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
 *  TOLERANCIA   o total que a cliente MANDA pode diferir do total que o servidor CALCULA em ate R$ 0,05 (a funcao recusa so com
 *               `ABS(calculado - enviado) > 0.05`): 0,00, 0,01, 0,02 e 0,05 (a borda) a favor e contra passam, 0,06 e recusado com
 *               "Os valores do pedido mudaram" sem gravar nada. O pedido que passa grava SEMPRE o total e o frete CALCULADOS (o price
 *               do cache), nunca o numero que veio do cliente: a tolerancia decide se recusa, nao quanto se cobra. Frete nacional
 *               (v24) e entrega local (v24 e v23).
 *  CUPOM        o CUPOM NAO entra no subtotal que decide o frete gratis: o limite (local, v24 e v23) e o minimo nacional olham o
 *               subtotal BRUTO. Bruto acima do limite e liquido (com o cupom) abaixo: o frete e gratis; bruto exatamente no limite:
 *               gratis; um centavo abaixo do limite: cobra. No nacional, a cotacao feita sobre o subtotal bruto (o que a edge e a
 *               tela fazem) vale; a cotada sobre o valor com cupom e recusada.
 *  FRETE        o frete enviado pelo cliente e' ignorado: o parametro `p_shipping_cost` nao e' lido em lugar nenhum do corpo vivo (v23 e
 *  ENVIADO      v24); o frete que o pedido grava e' o VALIDADO (o price da cotacao, a taxa da entrega local ou 0 na retirada) e o total e'
 *               o calculado pelo servidor. Com o total enviado coerente e `p_shipping_cost` ALTO (999,99), NEGATIVO (-50) e MENOR que
 *               o frete real (1,00), o pedido nasce com o frete validado e o total calculado: frete nacional cotado (simples, com
 *               desconto nacional e gratis), entrega local com taxa (v24 e v23) e retirada na loja (v24 e v23, frete 0 mesmo com 999,99,
 *               -50 ou 0,01 enviados). Antes so se provava contra 0.
 *  CONTROLES    a MESMA bateria, com o corpo vivo das duas funcoes trocado dentro de uma transacao que termina em ROLLBACK: (1) toda
 *               recusa FRETE_COTACAO_DESATUALIZADA vira aviso e cada cenario de recusa PASSA a deixar o pedido nascer; (2) o limite
 *               ">=" vira ">" e os cenarios do limite exato deixam de dar o frete certo; (3) a tolerancia do total vira ">=" (a borda
 *               de 0,05 passa a ser recusada), vira 0,01 (0,02 passa a ser recusado) e vira 0,10 (0,06 passa a nascer); (4) o cupom
 *               passa a entrar no subtotal do frete gratis e os cenarios do cupom perdem o frete certo; (5) o `>=` do minimo nacional
 *               no pedido vira `>` e os cenarios do minimo exato (a cotacao um centavo abaixo, ou nos dois lados) deixam de dar o
 *               resultado certo; (6) o servidor passa a gravar o frete do CLIENTE no INSERT do pedido (o total segue calculado): (A)
 *               `LEAST(v_shipping_validated, p_shipping_cost)`, o "frete do cliente quando menor que a cotacao", deixa vermelhos
 *               na assercao "frete gravado" so os cenarios com frete enviado menor que o validado (-50 e 1,00) e os de frete enviado
 *               maior seguem verdes; (B) `p_shipping_cost` puro deixa vermelhos TODOS os cenarios do frete enviado (999,99, -50, 1,00,
 *               0,01). Prova que os cenarios enxergam a regra e que a regra, e nao o acaso, e o que segura. O corpo original
 *               volta byte a byte depois de cada controle (hash do corpo conferido).
 *  MINIMO       o minimo nacional (acima_de_valor 199) a UM centavo, em cada lado: cotada no minimo e pedido com 198,99 recusa; cotada
 *               com 198,99 e pedido no minimo recusa (o subtotal cruzou o limite entre cotar e pedir).
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
const RECUSA_TOTAL = /^Os valores do pedido mudaram\./;
/** Um cupom por cenario (o pedido que o usa fica gravado e o cupom nao pode sumir debaixo dele). */
const codigoDoCupom = (c) => `PF-${c.id}`.toUpperCase();

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
async function estadoBase(c) {
  const { fsm, normal, gratis, nacional, revisao, retirada, cupom } = c;
  await C.query(
    "DELETE FROM public.store_shipping_credentials WHERE provider = '_revisao'",
  );
  if (cupom) {
    // Sem DELETE: um pedido de uma rodada anterior pode referenciar o cupom. Zera o uso e reaplica o desenho do cenario.
    const r = await C.query(
      `UPDATE public.coupons
          SET type = $2, value = $3, active = true, usage_count = 0, usage_limit = NULL, min_purchase = 0, valid_until = NULL
        WHERE code = $1`,
      [codigoDoCupom(c), cupom.tipo, cupom.valor],
    );
    if (r.rowCount === 0)
      await C.query(
        `INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit, min_purchase)
         VALUES ($1, $2, $3, true, 0, NULL, 0)`,
        [codigoDoCupom(c), cupom.tipo, cupom.valor],
      );
  }
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
      c.freteEnviado, // o `p_shipping_cost` que a cliente MANDA: a funcao o ignora (ver FRETE ENVIADO)
      c.pagamento,
      c.enderecoId ?? null,
      c.cupom ? codigoDoCupom(c) : null,
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
    "SELECT shipping, total, subtotal, discount FROM public.marketplace_orders WHERE id = $1",
    [id],
  );
  assert.equal(r.rows.length, 1, `pedido ${id} nao gravado`);
  return {
    shipping: num(r.rows[0].shipping),
    total: num(r.rows[0].total),
    subtotal: num(r.rows[0].subtotal),
    discount: num(r.rows[0].discount),
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
    cupom: null, // { tipo, valor }: o cupom que o pedido usa (um por cenario)
    desconto: 0, // o desconto que o servidor tem de calcular com esse cupom
    ajuste: 0, // centavos somados ao total que a cliente MANDA (o servidor calcula o dele sem olhar este numero)
    freteEnviado: 0, // `p_shipping_cost` que a cliente manda (a funcao o ignora); so os cenarios FRETE ENVIADO o variam
    freteDaCliente: false, // marca os cenarios que provam o `p_shipping_cost` ignorado (alvo dos mutantes do controle 6)
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

// -- TOLERANCIA do total: o servidor recusa so quando |calculado - enviado| > R$ 0,05 --
// Medido no corpo vivo (v23 e v24): `ABS(v_calculated_total - p_total_amount) > 0.05`. O numero e' numeric exato, sem ruido de ponto
// flutuante: 0,05 de diferenca PASSA (a borda) e 0,06 recusa. O que e' gravado e' o total CALCULADO, nunca o enviado.
const DIFERENCAS_ACEITAS = [0, 1, -1, 2, -2, 5, -5]; // centavos
const DIFERENCAS_RECUSADAS = [6, -6];
const nomeDaDiferenca = (d) =>
  d === 0 ? "igual" : `${d < 0 ? "menos" : "mais"}-0-0${Math.abs(d)}`;
for (const d of [...DIFERENCAS_ACEITAS, ...DIFERENCAS_RECUSADAS]) {
  const recusada = DIFERENCAS_RECUSADAS.includes(d);
  const desfecho = recusada ? { recusa: RECUSA_TOTAL } : {};
  const sufixo = `${nomeDaDiferenca(d)}-${recusada ? "recusa" : "aceita"}`;
  // Frete NACIONAL (v24): o price do cache (21,16, com 15% de desconto nacional) e' o que se cobra; o total enviado e' que varia.
  const D15_TOL = descontoPct(15);
  add({
    id: `tolerancia-nacional-total-enviado-${sufixo}`,
    nacional: D15_TOL,
    opt: `frenet-t-${nomeDaDiferenca(d)}`,
    cotacao: opcao(`frenet-t-${nomeDaDiferenca(d)}`, 21.16, {
      precoCheio: 24.9,
      estrategiaNacional: carimbo(D15_TOL),
    }),
    subtotal: 50,
    frete: 21.16,
    ajuste: d,
    ...desfecho,
  });
}
// Entrega local, nas duas portas, so nas pontas (a borda de 0,05 e o primeiro centavo de fora): a tolerancia e' a MESMA nas duas.
for (const rpc of [V24, V23]) {
  for (const d of [5, -5, 6, -6]) {
    const recusada = Math.abs(d) > 5;
    add({
      id: `tolerancia-${rpc === V23 ? "local-v23" : "local"}-total-enviado-${nomeDaDiferenca(d)}-${recusada ? "recusa" : "aceita"}`,
      rpc,
      opt: "local-delivery",
      pagamento: "pix",
      destino: CEP_LOCAL,
      subtotal: 50,
      frete: TAXA_LOCAL,
      ajuste: d,
      ...(recusada ? { recusa: RECUSA_TOTAL } : {}),
    });
  }
}

// -- FRETE ENVIADO: o `p_shipping_cost` que a cliente manda e' IGNORADO --
// Medido no corpo vivo (v23 e v24): o parametro `p_shipping_cost` NAO e' lido em lugar nenhum; o frete e' `v_shipping_validated` (o price
// da cotacao do cache, a taxa da entrega local ou 0 na retirada) e o total e' GREATEST(0, subtotal + frete - desconto). Aqui o total
// enviado e' COERENTE com o calculado (ajuste 0), entao o pedido nasce, e o que muda e' so o frete que a cliente diz pagar: ALTO
// (999,99, pagar demais), NEGATIVO (-50, abater o total) e MENOR que o frete real (1,00, pagar menos). Em todos o pedido grava o frete
// VALIDADO e o total calculado pelo servidor.
const FRETES_ENVIADOS = [
  ["alto-999-99", 999.99],
  ["negativo-menos-50", -50],
  ["menor-que-o-frete-1-00", 1],
];
const freteDaCliente = (id, base) =>
  add({
    ...base,
    id: `frete-enviado-${id}`,
    freteDaCliente: true,
  });
for (const [nome, enviado] of FRETES_ENVIADOS) {
  // (a) frete NACIONAL cotado (v24; a v23 recusa transportadora): cotacao simples de R$ 20 e cotacao com 15% de desconto (21,16).
  freteDaCliente(`nacional-cotado-${nome}`, {
    opt: "frenet-fe1",
    cotacao: opcao("frenet-fe1", 20),
    subtotal: 50,
    frete: 20,
    freteEnviado: enviado,
  });
  freteDaCliente(`nacional-com-desconto-${nome}`, {
    nacional: D15,
    opt: "frenet-fe2",
    cotacao: opcao("frenet-fe2", 21.16, {
      precoCheio: 24.9,
      estrategiaNacional: carimbo(D15),
    }),
    subtotal: 50,
    frete: 21.16,
    freteEnviado: enviado,
  });
  // (b) ENTREGA LOCAL com taxa (v24 e v23): o frete e' a taxa da loja (12,50).
  for (const rpc of [V24, V23])
    freteDaCliente(`local${rpc === V23 ? "-v23" : ""}-taxa-${nome}`, {
      rpc,
      opt: "local-delivery",
      pagamento: "pix",
      destino: CEP_LOCAL,
      subtotal: 50,
      frete: TAXA_LOCAL,
      freteEnviado: enviado,
    });
}
// (a) tambem com a cotacao que da frete GRATIS (price 0): o cliente manda 999,99 ou -50 e o pedido segue com frete 0.
for (const [nome, enviado] of FRETES_ENVIADOS.slice(0, 2))
  freteDaCliente(`nacional-gratis-${nome}`, {
    nacional: SEMPRE,
    opt: "frenet-fe3",
    cotacao: opcao("frenet-fe3", 0, {
      precoCheio: 25,
      estrategiaNacional: carimbo(SEMPRE),
    }),
    subtotal: 50,
    frete: 0,
    freteEnviado: enviado,
  });
// (c) RETIRADA na loja (v24 e v23): frete 0 sempre. "Menor que o frete" nao existe (o frete real e' 0): o terceiro valor e' 0,01 (maior).
for (const [nome, enviado] of [
  ["alto-999-99", 999.99],
  ["negativo-menos-50", -50],
  ["um-centavo-0-01", 0.01],
])
  for (const rpc of [V24, V23])
    freteDaCliente(`retirada${rpc === V23 ? "-v23" : ""}-${nome}`, {
      rpc,
      retirada: true,
      opt: "store-pickup",
      pagamento: "pix",
      destino: CEP_LOCAL,
      subtotal: 50,
      frete: 0,
      freteEnviado: enviado,
    });

// -- CUPOM: o frete gratis olha o subtotal BRUTO (antes do cupom), no local (v24 e v23) e no nacional (v24) --
// O desconto e' calculado DEPOIS do bloco do frete e so entra no total. Mesma leitura da edge (`subtotalDoCarrinho` nao conhece cupom)
// e da tela (ShippingCalculator soma preco x quantidade): os tres concordam, entao a cliente ve o frete que o servidor cobra.
const CUPOM_10 = { tipo: "percentage", valor: 10 };
for (const rpc of [V24, V23]) {
  const v = rpc === V23 ? "-v23" : "";
  const baseLocal = {
    rpc,
    normal: 100,
    itens: normais(2), // bruto 200, cupom de 10% = 20, liquido 180
    opt: "local-delivery",
    pagamento: "pix",
    destino: CEP_LOCAL,
    subtotal: 200,
    cupom: CUPOM_10,
    desconto: 20,
  };
  add({
    ...baseLocal,
    id: `cupom-local${v}-bruto-acima-do-minimo-e-liquido-abaixo-o-frete-e-gratis`,
    fsm: 190, // bruto 200 >= 190; liquido 180 < 190
    frete: 0,
    cupomDecide: true,
  });
  add({
    ...baseLocal,
    id: `cupom-local${v}-bruto-exatamente-no-minimo-o-frete-e-gratis`,
    fsm: 200, // bruto 200 = 200; liquido 180 < 200
    frete: 0,
    cupomDecide: true,
  });
  add({
    ...baseLocal,
    id: `cupom-local${v}-bruto-um-centavo-abaixo-do-minimo-cobra-a-taxa`,
    fsm: 200.01, // bruto 200 < 200,01: o cupom nao muda este lado
    frete: TAXA_LOCAL,
  });
}
// Nacional (acima_de_valor, minimo 199): bruto 200, liquido 180.
add({
  id: "cupom-nacional-bruto-200-liquido-180-minimo-199-cotado-no-bruto-o-frete-e-gratis",
  nacional: A199,
  normal: 100,
  itens: normais(2),
  opt: "frenet-cp1",
  cotacao: opcao("frenet-cp1", 0, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
    subtotalCotacao: 200, // o que a edge grava: o subtotal bruto do carrinho
  }),
  cupom: CUPOM_10,
  desconto: 20,
  subtotal: 200,
  frete: 0,
  cupomDecide: true,
});
add({
  id: "cupom-nacional-bruto-200-liquido-180-minimo-199-cotado-no-liquido-recusa",
  nacional: A199,
  normal: 100,
  itens: normais(2),
  opt: "frenet-cp2",
  cotacao: opcao("frenet-cp2", 25, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
    subtotalCotacao: 180, // cotada sobre o valor com cupom: o servidor olha o bruto (200 >= 199) e ve o outro lado
  }),
  cupom: CUPOM_10,
  desconto: 20,
  subtotal: 200,
  recusa: RECUSA_COTACAO,
  cupomDecide: true,
});
add({
  id: "cupom-nacional-bruto-180-abaixo-do-minimo-199-cobra-o-price-da-cotacao",
  nacional: A199,
  normal: 90,
  itens: normais(2),
  opt: "frenet-cp3",
  cotacao: opcao("frenet-cp3", 25, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
    subtotalCotacao: 180,
  }),
  cupom: CUPOM_10,
  desconto: 18,
  subtotal: 180,
  frete: 25,
});

// -- Minimo NACIONAL (acima_de_valor 199) a UM CENTAVO, para cada lado: o `>=` do pedido contra o `>=` da cotacao --
add({
  id: "carimbo-acima-de-valor-cotado-199-pedido-198-99-recusa",
  nacional: A199,
  normal: 198.99,
  itens: normais(1),
  opt: "frenet-cm1",
  cotacao: opcao("frenet-cm1", 0, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
    subtotalCotacao: 199, // atingia o minimo (gratis); o pedido ficou um centavo abaixo
  }),
  subtotal: 198.99,
  recusa: RECUSA_COTACAO,
});
add({
  id: "carimbo-acima-de-valor-cotado-198-99-pedido-199-recusa",
  nacional: A199,
  normal: 199,
  itens: normais(1),
  opt: "frenet-cm2",
  cotacao: opcao("frenet-cm2", 25, {
    precoCheio: 25,
    estrategiaNacional: carimbo(A199),
    subtotalCotacao: 198.99, // nao atingia (cobrava 25); o pedido chegou no minimo
  }),
  subtotal: 199,
  recusa: RECUSA_COTACAO,
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
  // `totalCalculado` e' o que o servidor tem de gravar; `total` e' o que a cliente manda (o mesmo, mais o `ajuste` em centavos).
  const totalCalculado = c.subtotal - c.desconto + (c.frete ?? precoEscolhido);
  const total = (centavos(totalCalculado) + c.ajuste) / 100;
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
  if (centavos(pedido.discount) !== centavos(c.desconto))
    return {
      ok: false,
      detalhe: `desconto gravado ${pedido.discount}, esperado ${c.desconto}`,
    };
  // O total gravado e' o CALCULADO, nunca o que veio da cliente (que pode diferir em ate R$ 0,05).
  if (centavos(pedido.total) !== centavos(totalCalculado))
    return {
      ok: false,
      detalhe: `total gravado ${pedido.total}, esperado ${totalCalculado} (a cliente mandou ${total})`,
    };
  return {
    ok: true,
    detalhe: `frete ${pedido.shipping}, total ${pedido.total}, desconto ${pedido.discount} (cliente mandou ${total})`,
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

/**
 * Troca `de` por `para` em TODAS as ocorrencias, mas so se houver exatamente `vezes` delas: o controle FALHA ALTO quando a ancora some
 * ou aparece onde nao devia (a funcao foi reescrita), em vez de passar calado sem mutar o que prometia mutar.
 */
function trocarExato(def, de, para, vezes) {
  const achadas = def.split(de).length - 1;
  assert.equal(
    achadas,
    vezes,
    `a ancora "${de.slice(0, 70)}" aparece ${achadas} vez(es) no corpo VIVO, esperava ${vezes}. Se a funcao foi reescrita, atualize a ancora deste controle.`,
  );
  return def.replaceAll(de, para);
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

    // CONTROLE 3: a TOLERANCIA do total. Tres mutantes do mesmo predicado, cada um contra os cenarios que so ele pode derrubar.
    const TOLERANCIA = "ABS(v_calculated_total - p_total_amount) > 0.05";
    const aceitasNaBorda = CENARIOS.filter(
      (c) => !c.recusa && Math.abs(c.ajuste) === 5,
    );
    const aceitasForaDe1Centavo = CENARIOS.filter(
      (c) => !c.recusa && Math.abs(c.ajuste) >= 2,
    );
    const recusadasPorTotal = CENARIOS.filter((c) => c.recusa === RECUSA_TOTAL);
    // O conjunto tem de existir de verdade, nas duas portas (v23 e v24): sem isto o mutante rodaria contra a lista vazia.
    assert.ok(
      aceitasNaBorda.length === 6 && recusadasPorTotal.length === 6,
      "poucos cenarios de tolerancia do total",
    );
    for (const [rotulo, novo, alvos, esperado] of [
      [
        "tolerancia estrita (>= 0.05)",
        "ABS(v_calculated_total - p_total_amount) >= 0.05",
        aceitasNaBorda,
        "o pedido foi recusado",
      ],
      [
        "tolerancia de 1 centavo (> 0.01)",
        "ABS(v_calculated_total - p_total_amount) > 0.01",
        aceitasForaDe1Centavo,
        "o pedido foi recusado",
      ],
      [
        "tolerancia de 10 centavos (> 0.10)",
        "ABS(v_calculated_total - p_total_amount) > 0.10",
        recusadasPorTotal,
        "o pedido NASCEU",
      ],
    ]) {
      const m3 = await comCorpoTrocado(
        rotulo,
        (def) => trocarExato(def, TOLERANCIA, novo, 1),
        alvos,
      );
      for (const r of m3)
        console.log(`  controle 3 (${rotulo}) | ${r.alvo.id}: ${r.detalhe}`);
      const naoPegou = m3.filter((r) => r.ok).map((r) => r.alvo.id);
      assert.deepEqual(
        naoPegou,
        [],
        `CONTROLE 3 (${rotulo}): estes cenarios continuaram verdes: ${naoPegou.join(", ")}`,
      );
      const motivoErrado = m3
        .filter((r) => !r.detalhe.startsWith(esperado))
        .map((r) => `${r.alvo.id} (${r.detalhe})`);
      assert.deepEqual(
        motivoErrado,
        [],
        `CONTROLE 3 (${rotulo}): ficaram vermelhos por outro motivo que nao "${esperado}": ${motivoErrado.join("; ")}`,
      );
      console.log(
        `PASS controle 3 (${rotulo}): os ${m3.length} cenarios da tolerancia ficam vermelhos.`,
      );
    }

    // CONTROLE 4: o CUPOM passa a entrar no subtotal que decide o frete gratis (local e nacional). Os cenarios que dependem de o
    // subtotal ser o BRUTO tem de ficar vermelhos; os que nao dependem (cobra dos dois jeitos) seguem verdes, o que mostra que o
    // mutante mexe so no que devia.
    const LIQUIDO_DO_CUPOM =
      "(v_calculated_subtotal - LEAST(v_calculated_subtotal, COALESCE((SELECT CASE WHEN cp.type = 'percentage' THEN round((v_calculated_subtotal * cp.value) / 100, 2) ELSE cp.value END FROM public.coupons cp WHERE UPPER(cp.code) = UPPER(p_coupon_code) AND cp.active = true), 0)))";
    const cupomDecide = CENARIOS.filter((c) => c.cupomDecide);
    const cupomNaoDecide = CENARIOS.filter((c) => c.cupom && !c.cupomDecide);
    assert.ok(
      cupomDecide.length >= 6 && cupomNaoDecide.length >= 3,
      "poucos cenarios de cupom",
    );
    const m4 = await comCorpoTrocado(
      "cupom entra no subtotal do frete",
      (def) =>
        trocarExato(
          trocarExato(
            def,
            "v_calculated_subtotal >= v_free_shipping_min",
            `${LIQUIDO_DO_CUPOM} >= v_free_shipping_min`,
            2,
          ),
          "(v_calculated_subtotal >= v_store_config.national_shipping_min)",
          `(${LIQUIDO_DO_CUPOM} >= v_store_config.national_shipping_min)`,
          1,
        ),
      [...cupomDecide, ...cupomNaoDecide],
    );
    for (const r of m4)
      console.log(`  controle 4 | ${r.alvo.id}: ${r.detalhe}`);
    const cupomNaoPegou = m4
      .filter((r) => r.alvo.cupomDecide && r.ok)
      .map((r) => r.alvo.id);
    assert.deepEqual(
      cupomNaoPegou,
      [],
      `CONTROLE 4: com o cupom no subtotal do frete estes cenarios continuaram verdes (nao enxergam o subtotal bruto): ${cupomNaoPegou.join(", ")}`,
    );
    const cupomMexeuDemais = m4
      .filter((r) => !r.alvo.cupomDecide && !r.ok)
      .map((r) => `${r.alvo.id} (${r.detalhe})`);
    assert.deepEqual(
      cupomMexeuDemais,
      [],
      `CONTROLE 4: o mutante derrubou cenario que nao depende do subtotal do frete: ${cupomMexeuDemais.join("; ")}`,
    );
    console.log(
      `PASS controle 4: com o cupom no subtotal do frete, os ${cupomDecide.length} cenarios do subtotal bruto ficam vermelhos e os ${cupomNaoDecide.length} que cobram dos dois jeitos seguem verdes.`,
    );

    // CONTROLE 5: o `>=` do minimo NACIONAL (subtotal do pedido contra o minimo, no pedido) vira `>`. Quem enxerga e' o cenario em que
    // o pedido cai EXATAMENTE no minimo e a cotacao tinha ficado um centavo abaixo (o pedido passa a ver o mesmo lado e aceita), e o
    // do minimo exato nos dois lados (so o pedido muda de lado e passa a ser recusado).
    const noMinimoNacional = CENARIOS.filter(
      (c) =>
        c.id ===
          "carimbo-acima-de-valor-subtotal-igual-ao-minimo-nos-dois-lados-aceita" ||
        c.id === "carimbo-acima-de-valor-cotado-198-99-pedido-199-recusa",
    );
    assert.equal(noMinimoNacional.length, 2, "esperava 2 cenarios do minimo");
    const m5 = await comCorpoTrocado(
      "minimo nacional estrito",
      (def) =>
        trocarExato(
          def,
          "(v_calculated_subtotal >= v_store_config.national_shipping_min)",
          "(v_calculated_subtotal > v_store_config.national_shipping_min)",
          1,
        ),
      noMinimoNacional,
    );
    for (const r of m5)
      console.log(`  controle 5 | ${r.alvo.id}: ${r.detalhe}`);
    const minimoNaoPegou = m5.filter((r) => r.ok).map((r) => r.alvo.id);
    assert.deepEqual(
      minimoNaoPegou,
      [],
      `CONTROLE 5: com o minimo nacional estrito estes cenarios continuaram verdes: ${minimoNaoPegou.join(", ")}`,
    );
    console.log(
      `PASS controle 5: com o minimo nacional estrito, os ${m5.length} cenarios do minimo exato ficam vermelhos.`,
    );

    // CONTROLE 6: o servidor passa a CONFIAR no frete que a cliente manda, so na gravacao do pedido (o total segue calculado). Dois
    // mutantes do mesmo INSERT: (A) `LEAST(v_shipping_validated, p_shipping_cost)` ("usa o frete do cliente quando menor que a
    // cotacao") e (B) `p_shipping_cost` puro. Cada um tem de derrubar exatamente os cenarios em que o frete enviado difere do validado
    // do lado que ele mexe, na assercao "frete gravado", e deixar VERDES os demais (o mutante mexe so no que devia).
    const GRAVA_O_FRETE =
      "v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id,";
    const doCliente = CENARIOS.filter((c) => c.freteDaCliente);
    assert.ok(
      doCliente.length === 20 &&
        doCliente.some((c) => c.freteEnviado > 100) &&
        doCliente.some((c) => c.freteEnviado < 0) &&
        doCliente.some((c) => c.freteEnviado > 0 && c.freteEnviado < c.frete) &&
        doCliente.some((c) => c.retirada) &&
        doCliente.some((c) => c.rpc === V23),
      "faltam cenarios do frete enviado (alto, negativo, menor que a cotacao; nacional, local e retirada; v24 e v23)",
    );
    // (A) so mexe quando o frete enviado e MENOR que o validado: os cenarios com frete enviado maior seguem verdes (minimo 4 deles).
    // (B) mexe em todos: nenhum cenario tem o frete enviado igual ao validado, entao nenhum verde.
    for (const [rotulo, novaGravacao, devemFicarVermelhos, minVerdes] of [
      [
        "frete do cliente quando menor que a cotacao",
        GRAVA_O_FRETE.replace(
          "v_shipping_validated",
          "LEAST(v_shipping_validated, p_shipping_cost)",
        ),
        (c) => c.freteEnviado < c.frete,
        4,
      ],
      [
        "frete do cliente sempre",
        GRAVA_O_FRETE.replace("v_shipping_validated", "p_shipping_cost"),
        (c) => centavos(c.freteEnviado) !== centavos(c.frete),
        0,
      ],
    ]) {
      const m6 = await comCorpoTrocado(
        rotulo,
        (def) => trocarExato(def, GRAVA_O_FRETE, novaGravacao, 1),
        doCliente,
      );
      for (const r of m6)
        console.log(`  controle 6 (${rotulo}) | ${r.alvo.id}: ${r.detalhe}`);
      const esperadosVermelhos = m6.filter((r) => devemFicarVermelhos(r.alvo));
      const esperadosVerdes = m6.filter((r) => !devemFicarVermelhos(r.alvo));
      assert.ok(
        esperadosVermelhos.length >= 6 && esperadosVerdes.length >= minVerdes,
        `CONTROLE 6 (${rotulo}): o mutante precisa ter alvo vermelho (>= 6) e verde (>= ${minVerdes})`,
      );
      const naoPegou = esperadosVermelhos
        .filter((r) => r.ok)
        .map((r) => r.alvo.id);
      assert.deepEqual(
        naoPegou,
        [],
        `CONTROLE 6 (${rotulo}): estes cenarios continuaram verdes (nao enxergam o frete gravado): ${naoPegou.join(", ")}`,
      );
      // Na asserção CERTA: o frete gravado diverge do validado (e nao outro motivo, como o pedido recusado).
      const motivoErrado = esperadosVermelhos
        .filter((r) => !r.detalhe.startsWith("frete gravado"))
        .map((r) => `${r.alvo.id} (${r.detalhe})`);
      assert.deepEqual(
        motivoErrado,
        [],
        `CONTROLE 6 (${rotulo}): ficaram vermelhos por outro motivo que nao "frete gravado": ${motivoErrado.join("; ")}`,
      );
      const mexeuDemais = esperadosVerdes
        .filter((r) => !r.ok)
        .map((r) => `${r.alvo.id} (${r.detalhe})`);
      assert.deepEqual(
        mexeuDemais,
        [],
        `CONTROLE 6 (${rotulo}): o mutante derrubou cenario em que o frete enviado nao o altera: ${mexeuDemais.join("; ")}`,
      );
      console.log(
        `PASS controle 6 (${rotulo}): ${esperadosVermelhos.length} cenarios ficam vermelhos em "frete gravado" e os ${esperadosVerdes.length} em que o frete enviado nao muda nada seguem verdes.`,
      );
    }

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
