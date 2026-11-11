"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs.
// Tirar active=true em cada RPC deve aceitar indevidamente o cupom inativo;
// tirar o teto da v24 deve deixar o excedente do desconto consumir o frete.
// MUTANTE_R100 instala UMA sabotagem no corpo vivo; ROLLBACK a desfaz.
const { randomUUID } = require("node:crypto");
const P = require("./prova-de-objeto-novo.cjs");
const { DESCONTO_DO_CUPOM } = require("./o-desconto-do-cupom-posterior.cjs");
const { assert, prova } = P;
const CLIENTE = "c101c000-0000-4000-8000-000000000001";
const PRODUTO = "c101c000-0000-4000-8000-000000000002";
const CODIGO = "R101COMUM";
const ASSINATURA =
  "(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";

async function semear({ ativo = false, valor = 10 } = {}) {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,'cliente@r101.fixture.invalid','{}')",
    [CLIENTE],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia R101','customer')",
    [CLIENTE],
  );
  await c.query(`INSERT INTO public.store_config
    (id, origin_cep, local_cep_range, free_shipping_min, local_delivery_fee,
     local_delivery_enabled, shipping_coverage, enable_coupons, pagamento_online,
     formas_pagamento_entrega, enabled_shipping_methods, store_address)
    VALUES (1,'38500-000','38500000-38505000',0,20,true,'national',true,true,
      ARRAY['pix','card','cash'],ARRAY['local-delivery','store-pickup'],'Rua Ficticia, 1')
    ON CONFLICT (id) DO UPDATE SET
      origin_cep=EXCLUDED.origin_cep, local_cep_range=EXCLUDED.local_cep_range,
      free_shipping_min=EXCLUDED.free_shipping_min, local_delivery_fee=EXCLUDED.local_delivery_fee,
      local_delivery_enabled=EXCLUDED.local_delivery_enabled,
      shipping_coverage=EXCLUDED.shipping_coverage, enable_coupons=EXCLUDED.enable_coupons,
      pagamento_online=EXCLUDED.pagamento_online, formas_pagamento_entrega=EXCLUDED.formas_pagamento_entrega,
      enabled_shipping_methods=EXCLUDED.enabled_shipping_methods, store_address=EXCLUDED.store_address`);
  await c.query(
    `INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo,custo,frete_gratis)
     VALUES ($1,'Produto ficticio R101',100,50,true,40,false)`,
    [PRODUTO],
  );
  await c.query(
    `INSERT INTO public.coupons
      (code,type,value,min_purchase,usage_limit,usage_count,valid_until,active,alcance)
     VALUES ($1,'fixed',$2,100,10,0,now()+interval '1 day',$3,'vitrine')`,
    [CODIGO, valor, ativo],
  );
}

async function mutar(nome, porta, trecho, substituto) {
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const assinatura = `public.create_marketplace_order_${porta}${ASSINATURA}`;
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        assinatura,
      ])
    ).rows[0].d.replace(/\r/g, "");
  const original = await ler();
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(trecho, substituto);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(
    await ler(),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

function comprar(porta, total, chave) {
  const online = porta === "v24";
  return P.tentar(
    online ? "authenticated" : "anon",
    `SELECT public.create_marketplace_order_${porta}(
      $1::jsonb,$2::numeric,20::numeric,$3::text,NULL::uuid,$4::text,
      'Pessoa ficticia R101','5534000000000',NULL::text,$5::jsonb,
      '38500-100','local-delivery',$6::uuid) AS id`,
    [
      JSON.stringify([{ product_id: PRODUTO, variant_id: null, quantity: 1 }]),
      total,
      online ? "online" : "cash",
      CODIGO,
      online
        ? null
        : JSON.stringify({
            cep: "38500-100",
            street: "Rua Ficticia",
            number: "1",
            neighborhood: "Centro",
            city: "Cidade Prova",
            state: "MG",
          }),
      chave,
    ],
    { uid: online ? CLIENTE : "" },
  );
}

async function foto() {
  return (
    await P.conexao().query(`SELECT
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.marketplace_orders o) AS pedidos,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.marketplace_order_items i) AS itens,
      (SELECT to_jsonb(p) FROM public.produtos p WHERE id='${PRODUTO}') AS produto,
      (SELECT to_jsonb(c) FROM public.coupons c WHERE code='${CODIGO}') AS cupom`)
  ).rows[0];
}

async function conferirSucesso(r, porta, desconto, total) {
  assert.equal(r.codigo, undefined, `controle ${porta} recusado: ${r.erro}`);
  const id = r.linhas[0].id;
  assert.ok(id, "controle nao devolveu pedido");
  const linha = (
    await P.conexao().query(
      `SELECT user_id,coupon_code,subtotal::text,discount::text,shipping::text,total::text,
        subtotal-discount+shipping=total AS fecha
       FROM public.marketplace_orders WHERE id=$1`,
      [id],
    )
  ).rows[0];
  assert.deepEqual(linha, {
    user_id: porta === "v24" ? CLIENTE : null,
    coupon_code: CODIGO,
    subtotal: "100.00",
    discount: desconto,
    shipping: "20.00",
    total,
    fecha: true,
  });
  const depois = await foto();
  assert.equal(depois.produto.estoque, 49, "controle nao baixou uma unidade");
  assert.equal(depois.cupom.usage_count, 1, "controle nao consumiu uma vaga");
  const itens = (
    await P.conexao().query(
      "SELECT product_id,quantity,price::text FROM public.marketplace_order_items WHERE order_id=$1",
      [id],
    )
  ).rows;
  assert.deepEqual(itens, [
    { product_id: PRODUTO, quantity: 1, price: "100.00" },
  ]);
}

for (const porta of ["v23", "v24"]) {
  prova(
    `${porta}: cupom comum inativo recusa sem efeito; reativar o mesmo aceita`,
    () =>
      P.emTransacao(async () => {
        await semear();
        await mutar(`cupom-sem-ativo-${porta}`, porta, "AND active = true", "");
        const antes = await foto();
        const chave = randomUUID();
        const r = await comprar(porta, 110, chave);
        assert.equal(
          r.codigo,
          "P0001",
          `CUPOM_INATIVO_${porta}: cupom desativado foi aceito`,
        );
        assert.match(r.erro, /está desativado pela loja/);
        assert.deepEqual(
          await foto(),
          antes,
          "recusa alterou pedido, itens, estoque ou contador",
        );
        await P.conexao().query(
          "UPDATE public.coupons SET active=true WHERE code=$1",
          [CODIGO],
        );
        // Mesma chave e payload: a recusa nao pode prender uma tentativa.
        await conferirSucesso(
          await comprar(porta, 110, chave),
          porta,
          "10.00",
          "110.00",
        );
      }),
  );
}

prova(
  "v24: desconto limitado aos produtos preserva frete; total menor recusa sem efeito",
  () =>
    P.emTransacao(async () => {
      await semear({ ativo: true, valor: 110 });
      await mutar(
        "cupom-sem-teto-v24",
        "v24",
        "IF v_discount_amount > v_calculated_subtotal THEN\n            v_discount_amount := v_calculated_subtotal;\n        END IF;",
        "",
      );
      const antes = await foto();
      const chave = randomUUID();
      // R$100 de produtos + R$20 de frete: cupom de R$110 so pode descontar R$100.
      const r = await comprar("v24", 10, chave);
      assert.equal(
        r.codigo,
        "P0001",
        "TETO_V24: desconto excedente abateu o frete e aceitou total R$10",
      );
      assert.match(r.erro, /Os valores do pedido mudaram/);
      assert.match(r.detalhe, /Calculado: 20/);
      assert.deepEqual(
        await foto(),
        antes,
        "total adulterado alterou pedido, itens, estoque ou contador",
      );
      await conferirSucesso(
        await comprar("v24", 20, chave),
        "v24",
        "100.00",
        "20.00",
      );
    }),
);

async function main() {
  await P.conectar();
  try {
    // Nao reinstala corpos antigos: a prova exige a definicao VIVA da 20261397000000.
    for (const f of DESCONTO_DO_CUPOM.funcoes.slice(0, 2)) {
      const r = await P.conexao().query(
        "SELECT md5(replace(prosrc,chr(13),'')) AS h FROM pg_proc WHERE oid=to_regprocedure($1)",
        [f.assinatura],
      );
      assert.equal(
        r.rows[0]?.h,
        f.hashDesta,
        `corpo vivo inesperado: ${f.nome}`,
      );
    }
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("cupom inativo e teto do desconto na v24");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
