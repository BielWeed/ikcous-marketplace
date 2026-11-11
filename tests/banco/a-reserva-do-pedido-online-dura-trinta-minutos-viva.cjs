"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs (CI_BANCO_EFEMERO=1).
//
// O que prova (DINHEIRO e ESTOQUE): o pedido ONLINE criado pela v24 nasce com a reserva de
// 30 minutos (expires_at = created_at + 30 min), e e' esse prazo que a varredura
// expirar_pedidos_vencidos() le: logo depois de criado o pedido NAO expira e o estoque segue
// baixado; empurrado o prazo para o passado, a mesma varredura o expira e devolve o estoque.
//   - prazo no passado ou zero: o pedido nasce vencido, a varredura o cancela em ate 5 min e a
//     criar-pagamento recusa gerar a cobranca (a venda online nao fecha);
//   - prazo de dias: todo pedido abandonado antes da cobranca segura o estoque por dias.
// Os vizinhos so afirmam `expires_at` nao nulo (a magnitude nunca era lida).
//
// MUTANTE_R114C instala UMA troca de texto no corpo VIVO da v24 (pg_get_functiondef, o trecho
// aparece 1 vez); a transacao e' sempre desfeita (ROLLBACK), nada fica no clone.
// Nome desconhecido => ERRO.
const { randomUUID } = require("node:crypto");
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const CLIENTE = "c114c000-0000-4000-8000-000000000001";
const PRODUTO = "c114c000-0000-4000-8000-000000000002";
const ESTOQUE = 50;
const ASSINATURA =
  "public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const TRECHO = "'aguardando', now() + interval '30 minutes'";
const MUTANTES = {
  "reserva-agora-menos-30": "'aguardando', now() - interval '30 minutes'",
  "reserva-zero": "'aguardando', now()",
  "reserva-30-dias": "'aguardando', now() + interval '30 days'",
};

async function semear() {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,'cliente@r114c.fixture.invalid','{}')",
    [CLIENTE],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia R114C','customer')",
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
     VALUES ($1,'Produto ficticio R114C',100,$2,true,40,false)`,
    [PRODUTO, ESTOQUE],
  );
}

async function mutar() {
  const nome = process.env.MUTANTE_R114C;
  if (!nome) return;
  const substituto = new Map(Object.entries(MUTANTES)).get(nome);
  if (substituto === undefined) {
    throw new Error(`MUTANTE_R114C desconhecido: ${nome}`);
  }
  const c = P.conexao();
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        ASSINATURA,
      ])
    ).rows[0].d.replace(/\r/g, "");
  const original = await ler();
  assert.equal(
    original.split(TRECHO).length - 1,
    1,
    `mutante ${nome}: o alvo deve ocorrer uma vez no corpo vivo`,
  );
  const alterado = original.replace(TRECHO, substituto);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(
    await ler(),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

const pedidoOnline = (chave) =>
  P.tentar(
    "authenticated",
    `SELECT public.create_marketplace_order_v24(
      $1::jsonb,120::numeric,20::numeric,'online'::text,NULL::uuid,NULL::text,
      'Pessoa ficticia R114C','5534000000000',NULL::text,NULL::jsonb,
      '38500-100','local-delivery',$2::uuid) AS id`,
    [
      JSON.stringify([{ product_id: PRODUTO, variant_id: null, quantity: 1 }]),
      chave,
    ],
    { uid: CLIENTE },
  );

const estoque = async () =>
  (
    await P.conexao().query("SELECT estoque FROM public.produtos WHERE id=$1", [
      PRODUTO,
    ])
  ).rows[0].estoque;

const linha = async (id) =>
  (
    await P.conexao().query(
      `SELECT status, payment_status, user_id,
              extract(epoch FROM (expires_at - created_at))::int AS reserva_seg,
              (expires_at > now()) AS reserva_no_futuro
         FROM public.marketplace_orders WHERE id=$1`,
      [id],
    )
  ).rows[0];

const varrer = async () =>
  Number(
    (
      await P.como(
        "service_role",
        "SELECT public.expirar_pedidos_vencidos() AS n",
      )
    )[0].n,
  );

prova(
  "v24: o pedido online nasce com reserva de 30 min, a varredura o poupa; vencido, a varredura o expira e devolve o estoque",
  () =>
    P.emTransacao(async () => {
      await semear();
      await mutar();
      // Esvazia o clone de qualquer pedido vencido que ja existisse: a contagem da varredura
      // abaixo passa a medir SO o pedido desta prova.
      await varrer();

      const r = await pedidoOnline(randomUUID());
      assert.equal(r.codigo, undefined, `controle recusado: ${r.erro}`);
      const id = r.linhas[0].id;
      assert.ok(id, "a v24 nao devolveu pedido");
      assert.equal(
        await estoque(),
        ESTOQUE - 1,
        "o pedido nao baixou o estoque",
      );

      const nasceu = await linha(id);
      assert.equal(nasceu.user_id, CLIENTE, "pedido de outro dono");
      assert.equal(nasceu.status, "pending");
      assert.equal(nasceu.payment_status, "aguardando");
      // created_at e' now() da transacao, a mesma do now() do corpo: a reserva e' EXATA.
      assert.ok(
        nasceu.reserva_seg >= 25 * 60 && nasceu.reserva_seg <= 35 * 60,
        `RESERVA: expires_at - created_at = ${nasceu.reserva_seg}s, fora de 25 a 35 min`,
      );
      assert.equal(
        nasceu.reserva_seg,
        30 * 60,
        "RESERVA: a reserva do pedido online deve ser de exatos 30 min",
      );
      assert.equal(
        nasceu.reserva_no_futuro,
        true,
        "RESERVA: o pedido nasceu ja vencido",
      );

      // A varredura logo depois nao pode tocar no pedido recem-criado.
      assert.equal(
        await varrer(),
        0,
        "VARREDURA: expirou um pedido recem-criado (a reserva nao esta no futuro)",
      );
      const depoisDaVarredura = await linha(id);
      assert.equal(depoisDaVarredura.status, "pending");
      assert.equal(depoisDaVarredura.payment_status, "aguardando");
      assert.equal(
        await estoque(),
        ESTOQUE - 1,
        "VARREDURA: o estoque do pedido vivo foi devolvido",
      );

      // Contraprova: o prazo e' MESMO o que a varredura le (empurrado para o passado, expira).
      await P.conexao().query(
        "UPDATE public.marketplace_orders SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [id],
      );
      assert.equal(
        await varrer(),
        1,
        "CONTRAPROVA: a varredura nao expirou o vencido",
      );
      const expirado = await linha(id);
      assert.equal(expirado.status, "cancelled");
      assert.equal(expirado.payment_status, "expirado");
      assert.equal(
        await estoque(),
        ESTOQUE,
        "CONTRAPROVA: o estoque do pedido expirado nao voltou",
      );
      assert.equal(
        await varrer(),
        0,
        "CONTRAPROVA: devolveu o estoque duas vezes",
      );
      assert.equal(await estoque(), ESTOQUE);
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("a reserva do pedido online dura trinta minutos");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
