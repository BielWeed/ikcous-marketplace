"use strict";

/**
 * ROLLBACK — o pacote do job se desfaz sem deixar rastro, e uma transação
 * interrompida no meio não grava metade.
 *
 * Tudo num CLONE do template `acl_antes` (o estado de produção), que some no fim:
 *
 *   A0. ESTRUTURA (estático): aplicar e desfazer começam em BEGIN; e terminam
 *      em COMMIT; (1 de cada, sem comentários).
 *   A. FALHA ANTES DO COMMIT: o pacote com uma divisão por zero injetada logo
 *      antes do COMMIT aborta — e a fotografia do banco continua IDÊNTICA à do
 *      antes. (Não prova o BEGIN: o protocolo simples do pg já é transação
 *      implícita; quem prova o BEGIN é a A0.)
 *   A2. TRAVA DO SERVIDOR (só pacote pequeno): variantes do SQL com um REVOKE de
 *      service_role inserido antes do DO final — numa função de FORA das 8 e
 *      numa das 8. O SQL tem de abortar ('conjunto de ausências do servidor
 *      mudou' no primeiro caso) e NADA pode ficar gravado.
 *   B. APLICA o pacote de verdade (tem de COMMITar). A fotografia muda — e, no
 *      pacote pequeno, muda EXATAMENTE nas 6 funções, de
 *      {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
 *      para {postgres=X/postgres,service_role=X/postgres}. O conjunto de
 *      funções que o servidor NÃO executa (lista e contagem impressas) é
 *      idêntico ao de antes. service_role e postgres (pg_cron) executam as 6.
 *   C. APLICA DE NOVO: no pequeno recusa na pré-condição sem mudar nada; no
 *      amplo é idempotente (mesma fotografia).
 *   D. DESFAZ: a fotografia fica IDÊNTICA à do antes — função a função, texto a
 *      texto (proacl cru, entradas, grantor); diferença impressa LITERAL. Ausências
 *      do servidor idênticas às de antes. As duas funções de emergência seguem
 *      fechadas; service_role e postgres executam as 6 também depois do rollback.
 *   D2. As variantes da A2 aplicadas ao SCRIPT DE DESFAZER (sobre o estado
 *      aplicado): abortam e nada fica gravado.
 *   E. DESFAZ DE NOVO: no pequeno recusa na pré-condição; no amplo idempotente;
 *      em ambos a fotografia continua igual à do antes.
 *
 * USO: PACOTE_ACL=seis|amplo node tests/banco/convergencia-acl/rollback.cjs
 */

const {
  BANCO_ANTES,
  BANCO_ROLLBACK,
  DUAS_FECHADAS,
  Falha,
  SEIS,
  anonExecuta,
  ausenciasDoServidor,
  clonarBanco,
  conectar,
  criarRelator,
  diferencas,
  executarSql,
  exigirAusenciasIguais,
  exigirBeginCommit,
  exigirIgual,
  falhar,
  fotografar,
  lerFixture,
  lerFotografia,
  mudancasAlemDasFechadas,
  pacoteDoJob,
  resumir,
  soltarBanco,
} = require("./comum.cjs");
const { seisExecutamParaServidor } = require("./convergencia-acl-viva.cjs");

const GRUPO = "ROLLBACK";

async function noClone(fn) {
  const c = await conectar(BANCO_ROLLBACK);
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}

const fotografiaDoClone = () => noClone(fotografar);
const ausenciasDoClone = () => noClone(ausenciasDoServidor);

const executaAsSeis = () =>
  noClone(async (c) => (await seisExecutamParaServidor(c)).join("; "));

/** Insere `comando` imediatamente antes do ÚLTIMO `DO $$` (o bloco de conferência final). */
function inserirAntesDoDoFinal(sql, comando) {
  const i = sql.lastIndexOf("DO $$");
  if (i < 0) throw new Falha("não achei o DO $$ final no SQL do pacote");
  return `${sql.slice(0, i)}${comando}\n\n${sql.slice(i)}`;
}

/** Uma função de fora das 8, que o servidor executa DIRETAMENTE (sem PUBLIC) — o REVOKE dela muda o conjunto. */
async function funcaoForaDasOito() {
  const nomes = [...SEIS.map((s) => s.sig), ...DUAS_FECHADAS].map(
    (s) => s.split("(")[0],
  );
  return noClone(async (c) => {
    const r = await c.query(
      `SELECT p.oid::regprocedure::text AS sig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname <> ALL ($1::text[])
          AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) x
                       WHERE x.grantee = 'service_role'::regrole::oid AND x.privilege_type = 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)
        ORDER BY 1 LIMIT 1`,
      [nomes],
    );
    if (r.rowCount !== 1)
      throw new Falha(
        "não achei função de fora das 8 com service_role direto e sem PUBLIC",
      );
    return r.rows[0].sig;
  });
}

const MENSAGENS_DA_TRAVA_DO_SERVIDOR = [
  "conjunto de ausências do servidor mudou",
  "servidor sem EXECUTE em",
  "ficou com proacl", // a checagem do texto do ACL das 8 vem ANTES das do servidor
  "reabriria a emergência",
];

async function main() {
  const pacote = pacoteDoJob();
  const relator = criarRelator();
  const antes = lerFotografia("antes");
  const ausenciasAntes = lerFotografia("ausencias-servidor-antes");
  const sigsSeis = SEIS.map((s) => s.sig);
  console.log(`[${GRUPO}] pacote: ${pacote.rotulo}`);

  const caso = async (nome, corpo) => {
    try {
      relator.ok(GRUPO, nome, await corpo());
    } catch (erro) {
      relator.falha(GRUPO, nome, erro);
    }
  };

  /**
   * Variantes com REVOKE de service_role inserido antes do DO final: têm de
   * ABORTAR e não deixar NADA gravado (fotografia igual a `estado`).
   */
  const variantesDaTrava = async (
    arquivo,
    estado,
    prefixoDaMensagem,
    rotulo,
  ) => {
    const original = lerFixture(arquivo);
    const fora = await funcaoForaDasOito();
    const dentro = "public.devolver_estoque(uuid)";
    await caso(
      `${rotulo}_revoke_de_service_role_FORA_das_8_aborta_e_nao_grava`,
      async () => {
        const erro = await executarSql(
          BANCO_ROLLBACK,
          inserirAntesDoDoFinal(
            original,
            `REVOKE EXECUTE ON FUNCTION ${fora} FROM service_role;`,
          ),
        );
        if (!erro)
          throw new Falha(`a variante com REVOKE em ${fora} NÃO abortou`);
        const alvo = `${prefixoDaMensagem}conjunto de ausências do servidor mudou`;
        if (!String(erro.message).includes(alvo)) {
          throw new Falha(
            `abortou, mas por outro motivo (esperava '${alvo}'): ${erro.code} ${erro.message}`,
          );
        }
        exigirIgual(
          estado,
          await fotografiaDoClone(),
          "depois do abort × estado anterior",
        );
        return `abortou (${erro.message}) e nada ficou gravado — REVOKE em ${fora}`;
      },
    );
    await caso(
      `${rotulo}_revoke_de_service_role_numa_das_8_aborta_e_nao_grava`,
      async () => {
        const erro = await executarSql(
          BANCO_ROLLBACK,
          inserirAntesDoDoFinal(
            original,
            `REVOKE EXECUTE ON FUNCTION ${dentro} FROM service_role;`,
          ),
        );
        if (!erro)
          throw new Falha(`a variante com REVOKE em ${dentro} NÃO abortou`);
        const qual = MENSAGENS_DA_TRAVA_DO_SERVIDOR.find((m) =>
          String(erro.message).includes(m),
        );
        if (!qual)
          throw new Falha(
            `abortou por motivo inesperado: ${erro.code} ${erro.message}`,
          );
        exigirIgual(
          estado,
          await fotografiaDoClone(),
          "depois do abort × estado anterior",
        );
        return `abortou (${erro.message}) e nada ficou gravado — a 1ª guarda a disparar foi '${qual}'`;
      },
    );
  };

  await clonarBanco(BANCO_ANTES, BANCO_ROLLBACK);
  let aplicou = false;
  try {
    await caso("clone_do_antes_e_fiel", async () => {
      exigirIgual(antes, await fotografiaDoClone(), "clone × antes");
      exigirAusenciasIguais(
        ausenciasAntes,
        await ausenciasDoClone(),
        "clone × antes",
      );
      return "fotografia e ausências do servidor do clone == antes";
    });

    // A0. ESTRUTURA: os dois arquivos do pacote são uma transação inteira.
    // (O caso A abaixo NÃO prova o BEGIN — ver o comentário dele.)
    await caso(
      "os_arquivos_do_pacote_abrem_BEGIN_e_fecham_COMMIT",
      async () => {
        return [pacote.aplica, pacote.desfaz]
          .map((arquivo) => exigirBeginCommit(lerFixture(arquivo), arquivo))
          .join(" · ");
      },
    );

    // A. FALHA ANTES DO COMMIT NÃO GRAVA. O texto vai por `client.query(texto)`
    // (protocolo simples), que já roda um texto de várias instruções numa
    // transação implícita; por isso esta injeção prova que uma falha entre as
    // mudanças e o COMMIT não deixa nada gravado, e NÃO prova que o arquivo
    // tem BEGIN (sem BEGIN também abortaria inteiro por este caminho). O BEGIN
    // e o COMMIT do arquivo são conferidos pelo caso estático A0.
    await caso("falha_antes_do_commit_nao_grava_metade", async () => {
      const original = lerFixture(pacote.aplica);
      const quebrado = original.replace(/COMMIT;\s*$/, "SELECT 1/0;\nCOMMIT;");
      if (quebrado === original) {
        throw new Falha(
          `${pacote.aplica} não termina em COMMIT; — não deu para injetar a falha`,
        );
      }
      const erro = await executarSql(BANCO_ROLLBACK, quebrado);
      if (!erro) throw new Falha("o pacote com falha injetada NÃO abortou");
      if (erro.code !== "22012")
        throw new Falha(
          `abortou por outro motivo: ${erro.code} ${erro.message}`,
        );
      exigirIgual(antes, await fotografiaDoClone(), "depois do abort × antes");
      return "abortou (22012) e a fotografia seguiu IDÊNTICA à do antes";
    });

    // A2. TRAVA DO SERVIDOR no script de aplicar (pacote pequeno)
    if (pacote.id === "seis") {
      await variantesDaTrava(pacote.aplica, antes, "", "aplicar");
    }

    // B. APLICA
    await caso("aplica_o_pacote_e_commita", async () => {
      const erro = await executarSql(BANCO_ROLLBACK, lerFixture(pacote.aplica));
      if (erro)
        throw new Falha(`${pacote.aplica} abortou: ${erro.message}`, [
          erro.where || "",
        ]);
      if (await anonExecuta(BANCO_ROLLBACK, pacote.sentinela)) {
        throw new Falha(
          `rodou sem erro mas, de conexão nova, anon ainda executa ${pacote.sentinela} (COMMIT não valeu)`,
        );
      }
      aplicou = true;
      return `${pacote.aplica} COMMITOU`;
    });
    let depois = null;
    if (aplicou) {
      depois = await fotografiaDoClone();
      await caso("a_fotografia_mudou_so_o_que_o_pacote_declara", async () => {
        const { soNoA, soNoB } = diferencas(antes, depois);
        if (soNoA.length + soNoB.length === 0)
          throw new Falha("o pacote não mudou NADA (prova vazia)");
        if (pacote.id === "seis") {
          const ruins = mudancasAlemDasFechadas(antes, depois, sigsSeis);
          if (ruins.length)
            throw new Falha(`${ruins.length} mudança(s) fora das 6`, ruins);
          return `exatamente as 6 (${soNoA.length} linhas saíram, ${soNoB.length} entraram)`;
        }
        return `${soNoA.length + soNoB.length} linhas mudaram`;
      });
      await caso(
        "ausencias_do_servidor_iguais_depois_da_aplicacao",
        async () => {
          exigirAusenciasIguais(
            ausenciasAntes,
            await ausenciasDoClone(),
            "depois da aplicação × antes",
          );
          return `${ausenciasAntes.length} ausência(s), lista idêntica`;
        },
      );
      await caso(
        "servidor_e_pg_cron_executam_as_6_depois_da_aplicacao",
        executaAsSeis,
      );

      // C. APLICA DE NOVO
      await caso(`aplicar_duas_vezes_${pacote.reaplicacao}`, async () => {
        const erro = await executarSql(
          BANCO_ROLLBACK,
          lerFixture(pacote.aplica),
        );
        if (pacote.reaplicacao === "recusa") {
          if (!erro)
            throw new Falha(
              "a 2ª aplicação NÃO foi recusada (esperava recusa na pré-condição)",
            );
          if (!String(erro.message).includes(pacote.mensagemRecusaAplicar)) {
            throw new Falha(
              `recusou por outro motivo: ${erro.code} ${erro.message}`,
            );
          }
        } else if (erro) {
          throw new Falha(`a 2ª aplicação abortou: ${erro.message}`);
        }
        exigirIgual(
          depois,
          await fotografiaDoClone(),
          "depois da 2ª aplicação × depois da 1ª",
        );
        return pacote.reaplicacao === "recusa"
          ? `recusada (${String(erro.message).slice(0, 90)}) e nada mudou`
          : "idempotente: mesma fotografia";
      });

      // Um grant surgido depois da aplicação não pode ser apagado pelo desfazer.
      if (pacote.id === "amplo") {
        await caso("desfazer_recusa_desvio_de_permissao", async () => {
          const bancoDesvio = "acl_rollback_desvio";
          await clonarBanco(BANCO_ROLLBACK, bancoDesvio);
          try {
            const cliente = await conectar(bancoDesvio);
            let desviado;
            try {
              await cliente.query(
                "GRANT EXECUTE ON FUNCTION public.check_is_admin() TO anon",
              );
              desviado = await fotografar(cliente);
            } finally {
              await cliente.end().catch(() => {});
            }
            const erro = await executarSql(
              bancoDesvio,
              lerFixture(pacote.desfaz),
            );
            if (
              !erro ||
              !String(erro.message).includes("pré-condição do desfazer")
            ) {
              throw new Falha("o desfazer não recusou a permissão alterada");
            }
            const leitura = await conectar(bancoDesvio);
            try {
              exigirIgual(
                desviado,
                await fotografar(leitura),
                "desvio depois do rollback recusado",
              );
            } finally {
              await leitura.end().catch(() => {});
            }
            return "desvio recusado sem gravar alterações";
          } finally {
            await soltarBanco(bancoDesvio).catch(() => {});
          }
        });
      }

      // D2. TRAVA DO SERVIDOR no script de desfazer (pacote pequeno), sobre o estado aplicado
      if (pacote.id === "seis") {
        await variantesDaTrava(pacote.desfaz, depois, "desfazer: ", "desfazer");
      }

      // D. DESFAZ
      let desfez = false;
      await caso("desfaz_e_commita", async () => {
        const erro = await executarSql(
          BANCO_ROLLBACK,
          lerFixture(pacote.desfaz),
        );
        if (erro)
          throw new Falha(`${pacote.desfaz} abortou: ${erro.message}`, [
            erro.where || "",
          ]);
        if (!(await anonExecuta(BANCO_ROLLBACK, pacote.sentinela))) {
          throw new Falha(
            `rodou sem erro mas, de conexão nova, anon NÃO executa ${pacote.sentinela} (COMMIT não valeu)`,
          );
        }
        desfez = true;
        return `${pacote.desfaz} COMMITOU`;
      });
      if (desfez) {
        await caso(
          "depois_do_rollback_a_fotografia_e_IDENTICA_a_do_antes",
          async () => {
            exigirIgual(
              antes,
              await fotografiaDoClone(),
              "depois do rollback × antes",
            );
            return "função a função, texto a texto (proacl cru, entradas, grantor, efetivo, relações, colunas)";
          },
        );
        await caso(
          "ausencias_do_servidor_iguais_depois_do_rollback",
          async () => {
            exigirAusenciasIguais(
              ausenciasAntes,
              await ausenciasDoClone(),
              "depois do rollback × antes",
            );
            return `${ausenciasAntes.length} ausência(s), lista idêntica`;
          },
        );
        await caso("emergencia_segue_fechada_depois_do_rollback", () =>
          noClone(async (c) => {
            const r = await c.query(`
              SELECT p.proname, p.proacl::text AS acl,
                     has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                     has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                     has_function_privilege('service_role', p.oid, 'EXECUTE') AS sr
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public'
                 AND p.proname IN ('confirmar_pagamento', 'devolver_uso_cupom')`);
            if (r.rowCount !== 2) throw new Falha(`achei ${r.rowCount} das 2`);
            const ruins = r.rows
              .filter((l) => l.anon || l.auth || !l.sr)
              .map(
                (l) =>
                  `${l.proname}: anon=${l.anon} authenticated=${l.auth} service_role=${l.sr} proacl=${l.acl}`,
              );
            if (ruins.length)
              throw new Falha("a emergência foi reaberta pelo rollback", ruins);
            return r.rows.map((l) => `${l.proname} ${l.acl}`).join(" · ");
          }),
        );
        await caso(
          "servidor_e_pg_cron_executam_as_6_depois_do_rollback",
          executaAsSeis,
        );

        // E. DESFAZ DE NOVO
        await caso(`desfazer_duas_vezes_${pacote.redesfazer}`, async () => {
          const erro = await executarSql(
            BANCO_ROLLBACK,
            lerFixture(pacote.desfaz),
          );
          if (pacote.redesfazer === "recusa") {
            if (!erro)
              throw new Falha(
                "o 2º desfazer NÃO foi recusado (esperava recusa na pré-condição)",
              );
            if (!String(erro.message).includes(pacote.mensagemRecusaDesfazer)) {
              throw new Falha(
                `recusou por outro motivo: ${erro.code} ${erro.message}`,
              );
            }
          } else if (erro) {
            throw new Falha(`o 2º desfazer abortou: ${erro.message}`);
          }
          exigirIgual(
            antes,
            await fotografiaDoClone(),
            "depois do 2º desfazer × antes",
          );
          return pacote.redesfazer === "recusa"
            ? `recusado (${String(erro.message).slice(0, 90)}) e nada mudou`
            : "idempotente: fotografia segue igual à do antes";
        });
      }
    }
  } finally {
    await soltarBanco(BANCO_ROLLBACK).catch(() => {});
  }

  resumir(`Permissões (${pacote.id}) — ROLLBACK`, relator.resultado);
  console.log(
    `\n${relator.resultado.ok} OK · ${relator.resultado.falhas} FALHA`,
  );
  if (relator.resultado.falhas > 0) process.exit(1);
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
