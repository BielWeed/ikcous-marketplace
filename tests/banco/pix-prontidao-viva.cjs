"use strict";

/**
 * PROVA VIVA da migration 20261186000000_o_balcao_sabe_se_o_pix_esta_pronto.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (num CLONE:
 * rodar-isolado.cjs). A prova estática (tests/migration_pix_do_balcao_pronto_test.ts)
 * confere o TEXTO; esta confere a EXECUÇÃO.
 *
 *   (0) ficha: STABLE, SECURITY INVOKER, search_path fechado; EXECUTE só do
 *       service_role (nem PUBLIC, nem anon, nem authenticated); controle: as
 *       peças das 84/85 estão no lugar.
 *   (1) service_role executa e recebe true no estado completo.
 *   (2) anon e authenticated recebem permission denied.
 *   (3) sem EXECUTE de authenticated em iniciar_venda_presencial_pix ou em
 *       anular_venda_presencial → false; o ROLLBACK restaura.
 *   (4) um dos dois gatilhos em modo R (só réplica) ou D (desligado), ou
 *       ausente → false; o ROLLBACK restaura. Controle positivo: em 'A'
 *       (always) continua true.
 *   (5) iniciar_venda_presencial_pix ou anular_venda_presencial ausente →
 *       false (nunca erro, nunca NULL); o ROLLBACK restaura.
 *   (6) o rollback manual da 86 derruba SÓ a função nova (funções, ACLs e
 *       gatilhos das 84/85 idênticos), e é idempotente; o ROLLBACK restaura.
 *
 * TODA mutação acontece dentro de BEGIN … ROLLBACK, no clone efêmero, e cada
 * caso confere (a) que a mutação pegou antes de medir e (b) que tudo voltou
 * depois.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/pix-prontidao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O único arquivo lido é o rollback-manual da 86, por caminho fixo deste repo. */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const INICIAR =
  "public.iniciar_venda_presencial_pix(jsonb,uuid,uuid,text,text,numeric,text)";
const ANULAR = "public.anular_venda_presencial(uuid,text)";
const PRONTO = "public.pix_do_balcao_pronto()";
const GATILHOS = [
  "tr_venda_do_balcao_paga_e_entregue",
  "tr_venda_do_balcao_guarda_o_status",
];
const ROLLBACK_86 = path.join(
  __dirname,
  "../../supabase/migrations/rollback-manual-20261186000000_o_balcao_sabe_se_o_pix_esta_pronto.sql",
);

async function um(cliente, sql, params = []) {
  return (await cliente.query(sql, params)).rows[0];
}

/** Roda `fn` dentro de BEGIN … ROLLBACK — nada do que ela fizer fica. */
async function emTransacao(cliente, fn) {
  await cliente.query("BEGIN");
  try {
    return await fn();
  } finally {
    await cliente.query("ROLLBACK");
  }
}

/** Dentro de uma transação já aberta: pergunta COMO service_role (a edge). */
async function prontoComoServidor(cliente) {
  await cliente.query("SET LOCAL ROLE service_role");
  const r = await um(cliente, `SELECT ${PRONTO} AS pronto`);
  await cliente.query("RESET ROLE");
  return r.pronto;
}

/** Fora de transação: a resposta no estado atual do clone. */
function pronto(cliente) {
  return emTransacao(cliente, () => prontoComoServidor(cliente));
}

async function authenticatedExecuta(cliente, assinatura) {
  return (
    await um(
      cliente,
      "SELECT has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS pode",
      [assinatura],
    )
  ).pode;
}

async function modoDoGatilho(cliente, nome) {
  const r = await um(
    cliente,
    `SELECT tgenabled FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.marketplace_orders'::regclass AND tgname = $1 AND NOT tgisinternal`,
    [nome],
  );
  return r ? r.tgenabled : null;
}

async function existe(cliente, assinatura) {
  return (
    await um(cliente, "SELECT to_regprocedure($1) IS NOT NULL AS existe", [
      assinatura,
    ])
  ).existe;
}

/**
 * O caso de mutação: dentro de UMA transação, aplica `mutacao`, confere com
 * `controle` que ela pegou, e mede como service_role — tem de ser `false`
 * (estrito: nem NULL, nem erro). Depois do ROLLBACK, `restaurado` confere a
 * peça e a resposta volta a ser `true`.
 */
async function exigirFalsoERestaurado(
  cliente,
  rotulo,
  { mutacao, controle, restaurado },
) {
  const dentro = await emTransacao(cliente, async () => {
    await cliente.query(mutacao);
    await controle();
    return prontoComoServidor(cliente);
  });
  assert.strictEqual(
    dentro,
    false,
    `${rotulo}: a prontidão devia ser false, veio ${dentro}`,
  );
  await restaurado();
  assert.strictEqual(
    await pronto(cliente),
    true,
    `${rotulo}: depois do ROLLBACK a prontidão devia voltar a true`,
  );
}

/** O que o rollback da 86 NÃO pode mexer: funções de public (com ACL e corpo) e os gatilhos do pedido. */
async function retratoDoEntorno(cliente) {
  const funcoes = (
    await cliente.query(
      `SELECT p.oid::regprocedure::text AS fn, p.proname,
              COALESCE(p.proacl::text, '') AS acl, md5(p.prosrc) AS corpo
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        ORDER BY 1`,
    )
  ).rows;
  const gatilhos = (
    await cliente.query(
      `SELECT tgname, tgenabled, tgfoid::regprocedure::text AS funcao
         FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.marketplace_orders'::regclass AND NOT tgisinternal
        ORDER BY 1`,
    )
  ).rows;
  return { funcoes, gatilhos };
}

const PROVAS = [];

PROVAS.push({
  nome: "(0) ficha da função e EXECUTE só do service_role; controle: as peças das 84/85 estão no lugar",
  corpo: async (cliente) => {
    const ficha = await um(
      cliente,
      `SELECT provolatile, prosecdef, proconfig, prorettype::regtype::text AS retorno
         FROM pg_catalog.pg_proc WHERE oid = to_regprocedure($1)`,
      [PRONTO],
    );
    assert.ok(ficha, "a função de prontidão não existe no banco migrado");
    assert.strictEqual(ficha.provolatile, "s", "tem de ser STABLE");
    assert.strictEqual(ficha.prosecdef, false, "tem de ser SECURITY INVOKER");
    assert.strictEqual(ficha.retorno, "boolean");
    assert.deepStrictEqual(ficha.proconfig, [
      "search_path=pg_catalog, pg_temp",
    ]);

    const acesso = await um(
      cliente,
      `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS auth,
              has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS sr,
              EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x
                       WHERE p.oid = $1::regprocedure AND x.grantee = 0) AS publico`,
      [PRONTO],
    );
    assert.deepStrictEqual(
      { ...acesso },
      { anon: false, auth: false, sr: true, publico: false },
    );

    // CONTROLE: sem isto, "false" nos casos abaixo não provaria nada.
    for (const assinatura of [INICIAR, ANULAR]) {
      assert.strictEqual(
        await existe(cliente, assinatura),
        true,
        `${assinatura} ausente no migrado`,
      );
      assert.strictEqual(
        await authenticatedExecuta(cliente, assinatura),
        true,
        `authenticated não executa ${assinatura} no migrado`,
      );
    }
    for (const gatilho of GATILHOS) {
      assert.strictEqual(
        await modoDoGatilho(cliente, gatilho),
        "O",
        `${gatilho} não está 'O' no migrado`,
      );
    }
  },
});

PROVAS.push({
  nome: "(1) service_role executa e recebe true no estado completo",
  corpo: async (cliente) => {
    assert.strictEqual(await pronto(cliente), true);
  },
});

PROVAS.push({
  nome: "(2) anon e authenticated recebem permission denied",
  corpo: async (cliente) => {
    for (const papel of ["anon", "authenticated"]) {
      await emTransacao(cliente, async () => {
        await cliente.query(`SET LOCAL ROLE ${papel}`);
        await assert.rejects(
          () => cliente.query(`SELECT ${PRONTO}`),
          /permission denied/,
          `${papel} executou a função de prontidão`,
        );
      });
    }
  },
});

PROVAS.push({
  nome: "(3) sem EXECUTE de authenticated numa função das 84/85 → false; o ROLLBACK restaura",
  corpo: async (cliente) => {
    for (const assinatura of [INICIAR, ANULAR]) {
      await exigirFalsoERestaurado(cliente, `revoke ${assinatura}`, {
        mutacao: `REVOKE EXECUTE ON FUNCTION ${assinatura} FROM authenticated`,
        controle: async () =>
          assert.strictEqual(
            await authenticatedExecuta(cliente, assinatura),
            false,
            `o REVOKE de controle não tirou o EXECUTE de ${assinatura}`,
          ),
        restaurado: async () =>
          assert.strictEqual(
            await authenticatedExecuta(cliente, assinatura),
            true,
          ),
      });
    }
  },
});

PROVAS.push({
  nome: "(4) gatilho em modo R (só réplica), D (desligado) ou ausente → false; o ROLLBACK restaura",
  corpo: async (cliente) => {
    for (const gatilho of GATILHOS) {
      for (const [modo, comando, esperado] of [
        [
          "R",
          `ALTER TABLE public.marketplace_orders ENABLE REPLICA TRIGGER ${gatilho}`,
          "R",
        ],
        [
          "D",
          `ALTER TABLE public.marketplace_orders DISABLE TRIGGER ${gatilho}`,
          "D",
        ],
        [
          "ausente",
          `DROP TRIGGER ${gatilho} ON public.marketplace_orders`,
          null,
        ],
      ]) {
        await exigirFalsoERestaurado(cliente, `${gatilho} ${modo}`, {
          mutacao: comando,
          controle: async () =>
            assert.strictEqual(
              await modoDoGatilho(cliente, gatilho),
              esperado,
              `o controle não deixou ${gatilho} em ${modo}`,
            ),
          restaurado: async () =>
            assert.strictEqual(await modoDoGatilho(cliente, gatilho), "O"),
        });
      }
      // CONTROLE POSITIVO: 'A' (always) dispara em sessão normal — a função
      // não pode responder false a qualquer ALTER, só aos modos que não disparam.
      const emA = await emTransacao(cliente, async () => {
        await cliente.query(
          `ALTER TABLE public.marketplace_orders ENABLE ALWAYS TRIGGER ${gatilho}`,
        );
        assert.strictEqual(await modoDoGatilho(cliente, gatilho), "A");
        return prontoComoServidor(cliente);
      });
      assert.strictEqual(
        emA,
        true,
        `${gatilho} em 'A' devia contar como pronto`,
      );
      assert.strictEqual(await modoDoGatilho(cliente, gatilho), "O");
    }
  },
});

PROVAS.push({
  nome: "(5) função das 84/85 ausente → false (nunca erro, nunca NULL); o ROLLBACK restaura",
  corpo: async (cliente) => {
    for (const assinatura of [INICIAR, ANULAR]) {
      await exigirFalsoERestaurado(cliente, `sem ${assinatura}`, {
        mutacao: `DROP FUNCTION ${assinatura}`,
        controle: async () =>
          assert.strictEqual(
            await existe(cliente, assinatura),
            false,
            `o DROP de controle não tirou ${assinatura}`,
          ),
        restaurado: async () =>
          assert.strictEqual(await existe(cliente, assinatura), true),
      });
    }
  },
});

PROVAS.push({
  nome: "(6) o rollback manual da 86 derruba SÓ a função nova e é idempotente; o ROLLBACK restaura",
  corpo: async (cliente) => {
    const sqlRollback = fs.readFileSync(ROLLBACK_86, "utf8");
    const antes = await retratoDoEntorno(cliente);
    assert.strictEqual(
      antes.funcoes.filter((f) => f.proname === "pix_do_balcao_pronto").length,
      1,
      "controle: a função de prontidão existe antes do rollback",
    );
    const esperado = {
      funcoes: antes.funcoes.filter(
        (f) => f.proname !== "pix_do_balcao_pronto",
      ),
      gatilhos: antes.gatilhos,
    };
    await emTransacao(cliente, async () => {
      await cliente.query(sqlRollback);
      await cliente.query(sqlRollback); // idempotente: IF EXISTS
      assert.strictEqual(
        await existe(cliente, PRONTO),
        false,
        "o rollback não derrubou a função",
      );
      assert.deepStrictEqual(
        await retratoDoEntorno(cliente),
        esperado,
        "o rollback mexeu em outra função, ACL ou gatilho",
      );
    });
    assert.strictEqual(
      await existe(cliente, PRONTO),
      true,
      "o ROLLBACK da transação não devolveu a função",
    );
    assert.deepStrictEqual(await retratoDoEntorno(cliente), antes);
    assert.strictEqual(await pronto(cliente), true);
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(
          "Prova viva da prontidão do PIX do balcão (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "A prontidão do PIX do balcão respondeu errado — ver acima qual caso.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[pix-prontidao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva da prontidão do PIX do balcão (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero (mutações só dentro de BEGIN … ROLLBACK).`,
  );
}

main();
