"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os unicos caminhos lidos sao os arquivos desta migration e das consultas 96a/96b, montados daqui (nunca entrada de rede). */
// SOMENTE Postgres efêmero do CI (rodar-isolado.cjs: clone descartável); nunca banco de loja.
// Migration 20261389100000: devolver_estoque tranca as linhas do pedido na MESMA ordem da compra (variações por id, depois produtos
// por id). Frente E / E2.
//
// Tudo com conexões reais e COMMIT, no clone descartável.
//  - O DEFEITO, provado: com o corpo da 20261175000000 duas conexões reais cruzam travas e o banco derruba uma com 40P01, em três
//    cenários deterministas (variação x variação, produto x variação, produto x produto). Com o corpo desta migration, nos MESMOS
//    cenários, ninguém é derrubado e o estoque é creditado uma vez só.
//  - O COMPORTAMENTO, igual: os dois corpos dão o mesmo retorno e o mesmo estoque nos mesmos pedidos (matriz diferencial).
//  - A migration: pré-voo, pós-voo, reaplicar (LF/CRLF), rollback byte a byte, consultas 96a/96b e mutantes.
//
// COMO A COMPRA É REPRESENTADA: a compra (create_marketplace_order_v23/v24) tranca, em ordem global, TODAS as variações do carrinho
// (um SELECT ... ORDER BY id FOR NO KEY UPDATE) e depois TODOS os produtos. Um SELECT assim não pode ser parado no meio, então o
// teste o parte em dois passos na mesma ordem (a primeira variação, a segunda variação / os produtos) e os separa pelo tempo que a
// outra conexão precisa para pedir a sua primeira trava. É a mesma sequência de travas da compra, com a pausa que o teste controla.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const ROOT = path.resolve(__dirname, "../..");
const ARQ =
  "20261389100000_o_estoque_que_volta_tranca_na_mesma_ordem_da_compra.sql";
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const migration = ler(`supabase/migrations/${ARQ}`);
const rollback = ler(`supabase/migrations/rollback-manual-${ARQ}`);
const CONSULTA_A = ler(
  "scripts/publicacao/consultas/96a-conferir-o-estoque-que-volta-tranca-na-mesma-ordem-aplicado.sql",
);
const CONSULTA_B = ler(
  "scripts/publicacao/consultas/96b-antes-o-estoque-que-volta-tranca-na-mesma-ordem-base-vigente.sql",
);
const H_VIGENTE = "05f6f7e6ac7a2fa7793298110cf17e96"; // corpo da 20261175000000
const H_NOVO = "943b226906e91013e7cccf4992617e35"; // corpo desta migration

const url = lerDatabaseUrlEfemera();
const novoCliente = async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
};
const passo = (texto) => console.log(`  ok - ${texto}`);

// Fixtures fixas. Os ids de variação/produto crescem na ordem em que a COMPRA os tranca (a < b < c < ...).
const id = (grupo, n) =>
  `389${grupo}0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P_A = id(1, 1); // pai da variação V_A
const P_B = id(1, 2); // pai da variação V_B
const P_Q1 = id(1, 3); // produto simples
const P_Q2 = id(1, 4); // produto simples
const V_A = id(2, 1);
const V_B = id(2, 2);
const PEDIDOS = {
  // itens em ordem CONTRÁRIA à da compra
  VARIACAO_X_VARIACAO: id(3, 1), // [V_B (2), V_A (1)]
  PRODUTO_X_VARIACAO: id(3, 2), // [P_Q1 (2), V_A (1)]
  PRODUTO_X_PRODUTO: id(3, 3), // [P_Q2 (2), P_Q1 (1)]
  MISTO: id(3, 4), // [P_Q1 (1), V_B (2), V_A (3)]
  SEM_ITENS: id(3, 5),
  PRODUTO_COM_VARIACAO: id(3, 6), // item com product_id = P_Q1 e variant_id = V_A (o front manda os dois)
};

async function aplicar(c, sql) {
  await c.query("BEGIN");
  try {
    await c.query(sql);
    await c.query("COMMIT");
    return null;
  } catch (e) {
    await c.query("ROLLBACK");
    return { codigo: e.code, mensagem: e.message };
  }
}

async function erro(c, sql, params = []) {
  try {
    await c.query(sql, params);
    return null;
  } catch (e) {
    return { codigo: e.code, mensagem: e.message };
  }
}

const corpoVivo = async (c) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'devolver_estoque'",
    )
  ).rows[0].h;

async function conferir(c, sql, quantas, esperadoPorItem) {
  const r = (await c.query(sql)).rows;
  assert.equal(r.length, quantas);
  for (const x of r) {
    const certo = esperadoPorItem(x.item);
    assert.equal(x.ok, certo, `${x.item} -> ${x.ok}`);
  }
}

async function esperarBloqueio(monitor, pid) {
  for (let i = 0; i < 100; i++) {
    const r = await monitor.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("a conexão do estoque não esperou a trava da compra");
}

async function semear(c) {
  // Variações e produtos entram em ordem DECRESCENTE de id, para que uma leitura sem ORDER BY volte "ao contrário".
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo) VALUES
       ($1, 'Q2', 10, 100, true), ($2, 'Q1', 10, 100, true), ($3, 'B', 10, 0, true), ($4, 'A', 10, 0, true)
     ON CONFLICT (id) DO NOTHING`,
    [P_Q2, P_Q1, P_B, P_A],
  );
  await c.query(
    `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES
       ($1, $2, 'Tam', 'G', 10, true), ($3, $4, 'Tam', 'P', 10, true)
     ON CONFLICT (id) DO NOTHING`,
    [V_B, P_B, V_A, P_A],
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status)
     SELECT x, NULL, 'Prova 389', '{}'::jsonb, 10, 10, 'pending', 'online', 'pix', 'aguardando'
       FROM unnest($1::uuid[]) AS x
     ON CONFLICT (id) DO NOTHING`,
    [Object.values(PEDIDOS)],
  );
  const item = (pedido, produto, variacao, qtd) =>
    c.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
       VALUES ($1, $2, $3, 'Item 389', $4, 10)`,
      [pedido, produto, variacao, qtd],
    );
  await item(PEDIDOS.VARIACAO_X_VARIACAO, P_B, V_B, 2);
  await item(PEDIDOS.VARIACAO_X_VARIACAO, P_A, V_A, 1);
  await item(PEDIDOS.PRODUTO_X_VARIACAO, P_Q1, null, 2);
  await item(PEDIDOS.PRODUTO_X_VARIACAO, P_A, V_A, 1);
  await item(PEDIDOS.PRODUTO_X_PRODUTO, P_Q2, null, 2);
  await item(PEDIDOS.PRODUTO_X_PRODUTO, P_Q1, null, 1);
  await item(PEDIDOS.MISTO, P_Q1, null, 1);
  await item(PEDIDOS.MISTO, P_B, V_B, 2);
  await item(PEDIDOS.MISTO, P_A, V_A, 3);
  await item(PEDIDOS.PRODUTO_COM_VARIACAO, P_Q1, V_A, 4);
}

async function zerar(c) {
  await c.query(
    "UPDATE public.produtos SET estoque = CASE WHEN id IN ($1, $2) THEN 100 ELSE 0 END WHERE id IN ($1, $2, $3, $4)",
    [P_Q1, P_Q2, P_A, P_B],
  );
  await c.query(
    "UPDATE public.product_variants SET stock_increment = 10 WHERE id IN ($1, $2)",
    [V_A, V_B],
  );
  await c.query(
    "UPDATE public.marketplace_orders SET stock_returned_at = NULL WHERE id = ANY($1::uuid[])",
    [Object.values(PEDIDOS)],
  );
}

async function estoques(c) {
  const p = (
    await c.query(
      "SELECT id, estoque FROM public.produtos WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[P_A, P_B, P_Q1, P_Q2]],
    )
  ).rows;
  const v = (
    await c.query(
      "SELECT id, stock_increment FROM public.product_variants WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[V_A, V_B]],
    )
  ).rows;
  return {
    produtos: p.map((x) => Number(x.estoque)),
    variacoes: v.map((x) => Number(x.stock_increment)),
  };
}

// ---------- Os cenários de duas conexões ----------
// c1 = a compra (trava na ordem global, em passos); c2 = devolver_estoque do pedido. O monitor só observa pg_stat_activity.
async function cruzar({ pedido, passo1, passo2 }) {
  const [c1, c2, monitor] = [
    await novoCliente(),
    await novoCliente(),
    await novoCliente(),
  ];
  const resultado = { c1: "ok", c2: "ok", retorno: null };
  try {
    await zerar(monitor);
    const pid2 = (await c2.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await c1.query("BEGIN");
    await c1.query(passo1.sql, passo1.params); // a compra tranca a PRIMEIRA linha da ordem global
    await c2.query("BEGIN");
    const emVoo = c2
      .query("SELECT public.devolver_estoque($1) AS n", [pedido])
      .then(
        (r) => ({ n: Number(r.rows[0].n) }),
        (e) => ({ codigo: e.code }),
      );
    await esperarBloqueio(monitor, pid2); // o estoque ficou esperando a trava que a compra segura
    try {
      await c1.query(passo2.sql, passo2.params); // a compra pede a SEGUNDA trava (a que o estoque pode estar segurando)
    } catch (e) {
      resultado.c1 = e.code;
    }
    if (resultado.c1 === "ok") await c1.query("COMMIT");
    else await c1.query("ROLLBACK");
    const fim = await emVoo;
    if (fim.codigo) {
      resultado.c2 = fim.codigo;
      await c2.query("ROLLBACK");
    } else {
      resultado.retorno = fim.n;
      await c2.query("COMMIT");
    }
  } finally {
    await Promise.all([c1, c2, monitor].map((x) => x.end().catch(() => {})));
  }
  return resultado;
}

const trancaVariacoes = (ids) => ({
  sql: "SELECT 1 FROM public.product_variants v WHERE v.id = ANY($1::uuid[]) ORDER BY v.id FOR NO KEY UPDATE",
  params: [ids],
});
const trancaProdutos = (ids) => ({
  sql: "SELECT 1 FROM public.produtos p WHERE p.id = ANY($1::uuid[]) ORDER BY p.id FOR NO KEY UPDATE",
  params: [ids],
});

const CENARIOS = {
  // A compra de [V_A, V_B] tranca V_A e depois V_B. O estoque do pedido [V_B, V_A] (old) tranca V_B e espera V_A.
  "variação x variação": {
    pedido: PEDIDOS.VARIACAO_X_VARIACAO,
    passo1: trancaVariacoes([V_A]),
    passo2: trancaVariacoes([V_B]),
    credito: { produtos: [0, 0, 100, 100], variacoes: [11, 12], retorno: 3 },
  },
  // A compra de [V_A] + produto P_Q1 tranca V_A e depois os produtos. O estoque do pedido [P_Q1, V_A] (old) tranca P_Q1 e espera V_A.
  "produto x variação": {
    pedido: PEDIDOS.PRODUTO_X_VARIACAO,
    passo1: trancaVariacoes([V_A]),
    passo2: trancaProdutos([P_A, P_Q1]),
    credito: { produtos: [0, 0, 102, 100], variacoes: [11, 10], retorno: 3 },
  },
  // A compra de dois produtos tranca P_Q1 e depois P_Q2. O estoque do pedido [P_Q2, P_Q1] (old) tranca P_Q2 e espera P_Q1.
  "produto x produto": {
    pedido: PEDIDOS.PRODUTO_X_PRODUTO,
    passo1: trancaProdutos([P_Q1]),
    passo2: trancaProdutos([P_Q2]),
    credito: { produtos: [0, 0, 101, 102], variacoes: [10, 10], retorno: 3 },
  },
};

async function provaDosCenarios(esperaDeadlock, rotulo, c) {
  for (const [nome, cenario] of Object.entries(CENARIOS)) {
    const r = await cruzar(cenario);
    const derrubados = [r.c1, r.c2].filter((x) => x === "40P01").length;
    if (esperaDeadlock) {
      assert.equal(
        derrubados,
        1,
        `${rotulo} / ${nome}: o banco tinha de derrubar exatamente um (40P01), deu ${JSON.stringify(r)}`,
      );
    } else {
      assert.deepEqual(
        [r.c1, r.c2],
        ["ok", "ok"],
        `${rotulo} / ${nome}: ninguém pode ser derrubado: ${JSON.stringify(r)}`,
      );
      assert.equal(
        r.retorno,
        cenario.credito.retorno,
        `${rotulo} / ${nome}: unidades creditadas`,
      );
      const e = await estoques(c);
      assert.deepEqual(
        e.produtos,
        cenario.credito.produtos,
        `${rotulo} / ${nome}: produtos`,
      );
      assert.deepEqual(
        e.variacoes,
        cenario.credito.variacoes,
        `${rotulo} / ${nome}: variações`,
      );
    }
  }
}

// ---------- A matriz diferencial: o mesmo pedido dá o mesmo retorno e o mesmo estoque nos dois corpos ----------
async function matriz(c) {
  const saida = new Map();
  const casos = {
    "só produto simples": PEDIDOS.PRODUTO_X_PRODUTO,
    "só variação": PEDIDOS.VARIACAO_X_VARIACAO,
    "misto (produto + 2 variações)": PEDIDOS.MISTO,
    "produto x variação": PEDIDOS.PRODUTO_X_VARIACAO,
    "item com product_id E variant_id (só a variação é creditada)":
      PEDIDOS.PRODUTO_COM_VARIACAO,
    "pedido sem itens": PEDIDOS.SEM_ITENS,
    "pedido inexistente": id(9, 9),
  };
  for (const [nome, pedido] of Object.entries(casos)) {
    await zerar(c);
    await c.query("BEGIN");
    const primeira = Number(
      (await c.query("SELECT public.devolver_estoque($1) AS n", [pedido]))
        .rows[0].n,
    );
    const e1 = await estoques(c);
    const carimbo =
      (
        await c.query(
          "SELECT stock_returned_at IS NOT NULL AS c FROM public.marketplace_orders WHERE id = $1",
          [pedido],
        )
      ).rows[0]?.c ?? null;
    const segunda = Number(
      (await c.query("SELECT public.devolver_estoque($1) AS n", [pedido]))
        .rows[0].n,
    );
    const e2 = await estoques(c);
    await c.query("ROLLBACK");
    saida.set(nome, { primeira, e1, carimbo, segunda, e2 });
  }
  // Pedido que ja' foi devolvido por outro caminho: o carimbo presente devolve 0 sem creditar.
  await zerar(c);
  await c.query(
    "UPDATE public.marketplace_orders SET stock_returned_at = now() WHERE id = $1",
    [PEDIDOS.MISTO],
  );
  saida.set("carimbo já presente", {
    n: Number(
      (
        await c.query("SELECT public.devolver_estoque($1) AS n", [
          PEDIDOS.MISTO,
        ])
      ).rows[0].n,
    ),
    e: await estoques(c),
  });
  return Object.fromEntries(saida);
}

async function main() {
  const c = await novoCliente();
  try {
    // ---------- 1. Antes: o corpo vivo é o da 20261175000000 ----------
    // Dois pontos de partida, a prova vale nos dois: no clone de base a migration ainda não veio (corpo da 175); no CI ("Migrations do
    // zero") ela já veio no apply, e o estado de ANTES se obtém desfazendo com o rollback-manual, que devolve o corpo da 175 byte a byte.
    // Qualquer outro corpo (nem o da 175 nem o desta migration) NÃO é desfeito: a asserção abaixo reprova, sem afrouxar.
    if ((await corpoVivo(c)) === H_NOVO) {
      assert.equal(
        await aplicar(c, rollback),
        null,
        "o rollback-manual desfaz o corpo já aplicado",
      );
    }
    assert.equal(await corpoVivo(c), H_VIGENTE);
    const antes = (
      await c.query(
        "SELECT oid::int AS oid, proowner::regrole::text AS dono, proacl::text AS acl, obj_description(oid) AS comentario FROM pg_proc WHERE proname = 'devolver_estoque'",
      )
    ).rows[0];
    await conferir(c, CONSULTA_B, 4, () => true);
    await conferir(
      c,
      CONSULTA_A,
      3,
      (item) => item.startsWith("controle") || item.includes("atributos"),
    );
    passo(
      "antes: o corpo vivo é o da 20261175000000; a 96b confere e a 96a responde não (nunca erro)",
    );

    await semear(c);

    // ---------- 2. O DEFEITO: com o corpo antigo, duas conexões reais cruzam travas e o banco derruba uma ----------
    await provaDosCenarios(true, "corpo antigo", c);
    passo(
      "DEFEITO provado: com o corpo da 20261175000000 os 3 cenários (variação x variação, produto x variação, produto x produto) dão 40P01 em uma das duas conexões",
    );

    // ---------- 3. Matriz do corpo antigo (referência) ----------
    const matrizAntiga = await matriz(c);

    // ---------- 4. Aplica como o aplicador ----------
    assert.equal(await aplicar(c, migration), null);
    assert.equal(await corpoVivo(c), H_NOVO);
    await conferir(c, CONSULTA_A, 3, () => true);
    await conferir(
      c,
      CONSULTA_B,
      4,
      (item) =>
        item.startsWith("controle") ||
        item.includes("atributos") ||
        item.includes("existem como uuid"),
    );
    const depois = (
      await c.query(
        "SELECT oid::int AS oid, proowner::regrole::text AS dono, proacl::text AS acl, obj_description(oid) AS comentario FROM pg_proc WHERE proname = 'devolver_estoque'",
      )
    ).rows[0];
    assert.equal(depois.oid, antes.oid, "mesmo OID");
    assert.equal(depois.dono, antes.dono);
    assert.equal(depois.acl, antes.acl, "mesma ACL");
    assert.match(depois.comentario, /20261389100000/);
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'devolver_estoque'",
        )
      ).rows[0].n,
      1,
    );
    passo(
      "aplicada: corpo novo, mesmo OID, dono e ACL, uma assinatura só; 96a confere e 96b passa a dizer que o corpo vigente já não é o antigo",
    );

    // ---------- 5. O CONSERTO: nos MESMOS cenários ninguém é derrubado e o estoque é creditado uma vez ----------
    await provaDosCenarios(false, "corpo novo", c);
    passo(
      "CONSERTO provado: nos mesmos 3 cenários ninguém é derrubado e cada unidade é creditada uma vez só",
    );

    // ---------- 6. Mesmo comportamento: a matriz dos dois corpos é idêntica ----------
    const matrizNova = await matriz(c);
    assert.deepEqual(matrizNova, matrizAntiga);
    const mista = matrizNova["misto (produto + 2 variações)"];
    assert.equal(mista.primeira, 6, "1 + 2 + 3");
    assert.equal(mista.segunda, 0, "devolver duas vezes credita uma só");
    assert.deepEqual(mista.e1, mista.e2);
    assert.deepEqual(
      matrizNova["item com product_id E variant_id (só a variação é creditada)"]
        .e1.produtos,
      [0, 0, 100, 100],
    );
    passo(
      "matriz diferencial (8 casos, incluindo repetir, pedido inexistente, sem itens, carimbo presente e item com produto E variação): retorno e estoque IDÊNTICOS nos dois corpos",
    );

    // ---------- 7. Reaplicar: LF e CRLF ----------
    assert.equal(await aplicar(c, migration), null);
    assert.equal(await aplicar(c, migration.replace(/\n/g, "\r\n")), null);
    assert.equal(await corpoVivo(c), H_NOVO);
    await conferir(c, CONSULTA_A, 3, () => true);
    passo(
      "reaplicar duas vezes (LF e CRLF) deixa o mesmo corpo e a 96a segue conferindo",
    );

    // ---------- 8. Pré-voo e pós-voo ----------
    // (a) corpo desconhecido
    await c.query(
      "CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $x$ BEGIN RETURN 0; END; $x$",
    );
    let e = await aplicar(c, migration);
    assert.match(e?.mensagem ?? "", /B1_BASELINE_DIVERGENT/);
    assert.equal(
      (
        await c.query(
          "SELECT prosrc FROM pg_proc WHERE proname = 'devolver_estoque'",
        )
      ).rows[0].prosrc.trim(),
      "BEGIN RETURN 0; END;",
    );
    // (b) o rollback também recusa corpo desconhecido
    e = await aplicar(c, rollback);
    assert.match(e?.mensagem ?? "", /B1_BASELINE_DIVERGENT/);
    // volta ao corpo novo pelo próprio arquivo? Não pode (recusa): restaura o antigo à mão e reaplica.
    const antigo = rollback.slice(
      rollback.indexOf("CREATE OR REPLACE FUNCTION"),
      rollback.indexOf("COMMENT ON FUNCTION"),
    );
    await c.query(antigo);
    assert.equal(await corpoVivo(c), H_VIGENTE);
    // (c) ACL aberta para anon: recusa e não troca o corpo
    await c.query(
      "GRANT EXECUTE ON FUNCTION public.devolver_estoque(uuid) TO anon",
    );
    e = await aplicar(c, migration);
    assert.match(e?.mensagem ?? "", /B1_BASELINE_DIVERGENT/);
    assert.equal(await corpoVivo(c), H_VIGENTE, "ACL aberta: nada trocado");
    await c.query(
      "REVOKE EXECUTE ON FUNCTION public.devolver_estoque(uuid) FROM anon",
    );
    // (d) coluna que o bloco novo lê não existe: recusa
    await c.query(
      "ALTER TABLE public.marketplace_order_items RENAME COLUMN variant_id TO variant_id_x",
    );
    e = await aplicar(c, migration);
    await c.query(
      "ALTER TABLE public.marketplace_order_items RENAME COLUMN variant_id_x TO variant_id",
    );
    assert.match(e?.mensagem ?? "", /B1_BASELINE_DIVERGENT/);
    assert.equal(await corpoVivo(c), H_VIGENTE);
    // (e) pós-voo que falha desfaz o arquivo inteiro, numa conexão SEM BEGIN
    const sabotado = migration.replace(
      "DO $conferencia_20261389100000$",
      "ALTER FUNCTION public.devolver_estoque(uuid) SECURITY INVOKER;\nDO $conferencia_20261389100000$",
    );
    assert.notEqual(sabotado, migration);
    e = await erro(c, sabotado);
    assert.match(e?.mensagem ?? "", /B2_POSVOO_DIVERGENTE/);
    assert.equal(
      await corpoVivo(c),
      H_VIGENTE,
      "pós-voo que falha desfaz o arquivo inteiro",
    );
    passo(
      "pré-voo recusa corpo desconhecido, ACL aberta e coluna ausente sem trocar nada; pós-voo que falha desfaz tudo, numa conexão sem BEGIN",
    );

    // ---------- 9. Rollback: byte a byte, repetir é no-op ----------
    assert.equal(await aplicar(c, migration), null);
    assert.equal(await aplicar(c, rollback), null);
    assert.equal(await corpoVivo(c), H_VIGENTE);
    const volta = (
      await c.query(
        "SELECT obj_description(oid) AS comentario, proacl::text AS acl, oid::int AS oid FROM pg_proc WHERE proname = 'devolver_estoque'",
      )
    ).rows[0];
    assert.equal(
      volta.comentario,
      antes.comentario,
      "o comentário volta ao da 175",
    );
    assert.equal(volta.acl, antes.acl);
    assert.equal(volta.oid, antes.oid);
    assert.equal(
      await aplicar(c, rollback),
      null,
      "repetir o rollback é no-op",
    );
    assert.equal(await corpoVivo(c), H_VIGENTE);
    await conferir(c, CONSULTA_B, 4, () => true);
    // E o corpo antigo, de volta, volta a ter o defeito (o rollback é o rollback).
    await provaDosCenarios(true, "depois do rollback", c);
    assert.equal(await aplicar(c, migration), null);
    passo(
      "rollback devolve o corpo (md5) e o comentário da 175, mesmo OID e ACL; repetir é no-op; a 96b volta a conferir; o defeito volta junto",
    );

    // ---------- 10. Mutantes: a bateria dos cenários reprova quem tira uma peça ----------
    const corpoDaMigration = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.devolver_estoque"),
      migration.indexOf("COMMENT ON FUNCTION"),
    );
    const mutante = async (trocar, rotulo) => {
      const m = trocar(corpoDaMigration);
      assert.notEqual(
        m,
        corpoDaMigration,
        `${rotulo}: o mutante tem de mudar o texto`,
      );
      await c.query(m);
      let reprovou = false;
      try {
        await provaDosCenarios(false, rotulo, c);
      } catch {
        reprovou = true;
      }
      await c.query(corpoDaMigration);
      assert.equal(await corpoVivo(c), H_NOVO);
      assert.ok(reprovou, `${rotulo}: a bateria tinha de reprovar o mutante`);
    };
    await mutante(
      (t) =>
        t.replace(
          / {4}IF cardinality\(v_trava_variantes\) > 0 THEN[\s\S]*? {4}END IF;\n\n {4}SELECT COALESCE\(array_agg\(DISTINCT x\.product_id\)/,
          "    SELECT COALESCE(array_agg(DISTINCT x.product_id)",
        ),
      "mutante M1 (sem a trava das variações)",
    );
    await mutante(
      (t) =>
        t.replace(
          / {4}IF cardinality\(v_trava_produtos\) > 0 THEN[\s\S]*? {4}END IF;\n {4}-- <<< ordem global/,
          "    -- <<< ordem global",
        ),
      "mutante M2 (sem a trava dos produtos)",
    );
    await mutante(
      (t) =>
        t
          .replace(
            "ORDER BY v.id\n           FOR NO KEY UPDATE;",
            "FOR NO KEY UPDATE;",
          )
          .replace(
            "ORDER BY p.id\n           FOR NO KEY UPDATE;",
            "FOR NO KEY UPDATE;",
          ),
      "mutante M3 (travas sem ORDER BY)",
    );
    passo(
      "3 mutantes (sem a trava das variações, sem a dos produtos, sem ORDER BY) reprovam a bateria de cenários",
    );

    console.log(
      "\nO ESTOQUE QUE VOLTA TRANCA NA MESMA ORDEM DA COMPRA: prova viva completa.",
    );
  } finally {
    await c.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
