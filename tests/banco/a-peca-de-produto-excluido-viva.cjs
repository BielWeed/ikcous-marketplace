"use strict";

/**
 * Prova VIVA da migration 20261659000000 (a peca de produto EXCLUIDO fica fora do estoque, e o vale-troca nao e dinheiro no ranking
 * de lucro). So Postgres EFEMERO, num CLONE proprio (rodar-isolado.cjs): nunca banco de loja.
 *
 * OS DEFEITOS (controle, com os corpos anteriores aplicados dentro da transacao da prova pelo rollback desta):
 *   - a lojista exclui um produto; depois o pedido dele e' cancelado / o Pix vence (devolver_estoque) ou a devolucao e' concluida com
 *     "voltar ao estoque" (admin_devolucao_concluir): o banco soma no estoque do produto EXCLUIDO, que ninguem ve nem vende;
 *     resolver_peca_sem_tamanho aceita por a peca num tamanho do produto excluido;
 *   - o ranking "Produtos que mais dao lucro" desconta o vale-troca como dinheiro devolvido: R$ 100 entraram, a blusa voltou por vale e
 *     a calca (custo R$ 50) saiu paga com o cupom do vale: o Financeiro (fin_dre) da +R$ 50 e o ranking dava -R$ 50.
 *
 * PROVAS (cada uma pelo nome na saida):
 *   1. controle do defeito (corpos anteriores: o excluido recebe, o resolver aceita, o vale desconta) x o corpo novo;
 *   2. cancelar / Pix vencido: produto simples, variacao, item sem produto (pai da variacao) e variacao desligada de produto excluido
 *      nao somam nem vao para o cantinho; o carimbo do pedido e' gravado e repetir nao credita; pedido misto credita so o normal;
 *   3. devolucao: 'fora_do_estoque' conta a peca do excluido, 'reestocados' so o que voltou a venda, reestocado_em gravado; o
 *      cancelamento depois (achado C) nao credita; 'ausente' e "nao reestocar" nao contam;
 *   4. a decisao da peca que ja esperava: tamanho de produto excluido recusado 22023 (nada muda); "nao tenho" aceito; repetir devolve
 *      a decisao; o controle sem exclusao credita;
 *   5. CONTROLE: produto NAO excluido -> estoque, retorno e cantinho IDENTICOS aos dos corpos anteriores (matriz diferencial);
 *   6. ranking e grafico com o vale: +R$ 50 nos dois, igual ao Financeiro; a venda sem devolucao da o JSON INTEIRO igual ao anterior;
 *   7. DUAS CONEXOES REAIS: a lojista exclui o produto enquanto o pedido volta; a volta espera a trava do produto e ve o excluido;
 *   8. mutantes (cada um na guarda certa), restaurando o corpo exato depois;
 *   9. reaplicar (LF e CRLF), pre-voo, atomicidade, rollback (os quatro corpos byte a byte, OID/dono/ACL iguais, dado intacto, os
 *      rollbacks da 1657 e da 3995 recusam por baixo desta), consultas 215a/215b e as fichas antigas que aceitam esta como sucessora.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-peca-de-produto-excluido-viva.cjs
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
  PRODUTO_EXCLUIDO,
  HASH_DEVOLVER_DESTA,
  HASH_CONCLUIR_DESTA,
  HASH_RESOLVER_DESTA,
  HASH_ANALYTICS_DESTA,
  HASH_DEVOLVER_657,
  HASH_CONCLUIR_657,
  HASH_RESOLVER_642,
  HASH_ANALYTICS_3995,
} = require("./a-peca-de-produto-excluido-posterior.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const NOME = PRODUTO_EXCLUIDO.nome;
const norm = (s) => s.replace(/\r\n/g, "\n");
const lerMigration = (n) =>
  norm(fs.readFileSync(path.join(RAIZ, "supabase", "migrations", n), "utf8"));
const lerConsulta = (n) =>
  fs.readFileSync(
    path.join(RAIZ, "scripts", "publicacao", "consultas", `${n}.sql`),
    "utf8",
  );
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

const MIGRATION = lerMigration(NOME);
const ROLLBACK = lerMigration(`rollback-manual-${NOME}`);
const ROLLBACK_657 = lerMigration(
  "rollback-manual-20261657000000_o_produto_todo_desligado_nao_volta_a_venda.sql",
);
const ROLLBACK_3995 = lerMigration(
  "rollback-manual-20261399995000_o_lucro_do_ranking_casa_com_o_financeiro_pedido_a_pedido.sql",
);
const A215 =
  "215a-conferir-a-peca-de-produto-excluido-fica-fora-e-o-vale-nao-e-dinheiro-aplicado";
const B215 =
  "215b-antes-a-peca-de-produto-excluido-fica-fora-e-o-vale-nao-e-dinheiro-base-vigente";
const FICHA_A = lerConsulta(A215);
const FICHA_B = lerConsulta(B215);
// As fichas antigas que conferem um dos quatro corpos e passam a aceitar o desta como SUCESSORA: com esta no ar elas dizem
// EXATAMENTE o mesmo que com o corpo anterior (linha a linha).
const FICHAS_SUCESSORAS = [
  "8e-conferir-92-a-202-aplicado",
  // A 17a (o estoque do painel) confere o analytics por sha256 e aceita o corpo desta (LF e CRLF) ao lado dos anteriores.
  "17a-conferir-estoque-do-painel-aplicado",
  "35a-conferir-lucro-so-com-custo-aplicado",
  "43a-conferir-reembolso-em-duvida-aplicado",
  "45a-conferir-custo-do-dia-aplicado",
  "48a-conferir-lucro-com-desconto-aplicado",
  "53a-conferir-faturamento-potencial-aplicado",
  "54a-conferir-lucro-do-estoque-aplicado",
  "67a-conferir-reembolso-manual-reserva-aplicado",
  "96a-conferir-o-estoque-que-volta-tranca-na-mesma-ordem-aplicado",
  "110a-conferir-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-aplicado",
  "135a-conferir-o-ranking-de-lucro-desconta-a-devolucao-aplicado",
  "146a-conferir-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-aplicado",
  "147a-conferir-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-aplicado",
  "202a-conferir-a-peca-que-volta-sem-tamanho-aplicado",
  "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
  "213a-conferir-o-produto-todo-desligado-nao-volta-a-venda-aplicado",
].map((nome) => ({ nome, sql: lerConsulta(nome) }));

const blocoDe = (sql, inicio, fim) => {
  const i = sql.indexOf(inicio);
  assert.ok(i >= 0, `bloco ausente: ${inicio}`);
  assert.equal(sql.indexOf(inicio, i + 1), -1, `bloco repetido: ${inicio}`);
  return sql.slice(i, sql.indexOf(fim, i) + fim.length);
};
const corpoDe = (bloco, tag) => {
  const a = bloco.indexOf(`AS ${tag}`) + `AS ${tag}`.length;
  return bloco.slice(a, bloco.indexOf(tag, a));
};
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
  "CREATE OR REPLACE FUNCTION public.resolver_peca_sem_tamanho(p_peca_id uuid, p_variant_id uuid)",
  "\n$resolver$;",
);
const ANALYTICS = blocoDe(
  MIGRATION,
  "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)",
  "\n$$;",
);

const ASSIN = {
  dev: "public.devolver_estoque(uuid)",
  concl: "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)",
  res: "public.resolver_peca_sem_tamanho(uuid,uuid)",
  ana: "public.get_admin_analytics_v2(integer)",
};
const DESTA = {
  dev: HASH_DEVOLVER_DESTA,
  concl: HASH_CONCLUIR_DESTA,
  res: HASH_RESOLVER_DESTA,
  ana: HASH_ANALYTICS_DESTA,
};
const ANTERIOR = {
  dev: HASH_DEVOLVER_657,
  concl: HASH_CONCLUIR_657,
  res: HASH_RESOLVER_642,
  ana: HASH_ANALYTICS_3995,
};

const ADMIN = "7e7e1659-0000-4000-8000-0000000000a1";
const CLIENTE = "7e7e1659-0000-4000-8000-0000000000c1";
const REBAIXADO = "7e7e1659-0000-4000-8000-0000000000a2";
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
       VALUES ($1::uuid, $1::text || '@r1659.invalid', $2::jsonb)`,
      [id, meta],
    );
    await C.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa ficticia R1659', $2)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [id, papel],
    );
  }
}

/** Produto com estoque `estoque` no pai e as variacoes [{valor, estoque, ativa}]. Devolve { produto, v: { valor: id } }. */
async function produto(
  c,
  { estoque = 0, variacoes = [], preco = 50, custo = 10 } = {},
) {
  const id = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo)
     VALUES ($1, 'Produto ficticio R1659', $3, $4, $2, true)`,
    [id, estoque, custo, preco],
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
const simples = (c = C) => produto(c, { estoque: 5 });
/** P e M ligados com estoque 2; o pai com 0 (a compra vende pelas variacoes). */
const blusa = (c = C, { ligadaM = true } = {}) =>
  produto(c, {
    estoque: 0,
    variacoes: [
      { valor: "P", estoque: 2, ativa: true },
      { valor: "M", estoque: 2, ativa: ligadaM },
    ],
  });
const excluir = (p, c = C) =>
  c.query("UPDATE public.produtos SET deleted_at = now() WHERE id = $1", [p]);

/** Pedido cancelado com os itens [{p, v, q}] (produto ou null, variacao ou null, quantidade). */
async function pedido(c, itens) {
  const order = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal, payment_method, payment_status)
     VALUES ($1, $2, 'Pessoa ficticia R1659', '{}'::jsonb, 50, 50, 0, 'cancelled', 'online', 'pix', 'aguardando')`,
    [order, CLIENTE],
  );
  for (const { p, v, q } of itens)
    await c.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
       VALUES ($1, $2, $3, 'Item R1659', $4, 50)`,
      [order, p, v, q],
    );
  return order;
}

/** Pedido ENTREGUE e pago, com uma devolucao 'recebida' e um devolucao_itens por item. */
async function devolucao(c, itens) {
  const order = crypto.randomUUID();
  const dev = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal, payment_method, payment_status, paid_at,
        pagamento_recebido_em, gateway_payment_id, valor_estornado)
     VALUES ($1, $2, 'Pessoa ficticia R1659', '{}'::jsonb, 100, 100, 0, 'delivered', 'online', 'online', 'pago', now(), now(), $3, 0)`,
    [order, CLIENTE, `ORD-R1659-${order}`],
  );
  await c.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno, status, valor_itens,
        valor_frete_ida, prazo_ate, politica)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'outro', 'reembolso', 'nacional', 'envio_proprio', 'recebida', 50, 0, current_date + 7, '{}')`,
    [dev, `DEV-R1659-${dev.slice(0, 8)}`, order, CLIENTE],
  );
  const di = [];
  for (const { p, v, q } of itens) {
    const item = (
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
         VALUES ($1, $2, $3, 'Item R1659', $4, 50) RETURNING id`,
        [order, p, v, q],
      )
    ).rows[0].id;
    di.push(
      (
        await c.query(
          `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, variant_id, product_name, quantidade, valor_unitario)
           VALUES ($1, $2, $3, $4, 'Item R1659', $5, 50) RETURNING id`,
          [dev, item, p, v, q],
        )
      ).rows[0].id,
    );
  }
  return { order, dev, di };
}

/** O erro volta ao savepoint e nao derruba a transacao da prova. */
async function chamar(conn, sql, params = []) {
  await conn.query("SAVEPOINT tentativa");
  try {
    await conn.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [ADMIN, CLAIMS_ADMIN],
    );
    await conn.query("SET LOCAL ROLE authenticated");
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
const ok = (r) => {
  assert.equal(r.erro, undefined, `a chamada foi recusada: ${r.erro}`);
  return r.linhas;
};
const concluir = async (dev, itens) =>
  ok(
    await chamar(
      C,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'troca', $2::jsonb, NULL, NULL) AS r",
      [dev, JSON.stringify(itens)],
    ),
  )[0].r;
const resolver = (peca, variante) =>
  chamar(
    C,
    "SELECT public.resolver_peca_sem_tamanho($1::uuid, $2::uuid) AS r",
    [peca, variante],
  );

async function emTransacao(corpo) {
  await C.query("BEGIN");
  try {
    return await corpo();
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
      `SELECT id, order_id, origem, resolvida_em, resolucao, variant_id
         FROM public.pecas_sem_tamanho WHERE produto_id = $1 ORDER BY criada_em, id`,
      [p],
    )
  ).rows;
const devolverEstoque = async (order, c = C) =>
  (await um("SELECT public.devolver_estoque($1) AS n", [order], c)).n;
const carimbo = async (order) =>
  (
    await um(
      "SELECT stock_returned_at FROM public.marketplace_orders WHERE id = $1",
      [order],
    )
  ).stock_returned_at;
const hashDe = async (assinatura, c = C) =>
  (
    await um(
      `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`,
      [assinatura],
      c,
    )
  )?.h ?? null;
const hashes = async () => ({
  dev: await hashDe(ASSIN.dev),
  concl: await hashDe(ASSIN.concl),
  res: await hashDe(ASSIN.res),
  ana: await hashDe(ASSIN.ana),
});
/** OID, dono, ACL e todos os atributos das quatro (sem o texto). */
const fotografia = async () =>
  (
    await C.query(
      `SELECT to_jsonb(p) - 'prosrc' AS f FROM pg_proc p
        WHERE p.oid IN (to_regprocedure($1), to_regprocedure($2), to_regprocedure($3), to_regprocedure($4))
        ORDER BY p.oid`,
      [ASSIN.dev, ASSIN.concl, ASSIN.res, ASSIN.ana],
    )
  ).rows.map((r) => r.f);
/** Os corpos anteriores (1657, 642 e 3995) DENTRO da transacao aberta, pelo rollback desta (o ROLLBACK do fim os devolve). */
async function corposAnteriores() {
  await C.query(ROLLBACK);
  assert.deepEqual(await hashes(), ANTERIOR);
}

// ---------------------------------------------------------------------------
// 1. O defeito (controle, corpos anteriores) x o corpo novo
// ---------------------------------------------------------------------------
async function cenarioDoDefeito() {
  const p = await simples();
  const b = await blusa();
  const order = await pedido(C, [
    { p: p.produto, v: null, q: 2 },
    { p: b.produto, v: b.v.M, q: 1 },
  ]);
  const dev = await devolucao(C, [{ p: p.produto, v: null, q: 1 }]);
  await excluir(p.produto);
  await excluir(b.produto);
  const devolvidas = await devolverEstoque(order);
  const r = await concluir(dev.dev, [
    { item_id: dev.di[0], condicao: "nova", reestocar: true },
  ]);
  return { p, b, devolvidas, r };
}

async function provaDoDefeito() {
  await emTransacao(async () => {
    await corposAnteriores();
    const s = await cenarioDoDefeito();
    assert.equal(
      s.devolvidas,
      3,
      "controle: o corpo anterior credita as tres pecas",
    );
    assert.equal(
      await estoquePai(s.p.produto),
      8,
      "controle: o produto EXCLUIDO recebe 2 + 1 (o defeito)",
    );
    assert.equal(
      await estoqueVar(s.b.v.M),
      3,
      "controle: o M do produto excluido recebe",
    );
    assert.equal(
      s.r.reestocados,
      1,
      "controle: o painel diz que voltou ao estoque",
    );
    assert.equal(
      s.r.fora_do_estoque,
      undefined,
      "controle: o corpo anterior nao tem o campo novo",
    );
  });
  await emTransacao(async () => {
    const s = await cenarioDoDefeito();
    assert.equal(
      s.devolvidas,
      0,
      "nenhuma peca de produto excluido conta como creditada",
    );
    assert.equal(
      await estoquePai(s.p.produto),
      5,
      "o produto excluido NAO recebe",
    );
    assert.equal(
      await estoqueVar(s.b.v.M),
      2,
      "o M do produto excluido NAO recebe",
    );
    assert.equal(
      (await cantinho(s.b.produto)).length,
      0,
      "nem vai para o cantinho",
    );
    assert.equal(s.r.reestocados, 0);
    assert.equal(s.r.fora_do_estoque, 1);
    assert.equal(s.r.sem_tamanho, 0);
  });
}

// ---------------------------------------------------------------------------
// 2. Cancelar / Pix vencido (devolver_estoque)
// ---------------------------------------------------------------------------
async function provaDoPedidoDesfeito() {
  await emTransacao(async () => {
    // Produto simples excluido: nada credita, o carimbo e' gravado e repetir nao credita depois.
    const p = await simples();
    const o1 = await pedido(C, [{ p: p.produto, v: null, q: 2 }]);
    await excluir(p.produto);
    assert.equal(await devolverEstoque(o1), 0);
    assert.equal(
      await estoquePai(p.produto),
      5,
      "o produto excluido nao recebe",
    );
    assert.notEqual(await carimbo(o1), null, "o carimbo do pedido e' gravado");
    assert.equal(await devolverEstoque(o1), 0, "repetir nao credita");
    assert.equal(await estoquePai(p.produto), 5);

    // Variacao (ligada) de produto excluido: nem a variacao, nem o pai, nem o cantinho.
    const b = await blusa();
    const o2 = await pedido(C, [{ p: b.produto, v: b.v.M, q: 1 }]);
    await excluir(b.produto);
    assert.equal(await devolverEstoque(o2), 0);
    assert.equal(await estoqueVar(b.v.M), 2);
    assert.equal(await estoqueVar(b.v.P), 2);
    assert.equal(await estoquePai(b.produto), 0);
    assert.equal((await cantinho(b.produto)).length, 0);

    // Item SEM produto, so com a variacao: o pai da variacao excluido tambem segura.
    const b2 = await blusa();
    const o3 = await pedido(C, [{ p: null, v: b2.v.M, q: 1 }]);
    await excluir(b2.produto);
    assert.equal(await devolverEstoque(o3), 0);
    assert.equal(
      await estoqueVar(b2.v.M),
      2,
      "o pai excluido segura o item sem produto",
    );
    assert.equal((await cantinho(b2.produto)).length, 0);

    // Variacao DESLIGADA de produto excluido: o excluido vence (sem o cantinho da 653).
    const b3 = await blusa(C, { ligadaM: false });
    const o4 = await pedido(C, [{ p: b3.produto, v: b3.v.M, q: 1 }]);
    await excluir(b3.produto);
    assert.equal(await devolverEstoque(o4), 0);
    assert.equal(
      (await cantinho(b3.produto)).length,
      0,
      "a peca de produto excluido nao espera a lojista",
    );
    assert.equal(await estoqueVar(b3.v.M), 2);

    // TODOS os tamanhos desligados e o produto excluido: o excluido vence tambem o caminho da 1657 (a peca na propria variacao).
    const b4 = await produto(C, {
      estoque: 0,
      variacoes: [{ valor: "M", estoque: 2, ativa: false }],
    });
    const o6 = await pedido(C, [{ p: b4.produto, v: b4.v.M, q: 1 }]);
    await excluir(b4.produto);
    assert.equal(await devolverEstoque(o6), 0);
    assert.equal(
      await estoqueVar(b4.v.M),
      2,
      "nem a variacao desligada recebe",
    );
    assert.equal(await estoquePai(b4.produto), 0);
    assert.equal((await cantinho(b4.produto)).length, 0);

    // Pedido misto: so o item do produto NAO excluido credita.
    const vivo = await simples();
    const morto = await simples();
    const o5 = await pedido(C, [
      { p: vivo.produto, v: null, q: 1 },
      { p: morto.produto, v: null, q: 3 },
    ]);
    await excluir(morto.produto);
    assert.equal(
      await devolverEstoque(o5),
      1,
      "conta so a peca que voltou a venda",
    );
    assert.equal(await estoquePai(vivo.produto), 6);
    assert.equal(await estoquePai(morto.produto), 5);
  });
}

// ---------------------------------------------------------------------------
// 3. Devolucao (admin_devolucao_concluir)
// ---------------------------------------------------------------------------
async function provaDaDevolucao() {
  await emTransacao(async () => {
    const vivo = await simples();
    const morto = await simples();
    const b = await blusa();
    const dev = await devolucao(C, [
      { p: morto.produto, v: null, q: 2 },
      { p: vivo.produto, v: null, q: 1 },
      { p: b.produto, v: b.v.M, q: 1 },
    ]);
    await excluir(morto.produto);
    await excluir(b.produto);
    const r = await concluir(dev.dev, [
      { item_id: dev.di[0], condicao: "nova", reestocar: true },
      { item_id: dev.di[1], condicao: "nova", reestocar: true },
      { item_id: dev.di[2], condicao: "usada", reestocar: true },
    ]);
    assert.equal(r.reestocados, 1, "so a do produto vivo voltou a venda");
    assert.equal(
      r.fora_do_estoque,
      3,
      "as duas do excluido e a do M do excluido",
    );
    assert.equal(r.sem_tamanho, 0);
    assert.equal(await estoquePai(vivo.produto), 6);
    assert.equal(await estoquePai(morto.produto), 5, "o excluido nao recebe");
    assert.equal(await estoqueVar(b.v.M), 2, "o M do excluido nao recebe");
    assert.equal((await cantinho(b.produto)).length, 0, "nem espera a lojista");
    const itens = (
      await C.query(
        "SELECT id, reestocado_em, reestocar FROM public.devolucao_itens WHERE devolucao_id = $1",
        [dev.dev],
      )
    ).rows;
    assert.equal(itens.length, 3);
    for (const i of itens) {
      assert.notEqual(
        i.reestocado_em,
        null,
        "a marca 'a peca voltou' fica gravada",
      );
      assert.equal(i.reestocar, true);
    }
    // Achado C: o cancelamento depois desconta o que a devolucao trouxe, inclusive a do excluido (nada a mais em lugar nenhum).
    assert.equal(await devolverEstoque(dev.order), 0);
    assert.equal(await estoquePai(vivo.produto), 6);
    assert.equal(await estoquePai(morto.produto), 5);
    assert.equal(await estoqueVar(b.v.M), 2);

    // 'ausente' e "nao reestocar" de produto excluido: nada volta, nada conta em fora_do_estoque.
    const m2 = await simples();
    const dev2 = await devolucao(C, [
      { p: m2.produto, v: null, q: 1 },
      { p: m2.produto, v: null, q: 1 },
    ]);
    await excluir(m2.produto);
    const r2 = await concluir(dev2.dev, [
      { item_id: dev2.di[0], condicao: "ausente", reestocar: true },
      { item_id: dev2.di[1], condicao: "danificada", reestocar: false },
    ]);
    assert.equal(r2.reestocados, 0);
    assert.equal(r2.fora_do_estoque, 0);
    assert.equal(await estoquePai(m2.produto), 5);
  });
}

// ---------------------------------------------------------------------------
// 4. A decisao da peca que ja esperava (resolver_peca_sem_tamanho)
// ---------------------------------------------------------------------------
/** Uma peca no cantinho: item SEM variacao de um produto com variacao ligada (o caminho da 642), ANTES de excluir. */
async function pecaNoCantinho() {
  const b = await blusa();
  const order = await pedido(C, [{ p: b.produto, v: null, q: 1 }]);
  assert.equal(await devolverEstoque(order), 0);
  const [peca] = await cantinho(b.produto);
  assert.ok(peca, "a peca esperou a lojista");
  return { b, peca: peca.id };
}

async function provaDoResolver() {
  await emTransacao(async () => {
    const { b, peca } = await pecaNoCantinho();
    await excluir(b.produto);
    const recusa = await resolver(peca, b.v.P);
    assert.equal(
      recusa.codigo,
      "22023",
      `tamanho de produto excluido recusado: ${recusa.erro}`,
    );
    assert.match(String(recusa.erro), /exclu/i);
    assert.equal(await estoqueVar(b.v.P), 2, "nada muda");
    assert.equal(
      (await cantinho(b.produto))[0].resolvida_em,
      null,
      "a peca segue esperando",
    );
    // "Nao tenho essa peca" segue aceito: e' por ele que a peca sai da lista.
    const descarte = ok(await resolver(peca, null))[0].r;
    assert.equal(descarte.resolucao, "descartada");
    assert.equal(descarte.ja_resolvida, false);
    // Repetir (dois toques) devolve a decisao que ja existe, sem erro e sem credito.
    const repetir = ok(await resolver(peca, b.v.P))[0].r;
    assert.equal(repetir.ja_resolvida, true);
    assert.equal(repetir.resolucao, "descartada");
    assert.equal(await estoqueVar(b.v.P), 2);
  });
  // Controle: produto NAO excluido, a lojista poe a peca no P.
  await emTransacao(async () => {
    const { b, peca } = await pecaNoCantinho();
    const r = ok(await resolver(peca, b.v.P))[0].r;
    assert.equal(r.resolucao, "reposta");
    assert.equal(await estoqueVar(b.v.P), 3);
  });
}

// ---------------------------------------------------------------------------
// 5. CONTROLE: produto NAO excluido -> identico aos corpos anteriores
// ---------------------------------------------------------------------------
async function matrizSemExclusao() {
  const p = await simples();
  const b = await blusa();
  const bd = await blusa(C, { ligadaM: false });
  // Todos os tamanhos desligados (o caminho da 1657): a peca fica na propria variacao, nos dois corpos.
  const td = await produto(C, {
    estoque: 0,
    variacoes: [{ valor: "M", estoque: 2, ativa: false }],
  });
  const order = await pedido(C, [
    { p: p.produto, v: null, q: 2 },
    { p: b.produto, v: b.v.M, q: 1 },
    { p: bd.produto, v: bd.v.M, q: 1 },
    { p: td.produto, v: td.v.M, q: 1 },
  ]);
  const dev = await devolucao(C, [
    { p: p.produto, v: null, q: 1 },
    { p: b.produto, v: b.v.P, q: 1 },
  ]);
  const n = await devolverEstoque(order);
  const r = await concluir(dev.dev, [
    { item_id: dev.di[0], condicao: "nova", reestocar: true },
    { item_id: dev.di[1], condicao: "nova", reestocar: true },
  ]);
  return {
    n,
    reestocados: r.reestocados,
    sem_tamanho: r.sem_tamanho,
    pai: await estoquePai(p.produto),
    m: await estoqueVar(b.v.M),
    pP: await estoqueVar(b.v.P),
    cantinhoDesligada: (await cantinho(bd.produto)).length,
    todoDesligadoVariacao: await estoqueVar(td.v.M),
    todoDesligadoPai: await estoquePai(td.produto),
  };
}

async function provaDoControle() {
  const antes = await emTransacao(async () => {
    await corposAnteriores();
    return matrizSemExclusao();
  });
  const depois = await emTransacao(async () => {
    const m = await matrizSemExclusao();
    return m;
  });
  assert.deepEqual(
    depois,
    antes,
    "sem produto excluido, tudo igual aos corpos anteriores",
  );
  assert.deepEqual(antes, {
    // a do produto todo desligado conta como creditada (na propria variacao, regra da 1657)
    n: 4,
    reestocados: 2,
    sem_tamanho: 0,
    pai: 8,
    m: 3,
    pP: 3,
    cantinhoDesligada: 1,
    todoDesligadoVariacao: 3,
    todoDesligadoPai: 0,
  });
}

// ---------------------------------------------------------------------------
// 6. Ranking e grafico com o vale-troca (o Financeiro e' o oraculo)
// ---------------------------------------------------------------------------
const analytics = async () =>
  (await C.query("SELECT public.get_admin_analytics_v2(30) AS r")).rows[0].r;
const lucroBrutoFin = async () =>
  Number(
    (
      await C.query(
        "SELECT (public.fin_dre(current_date - 10, current_date + 1) ->> 'lucro_bruto')::numeric AS v",
      )
    ).rows[0].v,
  );

/** So as vendas desta fixture contam (as que ja existiam no clone saem DENTRO da transacao) e o admin de agora le o painel. */
async function soAFixture() {
  await C.query("SET LOCAL session_replication_role = replica");
  await C.query("UPDATE public.marketplace_orders SET status = 'cancelled'");
  await C.query("SET LOCAL session_replication_role = origin");
  await C.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
}

async function venda(c, { dias, itens, desconto = 0 }) {
  const subtotal = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const id = (
    await c.query(
      `INSERT INTO public.marketplace_orders
         (customer_name, customer_data, total, subtotal, discount, status, canal, payment_method,
          payment_status, paid_at, created_at)
       VALUES ('Cliente R1659', '{}'::jsonb, $1, $2, $3, 'delivered', 'online', 'online', 'pago',
               now() - ($4 || ' days')::interval, now() - ($4 || ' days')::interval)
       RETURNING id`,
      [subtotal - desconto, subtotal, desconto, String(dias)],
    )
  ).rows[0].id;
  const ids = [];
  for (const i of itens)
    ids.push(
      (
        await c.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
           VALUES ($1, $2, 'item R1659', $3, $4) RETURNING id`,
          [id, i.produto, i.qtd, i.preco],
        )
      ).rows[0].id,
    );
  return { id, itens: ids };
}

/** A devolucao CONCLUIDA por vale da peca `item` do pedido, com a peca de volta a prateleira (como a conclusao grava). */
async function valeConcluido(c, ped, item, valor) {
  const dev = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_frete_ida, prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'vale', 'vale', 'local', 'entrega_na_loja', 'concluida', $5::numeric, 0,
       current_date + 7, '{}'::jsonb, now())`,
    [dev, `P1659-${dev.slice(0, 8)}`, ped.id, CLIENTE, valor],
  );
  await c.query(
    `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, condicao, reestocar, reestocado_em)
     VALUES ($1, $2, (SELECT product_id FROM public.marketplace_order_items WHERE id = $2), 1, $3, 'nova', true, now())`,
    [dev, item, valor],
  );
}

/** O caso do socio: R$ 100 entraram, a blusa voltou por vale e a calca (custo R$ 50) saiu paga com o cupom do vale. */
async function casoDoVale() {
  const finAntes = await lucroBrutoFin();
  const blusaP = (await produto(C, { estoque: 10, preco: 100, custo: 50 }))
    .produto;
  const calcaP = (await produto(C, { estoque: 10, preco: 100, custo: 50 }))
    .produto;
  const p1 = await venda(C, {
    dias: 3,
    itens: [{ produto: blusaP, qtd: 1, preco: 100 }],
  });
  await valeConcluido(C, p1, p1.itens[0], 100);
  await venda(C, {
    dias: 2,
    desconto: 100,
    itens: [{ produto: calcaP, qtd: 1, preco: 100 }],
  });
  const r = await analytics();
  const top = new Map(r.topProducts.map((p) => [p.id, Number(p.total)]));
  assert.ok(top.has(blusaP) && top.has(calcaP), "as duas pecas no ranking");
  const grafico = r.revenueHistory.reduce((s, d) => s + Number(d.profit), 0);
  return {
    blusa: top.get(blusaP),
    calca: top.get(calcaP),
    ranking: top.get(blusaP) + top.get(calcaP),
    grafico,
    financeiro: (await lucroBrutoFin()) - finAntes,
    quantidadeBlusa: r.topProducts.find((p) => p.id === blusaP).quantity,
  };
}

const perto = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} != ${b}`);

async function provaDoVale() {
  await emTransacao(async () => {
    await soAFixture();
    const s = await casoDoVale();
    perto(s.financeiro, 50, "o Financeiro da +R$ 50");
    perto(s.ranking, 50, "o ranking casa com o Financeiro (+R$ 50)");
    perto(s.grafico, 50, "o lucro do grafico casa com o Financeiro (+R$ 50)");
    perto(
      s.blusa,
      100,
      "a blusa do vale fica com a venda (o vale nao e dinheiro que saiu)",
    );
    perto(s.calca, -50, "a calca paga com o cupom do vale: so o custo");
    assert.equal(
      s.quantidadeBlusa,
      0,
      "a peca do vale segue na quantidade devolvida",
    );
  });
}

async function provaDoDefeitoDoVale() {
  await emTransacao(async () => {
    await soAFixture();
    await corposAnteriores();
    const s = await casoDoVale();
    perto(s.financeiro, 50, "controle: o Financeiro da +R$ 50");
    perto(
      s.ranking,
      -50,
      "controle: o corpo da 3995 descontava o vale (-R$ 50, o defeito)",
    );
    perto(s.grafico, -50, "controle: o grafico tambem");
  });
  // Venda SEM devolucao: o JSON INTEIRO igual nos dois corpos.
  await emTransacao(async () => {
    await soAFixture();
    const p = (await produto(C, { estoque: 10, preco: 80, custo: 30 })).produto;
    await venda(C, { dias: 4, itens: [{ produto: p, qtd: 2, preco: 80 }] });
    const novo = await analytics();
    await corposAnteriores();
    const anterior = await analytics();
    assert.deepEqual(
      novo,
      anterior,
      "sem devolucao, o JSON inteiro e' o mesmo",
    );
  });
}

// ---------------------------------------------------------------------------
// 7. Duas conexoes reais: excluir o produto enquanto o pedido volta
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
  const p = await simples();
  const order = await pedido(C, [{ p: p.produto, v: null, q: 1 }]);
  await C.query("COMMIT");
  const pidC = (await um("SELECT pg_backend_pid() AS p")).p;
  const pidD = (await um("SELECT pg_backend_pid() AS p", [], D)).p;

  // D: a lojista exclui o produto e ainda nao confirmou. C: o Pix do pedido vence agora.
  await D.query("BEGIN");
  await excluir(p.produto, D);
  await C.query("BEGIN");
  let terminouC = false;
  const emC = devolverEstoque(order).finally(() => {
    terminouC = true;
  });
  assert.ok(
    await esperandoTrava(pidC, pidD, () => terminouC),
    "a volta esperou a trava do produto",
  );
  await D.query("COMMIT");
  assert.equal(await emC, 0, "viu o produto excluido: nao credita");
  await C.query("COMMIT");
  assert.equal(
    await estoquePai(p.produto),
    5,
    "o produto excluido nao recebeu",
  );
  assert.notEqual(await carimbo(order), null);
}

// ---------------------------------------------------------------------------
// 8. Mutantes
// ---------------------------------------------------------------------------
const troca = (s, de, para) => {
  assert.equal(s.split(de).length - 1, 1, `mutante: ${de.slice(0, 60)}`);
  return s.replace(de, () => para);
};
const trocaPrimeira = (s, de, para) => {
  assert.equal(s.split(de).length - 1, 2, `mutante: ${de.slice(0, 60)}`);
  return s.replace(de, () => para);
};
const VALE_ZERO =
  "CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'vale' THEN 0\n                                              WHEN dv.resolucao_final = 'reembolso'";
const VALE_COMO_ANTES =
  "CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'reembolso'";
const MUTANTES = [
  {
    nome: "devolver_estoque sem o bloco do produto excluido (credita o excluido)",
    sql: troca(
      DEVOLVER,
      "        IF EXISTS (SELECT 1 FROM public.produtos p\n                    WHERE p.deleted_at IS NOT NULL",
      "        IF false AND EXISTS (SELECT 1 FROM public.produtos p\n                    WHERE p.deleted_at IS NOT NULL",
    ),
    prova: provaDoPedidoDesfeito,
  },
  {
    nome: "devolver_estoque sem o pai da variacao (o item sem produto credita a variacao do excluido)",
    sql: troca(
      DEVOLVER,
      "OR p.id = (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_item.variant_id))) THEN",
      "OR false)) THEN",
    ),
    prova: provaDoPedidoDesfeito,
  },
  {
    nome: "admin_devolucao_concluir sem o bloco do produto excluido",
    sql: troca(
      CONCLUIR,
      "      IF EXISTS (SELECT 1 FROM public.produtos p\n                  WHERE p.deleted_at IS NOT NULL",
      "      IF false AND EXISTS (SELECT 1 FROM public.produtos p\n                  WHERE p.deleted_at IS NOT NULL",
    ),
    prova: provaDaDevolucao,
  },
  {
    nome: "admin_devolucao_concluir que conta o excluido em 'reestocados' tambem",
    sql: troca(
      CONCLUIR,
      "'reestocados', v_reestocados - v_sem_tamanho - v_fora_do_estoque,",
      "'reestocados', v_reestocados - v_sem_tamanho,",
    ),
    prova: provaDaDevolucao,
  },
  {
    nome: "resolver_peca_sem_tamanho sem a recusa do produto excluido",
    sql: troca(
      RESOLVER,
      "IF EXISTS (SELECT 1 FROM public.produtos p WHERE p.id = v_produto AND p.deleted_at IS NOT NULL) THEN",
      "IF false THEN",
    ),
    prova: provaDoResolver,
  },
  {
    nome: "get_admin_analytics_v2 com o vale como dinheiro nas DUAS copias (o corpo da 3995)",
    sql: ANALYTICS.split(VALE_ZERO).join(VALE_COMO_ANTES),
    prova: provaDoVale,
  },
  {
    nome: "get_admin_analytics_v2 com o vale fora do dinheiro SO no ranking (o grafico como antes)",
    sql: trocaPrimeira(ANALYTICS, VALE_ZERO, VALE_COMO_ANTES),
    prova: provaDoVale,
  },
];

async function restaurar() {
  await C.query(DEVOLVER);
  await C.query(CONCLUIR);
  await C.query(RESOLVER);
  await C.query(ANALYTICS);
  assert.deepEqual(await hashes(), DESTA);
}

async function provarMutante(m) {
  await C.query(m.sql);
  let morreu = null;
  try {
    await m.prova();
  } catch (e) {
    morreu = e;
  }
  await C.query("ROLLBACK").catch(() => {});
  await restaurar();
  assert.ok(morreu, `o mutante sobreviveu: ${m.nome}`);
  return morreu;
}

// ---------------------------------------------------------------------------
// 9. Reaplicar, pre-voo, atomicidade, rollback e fichas
// ---------------------------------------------------------------------------
async function linhasDaFicha(sql) {
  const r = await C.query(sql);
  const linhas = Array.isArray(r) ? r[r.length - 1].rows : r.rows;
  return linhas
    .map((l) => JSON.stringify(l))
    .sort()
    .map((l) => JSON.parse(l));
}
async function fichaSoSim(sql, rotulo) {
  const linhas = await linhasDaFicha(sql);
  assert.equal(linhas.length, 7, `${rotulo}: rol de 7`);
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
async function fichasSucessoras() {
  const out = {};
  for (const f of FICHAS_SUCESSORAS) out[f.nome] = await linhasDaFicha(f.sql);
  return out;
}
/** O dado que ja existia: nada disso muda ao aplicar ou desfazer. */
const retrato = async () =>
  (
    await um(`SELECT md5(concat_ws('|',
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.produtos x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.product_variants x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.marketplace_orders x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.devolucao_itens x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.pecas_sem_tamanho x))) AS h`)
  ).h;

async function provaDaMigration() {
  await emTransacao(async () => {
    // Dado que ja existia: um produto excluido com estoque e uma peca no cantinho.
    const { b } = await pecaNoCantinho();
    await excluir(b.produto);
    const dados = await retrato();
    const foto = await fotografia();

    await fichaSoSim(FICHA_A, "215a depois do apply");
    await fichaSoSim(
      FICHA_B,
      "215b depois do apply (reaplicar e' idempotente)",
    );
    const comEsta = await fichasSucessoras();

    // Reaplicar (LF e CRLF): mesmo estado, nada de dado tocado.
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.equal(
      (await tentarSql(MIGRATION.replace(/\n/g, "\r\n"))).erro,
      undefined,
    );
    assert.deepEqual(await hashes(), DESTA);
    assert.deepEqual(
      await fotografia(),
      foto,
      "OID, dono, ACL e atributos iguais",
    );
    assert.equal(await retrato(), dados, "reaplicar nao toca dado");

    // Os rollbacks das antecessoras recusam por baixo desta (ordem).
    assert.match(
      String((await tentarSql(ROLLBACK_657)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.match(
      String((await tentarSql(ROLLBACK_3995)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.deepEqual(await hashes(), DESTA);

    // Rollback: os quatro corpos anteriores byte a byte, sem tocar dado; repetir e' no-op.
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined);
    assert.deepEqual(await hashes(), ANTERIOR);
    assert.deepEqual(
      await fotografia(),
      foto,
      "o rollback preserva OID, dono, ACL e atributos",
    );
    assert.equal(await retrato(), dados, "o rollback nao toca dado");
    await fichaSoSim(FICHA_B, "215b antes do apply");
    await fichaTemNao(FICHA_A, "215a antes do apply");
    // As fichas antigas dizem EXATAMENTE o mesmo com esta e com o corpo anterior (esta conta como sucessora).
    assert.deepEqual(await fichasSucessoras(), comEsta);
    assert.equal(
      (await tentarSql(ROLLBACK)).erro,
      undefined,
      "repetir e' no-op",
    );
    assert.deepEqual(await hashes(), ANTERIOR);

    // Atomicidade: a migration que falha no fim nao deixa nada gravado.
    const sabotada = `${MIGRATION}\nDO $x$ BEGIN RAISE EXCEPTION 'sabotada no fim'; END $x$;`;
    assert.match(String((await tentarSql(sabotada)).erro), /sabotada no fim/);
    assert.deepEqual(await hashes(), ANTERIOR, "nada gravado");

    // Apply sobre o dado que ja existia: so os corpos mudam.
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.deepEqual(await hashes(), DESTA);
    assert.deepEqual(await fotografia(), foto);
    assert.equal(await retrato(), dados, "o apply nao toca dado");

    // Pre-voo: um corpo estranho em QUALQUER das quatro recusa a migration e o rollback, sem trocar nada.
    await C.query(`${ANALYTICS.replace("\n$$;", "\n-- estranho\n$$;")}`);
    const estranho = await hashes();
    assert.notEqual(estranho.ana, HASH_ANALYTICS_DESTA);
    assert.match(
      String((await tentarSql(MIGRATION)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.match(
      String((await tentarSql(ROLLBACK)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.deepEqual(await hashes(), estranho, "nada trocado");
    await fichaTemNao(FICHA_A, "215a com corpo estranho");
    await fichaTemNao(FICHA_B, "215b com corpo estranho");
    await C.query(ANALYTICS);
    // EXECUTE aberto ao anon: o pre-voo recusa.
    await C.query(`GRANT EXECUTE ON FUNCTION ${ASSIN.res} TO anon`);
    assert.match(
      String((await tentarSql(MIGRATION)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    await fichaTemNao(FICHA_A, "215a com EXECUTE do anon");
  });
}

prova(
  "1. controle do defeito (corpos anteriores) x o corpo novo",
  provaDoDefeito,
);
prova(
  "2. cancelar / Pix vencido: produto, variacao, item sem produto e variacao desligada de produto excluido nao somam; pedido misto",
  provaDoPedidoDesfeito,
);
prova(
  "3. devolucao: fora_do_estoque, reestocados, carimbo, achado C, ausente e nao reestocar",
  provaDaDevolucao,
);
prova(
  "4. a decisao da peca: tamanho de produto excluido recusado, 'nao tenho' aceito, repetir devolve a decisao",
  provaDoResolver,
);
prova(
  "5. CONTROLE: produto nao excluido, identico aos corpos anteriores",
  provaDoControle,
);
prova(
  "6a. ranking e grafico com o vale: +R$ 50, igual ao Financeiro",
  provaDoVale,
);
prova(
  "6b. controle do vale (corpo da 3995: -R$ 50) e venda sem devolucao com o JSON inteiro igual",
  provaDoDefeitoDoVale,
);
prova(
  "7. duas conexoes reais: excluir o produto durante a volta, a volta espera e ve o excluido",
  provaDeDuasConexoes,
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
  "9. reaplicar (LF e CRLF), pre-voo, atomicidade, rollback (ordem, corpos, dado mantido), fichas 215a/215b e as sucessoras",
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
    // Os md5 pinados no modulo posterior sao os dos corpos que os arquivos carregam.
    assert.equal(md5(corpoDe(DEVOLVER, "$devolver$")), HASH_DEVOLVER_DESTA);
    assert.equal(md5(corpoDe(CONCLUIR, "$$")), HASH_CONCLUIR_DESTA);
    assert.equal(md5(corpoDe(RESOLVER, "$resolver$")), HASH_RESOLVER_DESTA);
    assert.equal(md5(corpoDe(ANALYTICS, "$$")), HASH_ANALYTICS_DESTA);
    assert.deepEqual(
      await hashes(),
      DESTA,
      "a migration 20261659000000 nao esta no banco efemero",
    );
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
      "PRODUTO-EXCLUIDO",
      `${falhas.length} prova(s) falharam:\n${falhas.join("\n")}`,
    );
  }
  console.log(
    `\na-peca-de-produto-excluido-viva: ${PROVAS.length} provas, ${MUTANTES.length} mutantes mortos`,
  );
}

main().catch((erro) => falhar("PRODUTO-EXCLUIDO", erro.stack ?? String(erro)));
