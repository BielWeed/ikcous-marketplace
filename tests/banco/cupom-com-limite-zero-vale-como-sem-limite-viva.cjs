"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do proprio teste (MUTANTES, LIMITES);
 * nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA (so teste; nenhum SQL de producao muda) de uma regra de dinheiro que
 * nenhum outro teste de banco mede: o formulario do cupom no painel
 * (src/views/admin/AdminCouponFormView.tsx) grava `usage_limit = 0` quando a
 * lojista nao define limite, e o banco trata 0 (e tambem negativo e NULL) como
 * "SEM LIMITE" em TODAS as portas que olham o limite de usos:
 *
 *   - public.validate_coupon_secure_v2   (validacao antecipada do checkout)
 *   - public.create_marketplace_order_v23 (fechamento: visitante, na entrega)
 *   - public.create_marketplace_order_v24 (fechamento: cliente logada, online)
 *   - public.cupons_do_checkout           (a lista que o checkout mostra)
 *
 * Corpo vivo medido: supabase/migrations/20261397000000_o_desconto_do_cupom_e_arredondado_ao_centavo.sql
 * (v23, v24, validate) e 20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql
 * (lista). Se alguem endurecer a condicao (ex.: `usage_count < usage_limit`), o
 * cupom criado pelo painel passa a ser recusado no fechamento com "ja atingiu o
 * limite de usos" e some da lista; nenhum teste de banco existente ficava
 * vermelho, porque os fixtures deles usam limite NULL, 1, 2, 5, 10, 50 ou 100.
 *
 * CENARIOS (valores exatos; cada prova numa transacao DESFEITA):
 *   limite 0, -1 e NULL, todos com usage_count = 5, cupom 'fixed' de R$ 10, produto
 *   de R$ 100, frete R$ 20: nas tres portas o cupom VALE (is_valid, desconto 10),
 *   o pedido grava desconto 10,00 / total 110,00 e usage_count vira 6; na lista o
 *   cupom APARECE (aplica, desconto 10).
 *   CONTRAPROVA: usage_limit = 1 com usage_count = 1 continua RECUSADO nas tres
 *   portas (mensagem de limite) e SOME da lista, sem gravar pedido nem mexer em
 *   estoque ou contador.
 *
 * MUTANTES: MUTANTE_R111C=<nome> troca UM trecho do corpo vivo (pg_get_functiondef,
 * dentro da transacao desfeita; o trecho tem de aparecer 1x) e roda os cenarios;
 * a execucao TEM de ficar vermelha, na prova que o nome promete. Nome
 * desconhecido e ERRO. Sem MUTANTE_R111C a execucao e a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://... \
 *        node tests/banco/rodar-isolado.cjs tests/banco/cupom-com-limite-zero-vale-como-sem-limite-viva.cjs
 */

const { randomUUID } = require("node:crypto");
const P = require("./prova-de-objeto-novo.cjs");
const { DESCONTO_DO_CUPOM } = require("./o-desconto-do-cupom-posterior.cjs");
const { assert, prova } = P;

const CLIENTE = "c111c000-0000-4000-8000-000000000001";
const PRODUTO = "c111c000-0000-4000-8000-000000000002";
const ASSINATURA_PEDIDO =
  "(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const VALIDATE = "public.validate_coupon_secure_v2(text,numeric)";
const LISTA = "public.cupons_do_checkout(numeric)";

// ---------------------------------------------------------------- mutantes
// de/para sao trechos EXATOS do corpo vivo (pg_get_functiondef); cada `de` tem de
// aparecer 1x. `espera` = a(s) prova(s) em que a execucao TEM de ficar vermelha.
const LIMITE_PEDIDO =
  "AND (usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit)";
const SEM_ZERO_PEDIDO =
  "AND (usage_limit IS NULL OR usage_count < usage_limit)";
const LIMITE_VALIDATE =
  "(v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_limit > 0) AND";
const LIMITE_LISTA = "c.usage_limit IS NOT NULL AND c.usage_limit > 0";

const MUTANTES = {
  "v23-sem-limite-zero": {
    espera: ["v23 limite 0", "v23 limite -1"],
    funcao: `public.create_marketplace_order_v23${ASSINATURA_PEDIDO}`,
    de: LIMITE_PEDIDO,
    para: SEM_ZERO_PEDIDO,
  },
  "v24-sem-limite-zero": {
    espera: ["v24 limite 0", "v24 limite -1"],
    funcao: `public.create_marketplace_order_v24${ASSINATURA_PEDIDO}`,
    de: LIMITE_PEDIDO,
    para: SEM_ZERO_PEDIDO,
  },
  "validate-limite-so-nao-nulo": {
    espera: ["validate limite 0", "validate limite -1"],
    funcao: VALIDATE,
    de: LIMITE_VALIDATE,
    para: "(v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_limit IS NOT NULL) AND",
  },
  "lista-limite-so-nao-nulo": {
    espera: ["lista limite 0", "lista limite -1"],
    funcao: LISTA,
    de: LIMITE_LISTA,
    para: "c.usage_limit IS NOT NULL AND c.usage_limit IS NOT NULL",
  },
  // Controles do outro lado: tirar o limite de vez tem de derrubar a contraprova.
  "v23-sem-limite-nenhum": {
    espera: ["contraprova v23"],
    funcao: `public.create_marketplace_order_v23${ASSINATURA_PEDIDO}`,
    de: LIMITE_PEDIDO,
    para: "AND true",
  },
  "v24-sem-limite-nenhum": {
    espera: ["contraprova v24"],
    funcao: `public.create_marketplace_order_v24${ASSINATURA_PEDIDO}`,
    de: LIMITE_PEDIDO,
    para: "AND true",
  },
  "validate-sem-limite-nenhum": {
    espera: ["contraprova validate"],
    funcao: VALIDATE,
    de: LIMITE_VALIDATE,
    para: "(false) AND",
  },
  "lista-sem-limite-nenhum": {
    espera: ["contraprova lista"],
    funcao: LISTA,
    de: LIMITE_LISTA,
    para: "false",
  },
};

const MUTANTE = process.env.MUTANTE_R111C;
if (MUTANTE && !Object.hasOwn(MUTANTES, MUTANTE)) {
  P.falhar(
    "ERRO",
    `MUTANTE_R111C desconhecido: ${MUTANTE}. Validos: ${Object.keys(MUTANTES).join(", ")}`,
  );
}

async function mutar() {
  if (!MUTANTE) return;
  const m = MUTANTES[MUTANTE];
  const c = P.conexao();
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        m.funcao,
      ])
    ).rows[0].d.replace(/\r/g, "");
  const original = await ler();
  assert.equal(
    original.split(m.de).length - 1,
    1,
    `mutante ${MUTANTE}: o alvo deve ocorrer exatamente uma vez`,
  );
  const alterado = original.replace(m.de, () => m.para);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(
    await ler(),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${MUTANTE} (espera vermelho em: ${m.espera})`);
}

// ------------------------------------------------------------------ semente
async function semear({ limite, usos, codigo }) {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,'cliente@r111c.fixture.invalid','{}')",
    [CLIENTE],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia R111C','customer')",
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
     VALUES ($1,'Produto ficticio R111C',100,50,true,40,false)`,
    [PRODUTO],
  );
  await c.query(
    `INSERT INTO public.coupons
      (code,type,value,min_purchase,usage_limit,usage_count,valid_until,active,alcance)
     VALUES ($1,'fixed',10,0,$2,$3,now()+interval '1 day',true,'vitrine')`,
    [codigo, limite, usos],
  );
  await mutar();
}

// Os tres jeitos de "sem limite" (o painel grava 0; -1 e NULL tambem valem).
const LIMITES = [
  { rotulo: "0", valor: 0, codigo: "R111CZERO" },
  { rotulo: "-1", valor: -1, codigo: "R111CNEG" },
  { rotulo: "NULL", valor: null, codigo: "R111CNULO" },
];

// -------------------------------------------------------------- chamadores
function validar(codigo) {
  return P.tentar(
    "authenticated",
    "SELECT public.validate_coupon_secure_v2($1::text,100::numeric) AS r",
    [codigo],
    { uid: CLIENTE },
  );
}

async function listar() {
  return (
    await P.como(
      "authenticated",
      "SELECT codigo, aplica, desconto::text AS desconto FROM public.cupons_do_checkout(100::numeric)",
      [],
      { uid: CLIENTE },
    )
  ).filter((l) => l.codigo.startsWith("R111C"));
}

function comprar(porta, codigo, total, chave) {
  const online = porta === "v24";
  return P.tentar(
    online ? "authenticated" : "anon",
    `SELECT public.create_marketplace_order_${porta}(
      $1::jsonb,$2::numeric,20::numeric,$3::text,NULL::uuid,$4::text,
      'Pessoa ficticia R111C','5534000000000',NULL::text,$5::jsonb,
      '38500-100','local-delivery',$6::uuid) AS id`,
    [
      JSON.stringify([{ product_id: PRODUTO, variant_id: null, quantity: 1 }]),
      total,
      online ? "online" : "cash",
      codigo,
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

async function foto(codigo) {
  return (
    await P.conexao().query(
      `SELECT
      (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
      (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
      (SELECT estoque FROM public.produtos WHERE id = $1) AS estoque,
      (SELECT usage_count FROM public.coupons WHERE code = $2) AS usos`,
      [PRODUTO, codigo],
    )
  ).rows[0];
}

// ------------------------------------------------------------------ provas
for (const { rotulo, valor, codigo } of LIMITES) {
  prova(`validate limite ${rotulo}: cupom com 5 usos VALE (desconto 10)`, () =>
    P.emTransacao(async () => {
      await semear({ limite: valor, usos: 5, codigo });
      const r = await validar(codigo);
      assert.equal(r.codigo, undefined, `validate errou: ${r.erro}`);
      const v = r.linhas[0].r;
      assert.equal(
        v.is_valid,
        true,
        `validate recusou o cupom de limite ${rotulo} com 5 usos: ${v.error_message}`,
      );
      assert.equal(Number(v.discount_value), 10);
      assert.equal(v.error_message, "");
    }),
  );
}

for (const { rotulo, valor, codigo } of LIMITES) {
  prova(
    `lista limite ${rotulo}: cupom com 5 usos APARECE (aplica, desconto 10)`,
    () =>
      P.emTransacao(async () => {
        await semear({ limite: valor, usos: 5, codigo });
        const lista = await listar();
        assert.deepEqual(
          lista,
          [{ codigo, aplica: true, desconto: "10.00" }],
          `a lista nao mostrou o cupom de limite ${rotulo} com 5 usos`,
        );
      }),
  );
}

for (const porta of ["v23", "v24"]) {
  for (const { rotulo, valor, codigo } of LIMITES) {
    prova(
      `${porta} limite ${rotulo}: cupom com 5 usos VALE, grava o desconto e usage_count vira 6`,
      () =>
        P.emTransacao(async () => {
          await semear({ limite: valor, usos: 5, codigo });
          const antes = await foto(codigo);
          assert.deepEqual(antes, {
            pedidos: 0,
            itens: 0,
            estoque: 50,
            usos: 5,
          });
          const r = await comprar(porta, codigo, 110, randomUUID());
          assert.equal(
            r.codigo,
            undefined,
            `${porta} recusou o cupom de limite ${rotulo} com 5 usos: ${r.erro}`,
          );
          const id = r.linhas[0].id;
          assert.ok(id, "a compra nao devolveu pedido");
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
            coupon_code: codigo,
            subtotal: "100.00",
            discount: "10.00",
            shipping: "20.00",
            total: "110.00",
            fecha: true,
          });
          assert.deepEqual(await foto(codigo), {
            pedidos: 1,
            itens: 1,
            estoque: 49,
            usos: 6,
          });
        }),
    );
  }
}

// CONTRAPROVA: limite 1 com 1 uso continua recusado, e a recusa nao deixa rastro.
const LIMITE_ATINGIDO = "R111CUM";
const semearAtingido = () =>
  semear({ limite: 1, usos: 1, codigo: LIMITE_ATINGIDO });

prova("contraprova validate: limite 1 com 1 uso recusa", () =>
  P.emTransacao(async () => {
    await semearAtingido();
    const r = await validar(LIMITE_ATINGIDO);
    assert.equal(r.codigo, undefined, `validate errou: ${r.erro}`);
    const v = r.linhas[0].r;
    assert.equal(
      v.is_valid,
      false,
      "validate aceitou cupom com o limite atingido",
    );
    assert.equal(Number(v.discount_value), 0);
    assert.equal(v.error_message, "Cupom atingiu o limite de uso.");
  }),
);

prova("contraprova lista: limite 1 com 1 uso SOME da lista", () =>
  P.emTransacao(async () => {
    await semearAtingido();
    assert.deepEqual(
      await listar(),
      [],
      "a lista mostrou cupom com o limite atingido",
    );
  }),
);

for (const porta of ["v23", "v24"]) {
  prova(`contraprova ${porta}: limite 1 com 1 uso recusa sem efeito`, () =>
    P.emTransacao(async () => {
      await semearAtingido();
      const antes = await foto(LIMITE_ATINGIDO);
      assert.deepEqual(antes, { pedidos: 0, itens: 0, estoque: 50, usos: 1 });
      const r = await comprar(porta, LIMITE_ATINGIDO, 110, randomUUID());
      assert.equal(
        r.codigo,
        "P0001",
        `${porta} aceitou cupom com o limite atingido`,
      );
      assert.equal(
        r.erro,
        `O cupom ${LIMITE_ATINGIDO} já atingiu o limite de usos.`,
      );
      assert.deepEqual(
        await foto(LIMITE_ATINGIDO),
        antes,
        "a recusa alterou pedido, itens, estoque ou contador",
      );
    }),
  );
}

async function main() {
  await P.conectar();
  try {
    // Nao reinstala corpos antigos: a prova exige a definicao VIVA da 20261397000000
    // (v23, v24 e validate). A lista (20261208000000) nao tem sucessora.
    for (const f of DESCONTO_DO_CUPOM.funcoes) {
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
    await P.executar("cupom com limite zero vale como sem limite");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
