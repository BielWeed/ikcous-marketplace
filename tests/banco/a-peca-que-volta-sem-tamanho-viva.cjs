"use strict";

/**
 * Prova VIVA da migration 20261642000000 (a peca que volta sem tamanho espera a lojista). So Postgres EFEMERO, num CLONE proprio
 * (rodar-isolado.cjs): nunca banco de loja.
 *
 * O DEFEITO (controle): produto sem tamanhos vende 1 peca; a lojista cria a grade (variacao LIGADA); o pedido antigo (item SEM
 * variacao) volta. Com os corpos de antes (rollback aplicado dentro da transacao da prova) o banco credita produtos.estoque, o
 * estoque do pai, que a compra ja nao vende. Com o corpo desta migration, no MESMO cenario, o pai nao muda e a peca espera em
 * pecas_sem_tamanho, com o pedido de origem.
 *
 * PROVAS (cada uma pelo nome na saida):
 *   1. controle do defeito (devolver_estoque e admin_devolucao_concluir com os corpos de antes) x o corpo novo;
 *   2. o resto e' IDENTICO: matriz diferencial (produto sem variacao, so com variacao desligada, item com variacao, item sem
 *      produto, quantidade 3, pedido misto) dá o mesmo estoque e o mesmo retorno nos dois corpos;
 *   3. pedido misto e quantidade: uma linha por PECA; repetir devolver_estoque nao cria nada (carimbo);
 *   4. devolucao concluida: o cantinho recebe a peca com o item da devolucao; reestocado_em gravado; 'reestocados' so o que
 *      voltou a venda e 'sem_tamanho' o resto; o cancelamento depois (achado C) nao cria de novo; "nao voltar" nao cria nada;
 *   5. pecas_sem_tamanho_pendentes: do produto, de todos, sem as resolvidas, na ordem; so o admin de agora;
 *   6. resolver_peca_sem_tamanho: credita +1 na variacao escolhida, fecha a linha, e e' IDEMPOTENTE (segundo toque, inclusive com
 *      outro tamanho, devolve a decisao e nao credita); "nao tenho essa peca" fecha sem creditar; recusas sem escrever nada;
 *   7. permissao: anon e service_role sem EXECUTE; cliente e admin rebaixado recusados (42501); a tabela fechada para todos;
 *   8. DUAS CONEXOES REAIS no mesmo toque: a segunda espera a trava e devolve ja_resolvida; o estoque sobe UMA vez;
 *   9. o Salvar de uma tela aberta antes NAO sobrescreve o estoque que a peca acabou de somar (PRD01 pela versao do produto);
 *  10. mutantes (cada um na guarda certa), restaurando o corpo exato depois;
 *  11. reaplicar (LF e CRLF), pre-voo, rollback (corpos de volta byte a byte, RPCs fora, tabela e linhas mantidas, o da 395 recusa
 *      antes dele), consultas 202a/202b.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-peca-que-volta-sem-tamanho-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (migrations, rollbacks e consultas), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  PECA_SEM_TAMANHO,
  HASH_DEVOLVER_DESTA,
  HASH_CONCLUIR_DESTA,
} = require("./a-peca-que-volta-sem-tamanho-posterior.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const NOME = PECA_SEM_TAMANHO.nome;
const NOME_395 =
  "20261395200000_a_conclusao_da_devolucao_tranca_na_mesma_ordem_da_compra.sql";
const norm = (s) => s.replace(/\r\n/g, "\n");
const lerMigration = (n) =>
  norm(fs.readFileSync(path.join(RAIZ, "supabase", "migrations", n), "utf8"));
const lerConsulta = (n) =>
  fs.readFileSync(
    path.join(RAIZ, "scripts", "publicacao", "consultas", `${n}.sql`),
    "utf8",
  );

const MIGRATION = lerMigration(NOME);
const ROLLBACK = lerMigration(`rollback-manual-${NOME}`);
const ROLLBACK_395 = lerMigration(`rollback-manual-${NOME_395}`);
const FICHA_A = lerConsulta(
  "202a-conferir-a-peca-que-volta-sem-tamanho-aplicado",
);
const FICHA_B = lerConsulta(
  "202b-antes-a-peca-que-volta-sem-tamanho-base-vigente",
);

const H_DEV_389 = "943b226906e91013e7cccf4992617e35";
const blocoDe = (sql, inicio, fim) => {
  const i = sql.indexOf(inicio);
  assert.ok(i >= 0, `bloco ausente: ${inicio}`);
  return sql.slice(i, sql.indexOf(fim, i) + fim.length);
};
const DEVOLVER_389 = blocoDe(
  lerMigration(
    "20261389100000_o_estoque_que_volta_tranca_na_mesma_ordem_da_compra.sql",
  ),
  "CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)",
  "\n$devolver$;",
);
const CONCLUIR_395 = blocoDe(
  lerMigration(NOME_395),
  "CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(",
  "\n$$;",
);
const H_CONCL_395 = "a152c8dcd7cf6d1e05e5aff128d6c45e";

const ADMIN = "7e7e1642-0000-4000-8000-0000000000a1";
const REBAIXADO = "7e7e1642-0000-4000-8000-0000000000a2";
const CLIENTE = "7e7e1642-0000-4000-8000-0000000000c1";
const CLAIMS_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const CLAIMS_CLIENTE = JSON.stringify({ role: "authenticated" });

let C;
let D;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

// ---------------------------------------------------------------------------
// Fixture e chamadas
// ---------------------------------------------------------------------------
async function semearPessoas() {
  for (const [id, meta, papel] of [
    [ADMIN, '{"role":"admin"}', "admin"],
    // Rebaixado: o JWT ainda diz admin, mas o profiles ja diz customer (is_admin_atual recusa).
    [REBAIXADO, '{"role":"admin"}', "customer"],
    [CLIENTE, "{}", "customer"],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, $1::text || '@r1642.invalid', $2::jsonb)`,
      [id, meta],
    );
    await C.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa ficticia R1642', $2)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [id, papel],
    );
  }
}

/** Produto com estoque `estoque` no pai e as variacoes [{valor, estoque, ativa}]. Devolve { produto, v: { valor: id } }. */
async function produto(c, { estoque = 0, variacoes = [] } = {}) {
  const id = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo)
     VALUES ($1, 'Blusa ficticia R1642', 10, 50, $2, true)`,
    [id, estoque],
  );
  const ids = [];
  for (const { valor, estoque: e = 0, ativa = true } of variacoes) {
    const variacao = crypto.randomUUID();
    ids.push([valor, variacao]);
    await c.query(
      `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active)
       VALUES ($1, $2, 'Tamanho', $3, $4, $5)`,
      [variacao, id, valor, e, ativa],
    );
  }
  return { produto: id, v: Object.fromEntries(ids) };
}

/** Pedido com os itens [{p, v, q}] (produto, variacao ou null, quantidade). Devolve { order, itens: [ids] }. */
async function pedido(c, itens, { status = "cancelled" } = {}) {
  const order = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal, payment_method, payment_status)
     VALUES ($1, $2, 'Pessoa ficticia R1642', '{}'::jsonb, 50, 50, 0, $3, 'online', 'pix', 'aguardando')`,
    [order, CLIENTE, status],
  );
  const ids = [];
  for (const { p, v, q } of itens) {
    ids.push(
      (
        await c.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
           VALUES ($1, $2, $3, 'Item R1642', $4, 50) RETURNING id`,
          [order, p, v, q],
        )
      ).rows[0].id,
    );
  }
  return { order, itens: ids };
}

/** Pedido ENTREGUE e pago, com uma devolucao 'recebida' e um devolucao_itens por item. */
async function devolucao(c, itens) {
  const order = crypto.randomUUID();
  const dev = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal, payment_method, payment_status, paid_at,
        pagamento_recebido_em, gateway_payment_id, valor_estornado)
     VALUES ($1, $2, 'Pessoa ficticia R1642', '{}'::jsonb, 100, 100, 0, 'delivered', 'online', 'online', 'pago', now(), now(), $3, 0)`,
    [order, CLIENTE, `ORD-R1642-${order}`],
  );
  await c.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno, status, valor_itens,
        valor_frete_ida, prazo_ate, politica)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'outro', 'reembolso', 'nacional', 'envio_proprio', 'recebida', 50, 0, current_date + 7, '{}')`,
    [dev, `DEV-R1642-${dev.slice(0, 8)}`, order, CLIENTE],
  );
  const di = [];
  const oi = [];
  for (const { p, v, q } of itens) {
    const item = (
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
         VALUES ($1, $2, $3, 'Item R1642', $4, 50) RETURNING id`,
        [order, p, v, q],
      )
    ).rows[0].id;
    oi.push(item);
    di.push(
      (
        await c.query(
          `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, variant_id, product_name, quantidade, valor_unitario)
           VALUES ($1, $2, $3, $4, 'Item R1642', $5, 50) RETURNING id`,
          [dev, item, p, v, q],
        )
      ).rows[0].id,
    );
  }
  return { order, dev, di, oi };
}

/** O erro volta ao savepoint e nao derruba a transacao da prova. */
async function chamar(
  conn,
  sql,
  params = [],
  { papel = "authenticated", uid = ADMIN, claims = CLAIMS_ADMIN } = {},
) {
  await conn.query("SAVEPOINT tentativa");
  try {
    await conn.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [uid ?? "", claims],
    );
    await conn.query(`SET LOCAL ROLE ${papel}`);
    const r = await conn.query(sql, params);
    await conn.query("RESET ROLE");
    await conn.query("RELEASE SAVEPOINT tentativa");
    return { linhas: r.rows };
  } catch (e) {
    await conn.query("ROLLBACK TO SAVEPOINT tentativa");
    await conn.query("RESET ROLE");
    await conn.query("RELEASE SAVEPOINT tentativa");
    return { erro: e.message, codigo: e.code };
  }
}

const resolver = (conn, peca, variante, opcoes) =>
  chamar(
    conn,
    "SELECT public.resolver_peca_sem_tamanho($1::uuid, $2::uuid) AS r",
    [peca, variante],
    opcoes,
  );
const pendentesRpc = (conn, produtoId, opcoes) =>
  chamar(
    conn,
    "SELECT * FROM public.pecas_sem_tamanho_pendentes($1::uuid)",
    [produtoId],
    opcoes,
  );
const concluir = (conn, dev, itens) =>
  chamar(
    conn,
    "SELECT public.admin_devolucao_concluir($1::uuid, 'troca', $2::jsonb, NULL, NULL) AS r",
    [dev, JSON.stringify(itens)],
  );
const ok = (r) => {
  assert.equal(r.erro, undefined, `a chamada foi recusada: ${r.erro}`);
  return r.linhas;
};

async function emTransacao(corpo) {
  await C.query("BEGIN");
  try {
    await corpo();
  } finally {
    await C.query("ROLLBACK");
  }
}
/** Roda SQL qualquer (superusuario) sem derrubar a transacao. */
async function tentarSql(sql) {
  await C.query("SAVEPOINT tentar_sql");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT tentar_sql");
    return {};
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentar_sql");
    await C.query("RELEASE SAVEPOINT tentar_sql");
    return { erro: e.message, codigo: e.code };
  }
}

const um = async (sql, params = [], c = C) =>
  (await c.query(sql, params)).rows[0];
const estoquePai = async (p, c = C) =>
  (await um("SELECT estoque FROM public.produtos WHERE id = $1", [p], c))
    .estoque;
const estoqueVar = async (v, c = C) =>
  (
    await um(
      "SELECT stock_increment FROM public.product_variants WHERE id = $1",
      [v],
      c,
    )
  ).stock_increment;
const cantinho = async (p, c = C) =>
  (
    await c.query(
      `SELECT id, order_id, order_item_id, devolucao_item_id, origem, resolvida_em, resolucao, variant_id, resolvida_por
         FROM public.pecas_sem_tamanho WHERE produto_id = $1 ORDER BY criada_em, id`,
      [p],
    )
  ).rows;
const devolverEstoque = async (order, c = C) =>
  (await um("SELECT public.devolver_estoque($1) AS n", [order], c)).n;
const hashDe = async (assinatura, c = C) =>
  (
    await um(
      `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`,
      [assinatura],
      c,
    )
  )?.h ?? null;
const hashDevolver = (c) => hashDe("public.devolver_estoque(uuid)", c);
const hashConcluir = (c) =>
  hashDe("public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)", c);
const rpcsNoAr = async () =>
  (
    await um(
      `SELECT to_regprocedure('public.pecas_sem_tamanho_pendentes(uuid)') IS NOT NULL
              AND to_regprocedure('public.resolver_peca_sem_tamanho(uuid,uuid)') IS NOT NULL AS sim`,
    )
  ).sim;

/**
 * Os corpos de ANTES, dentro da transacao aberta (o ROLLBACK do fim devolve os do banco). Pelos blocos das proprias migrations 389 e 395, e
 * nao pelo rollback desta: assim o controle tambem roda por cima de um MUTANTE (o pre-voo do rollback recusaria o corpo desconhecido e a
 * prova cairia no lugar errado).
 */
async function corposDeAntes() {
  await C.query(DEVOLVER_389);
  await C.query(CONCLUIR_395);
  assert.equal(await hashDevolver(), H_DEV_389);
  assert.equal(await hashConcluir(), H_CONCL_395);
}

// ---------------------------------------------------------------------------
// 1. O defeito (controle) x o corpo novo
// ---------------------------------------------------------------------------
async function cenarioDoDefeito() {
  const { produto: p, v } = await produto(C, {
    estoque: 0,
    variacoes: [{ valor: "P", estoque: 2 }],
  });
  const { order, itens } = await pedido(C, [{ p, v: null, q: 1 }]);
  const devolvidas = await devolverEstoque(order);
  const dev = await devolucao(C, [{ p, v: null, q: 1 }]);
  const r = ok(
    await concluir(C, dev.dev, [
      { item_id: dev.di[0], condicao: "nova", reestocar: true },
    ]),
  )[0].r;
  return { p, v, order, itens, devolvidas, dev, r };
}

async function provaDoDefeito() {
  await emTransacao(async () => {
    await corposDeAntes();
    const s = await cenarioDoDefeito();
    assert.equal(s.devolvidas, 1, "controle: o corpo de antes credita 1");
    assert.equal(
      await estoquePai(s.p),
      2,
      "controle: o pedido desfeito e a devolucao creditam o PAI (o defeito)",
    );
    assert.equal(await estoqueVar(s.v.P), 2);
    assert.equal(s.r.reestocados, 1);
    assert.equal(s.r.sem_tamanho, undefined);
    assert.equal(
      (await um("SELECT count(*)::int AS n FROM public.pecas_sem_tamanho")).n,
      0,
    );
  });
  await emTransacao(async () => {
    const s = await cenarioDoDefeito();
    assert.equal(s.devolvidas, 0, "a peca que espera nao conta como creditada");
    assert.equal(await estoquePai(s.p), 0, "o pai NAO recebe nada");
    assert.equal(await estoqueVar(s.v.P), 2, "a variacao nao muda sozinha");
    assert.equal(s.r.reestocados, 0);
    assert.equal(s.r.sem_tamanho, 1);
    const linhas = await cantinho(s.p);
    assert.equal(linhas.length, 2, "uma peca de cada volta");
    assert.deepEqual(linhas.map((l) => l.origem).sort(), [
      "devolucao",
      "pedido_desfeito",
    ]);
    const doPedido = linhas.find((l) => l.origem === "pedido_desfeito");
    assert.equal(doPedido.order_id, s.order);
    assert.equal(doPedido.order_item_id, s.itens[0]);
    assert.equal(doPedido.devolucao_item_id, null);
    const daDevolucao = linhas.find((l) => l.origem === "devolucao");
    assert.equal(daDevolucao.order_id, s.dev.order);
    assert.equal(daDevolucao.order_item_id, s.dev.oi[0]);
    assert.equal(daDevolucao.devolucao_item_id, s.dev.di[0]);
    for (const l of linhas) {
      assert.equal(l.resolvida_em, null);
      assert.equal(l.resolucao, null);
      assert.equal(l.variant_id, null);
    }
  });
}

// ---------------------------------------------------------------------------
// 2. O resto e' identico: matriz diferencial entre os dois corpos
// ---------------------------------------------------------------------------
async function matriz() {
  const saida = [];
  // (a) produto SEM variacao; (b) produto so com variacao DESLIGADA; (c) item COM variacao; (d) item sem produto; (e) quantidade 3
  const a = await produto(C, { estoque: 5 });
  const b = await produto(C, {
    estoque: 5,
    variacoes: [{ valor: "P", estoque: 1, ativa: false }],
  });
  const c = await produto(C, {
    estoque: 5,
    variacoes: [{ valor: "M", estoque: 1 }],
  });
  const e = await produto(C, { estoque: 0 });
  for (const [rotulo, itens] of [
    ["sem variacao", [{ p: a.produto, v: null, q: 2 }]],
    ["so variacao desligada", [{ p: b.produto, v: null, q: 1 }]],
    ["item com variacao", [{ p: c.produto, v: c.v.M, q: 1 }]],
    ["item sem produto", [{ p: null, v: null, q: 1 }]],
    ["quantidade 3", [{ p: e.produto, v: null, q: 3 }]],
  ]) {
    const { order } = await pedido(C, itens);
    const n = await devolverEstoque(order);
    const n2 = await devolverEstoque(order);
    saida.push({
      rotulo,
      n,
      n2,
      a: await estoquePai(a.produto),
      b: await estoquePai(b.produto),
      bv: await estoqueVar(b.v.P),
      c: await estoquePai(c.produto),
      cv: await estoqueVar(c.v.M),
      e: await estoquePai(e.produto),
    });
  }
  // A devolucao concluida: produto sem variacao e item com variacao.
  const dev = await devolucao(C, [
    { p: a.produto, v: null, q: 1 },
    { p: c.produto, v: c.v.M, q: 2 },
  ]);
  const r = ok(
    await concluir(C, dev.dev, [
      { item_id: dev.di[0], condicao: "nova", reestocar: true },
      { item_id: dev.di[1], condicao: "usada", reestocar: true },
    ]),
  )[0].r;
  saida.push({
    rotulo: "devolucao",
    reestocados: r.reestocados,
    a: await estoquePai(a.produto),
    c: await estoquePai(c.produto),
    cv: await estoqueVar(c.v.M),
  });
  saida.push({
    rotulo: "cantinho vazio",
    n: (await um("SELECT count(*)::int AS n FROM public.pecas_sem_tamanho")).n,
  });
  return saida;
}

async function provaDaMatriz() {
  let antes;
  let depois;
  await emTransacao(async () => {
    await corposDeAntes();
    antes = await matriz();
  });
  await emTransacao(async () => {
    depois = await matriz();
  });
  assert.deepEqual(depois, antes, "o que nao e' peca sem tamanho e' identico");
  // ancora: a matriz mede o que diz medir
  assert.deepEqual(
    antes.map((x) => x.n),
    // item sem produto: nada e' creditado, mas o corpo de antes ja contava a unidade (e o novo conta igual)
    [2, 1, 1, 1, 3, undefined, 0],
  );
}

// ---------------------------------------------------------------------------
// 3. Pedido misto, uma linha por peca, e repetir nao cria nada
// ---------------------------------------------------------------------------
async function provaDoPedidoMisto() {
  await emTransacao(async () => {
    const blusa = await produto(C, {
      estoque: 7,
      variacoes: [
        { valor: "P", estoque: 1 },
        { valor: "M", estoque: 1 },
      ],
    });
    const simples = await produto(C, { estoque: 4 });
    const { order } = await pedido(C, [
      { p: blusa.produto, v: blusa.v.M, q: 1 },
      { p: blusa.produto, v: null, q: 3 },
      { p: simples.produto, v: null, q: 2 },
    ]);
    assert.equal(
      await devolverEstoque(order),
      3,
      "1 da variacao + 2 do simples",
    );
    assert.equal(await estoquePai(blusa.produto), 7, "o pai da blusa nao muda");
    assert.equal(await estoqueVar(blusa.v.M), 2);
    assert.equal(await estoqueVar(blusa.v.P), 1);
    assert.equal(await estoquePai(simples.produto), 6);
    assert.equal(
      (await cantinho(blusa.produto)).length,
      3,
      "uma linha por PECA",
    );
    assert.equal((await cantinho(simples.produto)).length, 0);
    assert.equal(
      await devolverEstoque(order),
      0,
      "o carimbo segura a 2a volta",
    );
    assert.equal((await cantinho(blusa.produto)).length, 3, "nada a mais");
  });
}

// ---------------------------------------------------------------------------
// 4. Devolucao concluida
// ---------------------------------------------------------------------------
async function provaDaDevolucao() {
  await emTransacao(async () => {
    const blusa = await produto(C, {
      estoque: 0,
      variacoes: [{ valor: "G", estoque: 0 }],
    });
    const dev = await devolucao(C, [
      { p: blusa.produto, v: null, q: 2 },
      { p: blusa.produto, v: blusa.v.G, q: 1 },
    ]);
    const r = ok(
      await concluir(C, dev.dev, [
        { item_id: dev.di[0], condicao: "nova", reestocar: true },
        { item_id: dev.di[1], condicao: "nova", reestocar: true },
      ]),
    )[0].r;
    assert.equal(r.reestocados, 1, "so a da variacao voltou a venda");
    assert.equal(r.sem_tamanho, 2);
    assert.equal(await estoquePai(blusa.produto), 0);
    assert.equal(await estoqueVar(blusa.v.G), 1);
    const linhas = await cantinho(blusa.produto);
    assert.equal(linhas.length, 2);
    for (const l of linhas) {
      assert.equal(l.origem, "devolucao");
      assert.equal(l.devolucao_item_id, dev.di[0]);
      assert.equal(l.order_id, dev.order);
    }
    assert.notEqual(
      (
        await um(
          "SELECT reestocado_em FROM public.devolucao_itens WHERE id = $1",
          [dev.di[0]],
        )
      ).reestocado_em,
      null,
      "o carimbo do item e' gravado (a peca voltou)",
    );
    // Achado C: o cancelamento depois desconta o que a devolucao ja trouxe de volta, inclusive a que foi para o cantinho.
    assert.equal(await devolverEstoque(dev.order), 0);
    assert.equal((await cantinho(blusa.produto)).length, 2, "nada a mais");
    assert.equal(await estoqueVar(blusa.v.G), 1);

    // "Nao voltar ao estoque" e "nao veio" nao criam nada.
    const dev2 = await devolucao(C, [
      { p: blusa.produto, v: null, q: 1 },
      { p: blusa.produto, v: null, q: 1 },
    ]);
    const r2 = ok(
      await concluir(C, dev2.dev, [
        { item_id: dev2.di[0], condicao: "danificada", reestocar: false },
        { item_id: dev2.di[1], condicao: "ausente", reestocar: true },
      ]),
    )[0].r;
    assert.equal(r2.reestocados, 0);
    assert.equal(r2.sem_tamanho, 0);
    assert.equal((await cantinho(blusa.produto)).length, 2);
  });
}

// ---------------------------------------------------------------------------
// 5 e 6. A lista e a decisao da lojista
// ---------------------------------------------------------------------------
async function blusaComPecas(c, quantas) {
  const blusa = await produto(c, {
    estoque: 0,
    variacoes: [
      { valor: "P", estoque: 3 },
      { valor: "M", estoque: 3 },
      { valor: "G", estoque: 0, ativa: false },
    ],
  });
  const { order } = await pedido(c, [
    { p: blusa.produto, v: null, q: quantas },
  ]);
  await devolverEstoque(order, c);
  const pecas = (await cantinho(blusa.produto, c)).map((l) => l.id);
  assert.equal(pecas.length, quantas);
  return { ...blusa, order, pecas };
}

async function provaDaLista() {
  await emTransacao(async () => {
    const um1 = await blusaComPecas(C, 2);
    const um2 = await blusaComPecas(C, 1);
    const doProduto = ok(await pendentesRpc(C, um1.produto));
    assert.deepEqual(
      doProduto.map((l) => l.id),
      um1.pecas,
    );
    assert.deepEqual(Object.keys(doProduto[0]).sort(), [
      "criada_em",
      "id",
      "order_id",
      "origem",
      "produto_id",
    ]);
    assert.equal(doProduto[0].order_id, um1.order);
    assert.equal(doProduto[0].origem, "pedido_desfeito");
    const todas = ok(await pendentesRpc(C, null));
    for (const id of [...um1.pecas, ...um2.pecas])
      assert.ok(todas.some((l) => l.id === id));
    ok(await resolver(C, um1.pecas[0], um1.v.M));
    assert.deepEqual(
      ok(await pendentesRpc(C, um1.produto)).map((l) => l.id),
      [um1.pecas[1]],
      "a resolvida sai da lista",
    );
  });
}

async function provaDaDecisao() {
  await emTransacao(async () => {
    const b = await blusaComPecas(C, 3);
    const r1 = ok(await resolver(C, b.pecas[0], b.v.M))[0].r;
    assert.equal(r1.resolucao, "reposta");
    assert.equal(r1.variant_id, b.v.M);
    assert.equal(r1.ja_resolvida, false);
    assert.equal(r1.estoque_da_variacao, 4);
    assert.equal(r1.pendentes, 2);
    assert.equal(await estoqueVar(b.v.M), 4, "+1 na variacao escolhida");
    assert.equal(await estoqueVar(b.v.P), 3);
    assert.equal(await estoquePai(b.produto), 0, "o pai nunca");
    const linha = (await cantinho(b.produto)).find((l) => l.id === b.pecas[0]);
    assert.equal(linha.resolucao, "reposta");
    assert.equal(linha.variant_id, b.v.M);
    assert.notEqual(linha.resolvida_em, null);
    assert.equal(linha.resolvida_por, ADMIN);

    // Segundo toque (mesmo tamanho e outro tamanho): devolve a decisao, nao credita.
    for (const outra of [b.v.M, b.v.P, null]) {
      const r = ok(await resolver(C, b.pecas[0], outra))[0].r;
      assert.equal(r.ja_resolvida, true);
      assert.equal(r.resolucao, "reposta");
      assert.equal(r.variant_id, b.v.M);
      assert.equal(r.pendentes, 2);
    }
    assert.equal(await estoqueVar(b.v.M), 4, "dois toques nao creditam 2x");
    assert.equal(await estoqueVar(b.v.P), 3);

    // "Nao tenho essa peca".
    const r2 = ok(await resolver(C, b.pecas[1], null))[0].r;
    assert.equal(r2.resolucao, "descartada");
    assert.equal(r2.variant_id, null);
    assert.equal(r2.ja_resolvida, false);
    assert.equal(r2.pendentes, 1);
    assert.equal(await estoqueVar(b.v.M), 4);
    assert.equal(await estoqueVar(b.v.P), 3);
    const r2b = ok(await resolver(C, b.pecas[1], b.v.P))[0].r;
    assert.equal(r2b.ja_resolvida, true);
    assert.equal(r2b.resolucao, "descartada");
    assert.equal(await estoqueVar(b.v.P), 3, "a descartada nao vira reposta");

    // Recusas, sem escrever nada.
    const outro = await produto(C, { variacoes: [{ valor: "U", estoque: 1 }] });
    const antes = JSON.stringify(await cantinho(b.produto));
    for (const [rotulo, peca, variante, codigo] of [
      ["variacao de outro produto", b.pecas[2], outro.v.U, "22023"],
      ["variacao desligada", b.pecas[2], b.v.G, "22023"],
      ["variacao que nao existe", b.pecas[2], crypto.randomUUID(), "22023"],
      ["sem peca", null, b.v.M, "22023"],
      ["peca que nao existe", crypto.randomUUID(), b.v.M, "P0002"],
    ]) {
      const r = await resolver(C, peca, variante);
      assert.equal(r.codigo, codigo, `${rotulo}: ${r.erro}`);
    }
    assert.equal(JSON.stringify(await cantinho(b.produto)), antes);
    assert.equal(await estoqueVar(outro.v.U), 1);
    assert.equal(await estoqueVar(b.v.G), 0);

    // Estoque VAZIO (NULL, linha antiga): a peca soma 1, nunca fica "reposta" sem somar nada.
    await C.query(
      "UPDATE public.product_variants SET stock_increment = NULL WHERE id = $1",
      [b.v.P],
    );
    const r3 = ok(await resolver(C, b.pecas[2], b.v.P))[0].r;
    assert.equal(r3.resolucao, "reposta");
    assert.equal(r3.estoque_da_variacao, 1);
    assert.equal(await estoqueVar(b.v.P), 1, "NULL + a peca = 1");
  });
}

// ---------------------------------------------------------------------------
// 7. Permissao
// ---------------------------------------------------------------------------
async function provaDePermissao() {
  await emTransacao(async () => {
    const b = await blusaComPecas(C, 1);
    for (const [rotulo, opcoes, codigo] of [
      ["anon", { papel: "anon", uid: null, claims: "{}" }, "42501"],
      [
        "service_role",
        { papel: "service_role", uid: null, claims: '{"role":"service_role"}' },
        "42501",
      ],
      ["cliente", { uid: CLIENTE, claims: CLAIMS_CLIENTE }, "42501"],
      ["admin rebaixado", { uid: REBAIXADO, claims: CLAIMS_ADMIN }, "42501"],
    ]) {
      const r = await resolver(C, b.pecas[0], b.v.M, opcoes);
      assert.equal(r.codigo, codigo, `${rotulo} resolver: ${r.erro}`);
      const l = await pendentesRpc(C, b.produto, opcoes);
      assert.equal(l.codigo, codigo, `${rotulo} lista: ${l.erro}`);
      for (const sql of [
        "SELECT count(*) FROM public.pecas_sem_tamanho",
        `UPDATE public.pecas_sem_tamanho SET resolvida_em = now(), resolucao = 'descartada' WHERE id = '${b.pecas[0]}'`,
      ]) {
        const t = await chamar(C, sql, [], opcoes);
        assert.equal(t.codigo, "42501", `${rotulo} tabela: ${t.erro}`);
      }
    }
    assert.equal(await estoqueVar(b.v.M), 3, "ninguem de fora creditou");
    assert.equal((await cantinho(b.produto))[0].resolvida_em, null);
    // o admin de agora le a tabela? NAO: so pelas RPCs.
    const t = await chamar(C, "SELECT count(*) FROM public.pecas_sem_tamanho");
    assert.equal(t.codigo, "42501", "nem o admin le a tabela direto");
  });
}

// ---------------------------------------------------------------------------
// 8. Duas conexoes reais no mesmo toque
// ---------------------------------------------------------------------------
async function esperandoTrava(pidD, pidC, terminou) {
  for (let i = 0; i < 200; i++) {
    const r = await C.query(
      `SELECT wait_event_type = 'Lock' AND $2::int = ANY(pg_blocking_pids(pid)) AS espera
         FROM pg_stat_activity WHERE pid = $1`,
      [pidD, pidC],
    );
    if (r.rows[0]?.espera) return true;
    if (terminou()) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function provaDeDuasConexoes() {
  // Dado COMMITADO (as duas conexoes precisam ver), no clone descartavel.
  await C.query("BEGIN");
  const b = await blusaComPecas(C, 1);
  await C.query("COMMIT");
  const pidC = (await um("SELECT pg_backend_pid() AS p")).p;
  const pidD = (await um("SELECT pg_backend_pid() AS p", [], D)).p;
  for (const [rotuloD, variD] of [
    ["mesmo tamanho", b.v.M],
    ["outro tamanho", b.v.P],
    ["nao tenho", null],
  ]) {
    // Cada rodada com uma peca nova.
    await C.query("BEGIN");
    const { order } = await pedido(C, [{ p: b.produto, v: null, q: 1 }]);
    await devolverEstoque(order);
    const peca = (await cantinho(b.produto)).find(
      (l) => l.resolvida_em === null,
    ).id;
    await C.query("COMMIT");
    const antesM = await estoqueVar(b.v.M);
    const antesP = await estoqueVar(b.v.P);

    await C.query("BEGIN");
    ok(await resolver(C, peca, b.v.M));
    await D.query("BEGIN");
    let terminouD = false;
    const emD = resolver(D, peca, variD).finally(() => {
      terminouD = true;
    });
    assert.ok(
      await esperandoTrava(pidD, pidC, () => terminouD),
      `${rotuloD}: o segundo toque esperou a trava do primeiro`,
    );
    await C.query("COMMIT");
    const r = ok(await emD)[0].r;
    await D.query("COMMIT");
    assert.equal(r.ja_resolvida, true, rotuloD);
    assert.equal(r.resolucao, "reposta");
    assert.equal(r.variant_id, b.v.M);
    assert.equal(await estoqueVar(b.v.M), antesM + 1, `${rotuloD}: UMA vez`);
    assert.equal(await estoqueVar(b.v.P), antesP);
  }
}

// ---------------------------------------------------------------------------
// 9. O Salvar de uma tela aberta antes nao sobrescreve o estoque novo
// ---------------------------------------------------------------------------
async function salvarGrade(base, b, estoqueM) {
  return chamar(
    C,
    `SELECT public.salvar_produto_com_grade($1::uuid, $2::timestamptz, '{}'::jsonb, $3::jsonb, ARRAY[]::uuid[]) AS r`,
    [
      b.produto,
      base,
      JSON.stringify([
        {
          id: b.v.M,
          name: "Tamanho",
          value: "M",
          sku: null,
          codigo_barras: null,
          price_override: null,
          active: true,
          image_url: null,
          stock_increment: estoqueM,
        },
      ]),
    ],
  );
}

async function provaDoSalvar() {
  await C.query("BEGIN");
  const b = await blusaComPecas(C, 1);
  await C.query("COMMIT");
  // A tela abre: le a versao (como o painel faz com produtos.ultima_atualizacao).
  // Como TEXTO: o Date do JS perde os microssegundos e a versao nunca bateria (o app recebe o texto do PostgREST).
  const versaoDaTela = (
    await um(
      "SELECT ultima_atualizacao::text AS v FROM public.produtos WHERE id = $1",
      [b.produto],
    )
  ).v;
  // A lojista resolve a peca no aviso (outra transacao, como no app).
  await C.query("BEGIN");
  ok(await resolver(C, b.pecas[0], b.v.M));
  await C.query("COMMIT");
  assert.equal(await estoqueVar(b.v.M), 4);
  const versaoNova = (
    await um(
      "SELECT ultima_atualizacao::text AS v FROM public.produtos WHERE id = $1",
      [b.produto],
    )
  ).v;
  assert.notEqual(
    versaoNova,
    versaoDaTela,
    "o credito avanca a versao do produto",
  );
  // O Salvar com a versao da tela e o estoque VELHO da variacao (3) e' recusado; o 4 fica.
  await C.query("BEGIN");
  const r = await salvarGrade(versaoDaTela, b, 3);
  await C.query("COMMIT");
  assert.equal(
    r.codigo,
    "PRD01",
    `o salvar velho devia ser recusado: ${r.erro}`,
  );
  assert.equal(await estoqueVar(b.v.M), 4, "o estoque da peca somada fica");
  // Controle: com a versao nova o mesmo salvar passa (a recusa e' pela versao, nao por outra coisa).
  await C.query("BEGIN");
  const r2 = await salvarGrade(versaoNova, b, 4);
  await C.query("ROLLBACK");
  assert.equal(
    r2.erro,
    undefined,
    `com a versao nova o salvar passa: ${r2.erro}`,
  );
}

// ---------------------------------------------------------------------------
// 10. Mutantes: cada um tem de derrubar a prova certa
// ---------------------------------------------------------------------------
const DEVOLVER = blocoDe(
  MIGRATION,
  "CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)",
  "\n$devolver$;",
);
const CONCLUIR = blocoDe(
  MIGRATION,
  "CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(",
  "\n$$;",
);
const RESOLVER = blocoDe(
  MIGRATION,
  "CREATE OR REPLACE FUNCTION public.resolver_peca_sem_tamanho(",
  "\n$resolver$;",
);
const troca = (s, de, para) => {
  assert.equal(s.split(de).length - 1, 1, `mutante: ${de.slice(0, 60)}`);
  return s.replace(de, () => para);
};
const MUTANTES = [
  {
    nome: "devolver_estoque sem o ramo da peca sem tamanho (credita o pai)",
    sql: troca(
      DEVOLVER,
      "        ELSIF EXISTS (SELECT 1 FROM public.product_variants v\n                       WHERE v.product_id = v_item.product_id AND v.active = true) THEN",
      "        ELSIF false THEN",
    ),
    prova: provaDoDefeito,
  },
  {
    nome: "devolver_estoque sem o filtro de variacao LIGADA",
    sql: troca(
      DEVOLVER,
      "WHERE v.product_id = v_item.product_id AND v.active = true) THEN",
      "WHERE v.product_id = v_item.product_id) THEN",
    ),
    prova: provaDaMatriz,
  },
  {
    nome: "devolver_estoque sem o CONTINUE (conta a peca como creditada)",
    sql: troca(
      DEVOLVER,
      "              FROM generate_series(1, v_credito);\n            CONTINUE;",
      "              FROM generate_series(1, v_credito);",
    ),
    prova: provaDoDefeito,
  },
  {
    nome: "devolver_estoque com uma linha so por item (nao por peca)",
    sql: troca(
      DEVOLVER,
      "FROM generate_series(1, v_credito);",
      "FROM generate_series(1, 1);",
    ),
    prova: provaDoPedidoMisto,
  },
  {
    nome: "admin_devolucao_concluir sem o ramo da peca sem tamanho",
    sql: troca(
      CONCLUIR,
      "      ELSIF v_di.product_id IS NOT NULL\n            AND EXISTS",
      "      ELSIF false\n            AND EXISTS",
    ),
    prova: provaDaDevolucao,
  },
  {
    nome: "admin_devolucao_concluir conta a do cantinho em reestocados",
    sql: troca(
      CONCLUIR,
      "'reestocados', v_reestocados - v_sem_tamanho,",
      "'reestocados', v_reestocados,",
    ),
    prova: provaDaDevolucao,
  },
  {
    nome: "resolver sem a guarda de peca ja resolvida (credita 2x)",
    sql: troca(
      RESOLVER,
      "  IF v_peca.resolvida_em IS NOT NULL THEN\n    RETURN",
      "  IF false THEN\n    RETURN",
    ),
    prova: provaDaDecisao,
  },
  {
    nome: "resolver aceita variacao desligada",
    sql: troca(
      RESOLVER,
      "    IF v_variante.active IS NOT TRUE THEN",
      "    IF false THEN",
    ),
    prova: provaDaDecisao,
  },
  {
    nome: "resolver aceita variacao de outro produto",
    sql: troca(
      RESOLVER,
      "IF NOT FOUND OR v_variante.product_id IS DISTINCT FROM v_produto THEN",
      "IF NOT FOUND THEN",
    ),
    prova: provaDaDecisao,
  },
  {
    nome: "resolver sem o COALESCE (estoque NULL fica NULL e a peca some)",
    sql: troca(
      RESOLVER,
      "SET stock_increment = COALESCE(stock_increment, 0) + 1",
      "SET stock_increment = stock_increment + 1",
    ),
    prova: provaDaDecisao,
  },
  {
    nome: "resolver sem o admin de agora",
    sql: troca(
      RESOLVER,
      "  IF NOT public.is_admin_atual() THEN",
      "  IF false THEN",
    ),
    prova: provaDePermissao,
  },
];

/** Aplica o mutante (COMMIT no clone), roda a prova esperando que caia, e restaura a migration inteira. */
async function provarMutante(m) {
  await C.query(m.sql);
  let morreu = null;
  try {
    await m.prova();
  } catch (e) {
    morreu = e;
  }
  await C.query("ROLLBACK").catch(() => {});
  // Restaura os corpos exatos desta migration (o pre-voo dela recusaria o corpo mutante).
  await C.query(DEVOLVER);
  await C.query(CONCLUIR);
  await C.query(RESOLVER);
  assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);
  assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);
  assert.ok(morreu, `o mutante sobreviveu: ${m.nome}`);
  return morreu;
}

// ---------------------------------------------------------------------------
// 11. Reaplicar, pre-voo, rollback e fichas
// ---------------------------------------------------------------------------
async function fichaSoSim(sql, rotulo) {
  const r = await C.query(sql);
  const linhas = Array.isArray(r) ? r[r.length - 1].rows : r.rows;
  assert.ok(linhas.length > 0, `${rotulo}: sem linhas`);
  for (const l of linhas)
    assert.equal(l.ok, true, `${rotulo}: ${JSON.stringify(l)}`);
}
async function fichaTemNao(sql, rotulo) {
  const r = await C.query(sql);
  const linhas = Array.isArray(r) ? r[r.length - 1].rows : r.rows;
  assert.ok(
    linhas.some((l) => l.ok !== true),
    `${rotulo}: devia acusar algo`,
  );
}

async function provaDaMigration() {
  await emTransacao(async () => {
    const b = await blusaComPecas(C, 2);
    await fichaSoSim(FICHA_A, "202a depois do apply");
    await fichaSoSim(
      FICHA_B,
      "202b depois do apply (reaplicar e' idempotente)",
    );

    // Reaplicar (LF e CRLF): mesmo estado, as linhas ficam.
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.equal(
      (await tentarSql(MIGRATION.replace(/\n/g, "\r\n"))).erro,
      undefined,
    );
    assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);
    assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);
    assert.equal((await cantinho(b.produto)).length, 2);

    // O rollback da 395 recusa por baixo desta (ordem).
    const r395 = await tentarSql(ROLLBACK_395);
    assert.match(String(r395.erro), /B1_BASELINE_DIVERGENT/);
    assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);

    // Rollback: corpos de volta, RPCs fora, tabela e linhas ficam; repetir e' no-op.
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined);
    assert.equal(await hashDevolver(), H_DEV_389);
    assert.equal(await hashConcluir(), H_CONCL_395);
    assert.equal(await rpcsNoAr(), false);
    assert.equal(
      (await cantinho(b.produto)).length,
      2,
      "o rollback nao apaga dado",
    );
    await fichaSoSim(FICHA_B, "202b antes do apply");
    await fichaTemNao(FICHA_A, "202a antes do apply");
    assert.equal(
      (await tentarSql(ROLLBACK)).erro,
      undefined,
      "repetir e' no-op",
    );
    assert.equal(await hashDevolver(), H_DEV_389);

    // Reaplicar depois do rollback: as pecas voltam a aparecer.
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.equal(await rpcsNoAr(), true);
    assert.equal(ok(await pendentesRpc(C, b.produto)).length, 2);

    // Pre-voo: corpo desconhecido recusa sem escrever nada.
    await C.query(
      DEVOLVER.replace(
        "    RETURN v_unidades;",
        () => "    RETURN v_unidades + 0;",
      ),
    );
    const desconhecido = await hashDevolver();
    const e = await tentarSql(MIGRATION);
    assert.match(String(e.erro), /B1_BASELINE_DIVERGENT/);
    assert.equal(await hashDevolver(), desconhecido, "nada trocado");
    const eRb = await tentarSql(ROLLBACK);
    assert.match(String(eRb.erro), /B1_BASELINE_DIVERGENT/);
    await C.query(DEVOLVER);

    // Pre-voo: tabela com outra forma recusa.
    await C.query("ALTER TABLE public.pecas_sem_tamanho ADD COLUMN x int");
    assert.match(
      String((await tentarSql(MIGRATION)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
  });
}

// ---------------------------------------------------------------------------
prova(
  "1. o defeito com os corpos de antes (o pai recebe) x o corpo novo (a peca espera no cantinho)",
  provaDoDefeito,
);
prova(
  "2. matriz diferencial: o que nao e' peca sem tamanho e' identico nos dois corpos",
  provaDaMatriz,
);
prova(
  "3. pedido misto: uma linha por peca, so o que e' sem tamanho, e o carimbo segura a 2a volta",
  provaDoPedidoMisto,
);
prova(
  "4. devolucao concluida: cantinho, carimbo, reestocados/sem_tamanho e o achado C",
  provaDaDevolucao,
);
prova("5. a lista das pecas que esperam", provaDaLista);
prova(
  "6. a decisao: +1 na variacao, idempotente, 'nao tenho' e recusas sem escrever",
  provaDaDecisao,
);
prova(
  "7. permissao: anon, service_role, cliente e rebaixado recusados; a tabela fechada",
  provaDePermissao,
);
prova(
  "8. duas conexoes reais no mesmo toque: o estoque sobe uma vez",
  provaDeDuasConexoes,
);
prova(
  "9. o Salvar de uma tela aberta antes e' recusado (PRD01) e o estoque somado fica",
  provaDoSalvar,
);
for (const m of MUTANTES) {
  prova(`10. mutante morre: ${m.nome}`, async () => {
    const morreu = await provarMutante(m);
    console.log(
      `     (caiu por: ${String(morreu.message).split("\n")[0].slice(0, 150)})`,
    );
  });
}
prova(
  "11. reaplicar (LF e CRLF), pre-voo, rollback (ordem, corpos, dado mantido) e fichas 202a/202b",
  provaDaMigration,
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url, statement_timeout: 15000 });
  D = new Client({ connectionString: url, statement_timeout: 15000 });
  const falhas = [];
  try {
    await C.connect();
    const db = (await C.query("SELECT current_database() AS d")).rows[0].d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: nunca mutar o banco base",
    );
    await D.connect();
    assert.equal(
      await hashDevolver(),
      HASH_DEVOLVER_DESTA,
      "a migration 20261642000000 nao esta no banco efemero",
    );
    assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);
    await semearPessoas();
    for (const p of PROVAS) {
      try {
        await p.corpo();
        console.log(`PASSOU  ${p.nome}`);
      } catch (e) {
        await C.query("ROLLBACK").catch(() => {});
        await D.query("ROLLBACK").catch(() => {});
        falhas.push(`${p.nome}\n   ${e.stack ?? e}`);
        console.log(`FALHOU  ${p.nome}`);
      }
    }
  } finally {
    await C.end().catch(() => {});
    await D.end().catch(() => {});
  }
  if (falhas.length > 0) {
    falhar(
      "PECA-SEM-TAMANHO",
      `${falhas.length} prova(s) falharam:\n${falhas.join("\n")}`,
    );
  }
  console.log(
    `\na-peca-que-volta-sem-tamanho-viva: ${PROVAS.length} provas, ${MUTANTES.length} mutantes mortos`,
  );
}

main().catch((erro) => falhar("PECA-SEM-TAMANHO", erro.stack ?? String(erro)));
