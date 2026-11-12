"use strict";

// So o clone descartavel de rodar-isolado.cjs. Nenhum SQL de producao muda.
//
// A guarda: a cotacao de transportadora so vira preco se o cart_hash gravado
// nela for o MESMO conjunto (produto, variante, quantidade) do carrinho que
// esta sendo comprado (20261397000000, v24). Sem ela, cota-se o frete com um
// carrinho pequeno, enche-se o carrinho e fecha-se o pedido pagando o frete do
// pequeno, com a diferenca saindo do bolso da lojista.
//
// A v23 TAMBEM tem a mesma condicao no texto, mas ela e INALCANCAVEL: a v23 e a
// RPC do pagamento na entrega e recusa QUALQUER transportadora no passo 2-ter,
// antes do ramo da cotacao. Aqui a v23 e provada pelo que ela realmente
// protege (recusa a transportadora mesmo com a cotacao do carrinho certo); o
// mutante dela e equivalente (continua verde) e esta documentado.
//
// MUTANTE_R112C instala UMA sabotagem no corpo vivo; ROLLBACK a desfaz.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const CLIENTE = "d112c000-0000-4000-8000-000000000001";
const PRODUTO_A = "d112c000-0000-4000-8000-000000000010";
const PRODUTO_B = "d112c000-0000-4000-8000-000000000011";
const ORIGEM = "38500-000";
const DESTINO = "20000-000";
const OPCAO = "frenet-r112c";
const CODIGO = "R112CCUPOM";
const ASSINATURA =
  "(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const RECUSA =
  "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.";
const DETALHE = `Sem cotação válida nas últimas 24h para cep=20000000, opção=${OPCAO} -- ou a cotação encontrada era de OUTRO carrinho.`;
// A condicao exata (corpo vivo, sem \r) que amarra a cotacao ao carrinho.
const GUARDA = [
  "AND (SELECT array_agg(x ORDER BY x) FROM (",
  "                      SELECT split_part(t, ':', 1) || ':' ||",
  "                             split_part(t, ':', 2) || ':' ||",
  "                             split_part(t, ':', 3) AS x",
  "                        FROM unnest(string_to_array(q.cart_hash, ',')) AS t",
  "                    ) itens_da_cotacao)",
  "                 = (SELECT array_agg(x ORDER BY x) FROM (",
  "                      SELECT COALESCE(i->>'product_id', '') || ':' ||",
  "                             COALESCE(i->>'variant_id', '') || ':' ||",
  "                             COALESCE(i->>'quantity', '1') AS x",
  "                        FROM jsonb_array_elements(p_items) AS i",
  "                    ) itens_do_pedido)",
].join("\n");
const MUTANTES = ["v24-sem-a-guarda-do-frete", "v23-sem-a-guarda-do-frete"];

async function mutar(porta) {
  const nome = process.env.MUTANTE_R112C;
  if (nome !== `${porta}-sem-a-guarda-do-frete`) return;
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
    original.split(GUARDA).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(GUARDA, "AND true");
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(
    await ler(),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function montar() {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,'cliente@r112c.fixture.invalid','{}'::jsonb)",
    [CLIENTE],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia R112C','customer')",
    [CLIENTE],
  );
  await c.query(
    `INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo,custo,frete_gratis)
     VALUES ($1,'Produto A ficticio R112C',50,80,true,20,false),
            ($2,'Produto B ficticio R112C',30,60,true,10,false)`,
    [PRODUTO_A, PRODUTO_B],
  );
  await c.query(
    `INSERT INTO public.store_config
       (id,origin_cep,local_cep_range,free_shipping_min,shipping_coverage,
        local_delivery_fee,pagamento_online,enable_coupons,formas_pagamento_entrega)
     VALUES (1,$1,'38500000-38505000',0,'national',12.5,true,true,ARRAY['pix','card','cash'])
     ON CONFLICT (id) DO UPDATE SET
       origin_cep=EXCLUDED.origin_cep,local_cep_range=EXCLUDED.local_cep_range,
       free_shipping_min=0,shipping_coverage='national',local_delivery_fee=12.5,
       pagamento_online=true,enable_coupons=true,
       formas_pagamento_entrega=EXCLUDED.formas_pagamento_entrega`,
    [ORIGEM],
  );
  await c.query(
    `UPDATE public.store_config SET national_shipping_strategy='desligado',
       national_shipping_min=0,national_discount_type=NULL,
       national_discount_value=0,national_benefit_scope='mais_barata' WHERE id=1`,
  );
  await c.query(
    `INSERT INTO public.store_shipping_credentials (provider,credentials,updated_at)
     VALUES ('_revisao','{"revisao":"R112C"}'::jsonb,now())
     ON CONFLICT (provider) DO UPDATE SET credentials=EXCLUDED.credentials,updated_at=now()`,
  );
  await c.query(
    `INSERT INTO public.coupons
       (code,type,value,min_purchase,usage_limit,usage_count,valid_until,active,alcance)
     VALUES ($1,'fixed',10,0,10,0,now()+interval '1 day',true,'vitrine')`,
    [CODIGO],
  );
  await c.query("DELETE FROM public.shipping_quotes_cache");
}

/** cart_hash no formato que a edge grava: produto:variante:quantidade, por virgula. */
const hashDe = (itens) =>
  itens.map((i) => `${i.p}:${i.v ?? ""}:${i.q}`).join(",");
const itensDe = (itens) =>
  itens.map((i) => ({
    product_id: i.p,
    variant_id: i.v ?? null,
    quantity: i.q,
  }));

async function cotar(itens, preco) {
  await P.conexao().query(
    `INSERT INTO public.shipping_quotes_cache
       (origin_cep,destination_cep,cart_hash,options,created_at)
     VALUES ($1,$2,$3,$4::jsonb,now())`,
    [
      ORIGEM,
      DESTINO,
      hashDe(itens),
      JSON.stringify([
        {
          id: OPCAO,
          price: preco,
          precoCheio: preco,
          revisaoCredenciais: "R112C",
          estrategiaNacional: {
            estrategia: "desligado",
            minimo: 0,
            tipoDesconto: null,
            valorDesconto: 0,
            alcance: "mais_barata",
          },
        },
      ]),
    ],
  );
}

async function foto() {
  return (
    await P.conexao().query(
      `SELECT (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
              (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
              (SELECT estoque FROM public.produtos WHERE id=$1) AS estoque_a,
              (SELECT estoque FROM public.produtos WHERE id=$2) AS estoque_b,
              (SELECT usage_count FROM public.coupons WHERE code=$3) AS cupom`,
      [PRODUTO_A, PRODUTO_B, CODIGO],
    )
  ).rows[0];
}

let chaveSeq = 0;
function chave() {
  chaveSeq += 1;
  return `d112c000-0000-4000-8000-${String(900000000000 + chaveSeq)}`;
}

function pedir(porta, itens, total) {
  return P.tentar(
    "authenticated",
    `SELECT public.create_marketplace_order_${porta}(
      $1::jsonb,$2::numeric,0::numeric,$3::text,NULL::uuid,$4::text,
      'Cliente ficticio'::text,'5539000000000'::text,NULL::text,$5::jsonb,
      $6::text,$7::text,$8::uuid) AS id`,
    [
      JSON.stringify(itensDe(itens)),
      total,
      porta === "v24" ? "online" : "cash",
      CODIGO,
      JSON.stringify({ cep: DESTINO, rua: "Rua ficticia", numero: "1" }),
      DESTINO,
      OPCAO,
      chave(),
    ],
    { uid: CLIENTE },
  );
}

async function recusaDoOutroCarrinho(itens, total, antes, motivo) {
  const r = await pedir("v24", itens, total);
  assert.equal(
    r.codigo,
    "P0001",
    `${motivo}: o pedido nasceu com o frete cotado para outro carrinho`,
  );
  assert.equal(r.erro, RECUSA, `${motivo}: recusa deve ser por cotacao`);
  assert.equal(r.detalhe, DETALHE, `${motivo}: detalhe da recusa`);
  assert.deepEqual(
    await foto(),
    antes,
    `${motivo}: a recusa criou pedido/item, mexeu no estoque ou gastou o cupom`,
  );
}

async function conferirNasceu(r, itens, esperado, antes, vendidoA, vendidoB) {
  assert.equal(r.codigo, undefined, `controle recusado: ${r.erro}`);
  const id = r.linhas[0].id;
  assert.ok(id, "controle precisa criar pedido");
  const pedido = (
    await P.conexao().query(
      `SELECT subtotal::text,discount::text,shipping::text,total::text
         FROM public.marketplace_orders WHERE id=$1`,
      [id],
    )
  ).rows[0];
  assert.deepEqual(pedido, esperado, "o frete gravado e o da cotacao CERTA");
  assert.deepEqual(
    await foto(),
    {
      pedidos: antes.pedidos + 1,
      itens: antes.itens + itens.length,
      estoque_a: antes.estoque_a - vendidoA,
      estoque_b: antes.estoque_b - vendidoB,
      cupom: antes.cupom + 1,
    },
    "controle deve gravar o pedido, baixar o estoque e gastar UMA vaga do cupom",
  );
}

prova(
  "v24: frete cotado com 1 unidade nao vale para 5 do mesmo produto; recotar o carrinho certo passa com o frete certo",
  () =>
    P.emTransacao(async () => {
      await montar();
      await cotar([{ p: PRODUTO_A, q: 1 }], 22);
      await mutar("v24");
      const antes = await foto();
      assert.deepEqual(antes, {
        pedidos: 0,
        itens: 0,
        estoque_a: 80,
        estoque_b: 60,
        cupom: 0,
      });
      // 5 x R$50 - cupom R$10 + frete R$22 do carrinho de 1: o total BATE com o
      // que a RPC calcularia -- so a guarda separa este pedido de um aceito.
      await recusaDoOutroCarrinho(
        [{ p: PRODUTO_A, q: 5 }],
        262,
        antes,
        "UM_PARA_CINCO",
      );
      // Controle: cota-se o carrinho de 5 (frete R$30) e o MESMO pedido nasce,
      // com o frete de 30 -- nao o de 22 da cotacao do carrinho pequeno.
      await cotar([{ p: PRODUTO_A, q: 5 }], 30);
      await conferirNasceu(
        await pedir("v24", [{ p: PRODUTO_A, q: 5 }], 270),
        [{ p: PRODUTO_A, q: 5 }],
        {
          subtotal: "250.00",
          discount: "10.00",
          shipping: "30.00",
          total: "270.00",
        },
        antes,
        5,
        0,
      );
    }),
);

prova(
  "v24: frete cotado para A nao vale para A + B; a ordem dos itens nao importa",
  () =>
    P.emTransacao(async () => {
      await montar();
      await cotar([{ p: PRODUTO_A, q: 1 }], 22);
      await mutar("v24");
      const antes = await foto();
      const enchido = [
        { p: PRODUTO_A, q: 1 },
        { p: PRODUTO_B, q: 1 },
      ];
      // 50 + 30 - 10 + 22 = 92.
      await recusaDoOutroCarrinho(
        enchido,
        92,
        antes,
        "ENCHEU_COM_OUTRO_PRODUTO",
      );
      // Controle: a cotacao do carrinho certo, gravada na ORDEM INVERSA, vale.
      await cotar(
        [
          { p: PRODUTO_B, q: 1 },
          { p: PRODUTO_A, q: 1 },
        ],
        25,
      );
      await conferirNasceu(
        await pedir("v24", enchido, 95),
        enchido,
        {
          subtotal: "80.00",
          discount: "10.00",
          shipping: "25.00",
          total: "95.00",
        },
        antes,
        1,
        1,
      );
    }),
);

prova(
  "v24: frete cotado para A + B nao vale para um carrinho MENOR (so A)",
  () =>
    P.emTransacao(async () => {
      await montar();
      await cotar(
        [
          { p: PRODUTO_A, q: 1 },
          { p: PRODUTO_B, q: 1 },
        ],
        40,
      );
      await mutar("v24");
      const antes = await foto();
      // 50 - 10 + 40 = 80.
      await recusaDoOutroCarrinho(
        [{ p: PRODUTO_A, q: 1 }],
        80,
        antes,
        "CARRINHO_MENOR",
      );
      await cotar([{ p: PRODUTO_A, q: 1 }], 18);
      await conferirNasceu(
        await pedir("v24", [{ p: PRODUTO_A, q: 1 }], 58),
        [{ p: PRODUTO_A, q: 1 }],
        {
          subtotal: "50.00",
          discount: "10.00",
          shipping: "18.00",
          total: "58.00",
        },
        antes,
        1,
        0,
      );
    }),
);

prova(
  "v23: transportadora e recusada MESMO com a cotacao do carrinho certo (a condicao do cart_hash da v23 e inalcancavel)",
  () =>
    P.emTransacao(async () => {
      await montar();
      const itens = [{ p: PRODUTO_A, q: 2 }];
      await cotar(itens, 22);
      await mutar("v23");
      const antes = await foto();
      // 100 - 10 + 22 = 112: tudo certo, inclusive a cotacao do MESMO carrinho.
      const r = await pedir("v23", itens, 112);
      assert.equal(
        r.codigo,
        "P0001",
        "V23_TRANSPORTADORA: a RPC da entrega aceitou envio por transportadora",
      );
      assert.equal(
        r.erro,
        "Envio por transportadora exige pagamento antecipado. Pague com PIX no app para finalizar este envio.",
      );
      assert.match(r.detalhe, /A RPC do pagamento na entrega \(v23\)/);
      assert.deepEqual(
        await foto(),
        antes,
        "a recusa da v23 criou pedido, mexeu no estoque ou gastou o cupom",
      );
    }),
);

async function main() {
  const mutante = process.env.MUTANTE_R112C;
  if (mutante && !MUTANTES.includes(mutante)) {
    throw new Error(
      `MUTANTE_R112C desconhecido: ${mutante} (validos: ${MUTANTES.join(", ")})`,
    );
  }
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("o frete cotado para um carrinho nao vale para outro");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
