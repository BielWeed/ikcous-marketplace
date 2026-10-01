"use strict";

/**
 * PASSO 2 — leva o banco efêmero (que nasceu das migrations) ao estado de
 * PERMISSÕES da loja principal em produção, medido em 01/10/2026, e CONFERE
 * que ficou exatamente nele. É este estado que a convergência recebe.
 *
 * A aplicação é o `reproduz-producao.sql` (uma transação só). As asserções
 * abaixo rodam DEPOIS, numa conexão nova, e cada uma imprime OK/FALHA:
 *   160 funções · anon 158 · authenticated 158 · 16 com PUBLIC explícito ·
 *   37 colunas com grant próprio · 55 relações com os 7 privilégios para anon
 *   e authenticated · nenhuma tabela com PUBLIC · proacl TEXTUAL das 8 funções
 *   de dinheiro · dono postgres · confirmar_pagamento e devolver_uso_cupom só de
 *   postgres e service_role · o servidor executa as 8 de dinheiro.
 *
 * SERVIDOR: "service_role executa tudo" NÃO é afirmado nem forçado. O conjunto
 * de funções que ele NÃO executa (as ausências que as migrations deixaram) é
 * medido ANTES e DEPOIS da reprodução, impresso (lista e contagem) e tem de ser
 * idêntico; é gravado para os passos seguintes compararem.
 *
 * USO: node tests/banco/convergencia-acl/reproduz-producao.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  DUAS_FECHADAS,
  Falha,
  PROACL_ABERTA,
  PROACL_FECHADA,
  PUBLICAS_EXPLICITAS,
  SEIS,
  SETE_PRIVILEGIOS,
  ausenciasDoServidor,
  conectar,
  criarRelator,
  diferencas,
  exigirAusenciasIguais,
  falhar,
  gravarFotografia,
  imprimirAusencias,
  medirFuncoes,
  medirRelacoes,
  resumir,
} = require("./comum.cjs");

const GRUPO = "REPRODUZ_PRODUCAO";

async function aplicarSql() {
  // Caminho fixo da fixture adjacente; a regra não reconhece path.join.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(
    path.join(__dirname, "reproduz-producao.sql"),
    "utf8",
  );
  const cliente = await conectar();
  try {
    await cliente.query('SET search_path = "$user", public, extensions');
    await cliente.query(sql);
  } catch (erro) {
    falhar(
      "ABORTOU",
      `reproduz-producao.sql abortou e a transação foi desfeita inteira: ${erro.message}\n${erro.where || ""}`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function main() {
  const relator = criarRelator();
  const antesDoReproduz = await conectar();
  let ausenciasAntes;
  try {
    ausenciasAntes = await ausenciasDoServidor(antesDoReproduz);
  } finally {
    await antesDoReproduz.end().catch(() => {});
  }
  imprimirAusencias(
    "estado-base do efêmero (migrations aplicadas, ANTES de reproduzir)",
    ausenciasAntes,
  );
  await aplicarSql();
  const cliente = await conectar();
  try {
    const funcoes = await medirFuncoes(cliente);
    const relacoes = await medirRelacoes(cliente);

    const caso = async (nome, corpo) => {
      try {
        relator.ok(GRUPO, nome, await corpo());
      } catch (erro) {
        relator.falha(GRUPO, nome, erro);
      }
    };

    await caso("160_funcoes", async () => {
      if (funcoes.length !== 160) {
        throw new Falha(`${funcoes.length} funções em public (esperado 160)`);
      }
      return "160";
    });

    await caso("anon_executa_158", async () => {
      const n = funcoes.filter((f) => f.anon).length;
      if (n !== 158) throw new Falha(`anon executa ${n} (esperado 158)`);
      return "158";
    });

    await caso("authenticated_executa_158", async () => {
      const n = funcoes.filter((f) => f.auth).length;
      if (n !== 158)
        throw new Falha(`authenticated executa ${n} (esperado 158)`);
      return "158";
    });

    await caso("16_com_PUBLIC_explicito", async () => {
      const achadas = funcoes
        .filter((f) => f.public_explicito)
        .map((f) => f.fn);
      const { soNoA: faltam, soNoB: sobram } = diferencas(
        PUBLICAS_EXPLICITAS,
        achadas,
      );
      if (faltam.length || sobram.length) {
        throw new Falha(`PUBLIC explícito: ${achadas.length} (esperado 16)`, [
          ...faltam.map((n) => `deveria ter PUBLIC e não tem: ${n}`),
          ...sobram.map((n) => `tem PUBLIC e não deveria: ${n}`),
        ]);
      }
      return "16";
    });

    await caso(
      "ausencias_do_servidor_iguais_antes_e_depois_da_reproducao",
      async () => {
        const depois = await ausenciasDoServidor(cliente);
        exigirAusenciasIguais(ausenciasAntes, depois, "reprodução");
        gravarFotografia("ausencias-servidor-antes", depois);
        return `${depois.length} ausência(s), as mesmas de antes (nada concedido, nada tirado)`;
      },
    );

    await caso("servidor_executa_as_8_funcoes_de_dinheiro", async () => {
      const oito = new Set([...SEIS.map((i) => i.sig), ...DUAS_FECHADAS]);
      const sem = funcoes
        .filter((f) => oito.has(f.fn) && !f.sr)
        .map((f) => f.fn);
      if (sem.length || funcoes.filter((f) => oito.has(f.fn)).length !== 8) {
        throw new Falha("service_role sem EXECUTE em função de dinheiro", sem);
      }
      return "8 de 8";
    });

    await caso("dono_postgres", async () => {
      const outros = funcoes
        .filter((f) => f.dono !== "postgres")
        .map((f) => `${f.fn} (${f.dono})`);
      if (outros.length) {
        throw new Falha(
          `${outros.length} função(ões) com dono diferente de postgres`,
          outros,
        );
      }
      return "160 de 160";
    });

    await caso("duas_fechadas_so_postgres_e_service_role", async () => {
      const r = await cliente.query(
        `SELECT regexp_replace(p.oid::regprocedure::text, '^public\\.', '') AS fn,
                CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
          WHERE n.nspname = 'public'
            AND regexp_replace(p.oid::regprocedure::text, '^public\\.', '') = ANY($1::text[])`,
        [DUAS_FECHADAS],
      );
      const porFuncao = new Map();
      for (const linha of r.rows) {
        if (!porFuncao.has(linha.fn)) porFuncao.set(linha.fn, new Set());
        porFuncao.get(linha.fn).add(linha.grantee);
      }
      if (porFuncao.size !== 2) {
        throw new Falha(`achei ${porFuncao.size} das 2 funções fechadas`);
      }
      const ruins = [...porFuncao]
        .map(([fn, grantees]) => [fn, [...grantees].sort().join(",")])
        .filter(([, grantees]) => grantees !== "postgres,service_role")
        .map(([fn, grantees]) => `${fn}: ${grantees}`);
      if (ruins.length) {
        throw new Falha("função fechada com grantee a mais ou a menos", ruins);
      }
      return "postgres,service_role";
    });

    // O texto CRU do ACL das 8 funções tem de ser IGUAL ao medido na produção
    // (mesma ordem de entradas, grantor postgres) — o SQL de correção exige
    // esse texto como pré-condição.
    await caso("proacl_exato_das_8_funcoes", async () => {
      const esperado = new Map([
        ...SEIS.map((item) => [item.sig, PROACL_ABERTA]),
        ...DUAS_FECHADAS.map((sig) => [sig, PROACL_FECHADA]),
      ]);
      const r = await cliente.query(
        `SELECT regexp_replace(p.oid::regprocedure::text, '^public\\.', '') AS fn,
                p.proacl::text AS acl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'`,
      );
      const real = new Map(r.rows.map((l) => [l.fn, l.acl]));
      const ruins = [];
      for (const [sig, acl] of esperado) {
        if (real.get(sig) !== acl) {
          ruins.push(
            `${sig}: proacl = ${real.get(sig)}`,
            `  esperado = ${acl}`,
          );
        }
      }
      if (ruins.length)
        throw new Falha(
          "proacl textual diferente do medido em produção",
          ruins,
        );
      return `6 × ${PROACL_ABERTA} · 2 × ${PROACL_FECHADA}`;
    });

    await caso("37_colunas_com_grant_proprio", async () => {
      const r = await cliente.query(`
        SELECT count(DISTINCT (c.relname, a.attname))::int AS n
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attacl IS NOT NULL`);
      if (r.rows[0].n !== 37) {
        throw new Falha(
          `${r.rows[0].n} colunas com grant próprio (esperado 37)`,
        );
      }
      return "37";
    });

    await caso("55_relacoes_com_os_7_privilegios", async () => {
      const nomes = new Set(relacoes.map((l) => l.relname));
      if (nomes.size !== 55) {
        throw new Falha(`${nomes.size} relações em public (esperado 55)`);
      }
      const todos = SETE_PRIVILEGIOS.join("");
      const ruins = relacoes
        .filter((l) => l.privs !== todos)
        .map((l) => `${l.relname} / ${l.papel}: tem '${l.privs}'`);
      if (ruins.length) {
        throw new Falha(
          `${ruins.length} combinação(ões) relação×papel sem os 7 privilégios`,
          ruins,
        );
      }
      return "55 relações × anon e authenticated × 7";
    });

    await caso("nenhuma_tabela_com_PUBLIC", async () => {
      const r = await cliente.query(`
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
           AND x.grantee = 0
         GROUP BY c.relname`);
      if (r.rowCount) {
        throw new Falha(
          `${r.rowCount} relação(ões) com PUBLIC`,
          r.rows.map((l) => l.relname),
        );
      }
      return "0";
    });
  } finally {
    await cliente.end().catch(() => {});
  }

  resumir(
    "Convergência de permissões — estado de produção reproduzido",
    relator.resultado,
  );
  if (relator.resultado.falhas > 0) {
    falhar(
      "FALHOU",
      `${relator.resultado.falhas} asserção(ões) sobre o estado de produção reproduzido falharam.`,
    );
  }
  console.log(`[${GRUPO}] banco no estado de produção de 01/10/2026.`);
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
