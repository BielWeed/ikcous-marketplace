"use strict";

/**
 * Cinco guardas dos corpos VIVOS: solicitar_devolucao (20261175) e
 * create_marketplace_order_v24 (20261397). Não reaplica nem muda migrations.
 *
 * Chamadas diretas como authenticated, fixtures inventadas, em transações que
 * voltam. Cada guarda roda VERDE -> VERMELHO sem o predicado -> VERDE restaurado.
 * O mutante só entra no clone de rodar-isolado.cjs e sai em finally.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/solicitar-devolucao-e-cupom-recusas-viva.cjs
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const CLIENTE = "7e7e980a-0000-4000-8000-0000000000a1";
const OUTRA_CONTA = "7e7e980a-0000-4000-8000-0000000000b1";
const SIG_DEV =
  "public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])";
const SIG_V24 =
  "public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const CLAIMS = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "customer" },
});
let C;

async function definicao(sig) {
  return (
    await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [sig])
  ).rows[0].d;
}

async function semearPessoas() {
  for (const id of [CLIENTE, OUTRA_CONTA]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, $1::text || '@r98.invalid', '{}'::jsonb)`,
      [id],
    );
    await C.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa fictícia R98', 'customer') ON CONFLICT (id) DO NOTHING`,
      [id],
    );
  }
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
async function tentar(ator, sql, params) {
  await C.query("SAVEPOINT tentativa");
  try {
    await C.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [ator, CLAIMS],
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

async function produto(preco = 100) {
  const id = randomUUID();
  await C.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto fictício R98', $2, 20, true, false)`,
    [id, preco],
  );
  return id;
}

async function pedido(produtoId, status = "delivered") {
  const id = randomUUID();
  const item = randomUUID();
  await C.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping,
        status, canal, payment_method, payment_status, paid_at, gateway_payment_id)
     VALUES ($1, $2, 'Pessoa fictícia R98',
             '{"shipping_option_id":"local-delivery"}'::jsonb, 100, 100, 0,
             $3, 'online', 'online', 'pago', now(), $4)`,
    [id, CLIENTE, status, `ORD-R98-${id}`],
  );
  await C.query(
    `INSERT INTO public.marketplace_order_items
       (id, order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, $3, 'Produto fictício R98', 1, 100)`,
    [item, id, produtoId],
  );
  // Também nos pedidos ainda não entregues: sem isso outra guarda esconderia
  // a ausência da guarda de status, recusando por falta de data de entrega.
  await C.query(
    `INSERT INTO public.marketplace_order_history
       (order_id, old_status, new_status, created_at)
     VALUES ($1, 'shipping', 'delivered', now() - interval '1 day')`,
    [id],
  );
  return { id, item };
}

function solicitar(p, itens = [p.item], ator = CLIENTE) {
  return tentar(
    ator,
    `SELECT public.solicitar_devolucao(
       $1::uuid, $2::jsonb, 'desisti', NULL, 'reembolso', 'entrega_na_loja', '{}'::text[]) AS r`,
    [
      p.id,
      JSON.stringify(itens.map((id) => ({ order_item_id: id, quantidade: 1 }))),
    ],
  );
}

/** Fotografia completa das escritas possíveis, inclusive itens/avisos órfãos. */
async function medir(produtoId, cupomId = null) {
  return (
    await C.query(
      `SELECT jsonb_build_object(
         'devolucoes', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id), '[]'::jsonb)
                         FROM public.devolucoes d),
         'itens_devolvidos', (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb)
                               FROM public.devolucao_itens i),
         'eventos', (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id), '[]'::jsonb)
                      FROM public.devolucao_eventos e),
         'avisos', (SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.id), '[]'::jsonb)
                     FROM public.notificacoes n),
         'estornos', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
                       FROM public.order_refunds r),
         'pedidos', (SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]'::jsonb)
                      FROM public.marketplace_orders o WHERE o.user_id IN ($1, $2)),
         'itens', (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb)
                    FROM public.marketplace_order_items i WHERE i.product_id = $3),
         'historicos', (SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.id), '[]'::jsonb)
                         FROM public.marketplace_order_history h
                         JOIN public.marketplace_orders o ON o.id = h.order_id
                        WHERE o.user_id IN ($1, $2)),
         'estoque', (SELECT estoque FROM public.produtos WHERE id = $3),
         'cupom', (SELECT to_jsonb(c) FROM public.coupons c WHERE id = $4)
       ) AS estado`,
      [CLIENTE, OUTRA_CONTA, produtoId, cupomId],
    )
  ).rows[0].estado;
}

async function recusa(chamar, produtoId, cupomId, codigo, frase, marcador) {
  const antes = await medir(produtoId, cupomId);
  const r = await chamar();
  assert.deepEqual(
    await medir(produtoId, cupomId),
    antes,
    `${marcador}: a recusa deixou efeitos no banco`,
  );
  assert.equal(r.codigo, codigo, `${marcador}: faltou a exceção esperada`);
  assert.match(r.erro, frase, `${marcador}: a recusa veio de outra guarda`);
}

async function aceitaDevolucao(p) {
  const r = await solicitar(p);
  assert.equal(r.erro, undefined, `controle válido recusado: ${r.erro}`);
  assert.equal(r.resposta.status, "solicitada");
  const gravado = (
    await C.query(
      `SELECT d.user_id, d.order_id, d.status,
              (SELECT count(*)::int FROM public.devolucao_itens WHERE devolucao_id = d.id) AS itens,
              (SELECT count(*)::int FROM public.devolucao_eventos WHERE devolucao_id = d.id) AS eventos
         FROM public.devolucoes d WHERE d.id = $1`,
      [r.resposta.id],
    )
  ).rows[0];
  assert.deepEqual(gravado, {
    user_id: CLIENTE,
    order_id: p.id,
    status: "solicitada",
    itens: 1,
    eventos: 1,
  });
}

async function outraConta() {
  await emTransacao(async () => {
    const prod = await produto();
    const p = await pedido(prod);
    await recusa(
      () => solicitar(p, [p.item], OUTRA_CONTA),
      prod,
      null,
      "P0002",
      /^Pedido não encontrado\.$/,
      "OUTRA_CONTA",
    );
    await aceitaDevolucao(p);
  });
}

async function itemDeOutroPedido() {
  await emTransacao(async () => {
    const prod = await produto();
    const a = await pedido(prod);
    const b = await pedido(prod);
    // Primeiro um item válido: a falha seguinte precisa desfazer a devolução
    // E o primeiro item já inseridos, não só recusar antes de escrever.
    await recusa(
      () => solicitar(a, [a.item, b.item]),
      prod,
      null,
      "22023",
      /^Item não pertence a este pedido\.$/,
      "ITEM_DE_OUTRO_PEDIDO",
    );
    await aceitaDevolucao(a);
    await aceitaDevolucao(b);
  });
}

async function pedidoNaoEntregue() {
  await emTransacao(async () => {
    const prod = await produto();
    for (const status of ["processing", "shipping"]) {
      const p = await pedido(prod, status);
      await recusa(
        () => solicitar(p),
        prod,
        null,
        "22023",
        /^A devolução fica disponível depois que o pedido for entregue\.$/,
        `PEDIDO_NAO_ENTREGUE (${status})`,
      );
    }
    await aceitaDevolucao(await pedido(prod));
  });
}

async function cenarioCupom({ vencido = false, minimo = 0, preco = 100 } = {}) {
  await C.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true)
     ON CONFLICT (id) DO UPDATE SET
       origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
       free_shipping_min = EXCLUDED.free_shipping_min,
       shipping_coverage = EXCLUDED.shipping_coverage, enable_coupons = true`,
  );
  const prod = await produto(preco);
  const codigo = `R98${randomUUID().replace(/-/g, "").toUpperCase()}`;
  const cupom = (
    await C.query(
      `INSERT INTO public.coupons
         (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active, alcance)
       VALUES ($1, 'fixed', 10, $2, 10, 0,
               now() + CASE WHEN $3 THEN interval '-1 day' ELSE interval '1 day' END,
               true, 'vitrine') RETURNING id`,
      [codigo, minimo, vencido],
    )
  ).rows[0].id;
  return { prod, codigo, cupom, preco };
}

function comprar(cen) {
  return tentar(
    CLIENTE,
    `SELECT public.create_marketplace_order_v24(
       $1::jsonb, $2::numeric, 0::numeric, 'pix', NULL::uuid, $3::text,
       'Pessoa fictícia R98', '5539000000000', NULL::text, $4::jsonb,
       '38500-000', 'local-delivery', $5::uuid) AS r`,
    [
      JSON.stringify([{ product_id: cen.prod, variant_id: null, quantity: 1 }]),
      cen.preco - 10,
      cen.codigo,
      JSON.stringify({ cep: "38500-000", rua: "Rua Fictícia", numero: "1" }),
      randomUUID(),
    ],
  );
}

async function aceitaCompra(cen) {
  const antes = await medir(cen.prod, cen.cupom);
  const r = await comprar(cen);
  assert.equal(
    r.erro,
    undefined,
    `controle de cupom válido recusado: ${r.erro}`,
  );
  const linha = (
    await C.query(
      `SELECT user_id, coupon_id, coupon_code, subtotal, discount, total
         FROM public.marketplace_orders WHERE id = $1`,
      [r.resposta],
    )
  ).rows[0];
  assert.deepEqual(linha, {
    user_id: CLIENTE,
    coupon_id: cen.cupom,
    coupon_code: cen.codigo,
    subtotal: cen.preco.toFixed(2),
    discount: "10.00",
    total: (cen.preco - 10).toFixed(2),
  });
  const depois = await medir(cen.prod, cen.cupom);
  assert.equal(depois.estoque, antes.estoque - 1);
  assert.equal(depois.cupom.usage_count, antes.cupom.usage_count + 1);
  assert.equal(depois.pedidos.length, antes.pedidos.length + 1);
  assert.equal(depois.itens.length, antes.itens.length + 1);
}

async function cupomVencido() {
  await emTransacao(async () => {
    const cen = await cenarioCupom({ vencido: true });
    await recusa(
      () => comprar(cen),
      cen.prod,
      cen.cupom,
      "P0001",
      /^O cupom .+ expirou em .+\.$/,
      "CUPOM_VENCIDO",
    );
    await aceitaCompra(await cenarioCupom());
  });
}

async function compraMinima() {
  await emTransacao(async () => {
    // Um centavo abaixo e o mínimo EXATO: mata tanto ausência quanto > por >=.
    const cen = await cenarioCupom({ minimo: 100, preco: 99.99 });
    await recusa(
      () => comprar(cen),
      cen.prod,
      cen.cupom,
      "P0001",
      /^O cupom .+ exige uma compra mínima de R\$ 100,00\.$/,
      "COMPRA_MINIMA",
    );
    // O MESMO cupom, agora com o subtotal no limite: não é outro cupom mais permissivo.
    await C.query(
      "UPDATE public.produtos SET preco_venda = 100 WHERE id = $1",
      [cen.prod],
    );
    await aceitaCompra({ ...cen, preco: 100 });
  });
}

const GUARDAS = [
  {
    nome: "outra conta não solicita devolução; dono passa",
    sig: SIG_DEV,
    testar: outraConta,
    marcador: /^OUTRA_CONTA:/,
    de: "IF NOT FOUND OR v_o.user_id IS DISTINCT FROM v_uid THEN",
    para: "IF NOT FOUND THEN",
  },
  {
    nome: "item de outro pedido da mesma conta desfaz toda a solicitação",
    sig: SIG_DEV,
    testar: itemDeOutroPedido,
    marcador: /^ITEM_DE_OUTRO_PEDIDO:/,
    // Tirar só o RAISE deixaria v_oi vazio e cairia na guarda de quantidade.
    // O filtro de pertencimento é a guarda: o id continua sendo conferido.
    de: "WHERE id = NULLIF(v_item ->> 'order_item_id', '')::uuid AND order_id = v_o.id;",
    para: "WHERE id = NULLIF(v_item ->> 'order_item_id', '')::uuid;",
  },
  {
    nome: "processing e shipping pagos, com data recente, não abrem devolução",
    sig: SIG_DEV,
    testar: pedidoNaoEntregue,
    marcador: /^PEDIDO_NAO_ENTREGUE/,
    de: `  IF v_o.status IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION 'A devolução fica disponível depois que o pedido for entregue.' USING ERRCODE = '22023';
  END IF;`,
    para: "",
  },
  {
    nome: "cupom vencido na v24 direta não cria pedido nem gasta estoque ou uso",
    sig: SIG_V24,
    testar: cupomVencido,
    marcador: /^CUPOM_VENCIDO:/,
    de: "          AND (valid_until IS NULL OR valid_until > now())",
    para: "",
  },
  {
    nome: "v24 direta recusa um centavo abaixo da compra mínima; limite exato passa",
    sig: SIG_V24,
    testar: compraMinima,
    marcador: /^COMPRA_MINIMA:/,
    de: "          AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)",
    para: "",
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
    const originais = new Map();
    for (const sig of [SIG_DEV, SIG_V24]) {
      originais.set(sig, await definicao(sig));
      const hash = await C.query(
        "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
        [sig],
      );
      console.log(`Corpo VIVO ${sig}: ${hash.rows[0].h}`);
    }
    await semearPessoas();
    for (const g of GUARDAS) await provarGuarda(g, originais.get(g.sig));
    console.log(
      "\nsolicitar-devolucao-e-cupom-recusas-viva: 5/5 controles mortos; verde/vermelho/verde",
    );
  } finally {
    await C.end().catch(() => {});
  }
}

main().catch((erro) =>
  falhar("DEVOLUCAO-E-CUPOM-RECUSAS", erro.stack ?? String(erro)),
);
