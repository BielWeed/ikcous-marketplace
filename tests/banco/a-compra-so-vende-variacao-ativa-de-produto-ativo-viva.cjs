"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs.
// Corpo VIVO (20261397000000) de create_marketplace_order_v23 (anon, pagamento na entrega) e
// create_marketplace_order_v24 (authenticated, online): a compra so vende variacao ATIVA de produto ATIVO
// e recusa 'Escolha uma variação' quando chega variant_id nulo para produto que tem variacao ativa.
// Sem isso o pedido grava o preco-base no lugar do price_override e baixa o estoque agregado no lugar do
// tamanho escolhido; variacao desativada ou produto pausado/arquivado continuaria vendendo.
// MUTANTE_R112B instala UMA sabotagem no corpo vivo (troca unica de texto); ROLLBACK a desfaz.
const { randomUUID } = require("node:crypto");
const P = require("./prova-de-objeto-novo.cjs");
const { DESCONTO_DO_CUPOM } = require("./o-desconto-do-cupom-posterior.cjs");
const { assert, prova } = P;

const CLIENTE = "c112b000-0000-4000-8000-000000000001";
// A: ativo, 1 variacao ativa (price_override 80). B: ativo, so variacao INATIVA. D: pausado, variacao ativa.
// E: arquivado (ativo=false + deleted_at), sem variacao. F: arquivado, com variacao ativa.
const P_A = "c112b000-0000-4000-8000-000000000002";
const P_B = "c112b000-0000-4000-8000-000000000003";
const P_D = "c112b000-0000-4000-8000-000000000004";
const P_E = "c112b000-0000-4000-8000-000000000005";
const P_F = "c112b000-0000-4000-8000-000000000006";
const V_A = "c112b000-0000-4000-8000-000000000012";
const V_B = "c112b000-0000-4000-8000-000000000013";
const V_D = "c112b000-0000-4000-8000-000000000014";
const V_F = "c112b000-0000-4000-8000-000000000016";
const ASSINATURA =
  "(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";

// Cada mutante e UMA troca de texto, com uma so ocorrencia, no corpo vivo da porta indicada.
const MUTANTES = {
  "v23-sem-exigir-variacao": {
    porta: "v23",
    trecho: "IF v_db_price IS NOT NULL AND EXISTS (",
    substituto: "IF false AND EXISTS (",
  },
  "v24-sem-exigir-variacao": {
    porta: "v24",
    trecho: "IF v_db_price IS NOT NULL AND EXISTS (",
    substituto: "IF false AND EXISTS (",
  },
  "v23-variacao-inativa-passa": {
    porta: "v23",
    trecho: "AND v.active = true AND p.ativo = true",
    substituto: "AND true AND p.ativo = true",
  },
  "v24-produto-inativo-passa": {
    porta: "v24",
    trecho: "AND v.active = true AND p.ativo = true",
    substituto: "AND v.active = true",
  },
};
const MUTANTE = process.env.MUTANTE_R112B || "";
if (MUTANTE && !Object.hasOwn(MUTANTES, MUTANTE)) {
  console.error(
    `ERRO: MUTANTE_R112B desconhecido: ${MUTANTE} (validos: ${Object.keys(MUTANTES).join(", ")})`,
  );
  process.exit(2);
}

async function semear() {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,'cliente@r112b.fixture.invalid','{}')",
    [CLIENTE],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia R112B','customer')",
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
  const produtos = [
    [P_A, "Produto ficticio R112B A", 50, true, false],
    [P_B, "Produto ficticio R112B B", 30, true, false],
    [P_D, "Produto ficticio R112B D", 20, false, false],
    [P_E, "Produto ficticio R112B E", 20, false, true],
    [P_F, "Produto ficticio R112B F", 20, false, true],
  ];
  for (const [id, nome, estoque, ativo, arquivado] of produtos) {
    await c.query(
      `INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo,custo,frete_gratis,deleted_at)
       VALUES ($1,$2,100,$3,$4,40,false,CASE WHEN $5::boolean THEN now() END)`,
      [id, nome, estoque, ativo, arquivado],
    );
  }
  const variacoes = [
    [V_A, P_A, "Tam", "M", 7, 80, true],
    [V_B, P_B, "Tam", "M", 7, 60, false],
    [V_D, P_D, "Tam", "M", 5, 70, true],
    [V_F, P_F, "Tam", "M", 5, 70, true],
  ];
  for (const [id, produto, nome, valor, estoque, preco, ativa] of variacoes) {
    await c.query(
      `INSERT INTO public.product_variants
        (id,product_id,name,value,stock_increment,price_override,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, produto, nome, valor, estoque, preco, ativa],
    );
  }
}

async function mutar(porta) {
  const m = new Map(Object.entries(MUTANTES)).get(MUTANTE);
  if (!m || m.porta !== porta) return;
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
    original.split(m.trecho).length - 1,
    1,
    `mutante ${MUTANTE}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(m.trecho, () => m.substituto);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(
    await ler(),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${MUTANTE}`);
}

// O total esperado de uma venda que passasse: assim o mutante vende de verdade
// e cai na asserção de recusa, nao num "valores do pedido mudaram" por acaso.
function comprar(porta, produto, variante, total) {
  const online = porta === "v24";
  return P.tentar(
    online ? "authenticated" : "anon",
    `SELECT public.create_marketplace_order_${porta}(
      $1::jsonb,$2::numeric,20::numeric,$3::text,NULL::uuid,NULL::text,
      'Pessoa ficticia R112B','5534000000000',NULL::text,$4::jsonb,
      '38500-100','local-delivery',$5::uuid) AS id`,
    [
      JSON.stringify([
        { product_id: produto, variant_id: variante, quantity: 1 },
      ]),
      total,
      online ? "online" : "cash",
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
      randomUUID(),
    ],
    { uid: online ? CLIENTE : "" },
  );
}

// Tudo o que uma compra recusada nao pode tocar: pedidos, itens, estoque do produto e da variacao.
async function foto() {
  return (
    await P.conexao().query(`SELECT
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.marketplace_orders o) AS pedidos,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.marketplace_order_items i) AS itens,
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.produtos p) AS produtos,
      (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.product_variants v) AS variacoes`)
  ).rows[0];
}

async function contar() {
  return (
    await P.conexao().query(`SELECT
      (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
      (SELECT count(*)::int FROM public.marketplace_order_items) AS itens`)
  ).rows[0];
}

async function recusada(rotulo, porta, r, padrao, antes) {
  assert.equal(
    r.codigo,
    "P0001",
    `${rotulo}_${porta}: compra devia ser recusada e foi aceita (${JSON.stringify(r.linhas)})`,
  );
  assert.match(r.erro, padrao, `${rotulo}_${porta}: recusa pelo motivo errado`);
  assert.deepEqual(await contar(), { pedidos: 0, itens: 0 });
  assert.deepEqual(
    await foto(),
    antes,
    `${rotulo}_${porta}: a recusa alterou pedido, item ou estoque`,
  );
}

async function vendida(rotulo, porta, r, esperado) {
  assert.equal(r.codigo, undefined, `${rotulo}_${porta}: recusada: ${r.erro}`);
  const id = r.linhas[0].id;
  assert.ok(id, `${rotulo}_${porta}: nao devolveu pedido`);
  const c = P.conexao();
  const pedido = (
    await c.query(
      `SELECT user_id,subtotal::text,discount::text,shipping::text,total::text
         FROM public.marketplace_orders WHERE id=$1`,
      [id],
    )
  ).rows[0];
  assert.deepEqual(pedido, {
    user_id: porta === "v24" ? CLIENTE : null,
    subtotal: esperado.subtotal,
    discount: "0.00",
    shipping: "20.00",
    total: esperado.total,
  });
  const itens = (
    await c.query(
      "SELECT product_id,variant_id,quantity,price::text FROM public.marketplace_order_items WHERE order_id=$1",
      [id],
    )
  ).rows;
  assert.deepEqual(itens, [
    {
      product_id: esperado.produto,
      variant_id: esperado.variante,
      quantity: 1,
      price: esperado.preco,
    },
  ]);
  const estoques = (
    await c.query(
      `SELECT
        (SELECT estoque FROM public.produtos WHERE id=$1) AS produto,
        (SELECT stock_increment FROM public.product_variants WHERE id=$2) AS variacao`,
      [esperado.produto, esperado.variante ?? V_B],
    )
  ).rows[0];
  assert.deepEqual(
    estoques,
    esperado.estoques,
    `${rotulo}_${porta}: baixou o estoque no lugar errado`,
  );
}

for (const porta of ["v23", "v24"]) {
  prova(
    `${porta}: (a) produto com variacao ativa e variant_id nulo e recusado`,
    () =>
      P.emTransacao(async () => {
        await semear();
        await mutar(porta);
        const antes = await foto();
        await recusada(
          "SEM_VARIACAO",
          porta,
          await comprar(porta, P_A, null, 120),
          /^Escolha uma variação para o produto Produto ficticio R112B A\.$/,
          antes,
        );
        // O estoque do tamanho e o do agregado seguem exatamente onde estavam.
        const est = (
          await P.conexao().query(
            `SELECT (SELECT estoque FROM public.produtos WHERE id='${P_A}') AS produto,
                  (SELECT stock_increment FROM public.product_variants WHERE id='${V_A}') AS variacao`,
          )
        ).rows[0];
        assert.deepEqual(est, { produto: 50, variacao: 7 });
      }),
  );

  prova(`${porta}: (b) variacao com active=false escolhida e recusada`, () =>
    P.emTransacao(async () => {
      await semear();
      await mutar(porta);
      const antes = await foto();
      await recusada(
        "VARIACAO_INATIVA",
        porta,
        await comprar(porta, P_B, V_B, 80),
        /não disponível/,
        antes,
      );
    }),
  );

  prova(
    `${porta}: (c) produto pausado ou arquivado nao vende, com ou sem variacao`,
    () =>
      P.emTransacao(async () => {
        await semear();
        await mutar(porta);
        const antes = await foto();
        // Pausado (ativo=false) com variacao ATIVA: so o `p.ativo = true` do ramo da variacao o segura.
        await recusada(
          "PRODUTO_PAUSADO_COM_VARIACAO",
          porta,
          await comprar(porta, P_D, V_D, 90),
          /não disponível/,
          antes,
        );
        // Pausado sem variante: a mensagem tem de ser a de indisponivel, nao "Escolha uma variação".
        await recusada(
          "PRODUTO_PAUSADO",
          porta,
          await comprar(porta, P_D, null, 120),
          /não disponível/,
          antes,
        );
        // Arquivado (deleted_at preenchido e ativo=false), sem e com variacao.
        await recusada(
          "PRODUTO_ARQUIVADO",
          porta,
          await comprar(porta, P_E, null, 120),
          /não disponível/,
          antes,
        );
        await recusada(
          "PRODUTO_ARQUIVADO_COM_VARIACAO",
          porta,
          await comprar(porta, P_F, V_F, 90),
          /não disponível/,
          antes,
        );
      }),
  );

  prova(
    `${porta}: (d) controles: so variacoes inativas vende pelo produto; variacao ativa baixa o tamanho`,
    () =>
      P.emTransacao(async () => {
        await semear();
        await mutar(porta);
        // Produto cujas variacoes estao TODAS inativas segue vendavel pelo produto base.
        await vendida(
          "CONTROLE_SO_INATIVAS",
          porta,
          await comprar(porta, P_B, null, 120),
          {
            produto: P_B,
            variante: null,
            subtotal: "100.00",
            total: "120.00",
            preco: "100.00",
            estoques: { produto: 29, variacao: 7 },
          },
        );
        // Variacao ativa de produto ativo: preco da variacao e baixa no estoque DELA, nao no agregado.
        await vendida(
          "CONTROLE_VARIACAO_ATIVA",
          porta,
          await comprar(porta, P_A, V_A, 100),
          {
            produto: P_A,
            variante: V_A,
            subtotal: "80.00",
            total: "100.00",
            preco: "80.00",
            estoques: { produto: 50, variacao: 6 },
          },
        );
      }),
  );
}

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
    await P.executar("a compra so vende variacao ativa de produto ativo");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
