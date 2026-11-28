"use strict";

/**
 * Prova VIVA da migration 20261653000000 (a peca que volta para uma variacao DESLIGADA espera a lojista). So Postgres EFEMERO, num
 * CLONE proprio (rodar-isolado.cjs): nunca banco de loja.
 *
 * O DEFEITO (controle): a blusa tem P e M ligados; o pedido do M existe; a lojista DESLIGA o M (nao consegue apagar variacao
 * vendida). O pedido e' cancelado / o Pix vence (devolver_estoque) ou a devolucao do M e' concluida com "voltar ao estoque"
 * (admin_devolucao_concluir). Com os corpos da 20261642000000 (aplicados dentro da transacao da prova) o banco soma +1 no M
 * desligado, que a compra nao vende: a peca some. Com o corpo desta, no MESMO cenario, o M nao muda e a peca espera a lojista em
 * pecas_sem_tamanho (o caminho da 642), e ela a poe no P pela RPC da 642.
 *
 * PROVAS (cada uma pelo nome na saida):
 *   1. controle do defeito (corpos da 642: o M desligado recebe) x o corpo novo (o M nao muda, a peca vai para o cantinho);
 *   2. cancelar / Pix vencido (devolver_estoque, que os dois caminhos chamam): cantinho com o pedido e o item; o retorno nao a conta;
 *      repetir nao cria nada (carimbo); quantidade 3 = 3 linhas; a lojista poe a peca no P (+1) e o M desligado e' recusado;
 *   3. devolucao com o M desligado: cantinho com o item da devolucao, 'reestocados' 0 e 'sem_tamanho' 1, reestocado_em gravado; o
 *      cancelamento depois (achado C) nao cria de novo;
 *   4. CONTROLE com o M LIGADO: credita o M (pedido e devolucao), cantinho vazio, retornos como antes;
 *   5. nenhuma variacao ligada (M e P desligados): credita o PAI (a compra vende pelo pai), cantinho vazio; nunca os dois;
 *   6. item com variacao desligada e SEM produto: a linha do cantinho leva o pai da variacao;
 *   7. matriz diferencial: o que nao tem variacao desligada da' o mesmo estoque e o mesmo retorno nos dois corpos;
 *   8. DUAS CONEXOES REAIS: a lojista desliga o M ao mesmo tempo que o pedido volta; a volta espera a trava da variacao e ve o M
 *      desligado (a peca vai para o cantinho, o M nao muda);
 *   9. mutantes (cada um na guarda certa), restaurando o corpo exato depois;
 *  10. reaplicar (LF e CRLF), pre-voo (corpo estranho, destino ausente, leitura alheia com o mesmo nome), rollback (corpos da 642
 *      byte a byte, a leitura sai, o da 642 recusa antes dele, as linhas do cantinho ficam), consultas 209a/209b e a 202a como sucessora;
 *  11. a ficha da devolucao (pecas_sem_tamanho_da_devolucao): o item do M desligado aparece e o do P ligado do MESMO produto nao; uma
 *      linha por item (duas pecas = um item); some quando a ultima peca e' decidida; outro pedido, pedido desfeito e pedido NULL nao
 *      aparecem; religar o M depois NAO muda a resposta (e' a origem gravada na conclusao); o item sem variacao da 642 tambem aparece;
 *      anon, service_role, cliente e admin rebaixado recusados (42501).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-peca-da-variacao-desligada-viva.cjs
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
  VARIACAO_DESLIGADA,
  HASH_DEVOLVER_DESTA,
  HASH_CONCLUIR_DESTA,
  HASH_DA_DEVOLUCAO_DESTA,
} = require("./a-peca-da-variacao-desligada-posterior.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const NOME = VARIACAO_DESLIGADA.nome;
const NOME_642 =
  "20261642000000_a_peca_que_volta_sem_tamanho_espera_a_lojista.sql";
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
const ROLLBACK_642 = lerMigration(`rollback-manual-${NOME_642}`);
const FICHA_A = lerConsulta(
  "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
);
const FICHA_B = lerConsulta(
  "209b-antes-a-peca-da-variacao-desligada-espera-a-lojista-base-vigente",
);
const FICHA_202A = lerConsulta(
  "202a-conferir-a-peca-que-volta-sem-tamanho-aplicado",
);

const blocoDe = (sql, inicio, fim) => {
  const i = sql.indexOf(inicio);
  assert.ok(i >= 0, `bloco ausente: ${inicio}`);
  return sql.slice(i, sql.indexOf(fim, i) + fim.length);
};
const INICIO_DEV =
  "CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)";
const INICIO_CONCL =
  "CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(";
const M642 = lerMigration(NOME_642);
const DEVOLVER_642 = blocoDe(M642, INICIO_DEV, "\n$devolver$;");
const CONCLUIR_642 = blocoDe(M642, INICIO_CONCL, "\n$$;");
const H_DEV_642 = "80b1a90baf10d1b4c59484772e4864c4";
const H_CONCL_642 = "1a548896acb8248f1b1771d765c92fcb";
const DEVOLVER = blocoDe(MIGRATION, INICIO_DEV, "\n$devolver$;");
const CONCLUIR = blocoDe(MIGRATION, INICIO_CONCL, "\n$$;");
const DA_DEVOLUCAO = blocoDe(
  MIGRATION,
  "CREATE OR REPLACE FUNCTION public.pecas_sem_tamanho_da_devolucao(p_order_id uuid)",
  "\n$da_devolucao$;",
);

const ADMIN = "7e7e1653-0000-4000-8000-0000000000a1";
const CLIENTE = "7e7e1653-0000-4000-8000-0000000000c1";
const REBAIXADO = "7e7e1653-0000-4000-8000-0000000000a2";
const CLAIMS_CLIENTE = JSON.stringify({ role: "authenticated" });
const CLAIMS_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});

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
       VALUES ($1::uuid, $1::text || '@r1653.invalid', $2::jsonb)`,
      [id, meta],
    );
    await C.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa ficticia R1653', $2)
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
     VALUES ($1, 'Blusa ficticia R1653', 10, 50, $2, true)`,
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

/** Pedido com os itens [{p, v, q}] (produto ou null, variacao ou null, quantidade). Devolve { order, itens: [ids] }. */
async function pedido(c, itens, { status = "cancelled" } = {}) {
  const order = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal, payment_method, payment_status)
     VALUES ($1, $2, 'Pessoa ficticia R1653', '{}'::jsonb, 50, 50, 0, $3, 'online', 'pix', 'aguardando')`,
    [order, CLIENTE, status],
  );
  const ids = [];
  for (const { p, v, q } of itens) {
    ids.push(
      (
        await c.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
           VALUES ($1, $2, $3, 'Item R1653', $4, 50) RETURNING id`,
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
     VALUES ($1, $2, 'Pessoa ficticia R1653', '{}'::jsonb, 100, 100, 0, 'delivered', 'online', 'online', 'pago', now(), now(), $3, 0)`,
    [order, CLIENTE, `ORD-R1653-${order}`],
  );
  await c.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno, status, valor_itens,
        valor_frete_ida, prazo_ate, politica)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'outro', 'reembolso', 'nacional', 'envio_proprio', 'recebida', 50, 0, current_date + 7, '{}')`,
    [dev, `DEV-R1653-${dev.slice(0, 8)}`, order, CLIENTE],
  );
  const di = [];
  const oi = [];
  for (const { p, v, q } of itens) {
    const item = (
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
         VALUES ($1, $2, $3, 'Item R1653', $4, 50) RETURNING id`,
        [order, p, v, q],
      )
    ).rows[0].id;
    oi.push(item);
    di.push(
      (
        await c.query(
          `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, variant_id, product_name, quantidade, valor_unitario)
           VALUES ($1, $2, $3, $4, 'Item R1653', $5, 50) RETURNING id`,
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
const resolver = (conn, peca, variante) =>
  chamar(
    conn,
    "SELECT public.resolver_peca_sem_tamanho($1::uuid, $2::uuid) AS r",
    [peca, variante],
  );
const concluir = (conn, dev, itens) =>
  chamar(
    conn,
    "SELECT public.admin_devolucao_concluir($1::uuid, 'troca', $2::jsonb, NULL, NULL) AS r",
    [dev, JSON.stringify(itens)],
  );
/** Os itens da devolucao com peca esperando, pela leitura da ficha (como o painel chama). */
const daDevolucao = (conn, order, opcoes) =>
  chamar(
    conn,
    "SELECT devolucao_item_id FROM public.pecas_sem_tamanho_da_devolucao($1::uuid)",
    [order],
    opcoes,
  );
const itensDaFicha = async (order, opcoes) =>
  ok(await daDevolucao(C, order, opcoes)).map((l) => l.devolucao_item_id);
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
      `SELECT id, produto_id, order_id, order_item_id, devolucao_item_id, origem, resolvida_em, resolucao, variant_id
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
const hashDaDevolucao = (c) =>
  hashDe("public.pecas_sem_tamanho_da_devolucao(uuid)", c);

/**
 * Os corpos da 20261642000000, dentro da transacao aberta (o ROLLBACK do fim devolve os do banco). Pelos blocos da propria 642, e
 * nao pelo rollback desta: assim o controle tambem roda por cima de um MUTANTE.
 */
async function corposDa642() {
  await C.query(DEVOLVER_642);
  await C.query(CONCLUIR_642);
  assert.equal(await hashDevolver(), H_DEV_642);
  assert.equal(await hashConcluir(), H_CONCL_642);
}

/** A blusa da caca: P e M ligados com estoque 2; o pai com 0 (a compra vende pelas variacoes). */
const blusa = (c = C, { ligadaM = true, ligadaP = true } = {}) =>
  produto(c, {
    estoque: 0,
    variacoes: [
      { valor: "P", estoque: 2, ativa: ligadaP },
      { valor: "M", estoque: 2, ativa: ligadaM },
    ],
  });
const desligar = (v, c = C) =>
  c.query("UPDATE public.product_variants SET active = false WHERE id = $1", [
    v,
  ]);

// ---------------------------------------------------------------------------
// 1. O defeito (controle, corpos da 642) x o corpo novo
// ---------------------------------------------------------------------------
async function cenarioDoDefeito() {
  const b = await blusa();
  const { order, itens } = await pedido(C, [{ p: b.produto, v: b.v.M, q: 1 }]);
  const dev = await devolucao(C, [{ p: b.produto, v: b.v.M, q: 1 }]);
  // A lojista desliga o M DEPOIS das vendas (o banco nao a deixa apagar).
  await desligar(b.v.M);
  const devolvidas = await devolverEstoque(order);
  const r = ok(
    await concluir(C, dev.dev, [
      { item_id: dev.di[0], condicao: "nova", reestocar: true },
    ]),
  )[0].r;
  return { b, order, itens, dev, devolvidas, r };
}

async function provaDoDefeito() {
  await emTransacao(async () => {
    await corposDa642();
    const s = await cenarioDoDefeito();
    assert.equal(
      s.devolvidas,
      1,
      "controle: a 642 conta a peca como creditada",
    );
    assert.equal(
      await estoqueVar(s.b.v.M),
      4,
      "controle: o M DESLIGADO recebe as duas pecas (o defeito)",
    );
    assert.equal(s.r.reestocados, 1, "controle: o painel diz que voltou");
    assert.equal(s.r.sem_tamanho, 0);
    assert.equal((await cantinho(s.b.produto)).length, 0);
  });
  await emTransacao(async () => {
    const s = await cenarioDoDefeito();
    assert.equal(s.devolvidas, 0, "a peca que espera nao conta como creditada");
    assert.equal(await estoqueVar(s.b.v.M), 2, "o M desligado NAO recebe");
    assert.equal(await estoqueVar(s.b.v.P), 2, "o P nao muda sozinho");
    assert.equal(await estoquePai(s.b.produto), 0, "o pai nao recebe");
    assert.equal(s.r.reestocados, 0);
    assert.equal(s.r.sem_tamanho, 1);
    const linhas = await cantinho(s.b.produto);
    assert.equal(linhas.length, 2, "uma peca de cada volta, no cantinho");
    assert.deepEqual(linhas.map((l) => l.origem).sort(), [
      "devolucao",
      "pedido_desfeito",
    ]);
  });
}

// ---------------------------------------------------------------------------
// 2. Cancelar / Pix vencido (devolver_estoque)
// ---------------------------------------------------------------------------
async function provaDoPedidoDesfeito() {
  await emTransacao(async () => {
    const b = await blusa();
    const { order, itens } = await pedido(C, [
      { p: b.produto, v: b.v.M, q: 3 },
      { p: b.produto, v: b.v.P, q: 1 },
    ]);
    await desligar(b.v.M);
    assert.equal(await devolverEstoque(order), 1, "so a do P conta");
    assert.equal(await estoqueVar(b.v.P), 3, "o P ligado recebe a dele");
    assert.equal(await estoqueVar(b.v.M), 2, "o M desligado nao recebe");
    assert.equal(await estoquePai(b.produto), 0);
    const linhas = await cantinho(b.produto);
    assert.equal(linhas.length, 3, "uma linha por PECA do M");
    for (const l of linhas) {
      assert.equal(l.origem, "pedido_desfeito");
      assert.equal(l.order_id, order);
      assert.equal(l.order_item_id, itens[0]);
      assert.equal(l.devolucao_item_id, null);
      assert.equal(l.resolvida_em, null);
      assert.equal(l.variant_id, null);
    }
    // Repetir (reenvio do webhook, duplo clique, Pix que vence depois do cancelamento): o carimbo segura.
    assert.equal(await devolverEstoque(order), 0);
    assert.equal((await cantinho(b.produto)).length, 3, "nada a mais");
    assert.equal(await estoqueVar(b.v.P), 3);

    // A peca nao se perde: a lojista a poe no P (ligado); o M desligado e' recusado sem somar nada.
    const recusa = await resolver(C, linhas[0].id, b.v.M);
    assert.equal(recusa.codigo, "22023");
    assert.equal(await estoqueVar(b.v.M), 2);
    const r = ok(await resolver(C, linhas[0].id, b.v.P))[0].r;
    assert.equal(r.resolucao, "reposta");
    assert.equal(r.pendentes, 2);
    assert.equal(await estoqueVar(b.v.P), 4, "a peca voltou a venda no P");
  });
}

// ---------------------------------------------------------------------------
// 3. Devolucao com o M desligado
// ---------------------------------------------------------------------------
async function provaDaDevolucao() {
  await emTransacao(async () => {
    const b = await blusa();
    const dev = await devolucao(C, [
      { p: b.produto, v: b.v.M, q: 2 },
      { p: b.produto, v: b.v.P, q: 1 },
    ]);
    await desligar(b.v.M);
    const r = ok(
      await concluir(C, dev.dev, [
        { item_id: dev.di[0], condicao: "nova", reestocar: true },
        { item_id: dev.di[1], condicao: "nova", reestocar: true },
      ]),
    )[0].r;
    assert.equal(r.reestocados, 1, "so a do P voltou a venda");
    assert.equal(r.sem_tamanho, 2, "as duas do M esperam a lojista");
    assert.equal(await estoqueVar(b.v.M), 2, "o M desligado nao recebe");
    assert.equal(await estoqueVar(b.v.P), 3);
    assert.equal(await estoquePai(b.produto), 0);
    const linhas = await cantinho(b.produto);
    assert.equal(linhas.length, 2);
    for (const l of linhas) {
      assert.equal(l.origem, "devolucao");
      assert.equal(l.devolucao_item_id, dev.di[0]);
      assert.equal(l.order_item_id, dev.oi[0]);
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
    // Achado C: o cancelamento depois desconta o que a devolucao ja trouxe de volta, inclusive a do cantinho.
    assert.equal(await devolverEstoque(dev.order), 0);
    assert.equal((await cantinho(b.produto)).length, 2, "nada a mais");
    assert.equal(await estoqueVar(b.v.M), 2);
    assert.equal(await estoqueVar(b.v.P), 3);
  });
}

// ---------------------------------------------------------------------------
// 4. CONTROLE: o M ligado continua recebendo
// ---------------------------------------------------------------------------
async function provaDoControleLigado() {
  await emTransacao(async () => {
    const b = await blusa();
    const { order } = await pedido(C, [{ p: b.produto, v: b.v.M, q: 2 }]);
    assert.equal(await devolverEstoque(order), 2);
    assert.equal(await estoqueVar(b.v.M), 4, "o M ligado recebe");
    const dev = await devolucao(C, [{ p: b.produto, v: b.v.M, q: 1 }]);
    const r = ok(
      await concluir(C, dev.dev, [
        { item_id: dev.di[0], condicao: "usada", reestocar: true },
      ]),
    )[0].r;
    assert.equal(r.reestocados, 1);
    assert.equal(r.sem_tamanho, 0);
    assert.equal(await estoqueVar(b.v.M), 5);
    assert.equal(await estoquePai(b.produto), 0);
    assert.equal((await cantinho(b.produto)).length, 0, "nada no cantinho");
  });
}

// ---------------------------------------------------------------------------
// 5. Nenhuma variacao ligada: o pai (a compra vende pelo pai)
// ---------------------------------------------------------------------------
async function provaDoPai() {
  await emTransacao(async () => {
    const b = await blusa(C, { ligadaP: false });
    const { order } = await pedido(C, [{ p: b.produto, v: b.v.M, q: 2 }]);
    const dev = await devolucao(C, [{ p: b.produto, v: b.v.M, q: 1 }]);
    await desligar(b.v.M);
    assert.equal(await devolverEstoque(order), 2, "credita e conta");
    const r = ok(
      await concluir(C, dev.dev, [
        { item_id: dev.di[0], condicao: "nova", reestocar: true },
      ]),
    )[0].r;
    assert.equal(r.reestocados, 1);
    assert.equal(r.sem_tamanho, 0);
    assert.equal(await estoquePai(b.produto), 3, "o pai recebe as 3");
    assert.equal(await estoqueVar(b.v.M), 2, "o M desligado nao");
    assert.equal(await estoqueVar(b.v.P), 2);
    assert.equal((await cantinho(b.produto)).length, 0, "nunca os dois");
  });
}

// ---------------------------------------------------------------------------
// 6. Item sem produto: o pai da variacao
// ---------------------------------------------------------------------------
async function provaDoItemSemProduto() {
  await emTransacao(async () => {
    const b = await blusa();
    const { order, itens } = await pedido(C, [{ p: null, v: b.v.M, q: 1 }]);
    const dev = await devolucao(C, [{ p: null, v: b.v.M, q: 1 }]);
    await desligar(b.v.M);
    assert.equal(await devolverEstoque(order), 0);
    const r = ok(
      await concluir(C, dev.dev, [
        { item_id: dev.di[0], condicao: "nova", reestocar: true },
      ]),
    )[0].r;
    assert.equal(r.sem_tamanho, 1);
    const linhas = await cantinho(b.produto);
    assert.equal(linhas.length, 2, "as duas no cantinho do pai da variacao");
    assert.ok(linhas.some((l) => l.order_item_id === itens[0]));
    assert.ok(linhas.some((l) => l.devolucao_item_id === dev.di[0]));
    assert.equal(await estoqueVar(b.v.M), 2);
  });
}

// ---------------------------------------------------------------------------
// 7. Matriz diferencial: sem variacao desligada, os dois corpos sao identicos
// ---------------------------------------------------------------------------
async function matriz() {
  const saida = [];
  const a = await produto(C, { estoque: 5 });
  const b = await blusa();
  const so = await produto(C, {
    estoque: 5,
    variacoes: [{ valor: "U", estoque: 1, ativa: false }],
  });
  for (const [rotulo, itens] of [
    ["sem variacao", [{ p: a.produto, v: null, q: 2 }]],
    ["variacao ligada", [{ p: b.produto, v: b.v.M, q: 1 }]],
    ["sem variacao de produto com ligada", [{ p: b.produto, v: null, q: 1 }]],
    [
      "sem variacao de produto so com desligada",
      [{ p: so.produto, v: null, q: 1 }],
    ],
    ["item sem produto", [{ p: null, v: null, q: 1 }]],
  ]) {
    const { order } = await pedido(C, itens);
    saida.push({
      rotulo,
      n: await devolverEstoque(order),
      n2: await devolverEstoque(order),
      a: await estoquePai(a.produto),
      bp: await estoquePai(b.produto),
      bm: await estoqueVar(b.v.M),
      so: await estoquePai(so.produto),
      cantinho: (await cantinho(b.produto)).length,
      cantinhoSo: (await cantinho(so.produto)).length,
    });
  }
  const dev = await devolucao(C, [
    { p: a.produto, v: null, q: 1 },
    { p: b.produto, v: b.v.P, q: 2 },
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
    sem_tamanho: r.sem_tamanho,
    a: await estoquePai(a.produto),
    bp: await estoqueVar(b.v.P),
  });
  return saida;
}

async function provaDaMatriz() {
  let antes;
  let depois;
  await emTransacao(async () => {
    await corposDa642();
    antes = await matriz();
  });
  await emTransacao(async () => {
    depois = await matriz();
  });
  assert.deepEqual(depois, antes, "sem variacao desligada, identico a 642");
  // ancora: a matriz mede o que diz medir
  assert.deepEqual(
    antes.map((x) => x.n),
    [2, 1, 0, 1, 1, undefined],
  );
}

// ---------------------------------------------------------------------------
// 8. Duas conexoes reais: desligar o M ao mesmo tempo que o pedido volta
// ---------------------------------------------------------------------------
async function esperandoTrava(pidEspera, pidSegura, terminou) {
  for (let i = 0; i < 200; i++) {
    const r = await D.query(
      `SELECT wait_event_type = 'Lock' AND $2::int = ANY(pg_blocking_pids(pid)) AS espera
         FROM pg_stat_activity WHERE pid = $1`,
      [pidEspera, pidSegura],
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
  const b = await blusa();
  const { order } = await pedido(C, [{ p: b.produto, v: b.v.M, q: 1 }]);
  await C.query("COMMIT");
  const pidC = (await um("SELECT pg_backend_pid() AS p")).p;
  const pidD = (await um("SELECT pg_backend_pid() AS p", [], D)).p;

  // D: a lojista desliga o M e ainda nao confirmou. C: o Pix do pedido vence agora.
  await D.query("BEGIN");
  await desligar(b.v.M, D);
  await C.query("BEGIN");
  let terminouC = false;
  const emC = devolverEstoque(order).finally(() => {
    terminouC = true;
  });
  assert.ok(
    await esperandoTrava(pidC, pidD, () => terminouC),
    "a volta esperou a trava da variacao",
  );
  await D.query("COMMIT");
  assert.equal(await emC, 0, "viu o M desligado: nao conta como creditada");
  await C.query("COMMIT");
  assert.equal(await estoqueVar(b.v.M), 2, "o M desligado nao recebeu");
  assert.equal(
    (await cantinho(b.produto)).length,
    1,
    "a peca espera a lojista",
  );
}

// ---------------------------------------------------------------------------
// 11. A ficha da devolucao: QUAIS itens deixaram peca esperando
// ---------------------------------------------------------------------------
async function provaDaFicha() {
  await emTransacao(async () => {
    const b = await blusa();
    // O M (2 pecas) e o P (1) do MESMO produto na mesma devolucao; a lojista desligou o M antes de concluir.
    const dev = await devolucao(C, [
      { p: b.produto, v: b.v.M, q: 2 },
      { p: b.produto, v: b.v.P, q: 1 },
    ]);
    // Antes de concluir: nada espera.
    assert.deepEqual(await itensDaFicha(dev.order), []);
    await desligar(b.v.M);
    ok(
      await concluir(C, dev.dev, [
        { item_id: dev.di[0], condicao: "nova", reestocar: true },
        { item_id: dev.di[1], condicao: "nova", reestocar: true },
      ]),
    );
    // So o item do M (uma linha, mesmo com duas pecas); o do P, ligado e creditado de verdade, NAO.
    assert.deepEqual(await itensDaFicha(dev.order), [dev.di[0]]);
    // Religar o M depois nao muda o que aconteceu na conclusao: as pecas seguem no cantinho, e a ficha segue dizendo.
    await C.query(
      "UPDATE public.product_variants SET active = true WHERE id = $1",
      [b.v.M],
    );
    assert.deepEqual(await itensDaFicha(dev.order), [dev.di[0]]);
    // Outro pedido, pedido NULL e pedido desfeito (origem pedido_desfeito) nao aparecem nesta ficha.
    const outra = await devolucao(C, [{ p: b.produto, v: b.v.P, q: 1 }]);
    assert.deepEqual(await itensDaFicha(outra.order), []);
    assert.deepEqual(await itensDaFicha(null), []);
    await desligar(b.v.P);
    const { order: desfeito } = await pedido(C, [
      { p: b.produto, v: b.v.P, q: 1 },
    ]);
    assert.equal(await devolverEstoque(desfeito), 0);
    assert.equal(
      (await cantinho(b.produto)).filter((l) => l.order_id === desfeito).length,
      1,
      "a peca do pedido desfeito esta no cantinho",
    );
    assert.deepEqual(await itensDaFicha(desfeito), []);
    // A lojista decide uma das duas pecas do M: o item ainda espera; decidida a ultima, sai da ficha.
    const doM = (await cantinho(b.produto)).filter(
      (l) => l.devolucao_item_id === dev.di[0],
    );
    assert.equal(doM.length, 2);
    ok(await resolver(C, doM[0].id, b.v.M));
    assert.deepEqual(await itensDaFicha(dev.order), [dev.di[0]]);
    ok(await resolver(C, doM[1].id, null));
    assert.deepEqual(await itensDaFicha(dev.order), []);

    // O item SEM variacao de produto que hoje tem tamanho ligado (o caminho da 642) tambem aparece, pelo item.
    const b2 = await blusa();
    const dev2 = await devolucao(C, [
      { p: b2.produto, v: null, q: 1 },
      { p: b2.produto, v: b2.v.P, q: 1 },
    ]);
    ok(
      await concluir(C, dev2.dev, [
        { item_id: dev2.di[0], condicao: "nova", reestocar: true },
        { item_id: dev2.di[1], condicao: "nova", reestocar: true },
      ]),
    );
    assert.deepEqual(await itensDaFicha(dev2.order), [dev2.di[0]]);

    // Permissao: so o admin de agora le; nenhum de fora le nem o que existe.
    for (const [rotulo, opcoes] of [
      ["anon", { papel: "anon", uid: null, claims: "{}" }],
      [
        "service_role",
        { papel: "service_role", uid: null, claims: '{"role":"service_role"}' },
      ],
      ["cliente", { uid: CLIENTE, claims: CLAIMS_CLIENTE }],
      ["admin rebaixado", { uid: REBAIXADO, claims: CLAIMS_ADMIN }],
    ]) {
      const r = await daDevolucao(C, dev2.order, opcoes);
      assert.equal(r.codigo, "42501", `${rotulo}: ${r.erro}`);
    }
  });
}

// ---------------------------------------------------------------------------
// 9. Mutantes: cada um tem de derrubar a prova certa
// ---------------------------------------------------------------------------
const troca = (s, de, para) => {
  assert.equal(s.split(de).length - 1, 1, `mutante: ${de.slice(0, 60)}`);
  return s.replace(de, () => para);
};
const MUTANTES = [
  {
    nome: "devolver_estoque sem o bloco da variacao desligada (credita o M desligado)",
    sql: troca(
      DEVOLVER,
      "        IF v_item.variant_id IS NOT NULL\n           AND NOT EXISTS",
      "        IF false\n           AND NOT EXISTS",
    ),
    prova: provaDoPedidoDesfeito,
  },
  {
    nome: "devolver_estoque sem o filtro de LIGADA (nenhuma variacao vira sem tamanho)",
    sql: troca(
      DEVOLVER,
      "WHERE v.id = v_item.variant_id AND v.active = true) THEN",
      "WHERE v.id = v_item.variant_id) THEN",
    ),
    prova: provaDoPedidoDesfeito,
  },
  {
    nome: "devolver_estoque que manda TODA variacao para o cantinho (sem o NOT)",
    sql: troca(
      DEVOLVER,
      "           AND NOT EXISTS (SELECT 1 FROM public.product_variants v\n                            WHERE v.id = v_item.variant_id",
      "           AND EXISTS (SELECT 1 FROM public.product_variants v\n                            WHERE v.id = v_item.variant_id",
    ),
    prova: provaDoControleLigado,
  },
  {
    nome: "devolver_estoque sem o pai da variacao para o item sem produto",
    sql: troca(
      DEVOLVER,
      "            v_item.product_id := COALESCE(v_item.product_id,\n                                          (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_item.variant_id));",
      "            v_item.product_id := v_item.product_id;",
    ),
    prova: provaDoItemSemProduto,
  },
  {
    nome: "admin_devolucao_concluir sem o bloco da variacao desligada",
    sql: troca(
      CONCLUIR,
      "      IF v_di.variant_id IS NOT NULL\n         AND NOT EXISTS",
      "      IF false\n         AND NOT EXISTS",
    ),
    prova: provaDaDevolucao,
  },
  {
    nome: "admin_devolucao_concluir sem o filtro de LIGADA",
    sql: troca(
      CONCLUIR,
      "WHERE v.id = v_di.variant_id AND v.active = true) THEN",
      "WHERE v.id = v_di.variant_id) THEN",
    ),
    prova: provaDaDevolucao,
  },
  {
    nome: "pecas_sem_tamanho_da_devolucao sem o filtro do que ainda espera (a peca decidida segue na ficha)",
    sql: troca(
      DA_DEVOLUCAO,
      "     WHERE p.resolvida_em IS NULL\n       AND p.order_id",
      "     WHERE p.order_id",
    ),
    prova: provaDaFicha,
  },
  {
    nome: "pecas_sem_tamanho_da_devolucao sem o filtro do pedido (o item de outra devolucao aparece)",
    sql: troca(
      DA_DEVOLUCAO,
      "     WHERE p.resolvida_em IS NULL\n       AND p.order_id = p_order_id\n",
      "     WHERE p.resolvida_em IS NULL\n",
    ),
    prova: provaDaFicha,
  },
  {
    nome: "pecas_sem_tamanho_da_devolucao sem o item gravado (a peca do pedido desfeito aparece, sem item)",
    sql: troca(
      DA_DEVOLUCAO,
      "       AND p.devolucao_item_id IS NOT NULL\n",
      "",
    ),
    prova: provaDaFicha,
  },
  {
    nome: "pecas_sem_tamanho_da_devolucao sem o admin de AGORA (o rebaixado le)",
    sql: troca(
      DA_DEVOLUCAO,
      "  IF NOT public.is_admin_atual() THEN",
      "  IF false THEN",
    ),
    prova: provaDaFicha,
  },
];

/** Aplica o mutante (COMMIT no clone), roda a prova esperando que caia, e restaura os corpos desta. */
async function provarMutante(m) {
  await C.query(m.sql);
  let morreu = null;
  try {
    await m.prova();
  } catch (e) {
    morreu = e;
  }
  await C.query("ROLLBACK").catch(() => {});
  await C.query(DEVOLVER);
  await C.query(CONCLUIR);
  await C.query(DA_DEVOLUCAO);
  assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);
  assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);
  assert.equal(await hashDaDevolucao(), HASH_DA_DEVOLUCAO_DESTA);
  assert.ok(morreu, `o mutante sobreviveu: ${m.nome}`);
  return morreu;
}

// ---------------------------------------------------------------------------
// 10. Reaplicar, pre-voo, rollback e fichas
// ---------------------------------------------------------------------------
async function linhasDaFicha(sql) {
  const r = await C.query(sql);
  return Array.isArray(r) ? r[r.length - 1].rows : r.rows;
}
async function fichaSoSim(sql, rotulo) {
  const linhas = await linhasDaFicha(sql);
  assert.ok(linhas.length > 0, `${rotulo}: sem linhas`);
  for (const l of linhas)
    assert.equal(l.ok, true, `${rotulo}: ${JSON.stringify(l)}`);
}
async function fichaTemNao(sql, rotulo) {
  const linhas = await linhasDaFicha(sql);
  assert.ok(
    linhas.some((l) => l.ok !== true),
    `${rotulo}: devia acusar algo`,
  );
}

async function provaDaMigration() {
  await emTransacao(async () => {
    // Uma peca no cantinho por esta regra, antes de desfazer: tem de ficar.
    const b = await blusa();
    const { order } = await pedido(C, [{ p: b.produto, v: b.v.M, q: 1 }]);
    await desligar(b.v.M);
    await devolverEstoque(order);
    assert.equal((await cantinho(b.produto)).length, 1);

    await fichaSoSim(FICHA_A, "209a depois do apply");
    await fichaSoSim(
      FICHA_B,
      "209b depois do apply (reaplicar e' idempotente)",
    );
    await fichaSoSim(FICHA_202A, "202a aceita esta como sucessora");

    // Reaplicar (LF e CRLF): mesmo estado.
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.equal(
      (await tentarSql(MIGRATION.replace(/\n/g, "\r\n"))).erro,
      undefined,
    );
    assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);
    assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);
    assert.equal(await hashDaDevolucao(), HASH_DA_DEVOLUCAO_DESTA);

    // O rollback da 642 recusa por baixo desta (ordem).
    const r642 = await tentarSql(ROLLBACK_642);
    assert.match(String(r642.erro), /B1_BASELINE_DIVERGENT/);
    assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);

    // Rollback: os corpos da 642 de volta, o cantinho fica; repetir e' no-op.
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined);
    assert.equal(await hashDevolver(), H_DEV_642);
    assert.equal(await hashConcluir(), H_CONCL_642);
    assert.equal(await hashDaDevolucao(), null, "a leitura da ficha saiu");
    assert.equal(
      (await cantinho(b.produto)).length,
      1,
      "o rollback nao apaga dado",
    );
    await fichaSoSim(FICHA_B, "209b antes do apply");
    await fichaTemNao(FICHA_A, "209a antes do apply");
    await fichaSoSim(FICHA_202A, "202a com o corpo da 642");
    assert.equal(
      (await tentarSql(ROLLBACK)).erro,
      undefined,
      "repetir e' no-op",
    );
    assert.equal(await hashDevolver(), H_DEV_642);

    // Reaplicar depois do rollback: a leitura volta com a porta de sempre (so o authenticated executa).
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);
    assert.equal(await hashDaDevolucao(), HASH_DA_DEVOLUCAO_DESTA);
    assert.deepEqual(
      await um(
        `SELECT has_function_privilege('authenticated', to_regprocedure('public.pecas_sem_tamanho_da_devolucao(uuid)'), 'EXECUTE') AS auth,
                has_function_privilege('anon', to_regprocedure('public.pecas_sem_tamanho_da_devolucao(uuid)'), 'EXECUTE') AS anon,
                has_function_privilege('service_role', to_regprocedure('public.pecas_sem_tamanho_da_devolucao(uuid)'), 'EXECUTE') AS srv`,
      ),
      { auth: true, anon: false, srv: false },
    );

    // Pre-voo: uma leitura ALHEIA com o mesmo nome (outro corpo) recusa a migration e o rollback, sem trocar nem tirar nada.
    await C.query(
      DA_DEVOLUCAO.replace(
        "     ORDER BY p.devolucao_item_id;",
        () => "     ORDER BY 1;",
      ),
    );
    const alheia = await hashDaDevolucao();
    assert.notEqual(alheia, HASH_DA_DEVOLUCAO_DESTA);
    assert.match(
      String((await tentarSql(MIGRATION)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.match(
      String((await tentarSql(ROLLBACK)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.equal(await hashDaDevolucao(), alheia, "nada trocado nem tirado");
    await fichaTemNao(FICHA_A, "209a com a leitura alheia");
    await fichaTemNao(FICHA_B, "209b com a leitura alheia");
    await C.query(DA_DEVOLUCAO);

    // Pre-voo: corpo desconhecido recusa sem escrever nada (e o rollback tambem recusa).
    await C.query(
      DEVOLVER.replace(
        "    RETURN v_unidades;",
        () => "    RETURN v_unidades + 0;",
      ),
    );
    const desconhecido = await hashDevolver();
    assert.match(
      String((await tentarSql(MIGRATION)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.equal(await hashDevolver(), desconhecido, "nada trocado");
    assert.match(
      String((await tentarSql(ROLLBACK)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    await C.query(DEVOLVER);

    // Pre-voo: sem o destino (a RPC da 642 que resolve a peca), recusa.
    await C.query("DROP FUNCTION public.resolver_peca_sem_tamanho(uuid, uuid)");
    assert.match(
      String((await tentarSql(MIGRATION)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    await fichaTemNao(FICHA_B, "209b sem o destino");
  });
}

// ---------------------------------------------------------------------------
prova(
  "1. o defeito com os corpos da 642 (o M desligado recebe) x o corpo novo (a peca espera no cantinho)",
  provaDoDefeito,
);
prova(
  "2. cancelar / Pix vencido: cantinho por peca, carimbo segura a 2a volta, a lojista poe no P e o M desligado e' recusado",
  provaDoPedidoDesfeito,
);
prova(
  "3. devolucao com o M desligado: cantinho, reestocados/sem_tamanho, carimbo e o achado C",
  provaDaDevolucao,
);
prova(
  "4. CONTROLE: o M ligado continua recebendo (pedido e devolucao)",
  provaDoControleLigado,
);
prova(
  "5. nenhuma variacao ligada: credita o pai, nunca o cantinho junto",
  provaDoPai,
);
prova(
  "6. item sem produto: a peca vai para o cantinho do pai da variacao",
  provaDoItemSemProduto,
);
prova(
  "7. matriz diferencial: sem variacao desligada, identico aos corpos da 642",
  provaDaMatriz,
);
prova(
  "8. duas conexoes reais: desligar o M durante a volta, a volta espera e ve o M desligado",
  provaDeDuasConexoes,
);
for (const m of MUTANTES) {
  prova(`9. mutante morre: ${m.nome}`, async () => {
    const morreu = await provarMutante(m);
    console.log(
      `     (caiu por: ${String(morreu.message).split("\n")[0].slice(0, 150)})`,
    );
  });
}
prova(
  "10. reaplicar (LF e CRLF), pre-voo, rollback (ordem, corpos, a leitura sai, dado mantido) e fichas 209a/209b/202a",
  provaDaMigration,
);
prova(
  "11. a ficha da devolucao: so o item do M desligado (nunca o do P ligado do mesmo produto), religar nao muda, decidir tira, permissao",
  provaDaFicha,
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
    // A 20261657000000 (o produto todo desligado) sucede os dois corpos desta: esta prova mede o corpo e o comportamento da
    // 20261653000000, entao a tira antes. O banco e' o clone proprio do rodar-isolado.cjs: desfazer e gravar aqui nao toca outra prova.
    await C.query("BEGIN");
    await require("./o-produto-todo-desligado-posterior.cjs").desfazerProdutoTodoDesligadoNaTransacao(
      C,
    );
    await C.query("COMMIT");
    assert.equal(
      await hashDevolver(),
      HASH_DEVOLVER_DESTA,
      "a migration 20261653000000 nao esta no banco efemero",
    );
    assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);
    assert.equal(await hashDaDevolucao(), HASH_DA_DEVOLUCAO_DESTA);
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
      "VARIACAO-DESLIGADA",
      `${falhas.length} prova(s) falharam:\n${falhas.join("\n")}`,
    );
  }
  console.log(
    `\na-peca-da-variacao-desligada-viva: ${PROVAS.length} provas, ${MUTANTES.length} mutantes mortos`,
  );
}

main().catch((erro) =>
  falhar("VARIACAO-DESLIGADA", erro.stack ?? String(erro)),
);
