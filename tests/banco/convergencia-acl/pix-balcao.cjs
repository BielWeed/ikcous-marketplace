"use strict";

/**
 * PIX_BALCAO — as migrations 20261184 (o PIX do balcão abre na hora) e
 * 20261185 (a venda do balcão se anula no mesmo dia), do PR #741, ainda não
 * estão no código no ar. Aqui se prova que elas aplicam e que a prova viva
 * delas passa SOBRE o banco com o pacote de permissões aplicado.
 *
 * Para cada banco-base (o estado de antes e o banco depois do pacote):
 *   clone → aplica as duas migrations (das fixtures, fora de
 *   supabase/migrations) → roda `pix-do-balcao-viva.cjs` (idêntica à do PR;
 *   o `efemero.cjs` ao lado dela só repassa a trava de banco).
 * O veredito é por DIFERENÇA (compararAntesDepois): só falha se o pacote
 * quebrar o que passava no estado de antes.
 *
 * Falha de aplicação de uma migration é FALHA decisiva (code
 * MIGRACAO_NAO_APLICOU), mesmo se falhar igual nos dois estados: sem a
 * migration não há prova, e isso não é "falha pré-existente".
 *
 * AS DUAS ORDENS (só job `seis`, o primário; clones descartáveis, FALHA
 * decisiva). A ordem de aplicação em produção ainda não está decidida, então
 * as duas têm de funcionar:
 *   A. base -> migrations 84/85 -> seis-funcoes.sql (COMMITa). Depois: as 6
 *      fechadas para anon/authenticated e NADA além delas mudou;
 *      iniciar_venda_presencial_pix e anular_venda_presencial seguem
 *      executáveis por authenticated; emergência fechada; ausências do
 *      servidor iguais às medidas logo depois das migrations.
 *   B. base -> seis-funcoes.sql -> migrations 84/85 -> seis-funcoes-rollback.sql
 *      (COMMITa). Depois: a fotografia INTEIRA é igual à de base -> 84/85 (a
 *      referência, num clone à parte), as 6 voltaram ao texto exato do ACL
 *      aberto, emergência fechada, ausências iguais, funções novas executáveis.
 *
 * Informativo: o ACL final das funções que as duas migrations criam, no clone
 * do banco com o pacote (para registro de quem executa o quê).
 *
 * USO: PACOTE_ACL=seis|amplo node tests/banco/convergencia-acl/pix-balcao.cjs
 */

const path = require("node:path");
const {
  BANCO_ANTES,
  BANCO_PIX,
  DIR_FIXTURES,
  DUAS_FECHADAS,
  Falha,
  PROACL_ABERTA,
  PROACL_FECHADA,
  SEIS,
  anonExecuta,
  ausenciasDoServidor,
  clonarBanco,
  compararAntesDepois,
  conectar,
  criarRelator,
  executarSql,
  exigirAusenciasIguais,
  exigirIgual,
  falhar,
  fotografar,
  lerFixture,
  medirFuncoes,
  mudancasAlemDasFechadas,
  nomeDoBancoBase,
  pacoteDoJob,
  resumir,
  rodarNode,
  soltarBanco,
} = require("./comum.cjs");

const GRUPO = "PIX_BALCAO";
const MIGRATIONS = [
  "20261184000000_o_pix_do_balcao_abre_na_hora.sql",
  "20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql",
];

// As duas funções que o app do balcão chama: authenticated TEM de executá-las
// antes e depois do pacote (as migrations dão GRANT só a authenticated).
const FUNCOES_DO_BALCAO = [
  "iniciar_venda_presencial_pix",
  "anular_venda_presencial",
];

// Clones descartáveis das duas ordens (BANCO_PIX é o da comparação com a prova viva).
const BANCO_REFERENCIA = "acl_pix_ref";
const BANCO_ORDEM_A = "acl_pix_a";
const BANCO_ORDEM_B = "acl_pix_b";

async function noBanco(banco, fn) {
  const c = await conectar(banco);
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}

/** Aplica as duas migrations; qualquer erro lança Falha (a transação do arquivo já foi desfeita). */
async function aplicarMigrations(banco) {
  for (const arquivo of MIGRATIONS) {
    const erro = await executarSql(banco, lerFixture(arquivo));
    if (erro) {
      throw new Falha(
        `migration ${arquivo} NÃO aplicou em ${banco}: ${erro.code} ${erro.message}`,
        [erro.where || ""],
      );
    }
  }
}

/**
 * Roda um SQL do pacote (traz o próprio BEGIN…COMMIT) e prova, de conexão NOVA,
 * que COMMITOU: anon executa a sentinela depois? (`anonDepois`).
 */
async function aplicarPacote(banco, arquivo, sentinela, anonDepois) {
  const erro = await executarSql(banco, lerFixture(arquivo));
  if (erro) {
    throw new Falha(
      `${arquivo} abortou em ${banco}: ${erro.code} ${erro.message}`,
      [erro.where || ""],
    );
  }
  const anon = await anonExecuta(banco, sentinela);
  if (anon !== anonDepois) {
    throw new Falha(
      `${arquivo} rodou sem erro, mas de conexão nova anon ${anon ? "AINDA" : "NÃO"} executa ${sentinela} — o COMMIT não valeu`,
    );
  }
}

/** O que estas provas comparam: fotografia (texto exato do ACL), ausências do servidor, contagens. */
async function estadoDe(banco) {
  return noBanco(banco, async (c) => {
    const funcoes = await medirFuncoes(c);
    return {
      foto: await fotografar(c),
      ausencias: await ausenciasDoServidor(c),
      anon: funcoes.filter((f) => f.anon).length,
      auth: funcoes.filter((f) => f.auth).length,
      total: funcoes.length,
    };
  });
}

const contagem = (e) =>
  `${e.total} funções · anon executa ${e.anon} · authenticated executa ${e.auth} · ${e.ausencias.length} ausência(s) do servidor`;

/** As 6 e as 2 de emergência: texto do ACL e quem executa (anon, authenticated, service_role). */
async function aclDasOito(banco) {
  const nomes = [...SEIS.map((s) => s.sig), ...DUAS_FECHADAS].map(
    (s) => s.split("(")[0],
  );
  return noBanco(banco, async (c) => {
    const r = await c.query(
      `SELECT regexp_replace(p.oid::regprocedure::text, '^public\\.', '') AS fn,
              p.proacl::text AS acl,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS sr
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ANY ($1::text[])
        ORDER BY 1`,
      [nomes],
    );
    return r.rows;
  });
}

/**
 * Lança se as 6 não estão com o ACL `aclDasSeis` (e `anonEAuth` executando
 * ou não) ou se a emergência (as 2 fechadas) não está fechada; o servidor
 * executa as 8. Devolve texto para o relatório.
 */
function exigirOitoComo(linhas, aclDasSeis, rotulo, anonEAuth) {
  const ruins = [];
  const esperadas = SEIS.length + DUAS_FECHADAS.length;
  if (linhas.length !== esperadas) {
    ruins.push(`achei ${linhas.length} função(ões), esperava ${esperadas}`);
  }
  for (const l of linhas) {
    const seis = SEIS.some((s) => s.sig === l.fn);
    const acl = seis ? aclDasSeis : PROACL_FECHADA;
    const executa = seis ? anonEAuth : false;
    if (l.acl !== acl) ruins.push(`${l.fn}: proacl ${l.acl} (esperava ${acl})`);
    if (l.anon !== executa || l.auth !== executa) {
      ruins.push(
        `${l.fn}: anon=${l.anon} authenticated=${l.auth} (esperava ${executa} nos dois)`,
      );
    }
    if (!l.sr) ruins.push(`${l.fn}: service_role NÃO executa`);
  }
  if (ruins.length) throw new Falha(`${rotulo}: ACL das 8 diferente`, ruins);
  return linhas.map((l) => `${l.fn} ${l.acl}`).join(" · ");
}

/** As funções do balcão existem e authenticated as executa. Devolve texto para o relatório. */
async function exigirFuncoesDoBalcao(banco, rotulo) {
  const linhas = await noBanco(banco, async (c) => {
    const r = await c.query(
      `SELECT p.proname,
              regexp_replace(p.oid::regprocedure::text, '^public\\.', '') AS fn,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ANY ($1::text[])
        ORDER BY 2`,
      [FUNCOES_DO_BALCAO],
    );
    return r.rows;
  });
  const ruins = [];
  for (const nome of FUNCOES_DO_BALCAO) {
    if (!linhas.some((l) => l.proname === nome)) {
      ruins.push(`${nome}: a função não existe (a migration não criou?)`);
    }
  }
  for (const l of linhas) {
    if (!l.auth) ruins.push(`${l.fn}: authenticated NÃO executa`);
  }
  if (ruins.length) {
    throw new Falha(`${rotulo}: funções do balcão não executáveis`, ruins);
  }
  return linhas
    .map((l) => `${l.fn} anon=${l.anon} authenticated=${l.auth}`)
    .join(" · ");
}

/**
 * As duas ordens. Cada caso é FALHA decisiva (sem continue-on-error); se um
 * passo de montagem falha, os casos que dependem dele não rodam (a falha do
 * passo já está registrada).
 */
async function ordensDeAplicacao(relator, pacote) {
  const sigsSeis = SEIS.map((s) => s.sig);
  const caso = async (nome, corpo) => {
    try {
      relator.ok(GRUPO, nome, await corpo());
      return true;
    } catch (erro) {
      relator.falha(GRUPO, nome, erro);
      return false;
    }
  };

  try {
    // ---- A: base -> 84/85 -> pacote --------------------------------------
    await clonarBanco(BANCO_ANTES, BANCO_ORDEM_A);
    let antesDoPacote = null;
    const montouA = await caso(
      "ordem_A_base_depois_migrations_84_85_aplicam",
      async () => {
        await aplicarMigrations(BANCO_ORDEM_A);
        antesDoPacote = await estadoDe(BANCO_ORDEM_A);
        // CONTROLE: antes do pacote as funções do balcão já executam e as 6
        // estão abertas com o texto exato — sem isto, "depois" não prova nada.
        const novas = await exigirFuncoesDoBalcao(
          BANCO_ORDEM_A,
          "antes do pacote (controle)",
        );
        exigirOitoComo(
          await aclDasOito(BANCO_ORDEM_A),
          PROACL_ABERTA,
          "antes do pacote (controle)",
          true,
        );
        return `${contagem(antesDoPacote)} · ${novas}`;
      },
    );
    const aplicouA =
      montouA &&
      (await caso(
        "ordem_A_pacote_seis_commita_depois_das_migrations",
        async () => {
          await aplicarPacote(
            BANCO_ORDEM_A,
            pacote.aplica,
            pacote.sentinela,
            false,
          );
          return `${pacote.aplica} COMMITOU`;
        },
      ));
    if (aplicouA) {
      await caso(
        "ordem_A_as_6_fechadas_so_elas_mudaram_balcao_e_emergencia_intactos",
        async () => {
          const depois = await estadoDe(BANCO_ORDEM_A);
          console.log(
            `  ordem A: antes do pacote — ${contagem(antesDoPacote)}`,
          );
          console.log(`  ordem A: depois do pacote — ${contagem(depois)}`);
          // anon e authenticated perdem EXATAMENTE as 6 (6 + 6 pares).
          if (
            antesDoPacote.anon - depois.anon !== 6 ||
            antesDoPacote.auth - depois.auth !== 6
          ) {
            throw new Falha(
              `anon/authenticated deveriam perder exatamente 6 funções cada (anon ${antesDoPacote.anon}→${depois.anon}, authenticated ${antesDoPacote.auth}→${depois.auth})`,
            );
          }
          const ruins = mudancasAlemDasFechadas(
            antesDoPacote.foto,
            depois.foto,
            sigsSeis,
          );
          if (ruins.length) {
            throw new Falha(`${ruins.length} mudança(s) fora das 6`, ruins);
          }
          const oito = exigirOitoComo(
            await aclDasOito(BANCO_ORDEM_A),
            PROACL_FECHADA,
            "depois do pacote",
            false,
          );
          const novas = await exigirFuncoesDoBalcao(
            BANCO_ORDEM_A,
            "depois do pacote",
          );
          exigirAusenciasIguais(
            antesDoPacote.ausencias,
            depois.ausencias,
            "ordem A: depois do pacote × logo depois das migrations",
          );
          return `6 fechadas e só elas (anon ${antesDoPacote.anon}→${depois.anon}, authenticated ${antesDoPacote.auth}→${depois.auth}) · ${novas} · ${oito} · ${depois.ausencias.length} ausência(s) do servidor, lista idêntica`;
        },
      );
    }

    // ---- B: base -> pacote -> 84/85 -> rollback --------------------------
    // Referência: base -> 84/85, SEM pacote (o que o rollback tem de devolver).
    await clonarBanco(BANCO_ANTES, BANCO_REFERENCIA);
    let referencia = null;
    const montouRef = await caso(
      "ordem_B_referencia_base_depois_migrations_84_85_aplica",
      async () => {
        await aplicarMigrations(BANCO_REFERENCIA);
        referencia = await estadoDe(BANCO_REFERENCIA);
        return contagem(referencia);
      },
    );
    await soltarBanco(BANCO_REFERENCIA).catch(() => {});

    await clonarBanco(BANCO_ANTES, BANCO_ORDEM_B);
    const aplicouB = await caso(
      "ordem_B_pacote_seis_commita_na_base",
      async () => {
        await aplicarPacote(
          BANCO_ORDEM_B,
          pacote.aplica,
          pacote.sentinela,
          false,
        );
        return `${pacote.aplica} COMMITOU`;
      },
    );
    const migrouB =
      aplicouB &&
      (await caso(
        "ordem_B_migrations_84_85_aplicam_depois_do_pacote",
        async () => {
          await aplicarMigrations(BANCO_ORDEM_B);
          const novas = await exigirFuncoesDoBalcao(
            BANCO_ORDEM_B,
            "pacote aplicado, depois das migrations",
          );
          return `${contagem(await estadoDe(BANCO_ORDEM_B))} · ${novas}`;
        },
      ));
    const desfezB =
      migrouB &&
      (await caso(
        "ordem_B_rollback_commita_depois_das_migrations",
        async () => {
          await aplicarPacote(
            BANCO_ORDEM_B,
            pacote.desfaz,
            pacote.sentinela,
            true,
          );
          return `${pacote.desfaz} COMMITOU`;
        },
      ));
    if (desfezB && montouRef) {
      await caso(
        "ordem_B_fotografia_final_igual_a_de_base_mais_migrations",
        async () => {
          const final = await estadoDe(BANCO_ORDEM_B);
          console.log(
            `  ordem B: referência (base→84/85) — ${contagem(referencia)}`,
          );
          console.log(`  ordem B: depois do rollback — ${contagem(final)}`);
          exigirIgual(
            referencia.foto,
            final.foto,
            "ordem B: depois do rollback × base→84/85",
          );
          exigirAusenciasIguais(
            referencia.ausencias,
            final.ausencias,
            "ordem B: depois do rollback × base→84/85",
          );
          const oito = exigirOitoComo(
            await aclDasOito(BANCO_ORDEM_B),
            PROACL_ABERTA,
            "depois do rollback",
            true,
          );
          const novas = await exigirFuncoesDoBalcao(
            BANCO_ORDEM_B,
            "depois do rollback",
          );
          return `fotografia INTEIRA == base→84/85 (proacl textual de todas as funções) · ${oito} · ${novas}`;
        },
      );
    }
  } finally {
    for (const banco of [BANCO_ORDEM_A, BANCO_ORDEM_B, BANCO_REFERENCIA]) {
      await soltarBanco(banco).catch(() => {});
    }
  }
}

async function main() {
  const pacote = pacoteDoJob();
  const relator = criarRelator();
  console.log(`[${GRUPO}] pacote: ${pacote.rotulo}`);

  let aclRegistrado = false;
  const rodar = async (bancoBase) => {
    await clonarBanco(bancoBase, BANCO_PIX);
    try {
      for (const arquivo of MIGRATIONS) {
        const erro = await executarSql(BANCO_PIX, lerFixture(arquivo));
        if (erro) {
          // migracaoFalhou: o compararAntesDepois trata como FALHA decisiva,
          // nunca como "falha pré-existente".
          return {
            status: 1,
            migracaoFalhou: true,
            saida: `FALHOU migration ${arquivo} em ${bancoBase}: ${erro.message}\n${erro.where || ""}`,
          };
        }
      }
      if (bancoBase === nomeDoBancoBase() && !aclRegistrado) {
        aclRegistrado = true;
        const c = await conectar(BANCO_PIX);
        try {
          const r = await c.query(`
            SELECT regexp_replace(p.oid::regprocedure::text, '^public\\.', '') AS fn,
                   p.proacl::text AS acl,
                   has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                   has_function_privilege('service_role', p.oid, 'EXECUTE') AS sr
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname IN ('iniciar_venda_presencial_pix', 'anular_venda_presencial',
                                 'venda_do_balcao_paga_e_entregue', 'venda_do_balcao_guarda_o_status')
             ORDER BY 1`);
          relator.info(
            GRUPO,
            "acl_das_funcoes_novas_das_migrations_84_e_85",
            `${r.rowCount} função(ões) criadas pelas migrations (registro)`,
            r.rows.map(
              (l) =>
                `${l.fn}: anon=${l.anon} authenticated=${l.auth} service_role=${l.sr} proacl=${l.acl}`,
            ),
          );
        } finally {
          await c.end().catch(() => {});
        }
      }
      return rodarNode(
        [path.join(DIR_FIXTURES, "pix-do-balcao-viva.cjs")],
        BANCO_PIX,
      );
    } finally {
      await soltarBanco(BANCO_PIX).catch(() => {});
    }
  };

  await compararAntesDepois(
    relator,
    GRUPO,
    "migrations_84_85_e_prova_viva_do_pix_do_balcao",
    rodar,
    nomeDoBancoBase(),
  );

  if (pacote.id === "seis") await ordensDeAplicacao(relator, pacote);

  resumir(`Permissões (${pacote.id}) — PIX_BALCAO`, relator.resultado);
  console.log(
    `\n${relator.resultado.ok} OK · ${relator.resultado.falhas} FALHA · ${relator.resultado.infos} INFO`,
  );
  if (relator.resultado.falhas > 0) process.exit(1);
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
