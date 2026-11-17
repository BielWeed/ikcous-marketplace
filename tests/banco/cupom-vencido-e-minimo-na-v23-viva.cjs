"use strict";

/**
 * Duas guardas do corpo VIVO de create_marketplace_order_v23 (a porta do "pagar na entrega ou na
 * retirada"): o cupom vencido e o cupom com compra mínima não atingida são recusados SEM efeito. Antes
 * desta prova só a v24 tinha as duas recusas provadas (solicitar-devolucao-e-cupom-recusas-viva.cjs);
 * a v23 repete o mesmo WHERE em outro corpo, e ninguém reprovaria se uma das linhas dele sumisse.
 *
 * Dano de cada linha que some: cupom de R$ 50 com mínimo de R$ 100 aceito numa compra de R$ 99
 * (pedido mais barato do que a loja permite); cupom vencido de R$ 10 aceito numa compra de R$ 100,
 * com baixa de estoque e uso consumido.
 *
 * Não reaplica nem muda migrations. Chamada direta como authenticated (pagamento na entrega),
 * fixtures inventadas, em transações que voltam. Cada guarda roda VERDE -> VERMELHO sem o predicado
 * (o corpo vivo é trocado, UMA linha por mutante) -> VERDE restaurado. O mutante só entra no clone
 * de rodar-isolado.cjs e sai em finally.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cupom-vencido-e-minimo-na-v23-viva.cjs
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const CLIENTE = "7e7e99a3-0000-4000-8000-0000000000a1";
const SIG_V23 =
  "public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const CLAIMS = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "customer" },
});
const FRETE = 20;
let C;

async function definicao(sig) {
  return (
    await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [sig])
  ).rows[0].d;
}

async function semearPessoa() {
  await C.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, $1::text || '@r99.invalid', '{}'::jsonb)`,
    [CLIENTE],
  );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role)
     VALUES ($1, 'Pessoa fictícia R99', 'customer') ON CONFLICT (id) DO NOTHING`,
    [CLIENTE],
  );
}

async function emTransacao(corpo) {
  await C.query("BEGIN");
  try {
    await corpo();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Só a exceção desfaz a chamada; sucesso fica visível para medir os efeitos. */
async function tentar(sql, params) {
  await C.query("SAVEPOINT tentativa");
  try {
    await C.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [CLIENTE, CLAIMS],
    );
    await C.query("SET LOCAL ROLE authenticated");
    const r = await C.query(sql, params);
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    return { resposta: r.rows[0].r };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    return { erro: e.message, codigo: e.code };
  }
}

/**
 * `validade`: 'vencido' (ontem), 'futuro' (amanhã) ou 'nulo' (sem validade).
 * `minimo` NULL = sem compra mínima. Entrega local e pagamento na entrega, como a v23 exige.
 */
async function cenario({ validade, valor, minimo, preco }) {
  await C.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, local_delivery_fee,
        local_delivery_enabled, shipping_coverage, enable_coupons, pagamento_online,
        formas_pagamento_entrega, enabled_shipping_methods, store_address)
     VALUES (1, '38500-000', '38500000-38505000', 0, $1, true, 'national', true, true,
       ARRAY['pix','card','cash'], ARRAY['local-delivery','store-pickup'], 'Rua Fictícia, 1')
     ON CONFLICT (id) DO UPDATE SET
       origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
       free_shipping_min = EXCLUDED.free_shipping_min,
       local_delivery_fee = EXCLUDED.local_delivery_fee,
       local_delivery_enabled = EXCLUDED.local_delivery_enabled,
       shipping_coverage = EXCLUDED.shipping_coverage, enable_coupons = EXCLUDED.enable_coupons,
       pagamento_online = EXCLUDED.pagamento_online,
       formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
       enabled_shipping_methods = EXCLUDED.enabled_shipping_methods,
       store_address = EXCLUDED.store_address`,
    [FRETE],
  );
  const prod = randomUUID();
  await C.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
     VALUES ($1, 'Produto fictício R99', $2, 20, true, 40, false)`,
    [prod, preco],
  );
  const codigo = `R99${randomUUID().replace(/-/g, "").toUpperCase()}`;
  const cupom = (
    await C.query(
      `INSERT INTO public.coupons
         (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active, alcance)
       VALUES ($1, 'fixed', $2, $3, 10, 0,
               CASE $4::text WHEN 'vencido' THEN now() - interval '1 day'
                             WHEN 'futuro' THEN now() + interval '1 day' END,
               true, 'vitrine') RETURNING id`,
      [codigo, valor, minimo, validade],
    )
  ).rows[0].id;
  return { prod, codigo, cupom, valor };
}

/** Pagamento na entrega, entrega local; `total` é o que o app mostra (subtotal + frete - desconto). */
function comprar(cen, total) {
  return tentar(
    `SELECT public.create_marketplace_order_v23(
       $1::jsonb, $2::numeric, $3::numeric, 'cash', NULL::uuid, $4::text,
       'Pessoa fictícia R99', '5534000000000', NULL::text, $5::jsonb,
       '38500-100', 'local-delivery', $6::uuid) AS r`,
    [
      JSON.stringify([{ product_id: cen.prod, variant_id: null, quantity: 1 }]),
      total,
      FRETE,
      cen.codigo,
      JSON.stringify({
        cep: "38500-100",
        street: "Rua Fictícia",
        number: "1",
        neighborhood: "Centro",
        city: "Cidade Prova",
        state: "MG",
      }),
      randomUUID(),
    ],
  );
}

/** Fotografia das escritas possíveis: pedidos, itens, histórico, estoque e o contador do cupom. */
async function medir(cen) {
  return (
    await C.query(
      `SELECT jsonb_build_object(
         'pedidos', (SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]'::jsonb)
                       FROM public.marketplace_orders o WHERE o.user_id = $1),
         'itens', (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb)
                     FROM public.marketplace_order_items i WHERE i.product_id = $2),
         'historicos', (SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.id), '[]'::jsonb)
                          FROM public.marketplace_order_history h
                          JOIN public.marketplace_orders o ON o.id = h.order_id
                         WHERE o.user_id = $1),
         'estoque', (SELECT estoque FROM public.produtos WHERE id = $2),
         'cupom', (SELECT to_jsonb(c) FROM public.coupons c WHERE id = $3)
       ) AS estado`,
      [CLIENTE, cen.prod, cen.cupom],
    )
  ).rows[0].estado;
}

async function recusa(cen, total, frase, marcador) {
  const antes = await medir(cen);
  const r = await comprar(cen, total);
  assert.deepEqual(
    await medir(cen),
    antes,
    `${marcador}: a recusa deixou efeitos no banco (pedido, item, estoque ou uso do cupom)`,
  );
  assert.equal(r.codigo, "P0001", `${marcador}: faltou a exceção esperada`);
  assert.match(r.erro, frase, `${marcador}: a recusa veio de outra guarda`);
}

/** Controle positivo: o MESMO cupom, agora válido, vira pedido com o total que fecha. */
async function aceita(cen, total, subtotal, desconto) {
  const antes = await medir(cen);
  const r = await comprar(cen, total);
  assert.equal(
    r.erro,
    undefined,
    `controle de cupom válido recusado: ${r.erro}`,
  );
  const linha = (
    await C.query(
      `SELECT user_id, coupon_id, coupon_code, subtotal::text AS subtotal,
              discount::text AS discount, shipping::text AS shipping, total::text AS total,
              subtotal - discount + shipping = total AS fecha
         FROM public.marketplace_orders WHERE id = $1`,
      [r.resposta],
    )
  ).rows[0];
  assert.deepEqual(linha, {
    user_id: CLIENTE,
    coupon_id: cen.cupom,
    coupon_code: cen.codigo,
    subtotal,
    discount: desconto,
    shipping: `${FRETE}.00`,
    total: total.toFixed(2),
    fecha: true,
  });
  const depois = await medir(cen);
  assert.equal(
    depois.estoque,
    antes.estoque - 1,
    "o controle não baixou uma unidade",
  );
  assert.equal(
    depois.cupom.usage_count,
    antes.cupom.usage_count + 1,
    "o controle não consumiu uma vaga do cupom",
  );
  assert.equal(depois.pedidos.length, antes.pedidos.length + 1);
  assert.equal(depois.itens.length, antes.itens.length + 1);
}

async function cupomVencido() {
  await emTransacao(async () => {
    // R$ 100 de produto + R$ 20 de frete - R$ 10 do cupom = R$ 110 (o total que o app mostraria).
    const cen = await cenario({
      validade: "vencido",
      valor: 10,
      minimo: null,
      preco: 100,
    });
    const frase = /^O cupom .+ expirou em .+\.$/;
    await recusa(cen, 110, frase, "CUPOM_VENCIDO");
    // A borda: vencer exatamente agora já é vencido (dentro da transação now() não anda).
    await C.query(
      "UPDATE public.coupons SET valid_until = now() WHERE id = $1",
      [cen.cupom],
    );
    await recusa(cen, 110, frase, "CUPOM_VENCIDO");
    await C.query(
      "UPDATE public.coupons SET valid_until = now() + interval '1 day' WHERE id = $1",
      [cen.cupom],
    );
    await aceita(cen, 110, "100.00", "10.00");
  });
}

async function compraMinima() {
  await emTransacao(async () => {
    // Cupom de R$ 50 com mínimo de R$ 100, sem validade (a recusa é só pelo mínimo).
    const cen = await cenario({
      validade: "nulo",
      valor: 50,
      minimo: 100,
      preco: 99,
    });
    const frase = /^O cupom .+ exige uma compra mínima de R\$ 100,00\.$/;
    // Subtotal R$ 99 + frete R$ 20 - cupom R$ 50 = R$ 69: o pedido que o dano aceitaria.
    await recusa(cen, 69, frase, "COMPRA_MINIMA");
    // Um centavo abaixo do mínimo também recusa (R$ 99,99 + 20 - 50 = R$ 69,99).
    await C.query(
      "UPDATE public.produtos SET preco_venda = 99.99 WHERE id = $1",
      [cen.prod],
    );
    await recusa(cen, 69.99, frase, "COMPRA_MINIMA");
    // O MESMO cupom, no mínimo EXATO (R$ 100 + 20 - 50 = R$ 70): não é outro cupom mais permissivo.
    await C.query(
      "UPDATE public.produtos SET preco_venda = 100 WHERE id = $1",
      [cen.prod],
    );
    await aceita(cen, 70, "100.00", "50.00");
  });
}

const GUARDAS = [
  {
    nome: "v23: cupom vencido não cria pedido nem gasta estoque ou uso; o mesmo cupom com validade futura passa",
    sig: SIG_V23,
    testar: cupomVencido,
    marcador: /^CUPOM_VENCIDO:/,
    de: "AND (valid_until IS NULL OR valid_until > now())",
    para: "AND TRUE",
  },
  {
    nome: "v23: subtotal abaixo do mínimo do cupom recusa sem efeito; o mínimo exato passa",
    sig: SIG_V23,
    testar: compraMinima,
    marcador: /^COMPRA_MINIMA:/,
    de: "AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)",
    para: "AND TRUE",
  },
];

async function provarGuarda(g, original) {
  await g.testar();
  console.log(`  VERDE    ${g.nome}`);
  const normalizada = original.replace(/\r\n/g, "\n");
  assert.equal(
    normalizada.split(g.de).length - 1,
    1,
    `mutante: a âncora precisa casar exatamente 1x: ${g.nome}`,
  );
  const mutante = normalizada.replace(g.de, () => g.para);
  assert.notEqual(mutante, normalizada);
  let pego;
  try {
    await C.query(mutante);
    assert.equal(
      await definicao(g.sig),
      mutante,
      "o mutante não entrou no banco",
    );
    try {
      await g.testar();
    } catch (e) {
      pego = e;
    }
  } finally {
    await C.query(original);
    assert.equal(
      await definicao(g.sig),
      original,
      "o corpo vivo não foi restaurado",
    );
  }
  assert.ok(
    pego instanceof assert.AssertionError,
    `MUTANTE SOBREVIVEU ou erro SQL: ${pego?.stack}`,
  );
  assert.match(pego.message, g.marcador, "o mutante caiu pelo motivo errado");
  console.log(`  VERMELHO mutante: ${pego.message.split("\n")[0]}`);
  await g.testar();
  console.log(`  VERDE    restaurado: ${g.nome}`);
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url, statement_timeout: 10000 });
  try {
    await C.connect();
    const db = (await C.query("SELECT current_database() AS d")).rows[0].d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: nunca mutar o banco base",
    );
    const original = await definicao(SIG_V23);
    const hash = await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG_V23],
    );
    console.log(`Corpo VIVO ${SIG_V23}: ${hash.rows[0].h}`);
    await semearPessoa();
    for (const g of GUARDAS) await provarGuarda(g, original);
    console.log(
      "\ncupom-vencido-e-minimo-na-v23-viva: 2/2 controles mortos; verde/vermelho/verde",
    );
  } finally {
    await C.end().catch(() => {});
  }
}

main().catch((erro) =>
  falhar("CUPOM-VENCIDO-E-MINIMO-V23", erro.stack ?? String(erro)),
);
