"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (P, PRODUTOS) ou
 * do JSON da própria RPC no Postgres efêmero; nunca de entrada de rede. */

/**
 * PROVA VIVA da migration 20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * O DEFEITO: "Lucro se vender tudo" (tela de Produtos) é `inventory.totalValue
 * - inventory.totalCost` de `get_admin_analytics_v2`. O custo some quando o
 * produto não tem custo (`custo IS NULL`), mas o valor de venda contava TODO
 * produto — a venda inteira de quem não tem custo virava lucro.
 *
 * O QUE SE PROVA (tudo por DELTA: o clone pode já ter produto):
 *   (1) três produtos — P1 custo 10, preço 25, estoque 2; P2 SEM custo, preço
 *       100, estoque 3; P3 custo 5, preço 20, variações ativas 1+1 (estoque
 *       efetivo 2). `totalCost` = +30, `totalValue` = +90 (P1 + P3), o lucro
 *       = +60; `inventoryAlerts` = +3 (P1, P2, P3: estoque <= 5).
 *   (2) CONTROLE: com o corpo antigo (rollback-manual na transação)
 *       `totalValue` = +390 (P2 entra com 300) e o lucro +360; `totalCost` e
 *       `inventoryAlerts` iguais aos do corpo novo; o conjunto de chaves do
 *       JSON (em todos os níveis) idêntico.
 *   (3) a porta: cliente comum recusado com a mensagem de sempre; o corpo vivo
 *       é o que o preflight declara.
 *   (4) reaplicar 2x deixa a impressão digital igual; corpo divergente faz o
 *       preflight recusar (B1_BASELINE_DIVERGENT) sem escrever.
 *   (5) rollback-manual: volta ao md5 da 20261199000000 com SECURITY DEFINER,
 *       search_path, ACL, volatilidade e dono iguais; o segundo rollback
 *       recusa sem escrever; reaplicar volta ao corpo desta.
 *
 * Toda prova que mexe em corpo de função roda numa transação DESFEITA no fim.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/inventario-so-com-custo-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");

const NOME_99 = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const NOME_14 =
  "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql";
const M14 = ler(NOME_14);
const RB14 = ler(`rollback-manual-${NOME_14}`);

// Os hashes (md5 de prosrc sem \r) lidos do PREFLIGHT de cada migration — a
// prova de texto amarra cada um ao md5 real do corpo.
function hashesDoPreflight(sql, assinatura) {
  const ini = sql.indexOf(`('${assinatura}', '`);
  const m =
    ini < 0
      ? null
      : /^\('[^']*', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/.exec(sql.slice(ini));
  assert.ok(m, `o preflight não cita os dois hashes de ${assinatura}`);
  return { vigente: m[1], desta: m[2] };
}
const ANALYTICS = "public.get_admin_analytics_v2(integer)";
const H14 = hashesDoPreflight(M14, ANALYTICS);
const H99 = hashesDoPreflight(ler(NOME_99), ANALYTICS);

const U_ADMIN = "c0570000-0000-4000-8000-0000000000a1";
const U_CLIENTE = "c0570000-0000-4000-8000-0000000000a2";
const P = {
  P1: "c0570000-0000-4000-8000-000000000001",
  P2: "c0570000-0000-4000-8000-000000000002",
  P3: "c0570000-0000-4000-8000-000000000003",
};
// `variacoes`: [stock_increment, active].
const PRODUTOS = [
  { id: P.P1, nome: "P1 com custo", custo: 10, preco: 25, estoque: 2 },
  { id: P.P2, nome: "P2 sem custo", custo: null, preco: 100, estoque: 3 },
  {
    id: P.P3,
    nome: "P3 com variações",
    custo: 5,
    preco: 20,
    estoque: 0,
    variacoes: [
      [1, true],
      [1, true],
    ],
  },
];

async function logar(c, uid) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [uid]);
}

/** O JSON inteiro de get_admin_analytics_v2(90), como o admin o lê. */
async function analytics(c) {
  await logar(c, U_ADMIN);
  const r = await c.query("SELECT public.get_admin_analytics_v2(90) AS r");
  return r.rows[0].r;
}

/** Os números do estoque (o que a tela de Produtos lê), por delta. */
function estoque(json) {
  const custo = Number(json.inventory.totalCost);
  const valor = Number(json.inventory.totalValue);
  return {
    custo,
    valor,
    // AdminProductsView.tsx (financialStats): potentialValue - invested.
    lucro: valor - custo,
    alertas: Number(json.inventoryAlerts),
  };
}
const centavos = (n) => Math.round(n * 100) / 100;
const delta = (depois, antes) =>
  Object.fromEntries(
    Object.keys(depois).map((k) => [k, centavos(depois[k] - antes[k])]),
  );

/** O conjunto de chaves do JSON em todos os níveis de objeto (sem listas). */
function chaves(json, prefixo = "") {
  const lista = [];
  for (const [k, v] of Object.entries(json)) {
    lista.push(`${prefixo}${k}`);
    if (v && typeof v === "object" && !Array.isArray(v))
      lista.push(...chaves(v, `${prefixo}${k}.`));
  }
  return lista.sort();
}

async function catalogo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, pg_get_functiondef(oid) AS def,
            prosecdef, coalesce(array_to_string(proconfig, ','), '') AS proconfig,
            coalesce(proacl::text, '') AS proacl, provolatile::text AS volatil,
            proowner::regrole::text AS dono
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

// Impressão digital: funções (public, auth), gatilhos, políticas e ACL de
// tabela/coluna — deparseadas com search_path = pg_catalog.
async function digital(c) {
  await c.query("SET search_path = pg_catalog");
  try {
    const r = await c.query(`
      SELECT 'fn ' || p.oid::regprocedure::text AS k,
             concat_ws(' | ', md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, ''),
                       p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                       p.provolatile::text, p.proowner::regrole::text,
                       pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)) AS v
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'tg ' || c.oid::regclass::text || '.' || t.tgname,
             concat_ws(' | ', pg_get_triggerdef(t.oid), t.tgenabled::text, t.tgtype::text)
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'pol ' || pol.polrelid::regclass::text || '.' || pol.polname,
             concat_ws(' | ', coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-'),
                       coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-'),
                       pol.polroles::regrole[]::text, pol.polcmd::text, pol.polpermissive::text)
        FROM pg_policy pol
      UNION ALL
      SELECT 'acl ' || c.oid::regclass::text, coalesce(c.relacl::text, '')
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
      UNION ALL
      SELECT 'col ' || a.attrelid::regclass::text || '.' || a.attname, a.attacl::text
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND a.attacl IS NOT NULL`);
    return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
  } finally {
    await c.query("RESET search_path");
  }
}

const PROVAS = [];
const fx = {};

PROVAS.push({
  nome: "(0) fixtures: admin atual, cliente comum e os três produtos (P1 com custo, P2 sem custo, P3 com variações); números de ANTES guardados",
  corpo: async (c) => {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@inventario.teste', '{"role":"admin"}'::jsonb),
         ($2, 'cliente@inventario.teste', '{}'::jsonb)`,
      [U_ADMIN, U_CLIENTE],
    );
    // 20261199000000 (admin ATUAL): o analytics exige o papel admin AGORA em
    // auth.users E em profiles — o admin da prova tem os dois.
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Inventário', 'admin'), ($2, 'Cliente Inventário', 'customer')`,
      [U_ADMIN, U_CLIENTE],
    );
    fx.antes = estoque(await analytics(c));

    for (const p of PRODUTOS) {
      await c.query(
        `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [p.id, `Inventário ${p.nome}`, p.preco, p.custo, p.estoque],
      );
      for (const [i, [quantidade, ativa]] of (p.variacoes || []).entries()) {
        await c.query(
          `INSERT INTO public.product_variants (product_id, name, value, stock_increment, active)
           VALUES ($1, 'Tamanho', $2, $3, $4)`,
          [p.id, `V${i + 1}`, quantidade, ativa],
        );
      }
    }
    const semCusto = await c.query(
      "SELECT custo IS NULL AS nulo FROM public.produtos WHERE id = $1",
      [P.P2],
    );
    assert.equal(semCusto.rows[0].nulo, true, "P2 tinha de nascer SEM custo");
  },
});

PROVAS.push({
  nome: "(1) totalCost +30, totalValue +90 (só P1 e P3), lucro +60, inventoryAlerts +3",
  corpo: async (c) => {
    const json = await analytics(c);
    fx.jsonNovo = json;
    const d = delta(estoque(json), fx.antes);
    console.log(`    corpo novo: ${JSON.stringify(d)}`);
    assert.deepEqual(d, { custo: 30, valor: 90, lucro: 60, alertas: 3 });
  },
});

PROVAS.push({
  nome: "(2) CONTROLE: com o corpo antigo (rollback-manual na transação) totalValue +390 e lucro +360; custo e alertas iguais; as chaves do JSON idênticas em todos os níveis",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(RB14);
      assert.equal((await catalogo(c, ANALYTICS)).hash, H14.vigente);
      const json = await analytics(c);
      const d = delta(estoque(json), fx.antes);
      console.log(`    corpo antigo: ${JSON.stringify(d)}`);
      assert.deepEqual(
        d,
        { custo: 30, valor: 390, lucro: 360, alertas: 3 },
        "CONTROLE FALHOU: o corpo antigo não infla o valor com o produto sem custo — a prova não mede a migration",
      );
      assert.deepEqual(
        chaves(json),
        chaves(fx.jsonNovo),
        "o conjunto de chaves do JSON mudou",
      );
    } finally {
      await c.query("ROLLBACK");
    }
    assert.equal((await catalogo(c, ANALYTICS)).hash, H14.desta);
  },
});

PROVAS.push({
  nome: "(3) a porta: cliente comum recusado com a mensagem de sempre; o corpo vivo é o que o preflight declara",
  corpo: async (c) => {
    assert.equal((await catalogo(c, ANALYTICS)).hash, H14.desta);
    assert.equal(H14.vigente, H99.desta, "o vigente da 14 é o que a 99 deixa");
    await logar(c, U_CLIENTE);
    await assert.rejects(
      c.query("SELECT public.get_admin_analytics_v2(90)"),
      /Acesso negado: privilégios de administrador necessários\./,
    );
  },
});

PROVAS.push({
  nome: "(4) reaplicar 2x não muda a impressão digital; corpo vivo divergente -> B1_BASELINE_DIVERGENT sem NENHUMA escrita",
  corpo: async (c) => {
    const antes = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(M14);
      await c.query(M14);
      assert.deepEqual(await digital(c), antes, "reaplicar mudou alguma coisa");
    } finally {
      await c.query("ROLLBACK");
    }
    await c.query("BEGIN");
    try {
      const def = (await catalogo(c, ANALYTICS)).def;
      const divergente = def.replace(
        "-- 0. Security Check",
        "-- 0. Security Check (divergente)",
      );
      assert.notEqual(divergente, def);
      await c.query(divergente);
      const antesDaRecusa = await digital(c);
      await c.query("SAVEPOINT aplicar");
      await assert.rejects(
        c.query(M14),
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.get_admin_analytics_v2\(integer\)/,
      );
      await c.query("ROLLBACK TO SAVEPOINT aplicar");
      assert.deepEqual(
        await digital(c),
        antesDaRecusa,
        "a recusa escreveu algo",
      );
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(5) rollback-manual: volta ao md5 da 20261199000000 com SECURITY DEFINER, search_path, ACL, volatilidade e dono iguais; 2o rollback recusa sem escrever; reaplicar volta ao corpo desta",
  corpo: async (c) => {
    const com = await catalogo(c, ANALYTICS);
    assert.equal(com.hash, H14.desta);
    await c.query("BEGIN");
    try {
      await c.query(RB14);
      const sem = await catalogo(c, ANALYTICS);
      assert.equal(
        sem.hash,
        H99.desta,
        "não voltou ao corpo da 20261199000000",
      );
      for (const k of ["prosecdef", "proconfig", "proacl", "volatil", "dono"]) {
        assert.equal(sem[k], com[k], `${k} mudou no rollback`);
      }
      const semDigital = await digital(c);
      await c.query("SAVEPOINT segundo");
      await assert.rejects(c.query(RB14), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT segundo");
      assert.deepEqual(
        await digital(c),
        semDigital,
        "o 2o rollback escreveu algo",
      );
      await c.query(M14);
      assert.equal((await catalogo(c, ANALYTICS)).hash, H14.desta);
    } finally {
      await c.query("ROLLBACK");
    }
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
          "Prova viva do lucro do estoque só com custo (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "O lucro do estoque voltou a contar produto sem custo — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[inventario-so-com-custo] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva do lucro do estoque só com custo (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
