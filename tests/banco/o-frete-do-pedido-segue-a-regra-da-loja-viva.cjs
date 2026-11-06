"use strict";

/**
 * Prova VIVA do frete que o PEDIDO grava (DINHEIRO): `create_marketplace_order_v24` (e a v23, a porta do pagamento na entrega) decidem,
 * no banco, quanto de frete a cliente paga, e recusam a cotacao velha. Roda num Postgres EFEMERO local, sem rede, com as migrations
 * aplicadas do zero (o corpo VIVO das funcoes, nao o de uma migration antiga).
 *
 * POR QUE ESTE ARQUIVO EXISTE. Antes dele, estas regras so tinham ensaio em tests/frete-revisao-database/run.cjs e
 * tests/frete-estrategias-database/run.cjs: cada um sobe o PROPRIO container Docker, o CI nunca os rodou (nenhum workflow os chama) e
 * nenhum caso de tests/banco usava limite positivo de frete gratis, o modo por produto (-1), a estrategia nacional nem uma cotacao com
 * revisao diferente. A unica protecao automatica era um teste que le o TEXTO do SQL (tests/migration_frete_v2_presets_no_servidor_test.ts):
 * um CREATE OR REPLACE futuro que estragasse a decisao do frete podia deixa-lo verde. Aqui o comportamento e executado de verdade.
 *
 *  REVISAO      a cotacao carrega a revisao das credenciais de frete de quando foi feita; se a loja ja tem a linha '_revisao' e a da
 *               cotacao e outra (ou NAO existe o campo), o pedido e recusado com FRETE_COTACAO_DESATUALIZADA, sem pedido, sem item e sem
 *               mexer no estoque; revisao igual, loja sem a linha, e cotacao nova depois da recusa: o pedido nasce. Retirada e entrega
 *               local nao conferem a revisao.
 *  ESPELHO      cotacao SEM carimbo de estrategia (edge antiga) so vale enquanto a estrategia nacional da loja e o espelho do
 *               free_shipping_min: desligado, sempre (0,01), por produto (-1) e acima de valor (limite positivo), com o subtotal um
 *               centavo abaixo, EXATAMENTE no limite e acima; fora do espelho, recusa.
 *  LOCAL        a entrega local aplica as mesmas sentinelas de free_shipping_min (v24 e v23) e senao cobra a taxa configurada.
 *  CARIMBO      estrategia nacional carimbada na cotacao: igual cobra o price do cache; divergente, null, {} e parcial recusam;
 *               o subtotal que cruzou o minimo entre cotar e pedir recusa (nos dois sentidos, para acima_de_valor e para
 *               desconto_na_mais_barata); de duas opcoes na mesma cotacao vale o price da ESCOLHIDA.
 *  PORTOES      id nacional com CEP local ou sem CEP, endereco da conta local com CEP distante, free-shipping-promo so no modo por
 *               produto; retirada e local intactos; a v23 continua recusando transportadora.
 *  CONTROLES    a MESMA bateria, com o corpo vivo das duas funcoes trocado dentro de uma transacao que termina em ROLLBACK: (1) toda
 *               recusa FRETE_COTACAO_DESATUALIZADA vira aviso e cada cenario de recusa PASSA a deixar o pedido nascer; (2) o limite
 *               ">=" vira ">" e os cenarios do limite exato deixam de dar o frete certo. Prova que os cenarios enxergam a regra e que a
 *               regra, e nao o acaso, e o que segura. O corpo original volta byte a byte depois.
 *
 * NAO e' prova de migration (nao reaplica, nao desfaz, nao compara hash de corpo): isso fica nas provas de cada migration.
 * Nenhuma migration, funcao ou dado de loja real e' tocado: so o clone efemero do rodar-isolado.cjs.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-frete-do-pedido-segue-a-regra-da-loja-viva.cjs
 */

/* eslint-disable security/detect-object-injection --
 * Os indices vem de contadores e de listas fechadas deste arquivo, nunca de rede nem de terceiro. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

// ---- Fixtures: dado de FIXTURE, nenhum cliente real ------------------------
const U_CLIENTE = "11111111-1111-1111-1111-111111111111";
const P_NORMAL = "aaaaaaaa-0000-0000-0000-0000000000f1"; // frete_gratis = false
const P_GRATIS = "aaaaaaaa-0000-0000-0000-0000000000f2"; // frete_gratis = true (modo por produto)
const ENDERECO_LOCAL = "cccccccc-0000-0000-0000-0000000000f1";
const ORIGEM_CEP = "38500-000";
const FAIXA_LOCAL = "38500000-38505000";
const TAXA_LOCAL = 12.5;
const CEP_NACIONAL = "20000-000"; // fora da faixa local
const CEP_LOCAL = "38500-010"; // dentro da faixa local

const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const ASSINATURA =
  "(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)";
const RECUSA_COTACAO = /^FRETE_COTACAO_DESATUALIZADA/;

let C = null; // a conexao unica da prova
let EM_TRANSACAO = false; // dentro de um controle: cada chamada ganha um SAVEPOINT (erro de RPC nao aborta a transacao inteira)

const num = (v) => (v === null || v === undefined ? v : Number(v));
const centavos = (v) => Math.round(Number(v) * 100);

// ---- Banco: estado base e chamadas ----------------------------------------
async function garantirUsuarioEEndereco() {
  await C.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'prova-frete@example.com', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_CLIENTE],
  );
  await C.query(
    `INSERT INTO public.user_addresses
       (id, user_id, cep, city, complement, name, neighborhood, number, recipient_name, state, street, is_default)
     VALUES ($1, $2, $3, 'Cidade de Prova', NULL, 'Casa', 'Bairro', '10', 'Cliente de Prova', 'SP', 'Rua de Prova', true)
     ON CONFLICT (id) DO UPDATE SET cep = EXCLUDED.cep`,
    [ENDERECO_LOCAL, U_CLIENTE, "38500-050"],
  );
  await C.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_CLIENTE]);
}

/** Volta TUDO que a decisao do frete le para um estado conhecido e neutro, antes de cada cenario. */
async function estadoBase({
  fsm,
  normal,
  gratis,
  nacional,
  revisao,
  retirada,
}) {
  await C.query(
    "DELETE FROM public.store_shipping_credentials WHERE provider = '_revisao'",
  );
  await C.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto normal', $3, 999, true, false), ($2, 'Produto com frete gratis', $4, 999, true, true)
     ON CONFLICT (id) DO UPDATE
       SET preco_venda = EXCLUDED.preco_venda, estoque = 999, ativo = true, frete_gratis = EXCLUDED.frete_gratis`,
    [P_NORMAL, P_GRATIS, normal, gratis],
  );
  // `pagamento_online` e' coluna so da frota (gatilho dominio_publico_so_muda_pela_frota): esta conexao e' a privilegiada do clone
  // efemero, a mesma que tambem escreve free_shipping_min e as colunas nacionais fora de qualquer RPC.
  await C.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enabled_shipping_methods, store_address,
        local_delivery_fee, pagamento_online)
     VALUES (1, $1, $2, $3, 'national', $5, $6, $4, true)
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           enabled_shipping_methods = EXCLUDED.enabled_shipping_methods, store_address = EXCLUDED.store_address,
           local_delivery_fee = EXCLUDED.local_delivery_fee, pagamento_online = true`,
    // A retirada na loja exige o metodo ligado e um endereco fisico; nos demais cenarios os dois ficam no padrao (NULL).
    [
      ORIGEM_CEP,
      FAIXA_LOCAL,
      fsm,
      TAXA_LOCAL,
      retirada ? ["store-pickup"] : null,
      retirada ? "Rua da Loja, 123" : null,
    ],
  );
  await C.query(
    `UPDATE public.store_config
        SET national_shipping_strategy = $1, national_shipping_min = $2, national_discount_type = $3,
            national_discount_value = $4, national_benefit_scope = $5
      WHERE id = 1`,
    [
      nacional.strategy,
      nacional.min,
      nacional.tipo,
      nacional.valor,
      nacional.alcance,
    ],
  );
  if (revisao !== null) {
    await C.query(
      `INSERT INTO public.store_shipping_credentials (provider, credentials, updated_at)
       VALUES ('_revisao', jsonb_build_object('revisao', $1::text), now())
       ON CONFLICT (provider) DO UPDATE SET credentials = EXCLUDED.credentials, updated_at = now()`,
      [revisao],
    );
  }
}

/** cart_hash no formato que a edge grava: "produto::quantidade" por item, separados por virgula. */
const cartHashDe = (itens) => itens.map((i) => `${i.p}::${i.q}`).join(",");
const itensJson = (itens) =>
  JSON.stringify(
    itens.map((i) => ({ product_id: i.p, variant_id: null, quantity: i.q })),
  );

async function gravarCotacao(destino, itens, opcoes) {
  await C.query(
    `INSERT INTO public.shipping_quotes_cache (origin_cep, destination_cep, cart_hash, options, created_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (origin_cep, destination_cep, cart_hash)
     DO UPDATE SET options = EXCLUDED.options, created_at = EXCLUDED.created_at`,
    [ORIGEM_CEP, destino, cartHashDe(itens), JSON.stringify(opcoes)],
  );
}

async function chamarRpc(fn, c, total) {
  const addressData = JSON.stringify({
    cep: c.cepEndereco ?? c.destino,
    rua: "Rua da Prova",
    numero: "1",
  });
  const r = await C.query(
    `SELECT public.${fn}(
       $1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid,
       $6::text, $7::text, $8::text, $9::text, $10::jsonb,
       $11::text, $12::text, $13::uuid
     ) AS id`,
    [
      itensJson(c.itens),
      total,
      0,
      c.pagamento,
      c.enderecoId ?? null,
      null,
      "Cliente de Prova",
      "5539000000000",
      null,
      addressData,
      c.destino,
      c.opt,
      crypto.randomUUID(),
    ],
  );
  return r.rows[0].id;
}

async function fotoDoBanco() {
  const r = await C.query(
    `SELECT (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
            (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
            (SELECT string_agg(id::text || '=' || estoque::text, ',' ORDER BY id::text)
               FROM public.produtos WHERE id IN ($1, $2)) AS estoque`,
    [P_NORMAL, P_GRATIS],
  );
  return r.rows[0];
}

async function lerPedido(id) {
  const r = await C.query(
    "SELECT shipping, total, subtotal FROM public.marketplace_orders WHERE id = $1",
    [id],
  );
  assert.equal(r.rows.length, 1, `pedido ${id} nao gravado`);
  return {
    shipping: num(r.rows[0].shipping),
    total: num(r.rows[0].total),
    subtotal: num(r.rows[0].subtotal),
  };
}

// ---- Os cenarios -----------------------------------------------------------
const DESLIGADO = {
  strategy: "desligado",
  min: 0,
  tipo: null,
  valor: 0,
  alcance: "mais_barata",
};
const SEMPRE = {
  strategy: "sempre",
  min: 0,
  tipo: null,
  valor: 0,
  alcance: "todas",
};
const POR_PRODUTO = {
  strategy: "por_produto",
  min: 0,
  tipo: null,
  valor: 0,
  alcance: "todas",
};
const acimaDe = (min) => ({
  strategy: "acima_de_valor",
  min,
  tipo: null,
  valor: 0,
  alcance: "todas",
});
const descontoPct = (valor, min = 0) => ({
  strategy: "desconto_na_mais_barata",
  min,
  tipo: "percentual",
  valor,
  alcance: "mais_barata",
});
/** O carimbo que a edge grava na opcao: as 5 colunas nacionais do instante da cotacao. */
const carimbo = (n) => ({
  estrategia: n.strategy,
  minimo: n.min,
  tipoDesconto: n.tipo,
  valorDesconto: n.valor,
  alcance: n.alcance,
});
/** O espelho legado de free_shipping_min: a estrategia nacional que uma loja sem escolha propria tem. */
function espelhoDe(fsm) {
  if (fsm === 0.01) return SEMPRE;
  if (fsm < 0) return POR_PRODUTO;
  if (fsm > 0) return acimaDe(fsm);
  return DESLIGADO;
}

const UM_NORMAL = [{ p: P_NORMAL, q: 1 }];
const UM_GRATIS = [{ p: P_GRATIS, q: 1 }];
const normais = (q) => [{ p: P_NORMAL, q }];

/** Valores padrao de um cenario; cada cenario so diz o que muda. */
function cenario(base) {
  return {
    fsm: 0,
    normal: 50,
    gratis: 30,
    nacional: DESLIGADO,
    revisao: null,
    rpc: V24,
    pagamento: "online",
    destino: CEP_NACIONAL,
    itens: UM_NORMAL,
    cotacao: null, // [{ id, price, ... }] gravado como a linha do cache; o id escolhido e `opt`
    ...base,
  };
}

/** Cotacao de uma opcao so (a forma mais comum), sem campos opcionais que nao foram pedidos. */
const opcao = (id, price, extra = {}) => [{ id, price, ...extra }];

const CENARIOS = [];
const add = (c) => CENARIOS.push(cenario(c));

// -- REVISAO (v24, transportadora, pagamento online) --
add({
  id: "rev-sem-a-linha-de-revisao-o-pedido-nasce",
  opt: "frenet-r0",
  cotacao: opcao("frenet-r0", 20),
  subtotal: 50,
  frete: 20,
});
add({
  id: "rev-igual-o-pedido-nasce",
  revisao: "R1",
  opt: "frenet-r1",
  cotacao: opcao("frenet-r1", 22, { revisaoCredenciais: "R1" }),
  subtotal: 50,
  frete: 22,
});
add({
  id: "rev-diferente-recusa-e-nada-e-gravado",
  revisao: "R2",
  opt: "frenet-r2",
  cotacao: opcao("frenet-r2", 22, { revisaoCredenciais: "R1" }),
  subtotal: 50,
  recusa: RECUSA_COTACAO,
});
add({
  id: "rev-cotacao-sem-o-campo-de-revisao-recusa-quando-a-loja-ja-tem-uma",
  revisao: "R2",
  opt: "frenet-r2b",
  cotacao: opcao("frenet-r2b", 30), // o que a edge anterior ao campo grava
  subtotal: 50,
  recusa: RECUSA_COTACAO,
});
add({
  id: "rev-cotacao-nova-com-a-revisao-atual-depois-da-recusa-o-pedido-nasce",
  revisao: "R2",
  opt: "frenet-r2c",
  cotacao: opcao("frenet-r2c", 22, { revisaoCredenciais: "R2" }),
  subtotal: 50,
  frete: 22,
});
add({
  id: "rev-entrega-local-nao-confere-a-revisao",
  revisao: "R9",
  rpc: V24,
  opt: "local-delivery",
  pagamento: "pix",
  destino: CEP_LOCAL,
  subtotal: 50,
  frete: TAXA_LOCAL,
});
add({
  id: "rev-retirada-nao-confere-a-revisao",
  revisao: "R9",
  retirada: true,
  opt: "store-pickup",
  pagamento: "pix",
  destino: CEP_LOCAL,
  subtotal: 50,
  frete: 0,
});

// -- ESPELHO LEGADO (cotacao sem carimbo): transportadora, v24 --
const espelho = (id, { fsm, itens, subtotal, frete, normal = 50 }) =>
  add({
    id,
    fsm,
    normal,
    nacional: espelhoDe(fsm),
    itens,
    opt: "frenet-esp",
    cotacao: opcao("frenet-esp", 18),
    subtotal,
    frete,
  });
espelho("espelho-sem-limite-cobra-o-preco-da-cotacao", {
  fsm: 0,
  itens: UM_NORMAL,
  subtotal: 50,
  frete: 18,
});
espelho("espelho-sempre-0-01-zera-o-frete", {
  fsm: 0.01,
  itens: UM_NORMAL,
  subtotal: 50,
  frete: 0,
});
espelho("espelho-por-produto-item-marcado-zera", {
  fsm: -1,
  itens: UM_GRATIS,
  subtotal: 30,
  frete: 0,
});
espelho("espelho-por-produto-item-nao-marcado-cobra", {
  fsm: -1,
  itens: UM_NORMAL,
  subtotal: 50,
  frete: 18,
});
espelho("espelho-por-produto-um-item-marcado-no-meio-zera", {
  fsm: -1,
  itens: [
    { p: P_NORMAL, q: 1 },
    { p: P_GRATIS, q: 1 },
  ],
  subtotal: 80,
  frete: 0,
});
espelho("espelho-limite-150-subtotal-100-cobra", {
  fsm: 150,
  itens: normais(2),
  subtotal: 100,
  frete: 18,
});
espelho("espelho-limite-150-um-centavo-abaixo-cobra", {
  fsm: 150,
  normal: 49.99,
  itens: normais(3),
  subtotal: 149.97,
  frete: 18,
});
espelho("espelho-limite-150-exatamente-no-limite-zera", {
  fsm: 150,
  itens: normais(3),
  subtotal: 150,
  frete: 0,
});
espelho("espelho-limite-150-acima-zera", {
  fsm: 150,
  itens: normais(4),
  subtotal: 200,
  frete: 0,
});
add({
  id: "espelho-fora-do-espelho-cotacao-sem-carimbo-recusa",
  fsm: 0, // o espelho de fsm 0 e' "desligado"...
  nacional: SEMPRE, // ...mas a lojista ja escolheu outra coisa: cotacao sem carimbo nao prova que respeita a regra nova
  itens: UM_NORMAL,
  opt: "frenet-esp-fora",
  cotacao: opcao("frenet-esp-fora", 18),
  subtotal: 50,
  recusa: RECUSA_COTACAO,
});

// -- LOCAL (sentinelas de free_shipping_min), v24 e v23 --
const local = (id, { rpc, fsm, itens, subtotal, frete, normal = 50 }) =>
  add({
    id: `${rpc === V23 ? "local-v23" : "local"}-${id}`,
    rpc,
    fsm,
    normal,
    itens,
    opt: "local-delivery",
    pagamento: "pix",
    destino: CEP_LOCAL,
    subtotal,
    frete,
  });
for (const rpc of [V24, V23]) {
  local("sem-limite-cobra-a-taxa", {
    rpc,
    fsm: 0,
    itens: UM_NORMAL,
    subtotal: 50,
    frete: TAXA_LOCAL,
  });
  local("sempre-0-01-zera", {
    rpc,
    fsm: 0.01,
    itens: UM_NORMAL,
    subtotal: 50,
    frete: 0,
  });
  local("por-produto-item-marcado-zera", {
    rpc,
    fsm: -1,
    itens: UM_GRATIS,
    subtotal: 30,
    frete: 0,
  });
  local("por-produto-item-nao-marcado-cobra", {
    rpc,
    fsm: -1,
    itens: UM_NORMAL,
    subtotal: 50,
    frete: TAXA_LOCAL,
  });
  local("limite-150-subtotal-100-cobra", {
    rpc,
    fsm: 150,
    itens: normais(2),
    subtotal: 100,
    frete: TAXA_LOCAL,
  });
  local("limite-150-um-centavo-abaixo-cobra", {
    rpc,
    fsm: 150,
    normal: 49.99,
    itens: normais(3),
    subtotal: 149.97,
    frete: TAXA_LOCAL,
  });
  local("limite-150-exatamente-no-limite-zera", {
    rpc,
    fsm: 150,
    itens: normais(3),
    subtotal: 150,
    frete: 0,
  });
  local("limite-150-acima-zera", {
    rpc,
    fsm: 150,
    itens: normais(4),
    subtotal: 200,
    frete: 0,
  });
}

// -- CARIMBO da estrategia nacional (v24) --
const D15 = descontoPct(15);
add({
  id: "carimbo-igual-com-desconto-cobra-o-price-do-cache",
  nacional: D15,
  opt: "frenet-c1",
  cotacao: opcao("frenet-c1", 21.16, {
    precoCheio: 24.9,
    estrategiaNacional: carimbo(D15),
  }),
  subtotal: 50,
  frete: 21.16,
});
add({
  id: "carimbo-divergente-recusa",
  nacional: D15,
  opt: "frenet-c2",
  cotacao: opcao("frenet-c2", 22.41, {
    precoCheio: 24.9,
    estrategiaNacional: carimbo(descontoPct(10)),
  }),
  subtotal: 50,
  recusa: RECUSA_COTACAO,
});
add({
  id: "carimbo-json-null-recusa",
  nacional: SEMPRE,
  opt: "frenet-c5",
  cotacao: opcao("frenet-c5", 0, { precoCheio: 25, estrategiaNacional: null }),
  subtotal: 50,
  recusa: RECUSA_COTACAO,
});
add({
  id: "carimbo-objeto-vazio-recusa",
  nacional: SEMPRE,
  opt: "frenet-c6",
  cotacao: opcao("frenet-c6", 0, { precoCheio: 25, estrategiaNacional: {} }),
  subtotal: 50,
  recusa: RECUSA_COTACAO,
});
add({
  id: "carimbo-parcial-sem-alcance-recusa-mesmo-com-os-outros-quatro-batendo",
  nacional: SEMPRE,
  opt: "frenet-c7",
  cotacao: opcao("frenet-c7", 0, {
    precoCheio: 25,
    estrategiaNacional: {
      estrategia: "sempre",
      minimo: 0,
      tipoDesconto: null,
      valorDesconto: 0,
    },
  }),
  subtotal: 50,
  recusa: RECUSA_COTACAO,
});

// subtotal que cruzou o minimo entre cotar e pedir: acima_de_valor 199 e desconto_na_mais_barata 100
const A199 = acimaDe(199);
const D15_MIN100 = descontoPct(15, 100);
add({
  id: "carimbo-acima-de-valor-cotado-200-pedido-150-minimo-199-recusa",
  nacional: A199,
  normal: 37.5,
  itens: normais(4),
  opt: "frenet-c8",
  cotacao: opcao("frenet-c8", 0, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
    subtotalCotacao: 200,
  }),
  subtotal: 150,
  recusa: RECUSA_COTACAO,
});
add({
  id: "carimbo-acima-de-valor-cotado-150-pedido-210-minimo-199-recusa",
  nacional: A199,
  normal: 70,
  itens: normais(3),
  opt: "frenet-c9",
  cotacao: opcao("frenet-c9", 25, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
    subtotalCotacao: 150,
  }),
  subtotal: 210,
  recusa: RECUSA_COTACAO,
});
add({
  id: "carimbo-acima-de-valor-subtotal-mudou-mas-segue-do-mesmo-lado-aceita",
  nacional: A199,
  normal: 44,
  itens: normais(5),
  opt: "frenet-c10",
  cotacao: opcao("frenet-c10", 0, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
    subtotalCotacao: 250,
  }),
  subtotal: 220,
  frete: 0,
});
add({
  id: "carimbo-acima-de-valor-sem-o-subtotal-da-cotacao-recusa-fail-closed",
  nacional: A199,
  normal: 50,
  itens: normais(4),
  opt: "frenet-c10b",
  cotacao: opcao("frenet-c10b", 0, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
  }),
  subtotal: 200,
  recusa: RECUSA_COTACAO,
});
add({
  id: "carimbo-acima-de-valor-subtotal-igual-ao-minimo-nos-dois-lados-aceita",
  nacional: A199,
  normal: 199,
  itens: normais(1),
  opt: "frenet-c10c",
  cotacao: opcao("frenet-c10c", 0, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
    subtotalCotacao: 199,
  }),
  subtotal: 199,
  frete: 0,
});
add({
  id: "carimbo-desconto-com-minimo-subtotal-120-nos-dois-lados-aceita",
  nacional: D15_MIN100,
  normal: 60,
  itens: normais(2),
  opt: "frenet-c12",
  cotacao: opcao("frenet-c12", 21.16, {
    precoCheio: 24.9,
    estrategiaNacional: carimbo(D15_MIN100),
    subtotalCotacao: 120,
  }),
  subtotal: 120,
  frete: 21.16,
});
add({
  id: "carimbo-desconto-com-minimo-cotado-120-pedido-80-recusa",
  nacional: D15_MIN100,
  normal: 40,
  itens: normais(2),
  opt: "frenet-c13",
  cotacao: opcao("frenet-c13", 21.16, {
    precoCheio: 24.9,
    estrategiaNacional: carimbo(D15_MIN100),
    subtotalCotacao: 120,
  }),
  subtotal: 80,
  recusa: RECUSA_COTACAO,
});
add({
  id: "carimbo-duas-opcoes-na-mesma-cotacao-a-escolhida-cobra-o-price-proprio",
  nacional: D15,
  opt: "correios-c11-cheio",
  cotacao: [
    {
      id: "frenet-c11-desconto",
      price: 21.16,
      precoCheio: 24.9,
      estrategiaNacional: carimbo(D15),
    },
    {
      id: "correios-c11-cheio",
      price: 30,
      precoCheio: 30,
      estrategiaNacional: carimbo(D15),
    },
  ],
  subtotal: 50,
  frete: 30,
});

// -- LOCAL e NACIONAL nao vazam um para o outro (v24) --
add({
  id: "vazamento-local-gratis-e-nacional-desligado-o-nacional-cobra",
  fsm: 0.01,
  nacional: DESLIGADO,
  opt: "frenet-f1",
  cotacao: opcao("frenet-f1", 25, {
    precoCheio: 25,
    estrategiaNacional: carimbo(DESLIGADO),
  }),
  subtotal: 50,
  frete: 25,
});
add({
  id: "vazamento-local-gratis-e-nacional-desligado-o-local-zera",
  fsm: 0.01,
  nacional: DESLIGADO,
  opt: "local-delivery",
  pagamento: "pix",
  destino: CEP_LOCAL,
  subtotal: 50,
  frete: 0,
});
add({
  id: "vazamento-local-desligado-e-nacional-sempre-o-local-cobra-a-taxa",
  fsm: 0,
  nacional: SEMPRE,
  opt: "local-delivery",
  pagamento: "pix",
  destino: CEP_LOCAL,
  subtotal: 50,
  frete: TAXA_LOCAL,
});
add({
  id: "vazamento-local-desligado-e-nacional-sempre-o-nacional-zera",
  fsm: 0,
  nacional: SEMPRE,
  opt: "frenet-f2",
  cotacao: opcao("frenet-f2", 0, {
    precoCheio: 25,
    estrategiaNacional: carimbo(SEMPRE),
  }),
  subtotal: 50,
  frete: 0,
});

// -- PORTOES de CEP e free-shipping-promo (v24) --
add({
  id: "portao-id-nacional-com-cep-local-recusa",
  opt: "frenet-g1",
  destino: CEP_LOCAL,
  subtotal: 50,
  recusa: /^Opção de entrega inválida\./,
});
add({
  id: "portao-id-nacional-sem-cep-valido-recusa",
  opt: "frenet-g2",
  destino: "abc-xyz",
  subtotal: 50,
  recusa: /^Opção de entrega inválida\./,
});
add({
  id: "portao-endereco-da-conta-local-com-cep-distante-recusa",
  opt: "frenet-g3",
  cotacao: opcao("frenet-g3", 20, { estrategiaNacional: carimbo(DESLIGADO) }),
  enderecoId: ENDERECO_LOCAL,
  cepEndereco: CEP_NACIONAL,
  subtotal: 50,
  recusa: /^O frete foi cotado para outro CEP\./,
});
add({
  id: "portao-free-shipping-promo-sem-o-modo-por-produto-recusa",
  nacional: DESLIGADO,
  itens: UM_GRATIS,
  opt: "free-shipping-promo",
  subtotal: 30,
  recusa: /^Opção de entrega inválida\./,
});
add({
  id: "portao-free-shipping-promo-no-modo-por-produto-com-item-marcado-zera",
  nacional: POR_PRODUTO,
  itens: UM_GRATIS,
  opt: "free-shipping-promo",
  subtotal: 30,
  frete: 0,
});
add({
  id: "portao-free-shipping-promo-no-modo-por-produto-sem-item-marcado-recusa",
  nacional: POR_PRODUTO,
  itens: UM_NORMAL,
  opt: "free-shipping-promo",
  subtotal: 50,
  recusa: /^Opção de entrega inválida\./,
});
add({
  id: "portao-retirada-na-loja-segue-gratis",
  retirada: true,
  opt: "store-pickup",
  pagamento: "pix",
  destino: CEP_LOCAL,
  subtotal: 50,
  frete: 0,
});
add({
  id: "portao-v23-continua-recusando-transportadora",
  rpc: V23,
  pagamento: "cash",
  opt: "frenet-h3",
  subtotal: 50,
  recusa: /^Envio por transportadora exige pagamento antecipado\./,
});

assert.equal(
  new Set(CENARIOS.map((c) => c.id)).size,
  CENARIOS.length,
  "id de cenario repetido",
);

// ---- Executor --------------------------------------------------------------
/**
 * Roda UM cenario do estado base ate a verificacao. Devolve { ok, detalhe }: nunca lanca por falha da PROPRIA verificacao (assim os
 * controles podem pedir "este cenario tem de FALHAR"); so lanca para erro de montagem do teste.
 */
async function executar(c) {
  await estadoBase(c);
  if (c.cotacao) await gravarCotacao(c.destino, c.itens, c.cotacao);
  // Recusa: o total e' o que o pedido TERIA se a guarda deixasse passar (subtotal + price da opcao escolhida), para que um controle que
  // desligue a guarda veja o pedido NASCER e nao uma recusa por total errado.
  const precoEscolhido = c.cotacao?.find((o) => o.id === c.opt)?.price ?? 0;
  const total = c.subtotal + (c.recusa ? precoEscolhido : c.frete);
  const antes = await fotoDoBanco();

  let id = null;
  let erro = null;
  if (EM_TRANSACAO) await C.query("SAVEPOINT chamada");
  try {
    id = await chamarRpc(c.rpc, c, total);
  } catch (e) {
    erro = e;
    if (EM_TRANSACAO) await C.query("ROLLBACK TO SAVEPOINT chamada");
  }

  if (c.recusa) {
    if (erro === null)
      return { ok: false, detalhe: "o pedido NASCEU, mas devia ser recusado" };
    if (!c.recusa.test(erro.message))
      return {
        ok: false,
        detalhe: `recusou com outra mensagem: ${erro.message}`,
      };
    const depois = await fotoDoBanco();
    if (JSON.stringify(depois) !== JSON.stringify(antes))
      return {
        ok: false,
        detalhe: `a recusa deixou rastro: antes ${JSON.stringify(antes)}, depois ${JSON.stringify(depois)}`,
      };
    return { ok: true, detalhe: "recusado, nada gravado" };
  }

  if (erro !== null)
    return { ok: false, detalhe: `o pedido foi recusado: ${erro.message}` };
  const pedido = await lerPedido(id);
  if (centavos(pedido.shipping) !== centavos(c.frete))
    return {
      ok: false,
      detalhe: `frete gravado ${pedido.shipping}, esperado ${c.frete}`,
    };
  if (centavos(pedido.subtotal) !== centavos(c.subtotal))
    return {
      ok: false,
      detalhe: `subtotal gravado ${pedido.subtotal}, esperado ${c.subtotal}`,
    };
  if (centavos(pedido.total) !== centavos(total))
    return {
      ok: false,
      detalhe: `total gravado ${pedido.total}, esperado ${total}`,
    };
  return {
    ok: true,
    detalhe: `frete ${pedido.shipping}, total ${pedido.total}`,
  };
}

// ---- Controles: o corpo vivo das funcoes trocado, dentro de uma transacao que volta ----------------------------------------------
async function definicaoViva(fn) {
  const r = await C.query(
    "SELECT pg_get_functiondef(to_regprocedure($1)) AS d, md5(prosrc) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
    [`public.${fn}${ASSINATURA}`],
  );
  assert.equal(r.rows.length, 1, `${fn} nao existe no banco`);
  return r.rows[0];
}

/**
 * Troca o corpo de v23 e v24 por `transformar(definicao)`, roda os `alvos` (cada um num SAVEPOINT) e DESFAZ tudo. Devolve os
 * resultados. `esperarAncora` e o rotulo da ancora de texto: se o corpo vivo mudou e ela sumiu, o controle FALHA ALTO (e e' a hora de
 * atualizar a ancora aqui) em vez de passar calado sem mutar nada.
 */
async function comCorpoTrocado(rotulo, transformar, alvos) {
  const antes = [await definicaoViva(V23), await definicaoViva(V24)];
  const resultados = [];
  await C.query("BEGIN");
  EM_TRANSACAO = true;
  try {
    for (const [i, fn] of [V23, V24].entries()) {
      const mutada = transformar(antes[i].d);
      assert.notEqual(
        mutada,
        antes[i].d,
        `controle "${rotulo}": a ancora de texto nao existe mais no corpo VIVO de ${fn}. Se a funcao foi reescrita, atualize a ancora deste controle (a regra continua provada pelos cenarios normais).`,
      );
      await C.query(mutada);
    }
    for (const alvo of alvos) {
      await C.query("SAVEPOINT cenario");
      try {
        resultados.push({ alvo, ...(await executar(alvo)) });
      } finally {
        await C.query("ROLLBACK TO SAVEPOINT cenario");
      }
    }
  } finally {
    EM_TRANSACAO = false;
    await C.query("ROLLBACK");
  }
  const depois = [await definicaoViva(V23), await definicaoViva(V24)];
  assert.deepEqual(
    depois.map((d) => d.h),
    antes.map((d) => d.h),
    `controle "${rotulo}": o corpo original NAO voltou depois do ROLLBACK`,
  );
  return resultados;
}

// ---- Principal -------------------------------------------------------------
async function main() {
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  C.on("error", () => {});
  await C.connect();
  try {
    await garantirUsuarioEEndereco();

    const falhas = [];
    for (const c of CENARIOS) {
      const r = await executar(c);
      console.log(`${r.ok ? "PASS" : "FAIL"} ${c.id}: ${r.detalhe}`);
      if (!r.ok) falhas.push(`${c.id}: ${r.detalhe}`);
    }
    assert.deepEqual(
      falhas,
      [],
      `cenarios vermelhos:\n  ${falhas.join("\n  ")}`,
    );
    console.log(`PASS ${CENARIOS.length} cenarios do frete do pedido.`);

    // CONTROLE 1: toda recusa FRETE_COTACAO_DESATUALIZADA vira aviso -> cada cenario de recusa por cotacao velha tem de FALHAR.
    const recusasDeCotacao = CENARIOS.filter(
      (c) => c.recusa === RECUSA_COTACAO,
    );
    assert.ok(
      recusasDeCotacao.length >= 10,
      "poucos cenarios de recusa por cotacao velha",
    );
    const m1 = await comCorpoTrocado(
      "recusa vira aviso",
      (def) =>
        def.replaceAll(
          "RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA",
          "RAISE NOTICE 'FRETE_COTACAO_DESATUALIZADA",
        ),
      recusasDeCotacao,
    );
    for (const r of m1)
      console.log(`  controle 1 | ${r.alvo.id}: ${r.detalhe}`);
    // Mais forte que "ficou vermelho": sem a guarda o pedido tem de NASCER (nao pode ter caido por outro motivo, como total errado).
    const naoNasceu = m1
      .filter((r) => !r.detalhe.startsWith("o pedido NASCEU"))
      .map((r) => `${r.alvo.id} (${r.detalhe})`);
    assert.deepEqual(
      naoNasceu,
      [],
      `CONTROLE 1: sem a guarda o pedido devia nascer em todos: ${naoNasceu.join("; ")}`,
    );
    const mutanteNaoPegou = m1.filter((r) => r.ok).map((r) => r.alvo.id);
    assert.deepEqual(
      mutanteNaoPegou,
      [],
      `CONTROLE 1: com a recusa desligada estes cenarios continuaram verdes (nao enxergam a guarda): ${mutanteNaoPegou.join(", ")}`,
    );
    console.log(
      `PASS controle 1: sem a recusa, os ${m1.length} cenarios de cotacao velha ficam vermelhos (a guarda e o que os segura).`,
    );

    // CONTROLE 2: o limite ">=" vira ">" -> os cenarios do limite EXATO (transportadora e local, v24 e v23) tem de FALHAR.
    const noLimite = CENARIOS.filter((c) =>
      c.id.includes("exatamente-no-limite"),
    );
    assert.equal(
      noLimite.length,
      3,
      "esperava o limite exato em espelho, local (v24) e local (v23)",
    );
    const m2 = await comCorpoTrocado(
      "limite estrito",
      (def) =>
        def.replaceAll(
          "v_calculated_subtotal >= v_free_shipping_min",
          "v_calculated_subtotal > v_free_shipping_min",
        ),
      noLimite,
    );
    for (const r of m2)
      console.log(`  controle 2 | ${r.alvo.id}: ${r.detalhe}`);
    const limiteNaoPegou = m2.filter((r) => r.ok).map((r) => r.alvo.id);
    assert.deepEqual(
      limiteNaoPegou,
      [],
      `CONTROLE 2: com o limite estrito estes cenarios continuaram verdes: ${limiteNaoPegou.join(", ")}`,
    );
    console.log(
      `PASS controle 2: com o limite estrito, os ${m2.length} cenarios do limite exato ficam vermelhos.`,
    );

    // Depois dos controles o corpo verdadeiro responde de novo: um cenario de cada tipo, outra vez.
    for (const c of [CENARIOS[2], noLimite[0]]) {
      const r = await executar(c);
      assert.ok(r.ok, `depois dos controles ${c.id}: ${r.detalhe}`);
    }
    console.log("\nTODOS OS CENARIOS E CONTROLES DO FRETE DO PEDIDO PASSARAM.");
  } finally {
    await C.end().catch(() => {});
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
