"use strict";

/**
 * Prova VIVA da migration 20261394200000 (a v23 recusa o pagamento pelo app: `create_marketplace_order_v23`, a porta do "pagar na
 * entrega ou na retirada", RECUSA p_payment_method 'online' para TODO mundo, com ou sem conta, depois da idempotencia e do 0-bis e
 * ANTES de ler o carrinho, trancar linha, inserir, baixar estoque ou gastar cupom; dinheiro + estoque), num Postgres EFEMERO local, sem
 * rede, com os papeis de verdade (anon, authenticated, service_role). Esqueleto de migration em `prova-de-troca-de-corpo.cjs`.
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore ja tem a 20261394200000 (em CI ela tem), TODO caso comeca pelo
 * estado ANTES (o corpo da 20261394000000, instalado por CREATE OR REPLACE direto, byte a byte, lido do arquivo) ou pelo estado DEPOIS
 * (a propria migration). Cada caso roda numa transacao que termina em ROLLBACK (exceto a TRAVA DE LINHA, que usa conexoes reais e dados
 * commitados no clone descartavel).
 *
 *  ANTES      controle: anon e logado criam o pedido 'online' pela v23 e ele nasce com payment_status e expires_at NULOS, baixa o estoque
 *             e gasta a vaga do cupom (o defeito: o "zumbi").
 *  DEPOIS     (a) anon, authenticated e service_role com 'online' (entrega local, retirada na loja, com cupom, com endereco, acima de 10
 *             unidades, itens vazios, produto inexistente): P0001, a frase, o identificador no DETAIL e NADA reservado nem gasto (uma
 *             SEQUENCIA movida por gatilhos prova a ordem; o cupom e o estoque ficam intactos); (b) cash, pix e card (visitante e logado)
 *             seguem criando; a v24 com 'online' segue (logado cria 'aguardando' com prazo; visitante recebe a frase da 384); (c) a
 *             RETENTATIVA de um pedido 'online' antigo (o zumbi ja gravado, mesma chave) devolve o MESMO pedido, mesmo com o pagamento pelo
 *             app desligado na loja; chave de outra pessoa nao vaza (recusa); (d) a ordem dos trechos: pagamento desligado na loja ->
 *             a frase dele (0-bis vem antes), meio desconhecido -> a mesma.
 *  TRAVA      conexoes reais: com a linha do produto trancada por outra sessao, a recusa do 'online' volta NA HORA e o 'cash' espera a
 *             trava (a recusa vem antes da leitura do carrinho).
 *  INTACTO    o corpo novo e' o antigo mais UM trecho (byte a byte, escrito a parte); o mesmo roteiro de compras que passam grava linhas
 *             identicas antes e depois; so a v23 muda (oid, ACL, atributos, as outras funcoes de public iguais, a v24 intacta).
 *  MUTANTES   cada regra sabotada deixa a verificacao certa VERMELHA.
 *  MIGRATION  ver o esqueleto; mais: o pre-voo recusa o corpo da 350 (394000 nao aplicada) sem escrever, e a cadeia do rollback (a 394000 so
 *             desfaz depois desta, byte a byte); consultas 111a/111b (rol de 5 linhas, a ultima informativa).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-v23-recusa-o-pagamento-pelo-app-viva.cjs
 */

/* eslint-disable security/detect-object-injection --
 * Os indices vem de contadores e de listas fechadas deste arquivo (nomes de casos e de cenarios), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const { criar } = require("./prova-de-troca-de-corpo.cjs");

const ARQ = "20261394200000_a_v23_recusa_o_pagamento_pelo_app.sql";
const ARQ_394 = "20261394000000_o_pedido_de_visitante_na_entrega_tem_freio.sql";
const ARQ_350 =
  "20261350000000_a_compra_online_trava_o_preco_e_espera_a_mesma_chave.sql";
const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const ASSINATURA =
  "(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)";
const SIG23 = `public.${V23}${ASSINATURA}`;
const SIG24 = `public.${V24}${ASSINATURA}`;
const H_ANTES = "89c99662346d47a4d6b3d13612ca4acb";
const H_DEPOIS = "86a30fe3502bbafd1a507ce03189bc2d";
const H_350_V23 = "6b71cb823967518955407b532904ae91";
const H_V24 = "36c80a107f3ed16853c1c5b2b0cbc911";

const FRASE =
  "O pagamento pelo app é feito em outra etapa. Para este pedido, escolha pagar na retirada ou na entrega.";
const ID = "pedido_online_so_na_v24:";
const FRASE_0BIS =
  "Esta forma de pagamento não está disponível nesta loja. Escolha outra.";
const FRASE_384 =
  "Para pagar pelo app é preciso entrar na sua conta. Sem conta, escolha pagar na retirada ou na entrega.";
const FRASE_ENDERECO = "Endereço inválido ou não pertence ao usuário.";

const R_ATRIBUTOS =
  "create_marketplace_order_v23: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid; anon, authenticated e service_role, sem PUBLIC)";
const R_INFO =
  "informativo: pedidos pelo app presos (online, pending, sem payment_status)";
const R_CONTROLE = "controle: funcoes de public visiveis a este papel";

// ---------------------------------------------------------------------------
// O inverso do trecho, escrito a parte: tira o 0-ter (do seu cabecalho ate o 0-quater) e devolve o corpo da 20261394000000.
// ---------------------------------------------------------------------------
const INI_0_TER = "    -- 0-ter. O PAGAMENTO PELO APP NÃO ENTRA POR ESTA PORTA";
const INI_0_QUATER = "    -- 0-quater. O FREIO DO PEDIDO DE VISITANTE";
function inverso(corpo) {
  const ini = corpo.indexOf(INI_0_TER);
  assert.ok(ini > 0, "o trecho 0-ter nao esta no corpo novo");
  assert.equal(corpo.split(INI_0_TER).length - 1, 1);
  const fim = corpo.indexOf(INI_0_QUATER, ini);
  assert.ok(fim > ini, "o 0-quater nao vem depois do 0-ter");
  return corpo.slice(0, ini) + corpo.slice(fim);
}

const ESTRAGOS = [];
const T = criar({
  arq: ARQ,
  origem: { arquivo: ARQ_394 },
  fn: V23,
  delim: "$function$",
  sig: SIG23,
  hAntes: H_ANTES,
  hDepois: H_DEPOIS,
  volatil: "v",
  aclDeSempre: [
    "anon=X/postgres",
    "authenticated=X/postgres",
    "postgres=X/postgres",
    "service_role=X/postgres",
  ],
  consulta: {
    a: "111a-conferir-a-v23-recusa-o-pagamento-pelo-app-aplicado",
    b: "111b-antes-a-v23-recusa-o-pagamento-pelo-app-base-vigente",
    linhas: 5,
    rotulos: [
      R_CONTROLE,
      "create_marketplace_order_v23: corpo exato (md5)",
      "create_marketplace_order_v23: o corpo traz a recusa do pagamento pelo app (uma vez)",
      R_ATRIBUTOS,
      R_INFO,
    ],
    // As que ficam ok nos DOIS estados: o controle, os atributos/ACL e a informativa (esperado = vivo, nunca reprova).
    fixos: [R_CONTROLE, R_ATRIBUTOS, R_INFO],
    attr: R_ATRIBUTOS,
  },
  inverso,
  estragosDaConsulta: ESTRAGOS,
});
// Sabotagem da marca: um COMENTARIO com a marca repetida (SQL valido; o corpo muda e a marca aparece 2x) -> a linha da marca cai.
{
  const dup = T.NOVA.corpo.replace(
    "    IF p_payment_method = 'online' THEN\n",
    () =>
      "    -- USING DETAIL = 'pedido_online_so_na_v24: (copia)\n    IF p_payment_method = 'online' THEN\n",
  );
  assert.notEqual(dup, T.NOVA.corpo);
  ESTRAGOS.push([
    T.decl(T.NOVA, dup),
    "create_marketplace_order_v23: o corpo traz a recusa do pagamento pelo app (uma vez)",
  ]);
}

const md5 = T.md5;
const C = () => T.C;
const MUTADO = T.MUTADO;

// ---------------------------------------------------------------------------
// Semente (dentro da transacao do caso) e chamadas
// ---------------------------------------------------------------------------
const U = {
  cliente: "7e7e2394-2000-4000-8000-0000000000d1",
  outro: "7e7e2394-2000-4000-8000-0000000000d2",
};
const END = {
  cliente: "7e7e2394-2000-4000-8000-0000000000e1",
  outro: "7e7e2394-2000-4000-8000-0000000000e2",
};
const PROD = "7e7e2394-2000-4000-8000-0000000000f0";
const PROD_B = "7e7e2394-2000-4000-8000-0000000000f3";
const PROD_VAR = "7e7e2394-2000-4000-8000-0000000000f1";
const VAR = "7e7e2394-2000-4000-8000-0000000000f2";
const DIGITADO = {
  cep: "38500-120",
  street: "Rua Digitada",
  number: "5",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
};
const CEP_LOCAL = "38500-100";
const COD_CUPOM = "P3942X";

/** Roda `sql` como `papel`, com o auth.uid() pedido; devolve as linhas (o erro sobe). */
async function como(papel, sql, params = [], uid = "") {
  await C().query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
  if (papel) await C().query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C().query(sql, params)).rows;
  } finally {
    await C()
      .query("RESET ROLE")
      .catch(() => {});
  }
}
/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo, detalhe}. */
async function tentar(papel, sql, params = [], uid = "") {
  await C().query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, uid);
    await C().query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C().query("ROLLBACK TO SAVEPOINT tentativa");
    await C().query("RESET ROLE");
    return { erro: e.message, codigo: e.code, detalhe: e.detail };
  }
}

const SQL_PEDIDO = (rpc) =>
  `SELECT public.${rpc}($1::jsonb, $2::numeric, $3::numeric, $4::text, $10::uuid, $5::text,
     'Comprador Prova', '5534999990000', NULL::text, $6::jsonb, $7::text, $8::text, $9::uuid) AS id`;

const item = (produto, quantity, variant = null) => ({
  product_id: produto,
  variant_id: variant,
  quantity,
});
const UM = [item(PROD, 1)];

/** Faz o pedido pelo CAMINHO do checkout: R$ 100 por unidade, frete zero (frete gratis "sempre" na entrega local e na retirada). */
async function pedir({
  rpc = V23,
  metodo = "cash",
  uid = "",
  papel = "anon",
  dados = DIGITADO,
  opcao = "local-delivery",
  cupom = null,
  chave = crypto.randomUUID(),
  cep = DIGITADO.cep,
  itens = UM,
  total = null,
  enderecoId = null,
}) {
  const soma = itens.reduce((s, i) => {
    const q = Number(i.quantity);
    return s + (Number.isFinite(q) && q > 0 ? q : 0);
  }, 0);
  const bruto = 100 * soma;
  return tentar(
    papel,
    SQL_PEDIDO(rpc),
    [
      JSON.stringify(itens),
      total ?? (cupom ? bruto - 10 : bruto),
      0,
      metodo,
      cupom,
      dados === null ? null : JSON.stringify(dados),
      cep,
      opcao,
      chave,
      enderecoId,
    ],
    uid,
  );
}
/** O mesmo pedido, feito por quem TEM conta (o JWT de usuario: auth.uid() preenchido). */
const pedirLogado = (extra = {}) =>
  pedir({
    uid: U.cliente,
    papel: "authenticated",
    dados: null,
    cep: CEP_LOCAL,
    ...extra,
  });

const num = async (sql, params = []) =>
  Number((await C().query(sql, params)).rows[0].n);
const lerPedido = async (id) =>
  (
    await C().query(
      "SELECT to_jsonb(o) AS o FROM public.marketplace_orders o WHERE o.id = $1",
      [id],
    )
  ).rows[0]?.o;
const estoque = (id = PROD) =>
  num("SELECT estoque AS n FROM public.produtos WHERE id = $1", [id]);
const usoDoCupom = () =>
  num("SELECT usage_count AS n FROM public.coupons WHERE code = $1", [
    COD_CUPOM,
  ]);
/** Quantas vezes a SEQUENCIA-SONDA andou: o rollback do savepoint nao a desfaz. */
const ticks = async () => {
  const r = (
    await C().query("SELECT is_called, last_value::int AS v FROM probe_233_seq")
  ).rows[0];
  return r.is_called ? r.v : 0;
};
/** O que uma recusa NAO pode mexer: pedidos, itens, estoques, o uso do cupom e a sequencia-sonda. */
const foto = async () => ({
  pedidos: await num("SELECT count(*) AS n FROM public.marketplace_orders"),
  itens: await num("SELECT count(*) AS n FROM public.marketplace_order_items"),
  estoque: await estoque(PROD),
  estoqueB: await estoque(PROD_B),
  cupom: await usoDoCupom(),
  ticks: await ticks(),
});

const SQL_LOJA = `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons,
        pagamento_online, formas_pagamento_entrega, store_address, enabled_shipping_methods)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true,
        true, ARRAY['pix', 'card', 'cash'], 'Rua da Loja, 100 - Centro', ARRAY['local-delivery', 'store-pickup'])
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons, pagamento_online = EXCLUDED.pagamento_online,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods`;

/** Pessoas, enderecos, produtos, cupom, loja e a sonda de ordem dentro da transacao do caso. */
async function semear() {
  for (const id of Object.values(U))
    await C().query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@3942.teste', '{}'::jsonb)",
      [id],
    );
  await C().query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente Prova', 'customer'), ($2, 'Outra Prova', 'customer')`,
    [U.cliente, U.outro],
  );
  await C().query(SQL_LOJA);
  for (const [id, dono, rua] of [
    [END.cliente, U.cliente, "Rua da Cliente"],
    [END.outro, U.outro, "Rua da Outra Pessoa"],
  ])
    await C().query(
      `INSERT INTO public.user_addresses (id, user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default)
       VALUES ($1, $2, 'Casa', 'Dona Prova', '38500-100', $3, '1', 'Centro', 'Cidade Prova', 'MG', true)`,
      [id, dono, rua],
    );
  for (const [id, nome, preco] of [
    [PROD, "Camiseta Azul 3942", 100],
    [PROD_B, "Caneca Branca 3942", 100],
    [PROD_VAR, "Camiseta Grade 3942", 100],
  ])
    await C().query(
      "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, $2, $3, 1000, true, 40, false)",
      [id, nome, preco],
    );
  await C().query(
    "INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES ($1, $2, 'Tamanho', 'M', 50, true)",
    [VAR, PROD_VAR],
  );
  await C().query(
    `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active)
     VALUES ($1, 'fixed', 10, 0, 50, 0, NULL, true)`,
    [COD_CUPOM],
  );
  // A SONDA DE ORDEM: uma sequencia que um gatilho move em cada coisa que a recusa NAO pode ter feito (inserir pedido, baixar estoque
  // de produto ou variacao, gastar cupom). Sequencia nao e' desfeita por ROLLBACK (nem de savepoint): se a recusa viesse DEPOIS de
  // qualquer uma delas, o estado final voltaria limpo, mas a sequencia teria andado.
  await C().query(`
    CREATE SEQUENCE public.probe_233_seq;
    CREATE FUNCTION public.probe_233_tick() RETURNS trigger LANGUAGE plpgsql AS
      $f$ BEGIN PERFORM nextval('public.probe_233_seq'); RETURN NEW; END $f$;
    CREATE TRIGGER probe_233_pedido BEFORE INSERT ON public.marketplace_orders
      FOR EACH ROW EXECUTE FUNCTION public.probe_233_tick();
    CREATE TRIGGER probe_233_estoque BEFORE UPDATE ON public.produtos
      FOR EACH ROW EXECUTE FUNCTION public.probe_233_tick();
    CREATE TRIGGER probe_233_variacao BEFORE UPDATE ON public.product_variants
      FOR EACH ROW EXECUTE FUNCTION public.probe_233_tick();
    CREATE TRIGGER probe_233_cupom BEFORE UPDATE ON public.coupons
      FOR EACH ROW EXECUTE FUNCTION public.probe_233_tick();
  `);
}

/** Insere um pedido 'online' ANTIGO direto na tabela (o zumbi que o defeito deixou): pending, sem payment_status nem prazo, com a chave. */
async function zumbi({ userId = null, chave = crypto.randomUUID() } = {}) {
  const r = await C().query(
    `INSERT INTO public.marketplace_orders
       (user_id, total, subtotal, shipping, payment_method, status, customer_name, customer_data, idempotency_key)
     VALUES ($1::uuid, 100, 100, 0, 'online', 'pending', 'zumbi-prova', '{}'::jsonb, $2::uuid)
     RETURNING id`,
    [userId, chave],
  );
  return { id: r.rows[0].id, chave };
}

const comparar = (rotulo, antes, depois, f) => {
  for (const campo of Object.keys(antes))
    if (depois[campo] !== antes[campo])
      f.push(
        `${rotulo}: ${campo} foi de ${antes[campo]} para ${depois[campo]} (a recusa tem de vir ANTES de reservar)`,
      );
};
/** Confere uma recusa: a frase, o P0001, o identificador no DETAIL e que nada foi reservado nem gasto. */
async function recusaEsperada(rotulo, r, f, antes, frase = FRASE, id = ID) {
  if (r.linhas) {
    f.push(`${rotulo}: o pedido NASCEU (devia ser recusado)`);
    return;
  }
  if (r.erro !== frase) f.push(`${rotulo}: mensagem inesperada: ${r.erro}`);
  if (r.codigo !== "P0001")
    f.push(`${rotulo}: codigo ${r.codigo} (esperado P0001)`);
  if (!String(r.detalhe).startsWith(id))
    f.push(`${rotulo}: DETAIL sem o identificador ${id}: ${r.detalhe}`);
  if (antes) comparar(rotulo, antes, await foto(), f);
}

// ---------------------------------------------------------------------------
// O COMPORTAMENTO esperado — uma verificacao por chave; devolve a lista de falhas (vazia = passou). E' a MESMA que roda sobre o corpo
// certo (tem de dar vazio) e sobre cada mutante (tem de dar nao vazio, na verificacao certa).
// ---------------------------------------------------------------------------
const CHECKS = {
  /** (a) a recusa vale para TODO mundo e nao reserva nada. */
  async recusa() {
    const f = [];
    const casos = [
      ["recusa(anon, entrega local)", {}],
      ["recusa(authenticated, entrega local)", { _logado: true }],
      ["recusa(service_role)", { papel: "service_role" }],
      ["recusa(anon, retirada na loja)", { opcao: "store-pickup" }],
      [
        "recusa(authenticated, retirada na loja)",
        { _logado: true, opcao: "store-pickup" },
      ],
      ["recusa(anon, com cupom)", { cupom: COD_CUPOM }],
      ["recusa(authenticated, com cupom)", { _logado: true, cupom: COD_CUPOM }],
      [
        "recusa(anon, produto com variacao)",
        { itens: [item(PROD_VAR, 2, VAR)] },
      ],
      ["recusa(anon, mais de 10 unidades)", { itens: [item(PROD, 11)] }],
      [
        "recusa(authenticated, com o proprio endereco salvo)",
        { _logado: true, enderecoId: END.cliente },
      ],
      // Antes de qualquer outra coisa do pedido: itens vazios e produto inexistente recebem ESTA recusa (ela vem antes de ler o carrinho).
      ["recusa(anon, itens vazios)", { itens: [], total: 0 }],
      [
        "recusa(anon, produto inexistente)",
        { itens: [item("7e7e2394-2000-4000-8000-0000000000ff", 1)] },
      ],
    ];
    for (const [rotulo, { _logado, ...extra }] of casos) {
      const antes = await foto();
      const r = await (_logado ? pedirLogado : pedir)({
        ...extra,
        metodo: "online",
      });
      await recusaEsperada(rotulo, r, f, antes);
    }
    // Antes do 0-quater: visitante + 'online' + p_address_id recebe ESTA frase (nao a do endereco do 0-quater).
    for (const [rotulo, extra, naoPode] of [
      [
        "recusa(anon, com p_address_id) vem antes do 0-quater",
        { enderecoId: END.outro },
        FRASE_ENDERECO,
      ],
    ]) {
      const r = await pedir({ ...extra, metodo: "online" });
      if (r.erro === naoPode)
        f.push(`${rotulo}: veio a frase do 0-quater (${naoPode})`);
    }
    // 30 chamadas seguidas (o ataque que a v23 + 'online' permitia): nenhuma nasce, o catalogo nao "esgota".
    const antes30 = await foto();
    let nasceu = 0;
    for (let i = 0; i < 30; i++)
      if ((await pedir({ metodo: "online" })).linhas) nasceu += 1;
    if (nasceu !== 0) f.push(`recusa(30 seguidas): ${nasceu} pedidos nasceram`);
    comparar("recusa(30 seguidas)", antes30, await foto(), f);
    return f;
  },

  /** (b) o que NAO e' 'online' segue como sempre; a v24 nao muda. */
  async entregaSegue() {
    const f = [];
    for (const [rotulo, extra] of [
      ["visitante, cash", { metodo: "cash" }],
      ["visitante, pix", { metodo: "pix" }],
      ["visitante, card", { metodo: "card" }],
      ["visitante, retirada na loja", { opcao: "store-pickup" }],
      ["visitante, com cupom", { cupom: COD_CUPOM }],
      ["visitante, 10 unidades", { itens: [item(PROD, 10)] }],
      ["visitante, produto com variacao", { itens: [item(PROD_VAR, 2, VAR)] }],
      ["logado, cash", { _logado: true, metodo: "cash" }],
      [
        "logado, pix com o proprio endereco",
        { _logado: true, metodo: "pix", enderecoId: END.cliente },
      ],
      [
        "logado, card, 50 unidades",
        { _logado: true, metodo: "card", itens: [item(PROD_B, 50)] },
      ],
    ]) {
      const { _logado, ...resto } = extra;
      const r = await (_logado ? pedirLogado : pedir)(resto);
      if (!r.linhas) f.push(`entregaSegue(${rotulo}): recusado: ${r.erro}`);
    }
    // O cupom e o estoque do que passou foram gastos (a recusa nova nao os esconde).
    if ((await usoDoCupom()) !== 1)
      f.push(
        `entregaSegue: o cupom devia ter 1 uso, tem ${await usoDoCupom()}`,
      );
    // A v24 e' a porta do 'online': logado cria 'aguardando' com prazo; visitante continua com a frase da 384.
    const v24 = await pedirLogado({ rpc: V24, metodo: "online" });
    if (!v24.linhas)
      f.push(`entregaSegue(v24 online logado): recusado: ${v24.erro}`);
    else {
      const o = await lerPedido(v24.linhas[0].id);
      if (o?.payment_status !== "aguardando")
        f.push(`entregaSegue(v24): payment_status ${o?.payment_status}`);
      if (!o?.expires_at) f.push("entregaSegue(v24): sem prazo (expires_at)");
      if (o?.payment_method !== "online")
        f.push(`entregaSegue(v24): payment_method ${o?.payment_method}`);
    }
    const v24v = await pedir({ rpc: V24, metodo: "online" });
    if (v24v.erro !== FRASE_384)
      f.push(
        `entregaSegue(v24 online visitante): esperava a frase da 384, veio: ${v24v.erro ?? "pedido criado"}`,
      );
    return f;
  },

  /** (c) a RETENTATIVA de um pedido 'online' antigo devolve o MESMO pedido (a recusa vem DEPOIS da idempotencia). */
  async idempotencia() {
    const f = [];
    // Visitante: o zumbi sem dono; a mesma chave devolve o mesmo id, com 'online' ou com 'cash', e nada novo e' gravado.
    const z = await zumbi();
    const antes = await foto();
    for (const metodo of ["online", "cash"]) {
      const r = await pedir({ metodo, chave: z.chave });
      if (!r.linhas)
        f.push(`idempotencia(visitante, ${metodo}): recusado: ${r.erro}`);
      else if (r.linhas[0].id !== z.id)
        f.push(`idempotencia(visitante, ${metodo}): devolveu outro pedido`);
    }
    comparar("idempotencia(visitante)", antes, await foto(), f);
    // Logado: o zumbi dele volta; com a loja SEM o pagamento pelo app a retentativa continua voltando (a idempotencia vem antes do 0-bis).
    const zl = await zumbi({ userId: U.cliente });
    const rl = await pedirLogado({ metodo: "online", chave: zl.chave });
    if (!rl.linhas) f.push(`idempotencia(logado): recusado: ${rl.erro}`);
    else if (rl.linhas[0].id !== zl.id)
      f.push("idempotencia(logado): devolveu outro pedido");
    await C().query(
      "UPDATE public.store_config SET pagamento_online = false WHERE id = 1",
    );
    const rd = await pedirLogado({ metodo: "online", chave: zl.chave });
    if (!rd.linhas)
      f.push(
        `idempotencia(logado, loja sem pagamento pelo app): recusado: ${rd.erro}`,
      );
    else if (rd.linhas[0].id !== zl.id)
      f.push(
        "idempotencia(logado, loja sem pagamento pelo app): devolveu outro pedido",
      );
    await C().query(
      "UPDATE public.store_config SET pagamento_online = true WHERE id = 1",
    );
    // A chave de OUTRA pessoa nao vaza o pedido dela: o logado "outro" com a chave do zumbi do cliente recebe a recusa nova.
    const antesOutro = await foto();
    const ro = await pedirLogado({
      uid: U.outro,
      metodo: "online",
      chave: zl.chave,
    });
    await recusaEsperada(
      "idempotencia(chave de outra pessoa)",
      ro,
      f,
      antesOutro,
    );
    return f;
  },

  /** (d) a ordem dos trechos: o 0-bis (forma desligada) vem ANTES; meio desconhecido tambem. */
  async ordem() {
    const f = [];
    await C().query(
      "UPDATE public.store_config SET pagamento_online = false WHERE id = 1",
    );
    for (const [rotulo, extra] of [
      ["anon", {}],
      ["authenticated", { _logado: true }],
    ]) {
      const { _logado } = extra;
      const antes = await foto();
      const r = await (_logado ? pedirLogado : pedir)({ metodo: "online" });
      if (r.erro !== FRASE_0BIS)
        f.push(
          `ordem(${rotulo}, pagamento pelo app desligado): esperava a frase do 0-bis, veio: ${r.erro ?? "pedido criado"}`,
        );
      comparar(`ordem(${rotulo})`, antes, await foto(), f);
    }
    await C().query(
      "UPDATE public.store_config SET pagamento_online = true WHERE id = 1",
    );
    for (const metodo of ["Online", "online ", "ONLINE", "boleto", ""]) {
      const r = await pedir({ metodo });
      if (r.erro !== FRASE_0BIS)
        f.push(
          `ordem(meio "${metodo}"): esperava a frase do 0-bis, veio: ${r.erro ?? "pedido criado"}`,
        );
    }
    return f;
  },
};

/** Roda todas as verificacoes de CHECKS (cada uma numa transacao desfeita) no estado montado por `montar`. */
const rodarChecks = (montar) => T.todasAsVerificacoes(CHECKS, montar, semear);

const montarDepois = async () => {
  await T.instalarAntiga();
  await T.instalarNova();
};

// ---------------------------------------------------------------------------
// ANTES: o defeito (controle)
// ---------------------------------------------------------------------------
T.prova(
  "ANTES (controle): pela v23, anon e logado criam o pedido 'online' que nasce SEM payment_status e SEM expires_at, baixa o estoque e gasta a vaga do cupom; repetir esgota o produto; a consulta 111b conta o zumbi",
  () =>
    T.emTransacao(
      async () => {
        await semear();
        const e0 = await estoque();
        for (const [rotulo, quem] of [
          ["anon", pedir],
          ["logado", pedirLogado],
        ]) {
          const r = await quem({ metodo: "online", cupom: COD_CUPOM });
          assert.ok(
            r.linhas,
            `${rotulo}: o pedido devia nascer no corpo antigo: ${r.erro}`,
          );
          const o = await lerPedido(r.linhas[0].id);
          assert.equal(o.payment_method, "online");
          assert.equal(o.status, "pending");
          assert.equal(o.payment_status, null, `${rotulo}: payment_status`);
          assert.equal(o.expires_at, null, `${rotulo}: expires_at`);
        }
        assert.equal(await estoque(), e0 - 2, "o estoque devia ter baixado");
        assert.equal(await usoDoCupom(), 2, "o cupom devia ter gasto 2 vagas");
        for (let i = 0; i < 20; i++)
          await pedir({ metodo: "online", itens: [item(PROD_B, 50)] });
        assert.equal(
          await estoque(PROD_B),
          0,
          "20 chamadas de 50 esgotam o produto de 1000",
        );
        const info = (
          await C().query(
            T.lerConsulta(
              "111b-antes-a-v23-recusa-o-pagamento-pelo-app-base-vigente",
            ),
          )
        ).rows.find((l) => l.item === R_INFO);
        assert.equal(info.vivo, "22", "a 111b devia contar os 22 zumbis");
        assert.equal(info.ok, true);
      },
      { estado: "antes" },
    ),
);

// ---------------------------------------------------------------------------
// DEPOIS: o comportamento, por verificacao
// ---------------------------------------------------------------------------
for (const nome of Object.keys(CHECKS))
  T.prova(`DEPOIS: ${nome} — comportamento da v23 com a recusa`, async () => {
    const falhas = await rodarChecks(montarDepois);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  });

// ---------------------------------------------------------------------------
// TRAVA: conexoes reais — a recusa vem antes da leitura (e da trava) do carrinho
// ---------------------------------------------------------------------------
T.prova(
  "TRAVA: com a linha do produto trancada por OUTRA sessao, a recusa do 'online' volta NA HORA (nao espera) e o mesmo pedido em 'cash' espera a trava (controle)",
  async () => {
    const ADM = new Client({ connectionString: lerDatabaseUrlEfemera() });
    const SEGURA = new Client({ connectionString: lerDatabaseUrlEfemera() });
    const CHAMA = new Client({ connectionString: lerDatabaseUrlEfemera() });
    const PROD_TRAVA = "7e7e2394-2000-4000-8000-0000000000a0";
    await ADM.connect();
    await SEGURA.connect();
    await CHAMA.connect();
    try {
      // Dados COMMITADOS no clone descartavel (as outras sessoes precisam enxergar).
      await ADM.query(SQL_LOJA);
      await ADM.query(
        "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Produto da Trava 3942', 100, 1000, true, 40, false)",
        [PROD_TRAVA],
      );
      await SEGURA.query("BEGIN");
      await SEGURA.query(
        "SELECT id FROM public.produtos WHERE id = $1 FOR UPDATE",
        [PROD_TRAVA],
      );
      const chamar = async (metodo) => {
        await CHAMA.query("BEGIN");
        try {
          await CHAMA.query("SET LOCAL lock_timeout = '1500ms'");
          await CHAMA.query("SET LOCAL ROLE anon");
          const t0 = Date.now();
          try {
            await CHAMA.query(SQL_PEDIDO(V23), [
              JSON.stringify([item(PROD_TRAVA, 1)]),
              100,
              0,
              metodo,
              null,
              JSON.stringify(DIGITADO),
              DIGITADO.cep,
              "local-delivery",
              crypto.randomUUID(),
              null,
            ]);
            return { ok: true, ms: Date.now() - t0 };
          } catch (e) {
            return {
              erro: e.message,
              codigo: e.code,
              detalhe: e.detail,
              ms: Date.now() - t0,
            };
          }
        } finally {
          await CHAMA.query("ROLLBACK");
        }
      };
      // O corpo NOVO COMMITADO pela conexao ADM (as outras sessoes so enxergam o que esta commitado): antigo e depois a migration.
      await ADM.query(T.decl(T.ANTIGA));
      await ADM.query(MUTADO ? T.decl(T.NOVA) : T.MIGRATION);
      const online = await chamar("online");
      assert.equal(online.erro, FRASE, `online: ${JSON.stringify(online)}`);
      assert.ok(
        online.ms < 1000,
        `a recusa devia voltar na hora, levou ${online.ms} ms (esperou a trava?)`,
      );
      const cash = await chamar("cash");
      assert.equal(
        cash.codigo,
        "55P03",
        `cash devia esperar a trava e estourar o lock_timeout: ${JSON.stringify(cash)}`,
      );
      assert.ok(
        cash.ms >= 1000,
        `cash devia ter esperado, levou ${cash.ms} ms`,
      );
    } finally {
      await SEGURA.query("ROLLBACK").catch(() => {});
      await ADM.query("DELETE FROM public.produtos WHERE id = $1", [
        "7e7e2394-2000-4000-8000-0000000000a0",
      ]).catch(() => {});
      await SEGURA.end().catch(() => {});
      await CHAMA.end().catch(() => {});
      await ADM.end().catch(() => {});
    }
  },
);

// ---------------------------------------------------------------------------
// INTACTO: so a v23 muda
// ---------------------------------------------------------------------------
/** Um roteiro de compras que PASSAM; devolve as linhas normalizadas (sem id, relogio e chave). */
async function roteiro() {
  const saidas = [];
  const passos = [
    () => pedir({}),
    () => pedir({ metodo: "pix", opcao: "store-pickup" }),
    () => pedir({ metodo: "card", itens: [item(PROD, 3), item(PROD_B, 2)] }),
    () => pedir({ cupom: COD_CUPOM }),
    () => pedir({ itens: [item(PROD_VAR, 2, VAR)] }),
    () => pedirLogado({ metodo: "pix", enderecoId: END.cliente }),
    () => pedirLogado({ metodo: "cash", itens: [item(PROD_B, 20)] }),
    () => pedirLogado({ rpc: V24, metodo: "online" }),
  ];
  for (const passo of passos) {
    const r = await passo();
    assert.ok(r.linhas, `o roteiro devia passar: ${r.erro}`);
    const id = r.linhas[0].id;
    const o = (
      await C().query(
        `SELECT to_jsonb(o) - 'id' - 'created_at' - 'updated_at' - 'idempotency_key' - 'expires_at' - 'coupon_id' AS o,
                (o.coupon_id IS NOT NULL) AS com_cupom,
                (o.expires_at IS NOT NULL) AS com_prazo
           FROM public.marketplace_orders o WHERE o.id = $1`,
        [id],
      )
    ).rows[0];
    const itens = (
      await C().query(
        "SELECT product_id, variant_id, quantity, price, product_name FROM public.marketplace_order_items WHERE order_id = $1 ORDER BY product_id, variant_id NULLS FIRST",
        [id],
      )
    ).rows;
    saidas.push({
      o: o.o,
      com_prazo: o.com_prazo,
      com_cupom: o.com_cupom,
      itens,
    });
  }
  saidas.push({
    estoque: await estoque(),
    estoqueB: await estoque(PROD_B),
    cupom: await usoDoCupom(),
  });
  return saidas;
}
T.prova(
  "INTACTO: o mesmo roteiro de compras que passam (visitante e logado; cash, pix, card; retirada; cupom; variacao; v24 online) grava linhas identicas, estoque e cupom iguais ANTES e DEPOIS",
  async () => {
    const antes = await T.emTransacao(
      async () => {
        await semear();
        return roteiro();
      },
      { estado: "antes" },
    );
    const depois = await T.emTransacao(
      async () => {
        await semear();
        return roteiro();
      },
      { estado: "depois" },
    );
    assert.equal(antes.length, 9);
    assert.deepEqual(
      depois,
      antes,
      "o roteiro gravou diferente depois da migration",
    );
  },
);
T.prova(
  "INTACTO: so a v23 muda — o OID, o dono, a ACL e os atributos da v23 e da v24 sao os mesmos; a v24 e todas as outras funcoes de public tem o mesmo corpo; as tabelas nao ganham nem perdem linha",
  async () => {
    const foto2 = async () => ({
      funcoes: (
        await C().query(
          `SELECT p.oid::regprocedure::text AS f, md5(p.prosrc) AS h, p.proacl::text AS acl, p.proowner::regrole::text AS dono
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`,
        )
      ).rows,
      atributos: (
        await C().query(
          `SELECT p.oid::regprocedure::text AS f, to_jsonb(p) - 'prosrc' AS a
             FROM pg_proc p WHERE p.oid IN (to_regprocedure($1), to_regprocedure($2)) ORDER BY 1`,
          [SIG23, SIG24],
        )
      ).rows,
      linhas: (
        await C().query(
          `SELECT (SELECT count(*) FROM public.marketplace_orders) AS pedidos,
                  (SELECT count(*) FROM public.produtos) AS produtos,
                  (SELECT count(*) FROM public.coupons) AS cupons`,
        )
      ).rows[0],
    });
    const antes = await T.emTransacao(foto2, { estado: "antes" });
    const depois = await T.emTransacao(foto2, { estado: "depois" });
    assert.deepEqual(depois.atributos, antes.atributos);
    assert.deepEqual(depois.linhas, antes.linhas);
    const mudaram = depois.funcoes.filter(
      (d, i) => JSON.stringify(d) !== JSON.stringify(antes.funcoes[i]),
    );
    assert.equal(depois.funcoes.length, antes.funcoes.length);
    if (!MUTADO) {
      const nomeDe = (f) => f.replace(/^public\./, "").split("(")[0];
      assert.deepEqual(
        mudaram.map((m) => nomeDe(m.f)),
        [V23],
        "so a v23 pode mudar de corpo",
      );
      assert.equal(
        depois.funcoes.find((x) => nomeDe(x.f) === V24).h,
        md5(T.funcaoDe(T.lerMigration(ARQ_394), V24, "$function$").corpo),
        "a v24 mudou",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------
const antes0 = "    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO";
const passo1 =
  "    -- 1. Address Ownership Check (Only if user is logged in)\n";
const passo7 = "    -- 7. Create Order Header\n";
/** O trecho 0-ter completo (do cabecalho ate o 0-quater), tirado do corpo novo. */
const trecho = () => {
  const ini = T.NOVA.corpo.indexOf(INI_0_TER);
  return T.NOVA.corpo.slice(ini, T.NOVA.corpo.indexOf(INI_0_QUATER, ini));
};
T.mutantes(
  {
    "sem o trecho (a v23 volta a aceitar 'online')": {
      aplica: (c) => inverso(c),
      vermelho: [
        "recusa(anon, entrega local)",
        "recusa(authenticated, entrega local)",
      ],
    },
    "recusa so o visitante (o logado ainda cria o pedido impagavel)": {
      aplica: (c) =>
        c.replace(
          "IF p_payment_method = 'online' THEN",
          () => "IF p_payment_method = 'online' AND v_user_id IS NULL THEN",
        ),
      vermelho: ["recusa(authenticated, entrega local)"],
    },
    "recusa so quem tem conta": {
      aplica: (c) =>
        c.replace(
          "IF p_payment_method = 'online' THEN",
          () => "IF p_payment_method = 'online' AND v_user_id IS NOT NULL THEN",
        ),
      vermelho: ["recusa(anon, entrega local)"],
    },
    "recusa tambem o 'cash' (quebra a entrega)": {
      aplica: (c) =>
        c.replace(
          "IF p_payment_method = 'online' THEN",
          () => "IF p_payment_method IN ('online', 'cash') THEN",
        ),
      vermelho: ["entregaSegue(visitante, cash)"],
    },
    "o trecho antes da idempotencia (o zumbi antigo deixa de ser devolvido)": {
      aplica: (c) => {
        const sem = inverso(c);
        const i = sem.indexOf(antes0);
        assert.ok(i > 0);
        return sem.slice(0, i) + trecho() + sem.slice(i);
      },
      vermelho: ["idempotencia(visitante, online)"],
    },
    "o trecho depois do 0-quater (visitante + p_address_id recebe a frase do endereco)":
      {
        aplica: (c) => {
          const sem = inverso(c);
          const i = sem.indexOf(passo1);
          assert.ok(i > 0);
          return sem.slice(0, i) + trecho() + sem.slice(i);
        },
        vermelho: ["vem antes do 0-quater"],
      },
    "o trecho depois de ler o carrinho (produto inexistente recebe a recusa de produto, nao esta)":
      {
        aplica: (c) => {
          const sem = inverso(c);
          const i = sem.indexOf(passo7);
          assert.ok(i > 0);
          return sem.slice(0, i) + trecho() + sem.slice(i);
        },
        vermelho: ["recusa(anon, produto inexistente)"],
      },
    "o identificador do DETAIL trocado": {
      aplica: (c) =>
        c.replace(
          "USING DETAIL = 'pedido_online_so_na_v24:",
          () => "USING DETAIL = 'outro_identificador:",
        ),
      vermelho: ["DETAIL sem o identificador"],
    },
    "a frase trocada": {
      aplica: (c) =>
        c.replace(
          "O pagamento pelo app é feito em outra etapa.",
          () => "Pagamento pelo app indisponivel.",
        ),
      vermelho: ["mensagem inesperada"],
    },
    "o trecho nao recusa (RETURN NULL no lugar do RAISE: o pedido nao nasce, mas a chamada 'passa')":
      {
        aplica: (c) =>
          c.replace(
            / {8}RAISE EXCEPTION 'O pagamento pelo app[\s\S]*?nada reservado\.';\n/,
            () => "        RETURN NULL;\n",
          ),
        vermelho: ["recusa(anon, entrega local)"],
      },
  },
  CHECKS,
  semear,
);

// ---------------------------------------------------------------------------
// MIGRATION: o que e' desta migration (alem do esqueleto)
// ---------------------------------------------------------------------------
T.prova(
  "MIGRATION: a 20261394000000 NAO aplicada (o corpo da v23 e' o da 20261350000000): o pre-voo recusa SEM escrever (B1_BASELINE_DIVERGENT, a frase manda aplicar as anteriores) e o rollback tambem",
  () =>
    T.emTransacao(async () => {
      await T.C.query(
        T.decl(T.funcaoDe(T.lerMigration(ARQ_350), V23, "$function$")),
      );
      assert.equal(await T.hashVivo(), H_350_V23);
      const foto350 = await T.prosrcVivo();
      const e = await T.aplicar(T.MIGRATION);
      assert.ok(e, "a migration devia recusar o corpo da 350");
      assert.match(e.erro, /B1_BASELINE_DIVERGENT/);
      assert.match(e.erro, /aplique as anteriores/);
      assert.equal(await T.prosrcVivo(), foto350, "o pre-voo escreveu");
      const rb = await T.aplicar(T.ROLLBACK);
      assert.ok(rb);
      assert.match(rb.erro, /B1_BASELINE_DIVERGENT/);
      assert.equal(await T.prosrcVivo(), foto350);
    }),
);
T.prova(
  "MIGRATION: a cadeia do rollback — com esta no ar, o rollback da 20261394000000 RECUSA sem escrever; desfazendo esta antes, ele passa e devolve a v23 ao corpo da 350 e a v24 ao da 384, byte a byte",
  () =>
    T.emTransacao(
      async () => {
        assert.equal(await T.hashVivo(), H_DEPOIS);
        // A 20261397000000 (o desconto do cupom e' arredondado ao centavo) sucede a v24 da 394000 e a validate da 208: esta prova mede a cadeia
        // 350/384 -> 394 -> 394200, entao a v24 volta ao corpo da 394000 (a v23 aqui ja e' a desta migration, montada pelo estado "depois").
        await require("./o-desconto-do-cupom-posterior.cjs").desfazerODescontoDoCupomNaTransacao(
          T.C,
        );
        const hash24 = async () =>
          (
            await T.C.query(
              "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
              [SIG24],
            )
          ).rows[0].h;
        assert.equal(await hash24(), H_V24);
        const rb394 = T.lerMigration(`rollback-manual-${ARQ_394}`);
        const foto = await T.prosrcVivo();
        const recusa = await T.aplicar(rb394);
        assert.ok(recusa, "o rollback da 394000 devia recusar com esta no ar");
        assert.match(recusa.erro, /B1_BASELINE_DIVERGENT/);
        assert.equal(
          await T.prosrcVivo(),
          foto,
          "o rollback da 394000 escreveu",
        );
        assert.equal(await T.aplicar(T.ROLLBACK), null);
        assert.equal(await T.hashVivo(), H_ANTES);
        assert.equal(await T.aplicar(rb394), null);
        assert.equal(await T.hashVivo(), H_350_V23);
        assert.equal(await hash24(), "f8d6ed0c3622ab41123bacb98911a98f");
      },
      { estado: "depois" },
    ),
);
T.prova(
  "CONSULTAS: a linha informativa so conta o zumbi (online + pending + sem payment_status); pedido pago/aguardando, cancelado ou em outro meio nao entra; ela nunca reprova",
  async () => {
    const A = T.lerConsulta(
      "111a-conferir-a-v23-recusa-o-pagamento-pelo-app-aplicado",
    );
    const B = T.lerConsulta(
      "111b-antes-a-v23-recusa-o-pagamento-pelo-app-base-vigente",
    );
    await T.emTransacao(
      async () => {
        await semear();
        const ler = async (sql) =>
          (await T.C.query(sql)).rows.find((l) => l.item === R_INFO);
        for (const sql of [A, B]) {
          const l0 = await ler(sql);
          assert.equal(l0.vivo, "0");
          assert.equal(l0.ok, true);
        }
        await zumbi();
        await zumbi({ userId: U.cliente });
        const base = `INSERT INTO public.marketplace_orders (total, subtotal, shipping, payment_method, status, payment_status, customer_name, customer_data)
                      VALUES (100, 100, 0, $1, $2, $3, 'fora-do-rol', '{}'::jsonb)`;
        await T.C.query(base, ["online", "pending", "aguardando"]); // v24 normal
        await T.C.query(base, ["online", "cancelled", null]); // zumbi ja cancelado
        await T.C.query(base, ["cash", "pending", null]); // entrega
        await T.C.query(base, ["pix", "pending", null]);
        for (const sql of [A, B]) {
          const l = await ler(sql);
          assert.equal(l.vivo, "2");
          assert.equal(l.esperado, "2");
          assert.equal(l.ok, true);
        }
      },
      { estado: "depois" },
    );
  },
);

T.main().catch((e) => {
  console.error(e);
  process.exit(1);
});
