"use strict";

/**
 * Prova VIVA da migration 20261657000000 (o produto com TODOS os tamanhos desligados nao volta a venda sozinho). So Postgres EFEMERO,
 * num CLONE proprio (rodar-isolado.cjs): nunca banco de loja.
 *
 * O DEFEITO (controle, regressao da 20261653000000): o vestido tem P, M e G; o M esta com 0 porque uma cliente reservou a ultima peca no
 * Pix; a lojista desliga os TRES tamanhos (o formulario poe o pai em 0). O Pix vence (devolver_estoque) ou a devolucao do M e' concluida
 * com "voltar ao estoque" (admin_devolucao_concluir). Com os corpos da 20261653000000 (aplicados dentro da transacao da prova) nenhum
 * tamanho esta ligado, entao o item cai no ELSE e credita produtos.estoque: produto sem variacao ligada a compra vende pelo pai, e o
 * vestido volta "1 disponivel", sem tamanho. Com o corpo desta, no MESMO cenario, o pai fica em 0 e a peca fica no M desligado.
 *
 * PROVAS (cada uma pelo nome na saida):
 *   1. controle do defeito (corpos da 1653: o pai recebe) x o corpo novo (o pai fica em 0, a peca no M desligado; nada no cantinho);
 *   2. religar o M depois: a peca esta la (volta a venda pelo tamanho certo);
 *   3. devolucao com todos desligados: o M recebe, 'reestocados' conta, 'sem_tamanho' 0, reestocado_em gravado, cancelamento depois
 *      (achado C) nao credita de novo; repetir devolver_estoque nao credita de novo (carimbo);
 *   4. item SEM produto (so a variacao) com todos desligados: a peca fica na variacao, o pai do produto nao recebe;
 *   5. o caso legitimo do pai: produto SEM variacao nenhuma (pedido e devolucao) continua creditando o pai;
 *   6. alguma variacao LIGADA: o cantinho da 1653 segue igual (o M desligado nao recebe, a peca espera a lojista);
 *   7. matriz diferencial: fora do "todas desligadas", os dois corpos dao o mesmo estoque, o mesmo cantinho e o mesmo retorno;
 *   8. mutantes (cada um na guarda certa), restaurando o corpo exato depois;
 *   9. reaplicar (LF e CRLF), pre-voo (corpo estranho), rollback (corpos da 1653 byte a byte, o da 1653 recusa antes dele, dado mantido,
 *      repetir no-op), consultas 213a/213b nos dois estados e as das antecessoras (209a, 202a) aceitando esta como sucessora.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-produto-todo-desligado-nao-volta-a-venda-viva.cjs
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
  PRODUTO_TODO_DESLIGADO,
  HASH_DEVOLVER_DESTA,
  HASH_CONCLUIR_DESTA,
} = require("./o-produto-todo-desligado-posterior.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const NOME = PRODUTO_TODO_DESLIGADO.nome;
const NOME_1653 =
  "20261653000000_a_peca_da_variacao_desligada_espera_a_lojista.sql";
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
const ROLLBACK_1653 = lerMigration(`rollback-manual-${NOME_1653}`);
const FICHA_A = lerConsulta(
  "213a-conferir-o-produto-todo-desligado-nao-volta-a-venda-aplicado",
);
const FICHA_B = lerConsulta(
  "213b-antes-o-produto-todo-desligado-nao-volta-a-venda-base-vigente",
);
const FICHA_209A = lerConsulta(
  "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
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
const M1653 = lerMigration(NOME_1653);
const DEVOLVER_1653 = blocoDe(M1653, INICIO_DEV, "\n$devolver$;");
const CONCLUIR_1653 = blocoDe(M1653, INICIO_CONCL, "\n$$;");
const H_DEV_1653 = "2913f3178498938d0a79e3b47a1084d1";
const H_CONCL_1653 = "d146dc7aefb07a0bf580ed7265d9453e";
const DEVOLVER = blocoDe(MIGRATION, INICIO_DEV, "\n$devolver$;");
const CONCLUIR = blocoDe(MIGRATION, INICIO_CONCL, "\n$$;");

const ADMIN = "7e7e1657-0000-4000-8000-0000000000a1";
const CLIENTE = "7e7e1657-0000-4000-8000-0000000000c1";
const CLAIMS_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

// ---------------------------------------------------------------------------
// Fixture e chamadas
// ---------------------------------------------------------------------------
async function semearPessoas() {
  for (const [id, meta, papel] of [
    [ADMIN, '{"role":"admin"}', "admin"],
    [CLIENTE, "{}", "customer"],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, $1::text || '@r1657.invalid', $2::jsonb)`,
      [id, meta],
    );
    await C.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa ficticia R1657', $2)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [id, papel],
    );
  }
}

/** Produto com estoque `estoque` no pai e as variacoes [{valor, estoque, ativa}]. Devolve { produto, v: { valor: id } }. */
async function produto({ estoque = 0, variacoes = [] } = {}) {
  const id = crypto.randomUUID();
  await C.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo)
     VALUES ($1, 'Vestido ficticio R1657', 10, 50, $2, true)`,
    [id, estoque],
  );
  const ids = [];
  for (const { valor, estoque: e = 0, ativa = true } of variacoes) {
    const variacao = crypto.randomUUID();
    ids.push([valor, variacao]);
    await C.query(
      `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active)
       VALUES ($1, $2, 'Tamanho', $3, $4, $5)`,
      [variacao, id, valor, e, ativa],
    );
  }
  return { produto: id, v: Object.fromEntries(ids) };
}

/** Pedido com os itens [{p, v, q}] (produto ou null, variacao ou null, quantidade). Devolve { order, itens: [ids] }. */
async function pedido(itens) {
  const order = crypto.randomUUID();
  await C.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal, payment_method, payment_status)
     VALUES ($1, $2, 'Pessoa ficticia R1657', '{}'::jsonb, 50, 50, 0, 'cancelled', 'online', 'pix', 'aguardando')`,
    [order, CLIENTE],
  );
  const ids = [];
  for (const { p, v, q } of itens) {
    ids.push(
      (
        await C.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
           VALUES ($1, $2, $3, 'Item R1657', $4, 50) RETURNING id`,
          [order, p, v, q],
        )
      ).rows[0].id,
    );
  }
  return { order, itens: ids };
}

/** Pedido ENTREGUE e pago, com uma devolucao 'recebida' e um devolucao_itens por item. */
async function devolucao(itens) {
  const order = crypto.randomUUID();
  const dev = crypto.randomUUID();
  await C.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal, payment_method, payment_status, paid_at,
        pagamento_recebido_em, gateway_payment_id, valor_estornado)
     VALUES ($1, $2, 'Pessoa ficticia R1657', '{}'::jsonb, 100, 100, 0, 'delivered', 'online', 'online', 'pago', now(), now(), $3, 0)`,
    [order, CLIENTE, `ORD-R1657-${order}`],
  );
  await C.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno, status, valor_itens,
        valor_frete_ida, prazo_ate, politica)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'outro', 'reembolso', 'nacional', 'envio_proprio', 'recebida', 50, 0, current_date + 7, '{}')`,
    [dev, `DEV-R1657-${dev.slice(0, 8)}`, order, CLIENTE],
  );
  const di = [];
  for (const { p, v, q } of itens) {
    const item = (
      await C.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
         VALUES ($1, $2, $3, 'Item R1657', $4, 50) RETURNING id`,
        [order, p, v, q],
      )
    ).rows[0].id;
    di.push(
      (
        await C.query(
          `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, variant_id, product_name, quantidade, valor_unitario)
           VALUES ($1, $2, $3, $4, 'Item R1657', $5, 50) RETURNING id`,
          [dev, item, p, v, q],
        )
      ).rows[0].id,
    );
  }
  return { order, dev, di };
}

/** A conclusao pelo admin de agora (como o painel chama); o erro volta ao savepoint e nao derruba a transacao da prova. */
async function concluir(dev, itens) {
  await C.query("SAVEPOINT tentativa");
  try {
    await C.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [ADMIN, CLAIMS_ADMIN],
    );
    await C.query("SET LOCAL ROLE authenticated");
    const r = await C.query(
      "SELECT public.admin_devolucao_concluir($1::uuid, 'troca', $2::jsonb, NULL, NULL) AS r",
      [dev, JSON.stringify(itens)],
    );
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    return r.rows[0].r;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    throw new Error(`a conclusao foi recusada: ${e.message}`);
  }
}
const voltaTudo = (di) =>
  di.map((item_id) => ({ item_id, condicao: "nova", reestocar: true }));

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

const um = async (sql, params = []) => (await C.query(sql, params)).rows[0];
const estoquePai = async (p) =>
  (await um("SELECT estoque FROM public.produtos WHERE id = $1", [p])).estoque;
const estoqueVar = async (v) =>
  (
    await um(
      "SELECT stock_increment FROM public.product_variants WHERE id = $1",
      [v],
    )
  ).stock_increment;
const cantinho = async (p) =>
  Number(
    (
      await um(
        "SELECT count(*) AS n FROM public.pecas_sem_tamanho WHERE produto_id = $1",
        [p],
      )
    ).n,
  );
const devolverEstoque = async (order) =>
  (await um("SELECT public.devolver_estoque($1) AS n", [order])).n;
const hashDe = async (assinatura) =>
  (
    await um(
      `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`,
      [assinatura],
    )
  )?.h ?? null;
const hashDevolver = () => hashDe("public.devolver_estoque(uuid)");
const hashConcluir = () =>
  hashDe("public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)");

/**
 * Os corpos da 20261653000000, dentro da transacao aberta (o ROLLBACK do fim devolve os do banco). Pelos blocos da propria 1653, e
 * nao pelo rollback desta: assim o controle tambem roda por cima de um MUTANTE.
 */
async function corposDa1653() {
  await C.query(DEVOLVER_1653);
  await C.query(CONCLUIR_1653);
  assert.equal(await hashDevolver(), H_DEV_1653);
  assert.equal(await hashConcluir(), H_CONCL_1653);
}

/** O vestido da caca: P, M e G; o M com 0 (a ultima peca foi reservada no Pix); o pai com 0. */
const vestido = ({ ligadoP = true, ligadoM = true, ligadoG = true } = {}) =>
  produto({
    estoque: 0,
    variacoes: [
      { valor: "P", estoque: 2, ativa: ligadoP },
      { valor: "M", estoque: 0, ativa: ligadoM },
      { valor: "G", estoque: 1, ativa: ligadoG },
    ],
  });
/** A lojista desliga TODOS os tamanhos (o formulario poe o estoque do pai em 0: estoque-das-variacoes.ts). */
async function desligarTudo(p) {
  await C.query(
    "UPDATE public.product_variants SET active = false WHERE product_id = $1",
    [p],
  );
  await C.query("UPDATE public.produtos SET estoque = 0 WHERE id = $1", [p]);
}
/** O que a compra venderia: com variacao ligada, a soma das ligadas; sem nenhuma ligada, o estoque do pai. */
const aVenda = async (p) =>
  (
    await um(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = $1 AND v.active = true)
                   THEN (SELECT COALESCE(sum(v.stock_increment), 0)::int FROM public.product_variants v
                          WHERE v.product_id = $1 AND v.active = true)
                   ELSE (SELECT estoque FROM public.produtos WHERE id = $1) END AS n`,
      [p],
    )
  ).n;

// ---------------------------------------------------------------------------
// 1. O defeito (controle, corpos da 1653) x o corpo novo
// ---------------------------------------------------------------------------
async function cenarioDoDefeito() {
  const ve = await vestido();
  // A cliente reservou a ultima peca do M no Pix (o M ficou com 0); depois a lojista desliga os tres tamanhos.
  const { order } = await pedido([{ p: ve.produto, v: ve.v.M, q: 1 }]);
  await desligarTudo(ve.produto);
  assert.equal(await aVenda(ve.produto), 0, "o vestido saiu da venda");
  const devolvidas = await devolverEstoque(order);
  return { ve, order, devolvidas };
}

async function provaDoDefeito() {
  await emTransacao(async () => {
    await corposDa1653();
    const s = await cenarioDoDefeito();
    assert.equal(s.devolvidas, 1);
    assert.equal(
      await estoquePai(s.ve.produto),
      1,
      "controle: a 1653 credita o PAI (o defeito)",
    );
    assert.equal(
      await aVenda(s.ve.produto),
      1,
      "controle: o vestido volta a venda sozinho, sem tamanho",
    );
    assert.equal(await estoqueVar(s.ve.v.M), 0);
  });
  await emTransacao(async () => {
    const s = await cenarioDoDefeito();
    assert.equal(s.devolvidas, 1, "a peca voltou (para o M), conta");
    assert.equal(await estoquePai(s.ve.produto), 0, "o pai NAO recebe");
    assert.equal(await aVenda(s.ve.produto), 0, "o vestido segue esgotado");
    assert.equal(await estoqueVar(s.ve.v.M), 1, "a peca fica no M desligado");
    assert.equal(await estoqueVar(s.ve.v.P), 2, "o P nao muda");
    assert.equal(await estoqueVar(s.ve.v.G), 1, "o G nao muda");
    assert.equal(await cantinho(s.ve.produto), 0, "nada no cantinho");
    // Repetir (Pix que vence depois do cancelamento, reenvio do webhook): o carimbo segura.
    assert.equal(await devolverEstoque(s.order), 0);
    assert.equal(await estoqueVar(s.ve.v.M), 1);
    assert.equal(await estoquePai(s.ve.produto), 0);
  });
}

// ---------------------------------------------------------------------------
// 2. Religar o M depois: a peca esta la
// ---------------------------------------------------------------------------
async function provaDoReligar() {
  await emTransacao(async () => {
    const s = await cenarioDoDefeito();
    await C.query(
      "UPDATE public.product_variants SET active = true WHERE id = $1",
      [s.ve.v.M],
    );
    assert.equal(
      await aVenda(s.ve.produto),
      1,
      "religar o M poe a peca a venda pelo tamanho certo",
    );
    assert.equal(await estoquePai(s.ve.produto), 0);
  });
}

// ---------------------------------------------------------------------------
// 3. Devolucao com todos os tamanhos desligados
// ---------------------------------------------------------------------------
async function provaDaDevolucao() {
  await emTransacao(async () => {
    const ve = await vestido();
    const dev = await devolucao([
      { p: ve.produto, v: ve.v.M, q: 2 },
      { p: ve.produto, v: ve.v.P, q: 1 },
    ]);
    await desligarTudo(ve.produto);
    const r = await concluir(dev.dev, voltaTudo(dev.di));
    assert.equal(r.reestocados, 3, "as tres voltaram ao estoque dos tamanhos");
    assert.equal(r.sem_tamanho, 0, "nada no cantinho");
    assert.equal(await estoqueVar(ve.v.M), 2, "as duas do M no M");
    assert.equal(await estoqueVar(ve.v.P), 3, "a do P no P");
    assert.equal(await estoquePai(ve.produto), 0, "o pai NAO recebe");
    assert.equal(await aVenda(ve.produto), 0, "o vestido segue esgotado");
    assert.equal(await cantinho(ve.produto), 0);
    const carimbos = await C.query(
      "SELECT count(*) AS n FROM public.devolucao_itens WHERE devolucao_id = $1 AND reestocado_em IS NOT NULL",
      [dev.dev],
    );
    assert.equal(Number(carimbos.rows[0].n), 2, "reestocado_em gravado");
    // Achado C: o cancelamento depois desconta o que a devolucao ja trouxe.
    assert.equal(await devolverEstoque(dev.order), 0);
    assert.equal(await estoqueVar(ve.v.M), 2);
    assert.equal(await estoqueVar(ve.v.P), 3);
    assert.equal(await estoquePai(ve.produto), 0);
  });
}

// ---------------------------------------------------------------------------
// 4. Item sem produto (so a variacao) com todos desligados
// ---------------------------------------------------------------------------
async function provaDoItemSemProduto() {
  await emTransacao(async () => {
    const ve = await vestido();
    const { order } = await pedido([{ p: null, v: ve.v.M, q: 1 }]);
    const dev = await devolucao([{ p: null, v: ve.v.G, q: 1 }]);
    await desligarTudo(ve.produto);
    assert.equal(await devolverEstoque(order), 1);
    const r = await concluir(dev.dev, voltaTudo(dev.di));
    assert.equal(r.reestocados, 1);
    assert.equal(r.sem_tamanho, 0);
    assert.equal(await estoqueVar(ve.v.M), 1, "a do M no M");
    assert.equal(await estoqueVar(ve.v.G), 2, "a do G no G");
    assert.equal(await estoquePai(ve.produto), 0, "o pai da variacao nao");
    assert.equal(await cantinho(ve.produto), 0);
  });
}

// ---------------------------------------------------------------------------
// 5. O caso legitimo do pai: produto SEM variacao nenhuma
// ---------------------------------------------------------------------------
async function provaDoProdutoSemVariacao() {
  await emTransacao(async () => {
    const sv = await produto({ estoque: 3 });
    const { order } = await pedido([{ p: sv.produto, v: null, q: 2 }]);
    const dev = await devolucao([{ p: sv.produto, v: null, q: 1 }]);
    assert.equal(await devolverEstoque(order), 2);
    const r = await concluir(dev.dev, voltaTudo(dev.di));
    assert.equal(r.reestocados, 1);
    assert.equal(r.sem_tamanho, 0);
    assert.equal(await estoquePai(sv.produto), 6, "o pai recebe as tres");
    assert.equal(await cantinho(sv.produto), 0);
  });
}

// ---------------------------------------------------------------------------
// 6. Alguma variacao ligada: o cantinho da 1653 segue igual
// ---------------------------------------------------------------------------
async function provaDoCantinho() {
  await emTransacao(async () => {
    const ve = await vestido({ ligadoM: false });
    const { order } = await pedido([{ p: ve.produto, v: ve.v.M, q: 2 }]);
    const dev = await devolucao([{ p: ve.produto, v: ve.v.M, q: 1 }]);
    assert.equal(await devolverEstoque(order), 0, "a do cantinho nao conta");
    const r = await concluir(dev.dev, voltaTudo(dev.di));
    assert.equal(r.reestocados, 0);
    assert.equal(r.sem_tamanho, 1);
    assert.equal(await estoqueVar(ve.v.M), 0, "o M desligado nao recebe");
    assert.equal(await estoquePai(ve.produto), 0, "o pai nao recebe");
    assert.equal(await cantinho(ve.produto), 3, "as tres esperam a lojista");
  });
}

// ---------------------------------------------------------------------------
// 7. Matriz diferencial: fora do "todas desligadas", os dois corpos sao identicos
// ---------------------------------------------------------------------------
async function matriz() {
  const saida = [];
  const sv = await produto({ estoque: 5 });
  const ve = await vestido({ ligadoM: false });
  const so = await produto({
    estoque: 5,
    variacoes: [{ valor: "U", estoque: 1, ativa: false }],
  });
  for (const [rotulo, itens] of [
    ["sem variacao", [{ p: sv.produto, v: null, q: 2 }]],
    ["variacao ligada", [{ p: ve.produto, v: ve.v.P, q: 1 }]],
    [
      "variacao desligada com outra ligada",
      [{ p: ve.produto, v: ve.v.M, q: 1 }],
    ],
    ["sem variacao de produto com ligada", [{ p: ve.produto, v: null, q: 1 }]],
    [
      "sem variacao de produto so com desligada",
      [{ p: so.produto, v: null, q: 1 }],
    ],
    ["item sem produto nem variacao", [{ p: null, v: null, q: 1 }]],
  ]) {
    const { order } = await pedido(itens);
    saida.push({
      rotulo,
      n: await devolverEstoque(order),
      n2: await devolverEstoque(order),
      sv: await estoquePai(sv.produto),
      veP: await estoqueVar(ve.v.P),
      veM: await estoqueVar(ve.v.M),
      vePai: await estoquePai(ve.produto),
      so: await estoquePai(so.produto),
      soU: await estoqueVar(so.v.U),
      cantinhoVe: await cantinho(ve.produto),
      cantinhoSo: await cantinho(so.produto),
    });
  }
  const dev = await devolucao([
    { p: sv.produto, v: null, q: 1 },
    { p: ve.produto, v: ve.v.P, q: 2 },
    { p: ve.produto, v: ve.v.M, q: 1 },
  ]);
  const r = await concluir(dev.dev, voltaTudo(dev.di));
  saida.push({
    rotulo: "devolucao",
    reestocados: r.reestocados,
    sem_tamanho: r.sem_tamanho,
    sv: await estoquePai(sv.produto),
    veP: await estoqueVar(ve.v.P),
    veM: await estoqueVar(ve.v.M),
    cantinhoVe: await cantinho(ve.produto),
  });
  return saida;
}

async function provaDaMatriz() {
  let antes;
  let depois;
  await emTransacao(async () => {
    await corposDa1653();
    antes = await matriz();
  });
  await emTransacao(async () => {
    depois = await matriz();
  });
  assert.deepEqual(depois, antes, "fora do todas-desligadas, identico a 1653");
  // ancora: a matriz mede o que diz medir
  assert.deepEqual(
    antes.map((x) => x.n),
    [2, 1, 0, 0, 1, 1, undefined],
  );
}

// ---------------------------------------------------------------------------
// 8. Mutantes
// ---------------------------------------------------------------------------
const troca = (s, de, para) => {
  assert.equal(s.split(de).length - 1, 1, `mutante: ${de.slice(0, 60)}`);
  return s.replace(de, () => para);
};
const MUTANTES = [
  {
    nome: "devolver_estoque sem o sub-bloco (toda variacao desligada vira sem tamanho: o corpo da 1653)",
    sql: troca(
      DEVOLVER,
      "            IF EXISTS (SELECT 1 FROM public.product_variants v\n                        WHERE v.product_id = v_item.product_id AND v.active = true) THEN",
      "            IF true THEN",
    ),
    prova: provaDoDefeito,
  },
  {
    nome: "devolver_estoque sem o filtro de LIGADA (qualquer variacao no produto manda ao pai)",
    sql: troca(
      DEVOLVER,
      "WHERE v.product_id = v_item.product_id AND v.active = true) THEN\n                v_item.variant_id := NULL;",
      "WHERE v.product_id = v_item.product_id) THEN\n                v_item.variant_id := NULL;",
    ),
    prova: provaDoDefeito,
  },
  {
    nome: "devolver_estoque com o sub-bloco invertido (com variacao ligada a peca volta ao M desligado)",
    sql: troca(
      DEVOLVER,
      "            IF EXISTS (SELECT 1 FROM public.product_variants v\n                        WHERE v.product_id = v_item.product_id",
      "            IF NOT EXISTS (SELECT 1 FROM public.product_variants v\n                        WHERE v.product_id = v_item.product_id",
    ),
    prova: provaDoCantinho,
  },
  {
    nome: "admin_devolucao_concluir sem o sub-bloco (o corpo da 1653)",
    sql: troca(
      CONCLUIR,
      "        IF EXISTS (SELECT 1 FROM public.product_variants v\n                    WHERE v.product_id = v_di.product_id AND v.active = true) THEN",
      "        IF true THEN",
    ),
    prova: provaDaDevolucao,
  },
  {
    nome: "admin_devolucao_concluir sem o filtro de LIGADA",
    sql: troca(
      CONCLUIR,
      "WHERE v.product_id = v_di.product_id AND v.active = true) THEN\n          v_di.variant_id := NULL;",
      "WHERE v.product_id = v_di.product_id) THEN\n          v_di.variant_id := NULL;",
    ),
    prova: provaDaDevolucao,
  },
  {
    nome: "admin_devolucao_concluir com o sub-bloco invertido",
    sql: troca(
      CONCLUIR,
      "        IF EXISTS (SELECT 1 FROM public.product_variants v\n                    WHERE v.product_id = v_di.product_id",
      "        IF NOT EXISTS (SELECT 1 FROM public.product_variants v\n                    WHERE v.product_id = v_di.product_id",
    ),
    prova: provaDoCantinho,
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
  assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);
  assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);
  assert.ok(morreu, `o mutante sobreviveu: ${m.nome}`);
  return morreu;
}

// ---------------------------------------------------------------------------
// 9. Reaplicar, pre-voo, rollback e fichas
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
    // Uma peca no M desligado por esta regra, antes de desfazer: tem de ficar.
    const s = await cenarioDoDefeito();
    assert.equal(await estoqueVar(s.ve.v.M), 1);

    await fichaSoSim(FICHA_A, "213a depois do apply");
    await fichaSoSim(
      FICHA_B,
      "213b depois do apply (reaplicar e' idempotente)",
    );
    await fichaSoSim(FICHA_209A, "209a aceita esta como sucessora");
    await fichaSoSim(FICHA_202A, "202a aceita esta como sucessora");

    // Reaplicar (LF e CRLF): mesmo estado.
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.equal(
      (await tentarSql(MIGRATION.replace(/\n/g, "\r\n"))).erro,
      undefined,
    );
    assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);
    assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);

    // O rollback da 1653 recusa por baixo desta (ordem).
    const r1653 = await tentarSql(ROLLBACK_1653);
    assert.match(String(r1653.erro), /B1_BASELINE_DIVERGENT/);
    assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);

    // Rollback: os corpos da 1653 de volta, a peca do M fica; repetir e' no-op.
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined);
    assert.equal(await hashDevolver(), H_DEV_1653);
    assert.equal(await hashConcluir(), H_CONCL_1653);
    assert.equal(await estoqueVar(s.ve.v.M), 1, "o rollback nao mexe em dado");
    await fichaSoSim(FICHA_B, "213b antes do apply");
    await fichaTemNao(FICHA_A, "213a antes do apply");
    await fichaSoSim(FICHA_209A, "209a com o corpo da 1653");
    assert.equal(
      (await tentarSql(ROLLBACK)).erro,
      undefined,
      "repetir e' no-op",
    );
    assert.equal(await hashDevolver(), H_DEV_1653);
    assert.equal(
      (await tentarSql(ROLLBACK.replace(/\n/g, "\r\n"))).erro,
      undefined,
      "CRLF tambem",
    );

    // Reaplicar depois do rollback: volta o corpo desta.
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.equal(await hashDevolver(), HASH_DEVOLVER_DESTA);
    assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);

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
    assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);
    assert.match(
      String((await tentarSql(ROLLBACK)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    await fichaTemNao(FICHA_A, "213a com corpo estranho");
    await fichaTemNao(FICHA_B, "213b com corpo estranho");
    await C.query(DEVOLVER);

    // Pre-voo: EXECUTE de devolver_estoque aberto ao logado recusa (atributos e ACL de sempre).
    await C.query(
      "GRANT EXECUTE ON FUNCTION public.devolver_estoque(uuid) TO authenticated",
    );
    assert.match(
      String((await tentarSql(MIGRATION)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    await fichaTemNao(FICHA_B, "213b com o EXECUTE aberto");
  });
}

// ---------------------------------------------------------------------------
prova(
  "1. o defeito com os corpos da 1653 (o pai recebe, o vestido volta a venda) x o corpo novo (o pai fica em 0, a peca no M)",
  provaDoDefeito,
);
prova(
  "2. religar o M depois: a peca volta a venda pelo tamanho",
  provaDoReligar,
);
prova(
  "3. devolucao com todos desligados: os tamanhos recebem, o pai nao, carimbo e achado C",
  provaDaDevolucao,
);
prova(
  "4. item sem produto com todos desligados: a peca fica na variacao",
  provaDoItemSemProduto,
);
prova(
  "5. produto SEM variacao nenhuma: continua creditando o pai",
  provaDoProdutoSemVariacao,
);
prova(
  "6. alguma variacao ligada: o cantinho da 1653 segue igual",
  provaDoCantinho,
);
prova(
  "7. matriz diferencial: fora do todas-desligadas, identico aos corpos da 1653",
  provaDaMatriz,
);
for (const m of MUTANTES) {
  prova(`8. mutante morre: ${m.nome}`, async () => {
    const morreu = await provarMutante(m);
    console.log(
      `     (caiu por: ${String(morreu.message).split("\n")[0].slice(0, 150)})`,
    );
  });
}
prova(
  "9. reaplicar (LF e CRLF), pre-voo, rollback (ordem, corpos, dado mantido) e fichas 213a/213b/209a/202a",
  provaDaMigration,
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url, statement_timeout: 15000 });
  const falhas = [];
  try {
    await C.connect();
    const db = (await C.query("SELECT current_database() AS d")).rows[0].d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: nunca mutar o banco base",
    );
    assert.equal(
      await hashDevolver(),
      HASH_DEVOLVER_DESTA,
      "a migration 20261657000000 nao esta no banco efemero",
    );
    assert.equal(await hashConcluir(), HASH_CONCLUIR_DESTA);
    await semearPessoas();
    for (const p of PROVAS) {
      try {
        await p.corpo();
        console.log(`PASSOU  ${p.nome}`);
      } catch (e) {
        await C.query("ROLLBACK").catch(() => {});
        falhas.push(`${p.nome}\n   ${e.stack ?? e}`);
        console.log(`FALHOU  ${p.nome}`);
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  if (falhas.length > 0) {
    falhar(
      "PRODUTO-TODO-DESLIGADO",
      `${falhas.length} prova(s) falharam:\n${falhas.join("\n")}`,
    );
  }
  console.log(
    `\no-produto-todo-desligado-nao-volta-a-venda-viva: ${PROVAS.length} provas, ${MUTANTES.length} mutantes mortos`,
  );
}

main().catch((erro) =>
  falhar("PRODUTO-TODO-DESLIGADO", erro.stack ?? String(erro)),
);
