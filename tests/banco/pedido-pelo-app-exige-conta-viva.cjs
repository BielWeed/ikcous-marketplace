"use strict";

/**
 * Prova VIVA da migration 20261384000000 (o pedido pago pelo app exige conta e nao prende o estoque de visitante: a
 * `create_marketplace_order_v24` recusa `p_payment_method = 'online'` quando NAO ha sessao — auth.uid() nulo —, ANTES de
 * ler carrinho, trancar linha, inserir pedido, baixar estoque ou gastar cupom; dinheiro + estoque; decisao do dono de
 * 16/08/2026 "pagar pelo site/app exige conta"), num Postgres EFEMERO local, sem rede, com os papeis de verdade
 * (anon, authenticated, service_role).
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore ja tem a 20261384 (em CI ela tem), TODO caso
 * comeca pelo estado ANTES (o corpo da 20261350, instalado por CREATE OR REPLACE direto) ou pelo estado DEPOIS (a
 * propria migration). Cada caso roda numa transacao que termina em ROLLBACK (exceto a CONCORRENCIA, que usa conexoes
 * reais e dados commitados no clone descartavel).
 *
 *  ANTES      controle: pelo caminho do pagamento pelo app ('online', v24) a visitante SEM conta cria o pedido e o estoque
 *             BAIXA (produto simples e com variacao) — o defeito; repetido, esgota o produto.
 *  DEPOIS     (a) anon + online recusa (P0001, a frase certa, o identificador no DETAIL), em varias formas (entrega local,
 *             retirada, com e sem chave de idempotencia, com cupom, produto simples e com variacao, service_role), e
 *             NADA e' reservado nem gasto — provado por uma SEQUENCIA movida por gatilhos (que o rollback nao desfaz) no
 *             INSERT do pedido, na baixa do estoque (produto e variacao) e no uso do cupom; 30 chamadas seguidas deixam o
 *             estoque intacto; (b) quem tem conta (authenticated) + online nasce como hoje (pending, aguardando, prazo,
 *             estoque, cupom); (c) anon + pagar na entrega/retirada (pix/card/cash, v23 e v24 direto) nasce como hoje, e o
 *             logado tambem; (d) o RETRY de um pedido que ja existe (mesma chave) continua devolvendo o MESMO pedido, para
 *             o convidado e para o logado, sem recusa e sem mexer em nada (pedido criado pelo corpo ANTIGO, o legado), e
 *             chave nova do convidado recusa; (e) a ORDEM das recusas: loja com o pagamento pelo app desligado mantem a
 *             frase dela; produto inexistente, total adulterado e CEP fora da faixa recebem a recusa NOVA (ela vem antes
 *             da leitura do carrinho e dos portoes de entrega).
 *  CONCORRENCIA  duas conexoes reais: o retry do convidado ESPERA o primeiro envio (advisory lock da chave) e devolve o
 *             MESMO pedido quando ele conclui; se o primeiro desiste (ROLLBACK), o convidado recebe a recusa e nada
 *             existe; a recusa nao toca a linha do produto (uma sessao que a segura nao bloqueia o convidado, e bloqueia o
 *             controle autenticado).
 *  INTACTO    o corpo novo e' o antigo mais UM bloco (byte a byte); o mesmo roteiro de compras que passam grava linhas
 *             identicas antes e depois; so o corpo da v24 muda (v23, ACL, oid, atributos, dados, outras funcoes); pedido
 *             legado nao e' tocado pela migration (md5 das tabelas).
 *  MUTANTES   sem a trava; a trava DEPOIS de reservar; ANTES do passo 0; ANTES do 0-bis; so antes do INSERT; para todo meio
 *             de pagamento; so quem nao manda chave: cada um deixa a verificacao certa VERMELHA.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve o `prosrc` IDENTICO (md5 e sha256 do corpo da
 *             20261350) e a mesma ACL, e o segundo rollback recusa; o pre-voo recusa SEM escrever (corpo desconhecido,
 *             corpo da 20261244, atributo, sobrecarga, funcao ausente, ACL aberta, papel sem EXECUTE); o pos-voo reprovando
 *             desfaz a troca (conexao sem BEGIN); consultas 89a/89b e as que aceitam o corpo novo (31a, 37a, 47a, 81a).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/pedido-pelo-app-exige-conta-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations e as consultas), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(RAIZ, "supabase", "migrations");
const CONSULTAS = path.join(RAIZ, "scripts", "publicacao", "consultas");
const ARQ =
  "20261384000000_o_pedido_pelo_app_exige_conta_e_nao_prende_estoque_de_visitante.sql";
const norm = (s) => s.replace(/\r\n/g, "\n");
const ler = (nome) =>
  norm(fs.readFileSync(path.join(MIGRATIONS, nome), "utf8"));
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, nome), "utf8");
const MIGRATION = ler(ARQ);
const ROLLBACK = ler(`rollback-manual-${ARQ}`);
const SRC_350 = ler(
  "20261350000000_a_compra_online_trava_o_preco_e_espera_a_mesma_chave.sql",
);
const SRC_244 = ler("20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql");
const A89 = lerConsulta(
  "89a-conferir-o-pedido-pelo-app-exige-conta-aplicado.sql",
);
const B89 = lerConsulta(
  "89b-antes-o-pedido-pelo-app-exige-conta-base-vigente.sql",
);
const CONFERIR_BANCO = fs.readFileSync(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
  "utf8",
);
const CONSULTAS_QUE_ACEITAM = [
  "31a-conferir-endereco-da-compra-fica-no-pedido.sql",
  "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado.sql",
  "47a-conferir-a-loja-escolhe-como-entrega-aplicado.sql",
  "81a-conferir-compra-online-trava-preco-e-chave-aplicado.sql",
].map((n) => ({ n, sql: lerConsulta(n) }));
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const ASSINATURA =
  "(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)";
const FN = new Map([
  [V23, `public.${V23}${ASSINATURA}`],
  [V24, `public.${V24}${ASSINATURA}`],
]);

/** Do `CREATE OR REPLACE FUNCTION public.<fn>(` ao `$function$;`: { cabeca (ate o `AS $function$`), corpo }. */
function funcaoDe(sql, fn) {
  const delim = "$function$";
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `declaracao de ${fn} nao achada`);
  const ab = sql.indexOf(delim, ini);
  const corpoIni = ab + delim.length;
  const fim = sql.indexOf(delim, corpoIni);
  return { cabeca: sql.slice(ini, corpoIni), corpo: sql.slice(corpoIni, fim) };
}
const decl = (f, corpo = f.corpo) => `${f.cabeca + corpo}$function$;`;

// O corpo ANTIGO e' o da 20261350, LIDO DO ARQUIVO, nunca copiado para ca.
const ANTIGA = funcaoDe(SRC_350, V24);
const ANTIGA_244 = funcaoDe(SRC_244, V24);
const NOVA = funcaoDe(MIGRATION, V24);
const ROLL = funcaoDe(ROLLBACK, V24);
const H_ANTIGO = "e3c124d25632aaa9bcf1995153bc5a7e";
const H_NOVO = "f8d6ed0c3622ab41123bacb98911a98f";
assert.equal(md5(ANTIGA.corpo), H_ANTIGO, "o corpo da 20261350 mudou");
// MODO MUTANTE DE ARQUIVO (PROVA_ARQUIVO_MUTADO=1): quem edita o ARQUIVO da migration para sabotar o corpo roda
// so a prova de COMPORTAMENTO (a que fica vermelha pelo que o corpo faz), sem as travas de hash e de bytes que
// reprovariam a edicao antes de qualquer comportamento ser medido; o corpo sabotado entra por CREATE OR REPLACE
// (o pre-voo e a conferencia da migration, que exigem o hash certo, ficam de fora). Nunca roda em CI.
const MUTADO = process.env.PROVA_ARQUIVO_MUTADO === "1";
if (!MUTADO) assert.equal(md5(NOVA.corpo), H_NOVO, "o corpo da 20261384 mudou");
assert.equal(
  ROLL.corpo,
  ANTIGA.corpo,
  "o rollback nao e o corpo da 20261350 byte a byte",
);
assert.equal(ROLL.cabeca, ANTIGA.cabeca, "a declaracao do rollback mudou");
assert.equal(
  NOVA.cabeca,
  ANTIGA.cabeca,
  "a declaracao mudou (assinatura, atributos)",
);

// O corpo NOVO = o antigo + UM bloco (0-ter), antes do passo 1, e mais nada.
const ANCORA_PASSO_1 =
  "    -- 1. Address Ownership Check (Only if user is logged in)\n";
const ANCORA_PASSO_0 =
  "    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO (laudo caça-bugs do molde, 31/08/2026, A1):\n";
const ANCORA_0_BIS =
  "    -- 0-bis. FORMA DE PAGAMENTO DESLIGADA NA LOJA (formas de pagamento por\n";
const ANCORA_PASSO_7 = "    -- 7. Create Order Header\n";
const FIM_DA_FUNCAO = "\n    RETURN v_order_id;\nEND;\n";
const COND = "IF p_payment_method = 'online' AND v_user_id IS NULL THEN";
let BLOCO = "";
if (!MUTADO) {
  const iniBloco = NOVA.corpo.indexOf("    -- 0-ter.");
  assert.ok(iniBloco > 0, "o bloco 0-ter nao esta no corpo novo");
  BLOCO = NOVA.corpo.slice(iniBloco, NOVA.corpo.indexOf(ANCORA_PASSO_1));
  assert.equal(ANTIGA.corpo.split(ANCORA_PASSO_1).length - 1, 1);
  assert.equal(
    ANTIGA.corpo.replace(ANCORA_PASSO_1, () => BLOCO + ANCORA_PASSO_1),
    NOVA.corpo,
    "o corpo novo nao e o antigo mais o bloco 0-ter, byte a byte",
  );
  assert.equal(
    NOVA.corpo.split(COND).length - 1,
    1,
    "a condicao aparece 1 vez",
  );
  for (const [rotulo, ancora] of [
    ["passo 0", ANCORA_PASSO_0],
    ["0-bis", ANCORA_0_BIS],
    ["passo 7", ANCORA_PASSO_7],
    ["fim da funcao", FIM_DA_FUNCAO],
  ])
    assert.equal(
      ANTIGA.corpo.split(ancora).length - 1,
      1,
      `ancora do ${rotulo} nao e unica`,
    );
}

/** O estado DEPOIS: a migration inteira (pre-voo, troca e conferencia) ou, no modo mutante, so o corpo do arquivo. */
// A 20261394000000 (o pedido de visitante na entrega tem freio) sucede o corpo da v24 desta migration e tambem a v23 da 350: este
// clone parte da arvore inteira, entao ela cai antes de qualquer instalacao (no-op se nao estiver no ar; sempre dentro de BEGIN).
// Ver o-pedido-de-visitante-na-entrega-posterior.cjs.
const semOFreioDe394 = () =>
  require("./o-pedido-de-visitante-na-entrega-posterior.cjs").desfazerPedidoDeVisitanteTemFreioNaTransacao(
    C,
  );
const instalarNova = async () => {
  await semOFreioDe394();
  return C.query(MUTADO ? decl(NOVA, NOVA.corpo) : MIGRATION);
};
/** O estado ANTES: o corpo da 20261350 (CREATE OR REPLACE direto; vale como o rollback, sem depender do pre-voo). */
const instalarAntiga = async () => {
  await semOFreioDe394();
  return C.query(decl(ANTIGA, ANTIGA.corpo));
};

const FRASE =
  "Para pagar pelo app é preciso entrar na sua conta. Sem conta, escolha pagar na retirada ou na entrega.";
const FRASE_0_BIS =
  "Esta forma de pagamento não está disponível nesta loja. Escolha outra.";
const IDENTIFICADOR = "pedido_pelo_app_exige_conta";
const ACL_DE_SEMPRE = [
  "anon=X/postgres",
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];

const U = {
  cliente: "7e7e2384-0000-4000-8000-0000000000d1",
  outro: "7e7e2384-0000-4000-8000-0000000000d2",
};
const PROD = "7e7e2384-0000-4000-8000-0000000000f0";
const PROD_VAR = "7e7e2384-0000-4000-8000-0000000000f1";
const VAR = "7e7e2384-0000-4000-8000-0000000000f2";
const DIGITADO = {
  cep: "38500-120",
  street: "Rua Digitada",
  number: "5",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
};
const FORA_DA_CIDADE = { ...DIGITADO, cep: "01310-100" };
const CEP_LOCAL = "38500-100";

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashVivo = async (fn) =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN.get(fn)],
    )
  ).rows[0]?.h;
const prosrcVivo = async (fn) =>
  (
    await C.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN.get(fn)],
    )
  ).rows[0]?.prosrc;
const oidVivo = async (fn) =>
  (await C.query("SELECT to_regprocedure($1)::oid::text AS o", [FN.get(fn)]))
    .rows[0].o;
const aclBruto = async (fn) =>
  (
    await C.query(
      "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN.get(fn)],
    )
  ).rows[0]?.a;
async function acl(fn) {
  const r = await C.query(
    `SELECT coalesce(array_agg(x::text ORDER BY x::text), '{}') AS a
       FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) AS x
      WHERE p.oid = to_regprocedure($1)`,
    [FN.get(fn)],
  );
  return r.rows[0].a;
}

/** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

/** Uma transacao por caso, sempre desfeita, ja no estado pedido: "antes" (corpo da 350) ou "depois" (migration). */
async function emTransacao(fn, { estado = "antes" } = {}) {
  await C.query("BEGIN");
  try {
    if (estado === "antes") {
      await instalarAntiga();
      assert.equal(await hashVivo(V24), H_ANTIGO, "o estado ANTES nao montou");
    } else if (estado === "depois") {
      await instalarAntiga();
      await instalarNova();
      if (!MUTADO)
        assert.equal(await hashVivo(V24), H_NOVO, "o estado DEPOIS nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`, com o auth.uid() pedido; devolve as linhas (o erro sobe). */
async function como(papel, sql, params = [], uid = "") {
  await C.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
    await C.query("RESET ROLE").catch(() => {});
  }
}
/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo, detalhe}. */
async function tentar(papel, sql, params = [], uid = "") {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, uid);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code, detalhe: e.detail };
  }
}

const SQL_PEDIDO = (rpc) =>
  `SELECT public.${rpc}($1::jsonb, $2::numeric, $3::numeric, $4::text, NULL::uuid, $5::text,
     'Comprador Prova', '5534999990000', NULL::text, $6::jsonb, $7::text, $8::text, $9::uuid) AS id`;

const ITEM_SIMPLES = [{ product_id: PROD, variant_id: null, quantity: 1 }];
const ITEM_COM_VARIACAO = [
  { product_id: PROD_VAR, variant_id: VAR, quantity: 1 },
];

/**
 * Faz o pedido pelo CAMINHO do checkout (`useOrders.createOrder`): uma unidade de R$ 100, frete zero (a loja de prova tem
 * frete gratis "sempre" na entrega local e na retirada), `total` e' o que a tela mandou. Sem `uid`: visitante (anon).
 */
async function pedir({
  rpc = V24,
  metodo = "online",
  uid = "",
  papel = "anon",
  dados = DIGITADO,
  opcao = "local-delivery",
  cupom = null,
  chave = crypto.randomUUID(),
  cep = DIGITADO.cep,
  itens = ITEM_SIMPLES,
  total = 100,
}) {
  return tentar(
    papel,
    SQL_PEDIDO(rpc),
    [
      JSON.stringify(itens),
      total,
      0,
      metodo,
      cupom,
      dados === null ? null : JSON.stringify(dados),
      cep,
      opcao,
      chave,
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

const lerPedido = async (id) =>
  (
    await C.query(
      "SELECT to_jsonb(o) AS o FROM public.marketplace_orders o WHERE o.id = $1",
      [id],
    )
  ).rows[0]?.o;
const num = async (sql, params = []) =>
  Number((await C.query(sql, params)).rows[0].n);
const estoque = (id = PROD) =>
  num("SELECT estoque AS n FROM public.produtos WHERE id = $1", [id]);
const estoqueVariacao = () =>
  num(
    "SELECT stock_increment AS n FROM public.product_variants WHERE id = $1",
    [VAR],
  );
const usosDoCupom = async (codigo) =>
  num("SELECT usage_count AS n FROM public.coupons WHERE code = $1", [codigo]);
/** Quantas vezes a SEQUENCIA-SONDA andou: o rollback do savepoint nao a desfaz. */
const ticks = async () => {
  const r = (
    await C.query("SELECT is_called, last_value::int AS v FROM probe_conta_seq")
  ).rows[0];
  return r.is_called ? r.v : 0;
};
/** O que uma recusa NAO pode mexer: pedidos, estoques (produto e variacao), uso do cupom e a sequencia-sonda. */
const foto = async () => ({
  pedidos: await num("SELECT count(*) AS n FROM public.marketplace_orders"),
  itens: await num("SELECT count(*) AS n FROM public.marketplace_order_items"),
  estoque: await estoque(PROD),
  estoqueProdutoComVariacao: await estoque(PROD_VAR),
  estoqueVariacao: await estoqueVariacao(),
  usosDoCupom: await usosDoCupom("PARCIAL"),
  ticks: await ticks(),
});

/** Pessoas, produtos (simples e com variacao), loja, cupom e a sonda de ordem dentro da transacao do caso. */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@384.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente Prova', 'customer'), ($2, 'Outra Prova', 'customer')`,
    [U.cliente, U.outro],
  );
  await C.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons,
        pagamento_online, formas_pagamento_entrega, store_address, enabled_shipping_methods)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true,
        true, ARRAY['pix', 'card', 'cash'], 'Rua da Loja, 100 - Centro', ARRAY['local-delivery', 'store-pickup'])
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons, pagamento_online = EXCLUDED.pagamento_online,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods`,
  );
  await C.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Camiseta Azul 384', 100, 1000, true, 40, false)",
    [PROD],
  );
  await C.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Camiseta Grade 384', 100, 1000, true, 40, false)",
    [PROD_VAR],
  );
  await C.query(
    "INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES ($1, $2, 'Tamanho', 'M', 50, true)",
    [VAR, PROD_VAR],
  );
  await C.query(
    `INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit)
     VALUES ('PARCIAL', 'fixed', 10, true, 0, 100)`,
  );
  // A SONDA DE ORDEM: uma sequencia que um gatilho move em cada coisa que a recusa NAO pode ter feito. Sequencia
  // nao e' desfeita por ROLLBACK (nem de savepoint): se a recusa viesse DEPOIS de inserir o pedido, baixar o
  // estoque (produto ou variacao) ou gastar o cupom, o estado final voltaria limpo, mas a sequencia teria andado.
  await C.query(`
    CREATE SEQUENCE public.probe_conta_seq;
    CREATE FUNCTION public.probe_conta_tick() RETURNS trigger LANGUAGE plpgsql AS
      $f$ BEGIN PERFORM nextval('public.probe_conta_seq'); RETURN NEW; END $f$;
    CREATE TRIGGER probe_conta_pedido BEFORE INSERT ON public.marketplace_orders
      FOR EACH ROW EXECUTE FUNCTION public.probe_conta_tick();
    CREATE TRIGGER probe_conta_estoque BEFORE UPDATE ON public.produtos
      FOR EACH ROW EXECUTE FUNCTION public.probe_conta_tick();
    CREATE TRIGGER probe_conta_variacao BEFORE UPDATE ON public.product_variants
      FOR EACH ROW EXECUTE FUNCTION public.probe_conta_tick();
    CREATE TRIGGER probe_conta_cupom BEFORE UPDATE ON public.coupons
      FOR EACH ROW EXECUTE FUNCTION public.probe_conta_tick();
  `);
}

const comparar = (rotulo, antes, depois, f) => {
  for (const campo of Object.keys(antes))
    if (depois[campo] !== antes[campo])
      f.push(
        `${rotulo}: ${campo} foi de ${antes[campo]} para ${depois[campo]} (a recusa tem de vir ANTES de reservar)`,
      );
};

// ---------------------------------------------------------------------------
// O COMPORTAMENTO esperado — uma verificacao por chave; devolve a lista de falhas (vazia = passou). E' a
// MESMA que roda sobre o corpo certo (tem de dar vazio) e sobre cada mutante (tem de dar nao vazio).
// `montar` reinstala o estado sob teste (para as verificacoes que precisam criar pedido legado com o corpo antigo).
// ---------------------------------------------------------------------------
const CHECKS = {
  /** (a) visitante + online: recusa com a frase e o identificador, e nada reservado nem gasto. */
  async visitanteOnlineRecusado() {
    const f = [];
    const casos = [
      ["entrega local, produto simples", {}],
      ["entrega local, sem chave de idempotencia", { chave: null }],
      ["retirada na loja", { opcao: "store-pickup" }],
      ["com cupom", { cupom: "PARCIAL", total: 90 }],
      ["produto com variacao", { itens: ITEM_COM_VARIACAO }],
      ["service_role (auth.uid() nulo)", { papel: "service_role", uid: "" }],
    ];
    for (const [rotulo, extra] of casos) {
      const antes = await foto();
      const r = await pedir(extra);
      if (r.linhas) {
        f.push(
          `visitanteOnlineRecusado(${rotulo}): o pedido pelo app SEM CONTA nasceu`,
        );
        continue;
      }
      if (r.erro !== FRASE)
        f.push(
          `visitanteOnlineRecusado(${rotulo}): mensagem inesperada: ${r.erro}`,
        );
      if (r.codigo !== "P0001")
        f.push(
          `visitanteOnlineRecusado(${rotulo}): codigo ${r.codigo} (esperado P0001)`,
        );
      if (!String(r.detalhe).startsWith(`${IDENTIFICADOR}:`))
        f.push(
          `visitanteOnlineRecusado(${rotulo}): DETAIL sem o identificador: ${r.detalhe}`,
        );
      comparar(`visitanteOnlineRecusado(${rotulo})`, antes, await foto(), f);
    }
    // O ataque: repetir sem parar para esgotar a vitrine. 30 chamadas, estoque e sonda intactos.
    const antes = await foto();
    let nasceu = 0;
    for (let i = 0; i < 30; i++) {
      const r = await pedir(i % 2 === 0 ? {} : { itens: ITEM_COM_VARIACAO });
      if (r.linhas) nasceu += 1;
    }
    if (nasceu > 0)
      f.push(`visitanteOnlineRecusado(30x): ${nasceu} pedidos nasceram`);
    comparar("visitanteOnlineRecusado(30x)", antes, await foto(), f);
    return f;
  },
  /** (b) quem TEM conta + online: nasce como hoje (pending, aguardando, prazo, estoque, cupom). */
  async logadoOnlineNasce() {
    const f = [];
    const casos = [
      ["produto simples", {}, PROD, null],
      ["com cupom", { cupom: "PARCIAL", total: 90 }, PROD, "PARCIAL"],
      ["produto com variacao", { itens: ITEM_COM_VARIACAO }, PROD_VAR, null],
      ["retirada na loja", { opcao: "store-pickup" }, PROD, null],
    ];
    for (const [rotulo, extra, produto, cupom] of casos) {
      const antes = await foto();
      const r = await pedirLogado(extra);
      if (!r.linhas) {
        f.push(`logadoOnlineNasce(${rotulo}): recusado: ${r.erro}`);
        continue;
      }
      const o = await lerPedido(r.linhas[0].id);
      if (o.user_id !== U.cliente)
        f.push(`logadoOnlineNasce(${rotulo}): user_id ${o.user_id}`);
      if (o.payment_method !== "online" || o.status !== "pending")
        f.push(
          `logadoOnlineNasce(${rotulo}): ${o.payment_method}/${o.status} (esperado online/pending)`,
        );
      if (o.payment_status !== "aguardando" || !o.expires_at)
        f.push(
          `logadoOnlineNasce(${rotulo}): sem a reserva de sempre (${o.payment_status}, expires_at ${o.expires_at})`,
        );
      const depois = await foto();
      if (produto === PROD && depois.estoque !== antes.estoque - 1)
        f.push(
          `logadoOnlineNasce(${rotulo}): estoque ${antes.estoque} -> ${depois.estoque}`,
        );
      if (
        produto === PROD_VAR &&
        depois.estoqueVariacao !== antes.estoqueVariacao - 1
      )
        f.push(
          `logadoOnlineNasce(${rotulo}): estoque da variacao ${antes.estoqueVariacao} -> ${depois.estoqueVariacao}`,
        );
      if (cupom && depois.usosDoCupom !== antes.usosDoCupom + 1)
        f.push(
          `logadoOnlineNasce(${rotulo}): uso do cupom ${antes.usosDoCupom} -> ${depois.usosDoCupom}`,
        );
    }
    return f;
  },
  /** (c) pagar na entrega/retirada nao muda: visitante (v23 e v24 direto) e logado nascem como hoje. */
  async naEntregaNasce() {
    const f = [];
    const casos = [
      ["visitante, v23, cash, entrega local", { rpc: V23, metodo: "cash" }],
      [
        "visitante, v23, pix, retirada",
        { rpc: V23, metodo: "pix", opcao: "store-pickup" },
      ],
      ["visitante, v24 direto, cash, entrega local", { metodo: "cash" }],
      ["visitante, v24 direto, card, entrega local", { metodo: "card" }],
      [
        "visitante, v24 direto, pix, retirada",
        { metodo: "pix", opcao: "store-pickup" },
      ],
      ["logado, v24 direto, cash", { logado: true, metodo: "cash" }],
      ["logado, v23, cash", { logado: true, rpc: V23, metodo: "cash" }],
    ];
    for (const [rotulo, { logado, ...extra }] of casos) {
      const antes = await foto();
      const r = await (logado ? pedirLogado(extra) : pedir(extra));
      if (!r.linhas) {
        f.push(`naEntregaNasce(${rotulo}): recusado: ${r.erro}`);
        continue;
      }
      const o = await lerPedido(r.linhas[0].id);
      if (o.payment_method !== extra.metodo)
        f.push(`naEntregaNasce(${rotulo}): metodo ${o.payment_method}`);
      if (logado ? o.user_id !== U.cliente : o.user_id !== null)
        f.push(`naEntregaNasce(${rotulo}): user_id ${o.user_id}`);
      const depois = await foto();
      if (depois.estoque !== antes.estoque - 1)
        f.push(
          `naEntregaNasce(${rotulo}): estoque ${antes.estoque} -> ${depois.estoque}`,
        );
    }
    return f;
  },
  /**
   * (d) o RETRY de um pedido que ja existe (mesma chave) devolve o MESMO pedido, sem recusa e sem mexer em nada. Os
   * pedidos legados nascem com o corpo ANTIGO (o que a loja tem hoje no ar); o estado sob teste volta em seguida.
   */
  async retryDoPedidoQueJaExiste(montar) {
    const f = [];
    await instalarAntiga();
    const kVisitante = crypto.randomUUID();
    const kLogado = crypto.randomUUID();
    const kLegado2 = crypto.randomUUID();
    const legadoVisitante = await pedir({ chave: kVisitante });
    const legadoLogado = await pedirLogado({ chave: kLogado });
    const legadoVisitanteVar = await pedir({
      chave: kLegado2,
      itens: ITEM_COM_VARIACAO,
    });
    if (
      !legadoVisitante.linhas ||
      !legadoLogado.linhas ||
      !legadoVisitanteVar.linhas
    ) {
      f.push(
        `retry: o corpo ANTIGO devia criar os pedidos legados: ${legadoVisitante.erro} | ${legadoLogado.erro} | ${legadoVisitanteVar.erro}`,
      );
      await montar();
      return f;
    }
    await montar();
    const antes = await foto();
    const casos = [
      ["visitante, mesma chave", { chave: kVisitante }, legadoVisitante],
      [
        "visitante, mesma chave, produto com variacao",
        { chave: kLegado2, itens: ITEM_COM_VARIACAO },
        legadoVisitanteVar,
      ],
    ];
    for (const [rotulo, extra, esperado] of casos) {
      const r = await pedir(extra);
      if (!r.linhas) f.push(`retry(${rotulo}): foi recusado: ${r.erro}`);
      else if (r.linhas[0].id !== esperado.linhas[0].id)
        f.push(`retry(${rotulo}): devolveu outro pedido`);
    }
    const rLogado = await pedirLogado({ chave: kLogado });
    if (!rLogado.linhas) f.push(`retry(logado): foi recusado: ${rLogado.erro}`);
    else if (rLogado.linhas[0].id !== legadoLogado.linhas[0].id)
      f.push("retry(logado): devolveu outro pedido");
    // Outra pessoa logada com a chave do logado NAO recupera o pedido dele (comportamento de sempre): nasce outro ou
    // recusa por outro motivo, mas nunca devolve o id alheio.
    const rOutro = await pedirLogado({ uid: U.outro, chave: kLogado });
    if (rOutro.linhas && rOutro.linhas[0].id === legadoLogado.linhas[0].id)
      f.push("retry(outra pessoa logada): recuperou o pedido alheio");
    // O retry nao criou nada novo (a unica coisa nova e' o pedido da outra pessoa logada, se nasceu).
    const depois = await foto();
    const novosEsperados = rOutro.linhas ? 1 : 0;
    if (depois.pedidos !== antes.pedidos + novosEsperados)
      f.push(
        `retry: pedidos ${antes.pedidos} -> ${depois.pedidos} (esperado +${novosEsperados})`,
      );
    // Chave NOVA do visitante: recusa (o retry nao e' brecha).
    const nova = await pedir({});
    if (nova.linhas) f.push("retry: a chave nova do visitante nasceu");
    else if (nova.erro !== FRASE)
      f.push(`retry: chave nova recusou com outra frase: ${nova.erro}`);
    return f;
  },
  /** (e) a ORDEM das recusas: a forma de pagamento desligada vem antes; a nova vem antes de carrinho e portoes. */
  async ordemDasRecusas() {
    const f = [];
    const antes = await foto();
    const adulterado = await pedir({ total: 50 });
    if (adulterado.erro !== FRASE)
      f.push(
        `ordem(total adulterado): esperava a recusa nova, veio: ${adulterado.erro ?? "pedido criado"}`,
      );
    const inexistente = await pedir({
      itens: [
        {
          product_id: "7e7e2384-0000-4000-8000-0000000000ff",
          variant_id: null,
          quantity: 1,
        },
      ],
    });
    if (inexistente.erro !== FRASE)
      f.push(
        `ordem(produto inexistente): esperava a recusa nova, veio: ${inexistente.erro ?? "pedido criado"}`,
      );
    const foraDaCidade = await pedir({
      dados: FORA_DA_CIDADE,
      cep: FORA_DA_CIDADE.cep,
    });
    if (foraDaCidade.erro !== FRASE)
      f.push(
        `ordem(CEP fora da faixa): esperava a recusa nova, veio: ${foraDaCidade.erro ?? "pedido criado"}`,
      );
    const semOpcao = await pedir({ opcao: null });
    if (semOpcao.erro !== FRASE)
      f.push(
        `ordem(sem opcao de entrega): esperava a recusa nova, veio: ${semOpcao.erro ?? "pedido criado"}`,
      );
    comparar("ordem(recusas novas)", antes, await foto(), f);
    // Loja com o pagamento pelo app DESLIGADO: a frase dela vem primeiro (entrar na conta nao resolveria).
    await C.query(
      "UPDATE public.store_config SET pagamento_online = false WHERE id = 1",
    );
    for (const [rotulo, r] of [
      ["visitante", await pedir({})],
      ["logado", await pedirLogado({})],
    ])
      if (r.erro !== FRASE_0_BIS)
        f.push(
          `ordem(pagamento online desligado, ${rotulo}): esperava a frase da loja, veio: ${r.erro ?? "pedido criado"}`,
        );
    await C.query(
      "UPDATE public.store_config SET pagamento_online = true WHERE id = 1",
    );
    return f;
  },
};

/** Roda TODAS as verificacoes sobre o que estiver vivo, uma transacao por verificacao; devolve as falhas. */
async function todasAsVerificacoes(montarEstado) {
  const falhas = [];
  for (const [nome, check] of Object.entries(CHECKS)) {
    await C.query("BEGIN");
    try {
      await montarEstado();
      await semear();
      for (const f of await check(montarEstado)) falhas.push(f);
    } catch (e) {
      falhas.push(`${nome}: EXCECAO ${e.message}`);
    } finally {
      await C.query("ROLLBACK");
    }
  }
  return falhas;
}

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------

prova(
  "ANTES: com o corpo antigo (o da 20261350, byte a byte) a visitante SEM conta cria o pedido pelo app (pending, aguardando, com a reserva de 30 minutos) e o estoque BAIXA — produto simples e com variacao; repetido, esgota o produto (o defeito)",
  () =>
    emTransacao(async () => {
      assert.equal(await prosrcVivo(V24), ANTIGA.corpo);
      assert.deepEqual(await acl(V24), ACL_DE_SEMPRE);
      await semear();
      const antes = await foto();
      const r = await pedir({});
      assert.ok(r.linhas, `o controle devia nascer: ${r.erro}`);
      const o = await lerPedido(r.linhas[0].id);
      assert.equal(o.user_id, null, "o pedido e' de visitante");
      assert.equal(o.payment_method, "online");
      assert.equal(o.status, "pending");
      assert.equal(o.payment_status, "aguardando");
      assert.ok(o.expires_at, "sem a reserva de 30 minutos");
      assert.equal(
        (await foto()).estoque,
        antes.estoque - 1,
        "baixou o estoque",
      );
      assert.ok(
        (await foto()).ticks > antes.ticks,
        "a sonda de ordem nao andou",
      );
      const rv = await pedir({ itens: ITEM_COM_VARIACAO });
      assert.ok(rv.linhas, `o controle com variacao devia nascer: ${rv.erro}`);
      assert.equal(
        await estoqueVariacao(),
        antes.estoqueVariacao - 1,
        "baixou o estoque da variacao",
      );
      // O ataque: sem conta nenhuma, 40 chamadas baixam 40 unidades.
      for (let i = 0; i < 40; i++) assert.ok((await pedir({})).linhas);
      assert.equal(await estoque(PROD), antes.estoque - 41);
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: visitante + online recusa (frase, identificador, nada reservado nem gasto; a sonda de ordem nao anda; 30 chamadas seguidas deixam o estoque intacto); logado + online nasce como hoje; pagar na entrega/retirada nasce como hoje (visitante e logado); o retry de pedido que ja existe devolve o MESMO pedido; a ordem das recusas",
  async () => {
    const falhas = await todasAsVerificacoes(instalarNova);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

// ---------------------------------------------------------------------------
// CONCORRENCIA: duas conexoes reais, dados commitados no clone descartavel
// ---------------------------------------------------------------------------

const U2 = {
  cliente: "7e7e2384-0000-4000-8000-0000000002d1",
};
const PROD2 = "7e7e2384-0000-4000-8000-0000000002f0";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let ADM; // conexao de autocommit: semeia dados COMMITADOS e observa pg_locks/pg_stat_activity

async function semearCommitado() {
  await ADM.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@384c.teste', '{}'::jsonb) ON CONFLICT DO NOTHING",
    [U2.cliente],
  );
  await ADM.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente 384 c', 'customer') ON CONFLICT DO NOTHING",
    [U2.cliente],
  );
  await ADM.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons,
        pagamento_online, formas_pagamento_entrega, store_address, enabled_shipping_methods)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true,
        true, ARRAY['pix', 'card', 'cash'], 'Rua da Loja, 100 - Centro', ARRAY['local-delivery', 'store-pickup'])
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons, pagamento_online = EXCLUDED.pagamento_online,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods`,
  );
  await ADM.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Camiseta Concorrente 384', 100, 1000, true, 40, false) ON CONFLICT DO NOTHING",
    [PROD2],
  );
}
async function limparCommitado() {
  await ADM.query(
    "DELETE FROM public.marketplace_order_items WHERE product_id = $1",
    [PROD2],
  ).catch(() => {});
  await ADM.query("DELETE FROM public.marketplace_orders WHERE user_id = $1", [
    U2.cliente,
  ]).catch(() => {});
  await ADM.query("DELETE FROM public.produtos WHERE id = $1", [PROD2]).catch(
    () => {},
  );
}
async function sessao(papel) {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  c.pid = (await c.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  const anon = papel === "anon";
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, false), set_config('request.jwt.claims', $2, false)",
    [
      anon ? "" : U2.cliente,
      anon ? "" : JSON.stringify({ sub: U2.cliente, role: "authenticated" }),
    ],
  );
  await c.query(`SET ROLE ${papel}`);
  return c;
}
const comprarConc = (c, chave) =>
  c.query(SQL_PEDIDO(V24), [
    JSON.stringify([{ product_id: PROD2, variant_id: null, quantity: 1 }]),
    100,
    0,
    "online",
    null,
    JSON.stringify(DIGITADO),
    DIGITADO.cep,
    "local-delivery",
    chave,
  ]);
/** Observa uma promessa de consulta sem derrubar o teste: { fim, p: Promise<{ok}|{erro}> }. */
function observar(promessa) {
  const e = { fim: false };
  e.p = promessa
    .then(
      (r) => ({ ok: r.rows[0].id }),
      (x) => ({ erro: x.message }),
    )
    .then((r) => {
      e.fim = true;
      return r;
    });
  return e;
}
/** A sessao `pid` esta PARADA numa espera: "advisory" (pg_locks) ou "linha" (trava de linha). */
async function emEspera(pid, tipo) {
  for (let i = 0; i < 120; i++) {
    const r =
      tipo === "advisory"
        ? await ADM.query(
            "SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted",
            [pid],
          )
        : await ADM.query(
            "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock' AND wait_event IN ('transactionid', 'tuple')",
            [pid],
          );
    if (r.rowCount) return true;
    await dormir(50);
  }
  return false;
}
const terminaAte = async (e, ms) =>
  (await Promise.race([e.p, dormir(ms).then(() => "preso")])) !== "preso";
async function fechar(...cs) {
  for (const c of cs) {
    if (!c) continue;
    await c.query("ROLLBACK").catch(() => {});
    await c.end().catch(() => {});
  }
}
const pedidosDaChave = async (chave) =>
  (
    await ADM.query(
      "SELECT id, user_id FROM public.marketplace_orders WHERE idempotency_key = $1",
      [chave],
    )
  ).rows;
const estoque2 = async () =>
  Number(
    (
      await ADM.query("SELECT estoque FROM public.produtos WHERE id = $1", [
        PROD2,
      ])
    ).rows[0].estoque,
  );

prova(
  "CONCORRENCIA: o retry do convidado ESPERA o primeiro envio (mesma chave) e devolve o MESMO pedido quando ele conclui; se o primeiro desiste (ROLLBACK) o convidado recebe a recusa e nada existe; a recusa NAO toca a linha do produto (uma sessao que a segura nao bloqueia o convidado, e bloqueia o controle autenticado)",
  async () => {
    // O clone commitado parte da arvore inteira (a 20261394000000 no ar nas DUAS funcoes): ela cai ANTES (a v23 volta ao corpo da
    // 350, a v24 ao da 384), senao a troca so da v24 abaixo deixaria o clone "misto" e os estados seguintes nao montariam.
    await require("./o-pedido-de-visitante-na-entrega-posterior.cjs").desfazerPedidoDeVisitanteTemFreioNaTransacao(
      ADM,
    );
    await ADM.query(decl(NOVA, NOVA.corpo));
    await semearCommitado();
    try {
      // (1) o primeiro (autenticado) conclui; o convidado, que chegou no meio, espera e recebe o MESMO pedido.
      {
        const chave = crypto.randomUUID();
        const A = await sessao("authenticated");
        const B = await sessao("anon");
        try {
          await A.query("BEGIN");
          const idA = (await comprarConc(A, chave)).rows[0].id;
          await B.query("BEGIN");
          const eb = observar(comprarConc(B, chave));
          assert.ok(
            await emEspera(B.pid, "advisory"),
            "o convidado devia esperar a trava da chave",
          );
          assert.equal(eb.fim, false, "o convidado nao devia ter terminado");
          await A.query("COMMIT");
          const rb = await eb.p;
          assert.equal(
            rb.ok,
            idA,
            `o convidado devia receber o MESMO pedido: ${JSON.stringify(rb)}`,
          );
          await B.query("COMMIT");
          assert.equal((await pedidosDaChave(chave)).length, 1, "um pedido so");
        } finally {
          await fechar(A, B);
        }
      }
      // (2) o primeiro desiste: o convidado recebe a recusa; nenhum pedido; estoque so do pedido do passo 1.
      {
        const chave = crypto.randomUUID();
        const antes = await estoque2();
        const A = await sessao("authenticated");
        const B = await sessao("anon");
        try {
          await A.query("BEGIN");
          await comprarConc(A, chave);
          await B.query("BEGIN");
          const eb = observar(comprarConc(B, chave));
          assert.ok(await emEspera(B.pid, "advisory"));
          await A.query("ROLLBACK");
          const rb = await eb.p;
          assert.equal(
            rb.erro,
            FRASE,
            `o convidado devia receber a recusa: ${JSON.stringify(rb)}`,
          );
          await B.query("ROLLBACK");
          assert.equal(
            (await pedidosDaChave(chave)).length,
            0,
            "nenhum pedido",
          );
          assert.equal(await estoque2(), antes, "o estoque nao mexeu");
        } finally {
          await fechar(A, B);
        }
      }
      // (3) a recusa nao toca a linha do produto: uma sessao que a segura nao bloqueia o convidado; o controle bloqueia.
      {
        const H = new Client({ connectionString: lerDatabaseUrlEfemera() });
        await H.connect();
        const B = await sessao("anon");
        const A = await sessao("authenticated");
        try {
          await H.query("BEGIN");
          await H.query(
            "SELECT 1 FROM public.produtos WHERE id = $1 FOR UPDATE",
            [PROD2],
          );
          const eb = observar(comprarConc(B, crypto.randomUUID()));
          assert.ok(
            await terminaAte(eb, 5000),
            "a recusa do convidado ficou presa na linha do produto (ela nao devia tocar nela)",
          );
          assert.equal((await eb.p).erro, FRASE);
          const ea = observar(comprarConc(A, crypto.randomUUID()));
          assert.ok(
            await emEspera(A.pid, "linha"),
            "o controle autenticado devia esperar a linha do produto",
          );
          assert.equal(ea.fim, false);
          await H.query("ROLLBACK");
          const ra = await ea.p;
          assert.ok(
            ra.ok,
            `o controle devia concluir depois de soltar a linha: ${JSON.stringify(ra)}`,
          );
        } finally {
          await fechar(H, A, B);
        }
      }
    } finally {
      await limparCommitado();
    }
  },
);

// ---------------------------------------------------------------------------
// INTACTO: o resto do caminho do dinheiro
// ---------------------------------------------------------------------------

/** Escrubar o que muda de execucao para execucao (ids novos, relogio): o resto tem de ser identico. */
function normalizar(v) {
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        k === "coupon_id" ? x !== null : normalizar(x),
      ]),
    );
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) return "<ts>";
  return v;
}

/** O mesmo roteiro de compras que passam (pelo app logado, na entrega, com e sem cupom, retirada, convidada). */
async function roteiro() {
  await semear();
  const passos = [
    { logado: true, total: 100 },
    { logado: true, cupom: "PARCIAL", total: 90 },
    { logado: true, total: 100, opcao: "store-pickup" },
    { logado: true, itens: ITEM_COM_VARIACAO },
    { rpc: V23, metodo: "cash", total: 100 },
    { metodo: "pix", total: 100, opcao: "store-pickup" },
    { metodo: "cash", total: 100 },
    { logado: true, rpc: V23, metodo: "cash", total: 100 },
  ];
  const pedidos = [];
  for (const [i, { logado, ...p }] of passos.entries()) {
    const chave = `7e7e2384-0000-4000-8000-00000000c0${i}${i}`;
    const r = await (logado
      ? pedirLogado({ ...p, chave })
      : pedir({ ...p, chave }));
    assert.ok(r.linhas, `roteiro passo ${i}: ${r.erro}`);
    const o = await lerPedido(r.linhas[0].id);
    const itens = (
      await C.query(
        "SELECT to_jsonb(i) - 'id' - 'order_id' AS i FROM public.marketplace_order_items i WHERE i.order_id = $1 ORDER BY i.product_id",
        [r.linhas[0].id],
      )
    ).rows.map((x) => x.i);
    pedidos.push({
      pedido: normalizar({ ...o, id: "<id>" }),
      itens: normalizar(itens),
    });
  }
  const cupons = (
    await C.query("SELECT code, usage_count FROM public.coupons ORDER BY code")
  ).rows;
  return {
    pedidos,
    estoque: await estoque(),
    estoqueVariacao: await estoqueVariacao(),
    cupons,
  };
}

prova(
  "INTACTO: o MESMO roteiro de compras que passam (logado pelo app, na entrega, com e sem cupom, retirada, produto com variacao, convidada na entrega) grava linhas identicas no estado ANTES e no DEPOIS — total, subtotal, frete, desconto, cupom, itens, estoque, uso do cupom",
  async () => {
    const antes = await emTransacao(roteiro, { estado: "antes" });
    const depois = await emTransacao(roteiro, { estado: "depois" });
    assert.equal(antes.estoque, 1000 - 7, "o roteiro baixou o estoque");
    assert.deepEqual(depois, antes);
  },
);

/** O que a migration nao pode tocar: ACL de TODA funcao e tabela de public, e o corpo de toda funcao. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl,
              md5(p.prosrc) AS corpo, p.prosecdef, p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' ORDER BY 1`,
    )
  ).rows;
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  return { funcoes, tabelas };
}
/** A foto dos DADOS: o hash do conteudo das tabelas que a compra toca. */
async function retratoDosDados() {
  const out = {};
  for (const t of [
    "marketplace_orders",
    "marketplace_order_items",
    "produtos",
    "product_variants",
    "coupons",
    "store_config",
    "profiles",
  ])
    out[t] = (
      await C.query(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.${t} x`,
      )
    ).rows[0];
  return out;
}

prova(
  "SO O CORPO: aplicar a migration muda SO o corpo da v24 (nenhuma outra funcao — a v23 inclusive —, nenhuma tabela, nenhuma ACL, nenhuma linha de dado); oid, ACL, atributos e assinatura ficam; o corpo novo e' o antigo mais o bloco 0-ter; o pedido LEGADO (criado pelo corpo antigo, sem conta) fica byte a byte",
  () =>
    emTransacao(async () => {
      await semear();
      // O legado: pedidos online de visitante e de logado, criados pelo corpo ANTIGO.
      const chaveLegado = crypto.randomUUID();
      const legado = await pedir({ chave: chaveLegado });
      assert.ok(
        legado.linhas,
        `o corpo antigo devia criar o legado: ${legado.erro}`,
      );
      const legadoLogado = await pedirLogado({});
      assert.ok(legadoLogado.linhas);
      const antes = await retratoDoSchema();
      const dadosAntes = await retratoDosDados();
      const v23Antes = await hashVivo(V23);
      const oid = await oidVivo(V24);
      const aclAntes = await aclBruto(V24);
      assert.equal(await aplicar(MIGRATION), null);
      const depois = await retratoDoSchema();
      assert.deepEqual(depois.tabelas, antes.tabelas, "ACL de tabela mudou");
      assert.equal(depois.funcoes.length, antes.funcoes.length);
      const mudou = depois.funcoes.filter(
        (f, i) => JSON.stringify(f) !== JSON.stringify(antes.funcoes[i]),
      );
      assert.deepEqual(
        mudou.map((f) => f.f.replace(/\(.*$/, "")),
        [V24],
        "so a v24 pode mudar",
      );
      const velho = antes.funcoes.find((x) => x.f === mudou[0].f);
      assert.deepEqual(
        { ...mudou[0], corpo: 0 },
        { ...velho, corpo: 0 },
        "so o corpo muda (oid, ACL, atributos)",
      );
      assert.equal(await oidVivo(V24), oid);
      assert.equal(await aclBruto(V24), aclAntes);
      assert.deepEqual(await acl(V24), ACL_DE_SEMPRE);
      assert.equal(await prosrcVivo(V24), NOVA.corpo);
      assert.equal(await hashVivo(V24), H_NOVO);
      assert.equal(await hashVivo(V23), v23Antes, "a v23 foi tocada");
      assert.deepEqual(
        await retratoDosDados(),
        dadosAntes,
        "a migration mexeu em dado (o legado inclusive)",
      );
      // O legado continua sendo devolvido pelo retry (mesma chave) e a chave nova do visitante e' recusada.
      const o = await lerPedido(legado.linhas[0].id);
      assert.equal(o.user_id, null);
      const retry = await pedir({ chave: chaveLegado });
      assert.ok(retry.linhas, `o retry do legado foi recusado: ${retry.erro}`);
      assert.equal(retry.linhas[0].id, legado.linhas[0].id);
      assert.equal((await pedir({})).erro, FRASE);
    }),
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------

const sem = (c) => {
  const r = c.replace(BLOCO, "");
  assert.notEqual(r, c, "o bloco nao estava no corpo");
  return r;
};
const mover = (c, ancora, depois = false) => {
  const r = sem(c);
  assert.equal(
    r.split(ancora).length - 1,
    1,
    `ancora nao unica: ${ancora.slice(0, 50)}`,
  );
  return r.replace(ancora, () => (depois ? ancora + BLOCO : BLOCO + ancora));
};
const TROCAS = {
  "sem a trava (o corpo antigo)": null,
  "a trava vem DEPOIS de reservar estoque e gastar o cupom (so antes do RETURN)":
    (c) => mover(c, FIM_DA_FUNCAO),
  "a trava vem ANTES do passo 0 (a idempotencia): o retry do pedido que ja existe e' recusado":
    (c) => mover(c, ANCORA_PASSO_0),
  "a trava vem ANTES do 0-bis: a loja com o pagamento pelo app desligado perde a frase dela":
    (c) => mover(c, ANCORA_0_BIS),
  "a trava so vem antes do INSERT do pedido (depois da leitura do carrinho e dos portoes)":
    (c) => mover(c, ANCORA_PASSO_7),
  "a trava vale para todo meio de pagamento (sem a checagem do 'online')": (
    c,
  ) => c.replace(COND, "IF v_user_id IS NULL THEN"),
  "a trava so recusa quem NAO manda chave de idempotencia": (c) =>
    c.replace(
      COND,
      `${COND.replace(" THEN", "")} AND p_idempotency_key IS NULL THEN`,
    ),
  "a trava compara com o meio errado (pix em vez de online)": (c) =>
    c.replace(COND, COND.replace("'online'", "'pix'")),
};
const NOMES_ESPERADOS_VERMELHOS = {
  "sem a trava (o corpo antigo)": ["visitanteOnlineRecusado"],
  "a trava vem DEPOIS de reservar estoque e gastar o cupom (so antes do RETURN)":
    ["visitanteOnlineRecusado"],
  "a trava vem ANTES do passo 0 (a idempotencia): o retry do pedido que ja existe e' recusado":
    ["retry"],
  "a trava vem ANTES do 0-bis: a loja com o pagamento pelo app desligado perde a frase dela":
    ["ordem(pagamento online desligado"],
  "a trava so vem antes do INSERT do pedido (depois da leitura do carrinho e dos portoes)":
    ["ordem(produto inexistente)"],
  "a trava vale para todo meio de pagamento (sem a checagem do 'online')": [
    "naEntregaNasce",
  ],
  "a trava so recusa quem NAO manda chave de idempotencia": [
    "visitanteOnlineRecusado",
  ],
  "a trava compara com o meio errado (pix em vez de online)": [
    "visitanteOnlineRecusado",
  ],
};

for (const [nome, troca] of Object.entries(TROCAS)) {
  prova(`MUTANTE vermelho — ${nome}`, async () => {
    const instalar = async () => {
      await instalarAntiga();
      if (troca === null) return;
      const mutado = troca(NOVA.corpo);
      assert.notEqual(mutado, NOVA.corpo, "a sabotagem nao mudou o corpo");
      await C.query(decl(NOVA, mutado));
    };
    const falhas = await todasAsVerificacoes(instalar);
    assert.ok(falhas.length > 0, `o mutante "${nome}" NAO ficou vermelho`);
    for (const alvo of NOMES_ESPERADOS_VERMELHOS[nome]) {
      assert.ok(
        falhas.some((x) => x.includes(alvo)),
        `o mutante "${nome}" devia reprovar a verificacao "${alvo}"; reprovou: ${falhas.join(" | ")}`,
      );
    }
    console.log(
      `    (vermelho em ${falhas.length} verificacoes; ex.: ${falhas[0]})`,
    );
  });
}

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, CRLF, rollback, pre-voo, pos-voo, atomicidade
// ---------------------------------------------------------------------------

const retrato = async () => ({
  h: await hashVivo(V24),
  src: sha256(await prosrcVivo(V24)),
  oid: await oidVivo(V24),
  acl: await aclBruto(V24),
});

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL); o rollback devolve o prosrc IDENTICO (md5 e sha256 do corpo da 20261350) e a mesma ACL; o segundo rollback RECUSA; ida e volta termina igual",
  () =>
    emTransacao(async () => {
      const original = await retrato();
      assert.equal(original.src, sha256(ANTIGA.corpo));
      assert.equal(await aplicar(MIGRATION), null);
      const um = await retrato();
      assert.equal(um.h, H_NOVO);
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retrato(), um, "reaplicar mudou o estado");
      assert.equal(await aplicar(emCRLF(MIGRATION)), null);
      const crlf = await retrato();
      assert.equal(crlf.h, H_NOVO, "CRLF: o hash (sem CR) tem de ser o mesmo");
      assert.equal(crlf.oid, um.oid);
      assert.equal(crlf.acl, um.acl);
      assert.equal(await aplicar(ROLLBACK), null);
      assert.deepEqual(
        await retrato(),
        original,
        "o rollback nao devolveu o estado original byte a byte",
      );
      const segundo = await aplicar(ROLLBACK);
      assert.ok(segundo, "o segundo rollback devia recusar");
      assert.match(segundo.erro, /B1_BASELINE_DIVERGENT/);
      assert.deepEqual(
        await retrato(),
        original,
        "o segundo rollback escreveu",
      );
      // Em CRLF o texto gravado leva os CR (o hash sem CR e' o mesmo; o sha256 do texto cru nao e').
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(emCRLF(ROLLBACK)), null);
      assert.equal(await hashVivo(V24), H_ANTIGO, "rollback em CRLF");
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retrato(), um, "ida, volta e ida");
    }),
);

const ESTADOS_RUINS = {
  "corpo desconhecido (v24 com um comentario a mais)": async () => {
    await C.query(
      decl(ANTIGA, `${ANTIGA.corpo}\n-- redefinicao que ninguem revisou\n`),
    );
  },
  "a loja ainda esta no corpo da 20261244 (sem a 20261350)": async () => {
    await C.query(decl(ANTIGA_244, ANTIGA_244.corpo));
  },
  "atributo diferente (v24 STABLE)": async () => {
    await C.query(`ALTER FUNCTION ${FN.get(V24)} STABLE`);
  },
  "atributo diferente (v24 SECURITY INVOKER)": async () => {
    await C.query(`ALTER FUNCTION ${FN.get(V24)} SECURITY INVOKER`);
  },
  "sobrecarga (outra create_marketplace_order_v24)": async () => {
    await C.query(
      "CREATE FUNCTION public.create_marketplace_order_v24(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    );
  },
  "funcao ausente (v24 apagada)": async () => {
    await C.query(`DROP FUNCTION ${FN.get(V24)}`);
  },
  "ACL aberta (PUBLIC executa a v24)": async () => {
    await C.query(`GRANT EXECUTE ON FUNCTION ${FN.get(V24)} TO PUBLIC`);
  },
  "anon sem EXECUTE: o checkout da convidada quebraria": async () => {
    await C.query(`REVOKE EXECUTE ON FUNCTION ${FN.get(V24)} FROM anon`);
  },
  "authenticated sem EXECUTE": async () => {
    await C.query(
      `REVOKE EXECUTE ON FUNCTION ${FN.get(V24)} FROM authenticated`,
    );
  },
  "service_role sem EXECUTE": async () => {
    await C.query(
      `REVOKE EXECUTE ON FUNCTION ${FN.get(V24)} FROM service_role`,
    );
  },
};

prova(
  "MIGRATION: o pre-voo recusa SEM escrever em cada estado ruim (B1_BASELINE_DIVERGENT; nenhum corpo muda) e o rollback-manual tambem",
  () =>
    emTransacao(async () => {
      for (const [nome, ruim] of Object.entries(ESTADOS_RUINS)) {
        await C.query("SAVEPOINT ruim");
        await ruim();
        const antes = await prosrcVivo(V24);
        const erro = await aplicar(MIGRATION);
        assert.ok(erro, `${nome}: a migration devia recusar`);
        assert.match(
          erro.erro,
          /B1_BASELINE_DIVERGENT/,
          `${nome}: ${erro.erro}`,
        );
        assert.equal(
          await prosrcVivo(V24),
          antes,
          `${nome}: o pre-voo escreveu`,
        );
        const rb = await aplicar(ROLLBACK);
        assert.ok(rb, `${nome}: o rollback-manual devia recusar`);
        assert.match(
          rb.erro,
          /B1_BASELINE_DIVERGENT/,
          `${nome}: rollback: ${rb.erro}`,
        );
        assert.equal(
          await prosrcVivo(V24),
          antes,
          `${nome}: o pre-voo do rollback escreveu`,
        );
        await C.query("ROLLBACK TO SAVEPOINT ruim");
      }
    }),
);

const bloco = (sql, nome) => {
  const ini = sql.indexOf(`DO $${nome}$`);
  const fim = sql.indexOf(`END $${nome}$;`) + `END $${nome}$;`.length;
  assert.ok(ini >= 0 && fim > ini, `bloco ${nome} nao achado`);
  return sql.slice(ini, fim);
};

prova(
  "MIGRATION: o pos-voo da migration PASSA no estado novo e RECUSA corpo antigo, atributo mudado, PUBLIC aberto e anon sem EXECUTE; o da fotografia recusa mudanca de dono/ACL/OID e v23 alterada",
  () =>
    emTransacao(async () => {
      // O pos-voo depende das duas fotografias que o pre-voo grava (GUC): roda o pre-voo no estado novo (reaplicavel) e
      // depois o pos-voo isolado, em cada estrago.
      const PREVOO = bloco(MIGRATION, "preflight_20261384");
      const POSVOO = bloco(MIGRATION, "posvoo_20261384");
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(PREVOO), null);
      assert.equal(
        await aplicar(POSVOO),
        null,
        "o pos-voo reprovou o estado bom",
      );
      for (const [nome, estrago, padrao] of [
        [
          "corpo antigo",
          () => C.query(decl(ANTIGA, ANTIGA.corpo)),
          /nao ficou com o corpo desta migration/,
        ],
        [
          "atributo (v24 STABLE)",
          () => C.query(`ALTER FUNCTION ${FN.get(V24)} STABLE`),
          /atributos, dono, OID ou ACL/,
        ],
        [
          "PUBLIC aberto",
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN.get(V24)} TO PUBLIC`),
          /atributos, dono, OID ou ACL/,
        ],
        [
          "anon sem EXECUTE",
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN.get(V24)} FROM anon`),
          /atributos, dono, OID ou ACL/,
        ],
        [
          "v23 alterada",
          () =>
            C.query(
              decl(
                funcaoDe(SRC_350, V23),
                `${funcaoDe(SRC_350, V23).corpo}\n-- v23 mexida\n`,
              ),
            ),
          /create_marketplace_order_v23 foi alterada/,
        ],
      ]) {
        await C.query("SAVEPOINT estrago");
        await estrago();
        const erro = await aplicar(POSVOO);
        assert.ok(erro, `${nome}: o pos-voo devia recusar`);
        assert.match(erro.erro, /POSVOO_20261384000000/);
        assert.match(erro.erro, padrao, nome);
        await C.query("ROLLBACK TO SAVEPOINT estrago");
      }
    }),
);

prova(
  "MIGRATION: o pos-voo reprovando DESFAZ a troca — uma migration cujo corpo novo sai com 1 byte a mais aborta no pos-voo e a v24 fica como estava; o pre-voo recusando tambem nao escreve (o arquivo vai como UMA mensagem, uma transacao implicita, conexao SEM BEGIN)",
  async () => {
    const sabotada = MIGRATION.replace(decl(NOVA, NOVA.corpo), () =>
      decl(NOVA, `${NOVA.corpo}\n-- um byte a mais\n`),
    );
    assert.notEqual(sabotada, MIGRATION);
    const solto = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await solto.connect();
    try {
      await solto.query(decl(ANTIGA, ANTIGA.corpo)); // estado ANTES, de verdade (clone descartavel)
      const lido = async () =>
        (
          await solto.query(
            "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
            [FN.get(V24)],
          )
        ).rows[0].h;
      assert.equal(await lido(), H_ANTIGO);
      let erro = null;
      try {
        await solto.query(sabotada);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "a migration sabotada devia abortar no pos-voo");
      assert.match(erro.message, /POSVOO_20261384000000/);
      assert.equal(
        await lido(),
        H_ANTIGO,
        "o CREATE OR REPLACE ficou gravado apesar do pos-voo reprovar",
      );
      // E o arquivo de verdade aplica de fora de BEGIN e grava de uma vez
      await solto.query(MIGRATION);
      assert.equal(await lido(), H_NOVO);
      // Rollback em conexao solta tambem aplica inteiro; e o pre-voo recusando (segundo rollback) nao escreve.
      await solto.query(ROLLBACK);
      assert.equal(await lido(), H_ANTIGO);
      await assert.rejects(
        () => solto.query(ROLLBACK),
        /B1_BASELINE_DIVERGENT/,
      );
      assert.equal(await lido(), H_ANTIGO);
      await solto.query(MIGRATION);
      assert.equal(await lido(), H_NOVO);
    } finally {
      await solto.end();
    }
  },
);

// ---------------------------------------------------------------------------
// CONSULTAS 89a / 89b (e as que aceitam o corpo novo como sucessor)
// ---------------------------------------------------------------------------

const rodarConsulta = async (sql) => (await C.query(sql)).rows;
const mapa = (linhas) => Object.fromEntries(linhas.map((l) => [l.item, l.ok]));

prova(
  "CONSULTAS: 89a/89b tem rol fechado de 6 linhas (os rotulos do conferir-banco), positivas no estado certo; a 89a reprova no ANTES e a 89b no DEPOIS, nos itens certos; 31a, 37a, 47a e 81a seguem positivas nos DOIS corpos; cada desvio da 89a cai no item certo",
  async () => {
    const rodarTodas = async () => {
      const r = {
        a: await rodarConsulta(A89),
        b: await rodarConsulta(B89),
        aceitam: [],
      };
      for (const { n, sql } of CONSULTAS_QUE_ACEITAM)
        r.aceitam.push({ n, linhas: await rodarConsulta(sql) });
      return r;
    };
    const depois = await emTransacao(rodarTodas, { estado: "depois" });
    const antes = await emTransacao(rodarTodas, { estado: "antes" });
    for (const c of [depois.a, depois.b, antes.a, antes.b]) {
      assert.equal(c.length, 6, "rol fechado de 6 linhas");
      assert.equal(new Set(c.map((l) => l.item)).size, 6);
    }
    for (const l of [...depois.a, ...depois.b])
      assert.ok(
        CONFERIR_BANCO.includes(`"${l.item}"`),
        `rotulo fora do rol do conferir-banco: ${l.item}`,
      );
    const CONTROLE = "controle: funcoes de public visiveis a este papel";
    const FIXOS = [
      CONTROLE,
      "create_marketplace_order_v23: corpo inalterado, o da 20261350000000 (md5)",
      "create_marketplace_order_v24: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)",
      "create_marketplace_order_v24: EXECUTE para anon, authenticated e service_role, sem PUBLIC",
    ];
    // DEPOIS: a 89a toda verdadeira; a 89b reprova justamente nos dois itens que dizem "antes" (corpo e trava).
    assert.ok(
      depois.a.every((l) => l.ok),
      JSON.stringify(depois.a.filter((l) => !l.ok)),
    );
    for (const [item, ok] of Object.entries(mapa(depois.b)))
      assert.equal(ok, FIXOS.includes(item), `89b DEPOIS: ${item}`);
    // ANTES: o contrario
    assert.ok(
      antes.b.every((l) => l.ok),
      JSON.stringify(antes.b.filter((l) => !l.ok)),
    );
    for (const [item, ok] of Object.entries(mapa(antes.a)))
      assert.equal(ok, FIXOS.includes(item), `89a ANTES: ${item}`);
    for (const estado of [depois, antes])
      for (const { n, linhas } of estado.aceitam)
        assert.ok(
          linhas.every((l) => l.ok),
          `${n}: ${JSON.stringify(linhas.filter((l) => !l.ok))}`,
        );
    // Cada desvio da 89a (no estado novo) cai no item certo.
    const casos = [
      [
        `GRANT EXECUTE ON FUNCTION ${FN.get(V24)} TO PUBLIC`,
        "create_marketplace_order_v24: EXECUTE para anon, authenticated e service_role, sem PUBLIC",
      ],
      [
        `REVOKE EXECUTE ON FUNCTION ${FN.get(V24)} FROM anon`,
        "create_marketplace_order_v24: EXECUTE para anon, authenticated e service_role, sem PUBLIC",
      ],
      [
        `ALTER FUNCTION ${FN.get(V24)} SECURITY INVOKER`,
        "create_marketplace_order_v24: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)",
      ],
      [
        decl(NOVA, `${NOVA.corpo}\n-- sabotagem\n`),
        "create_marketplace_order_v24: corpo exato (md5)",
      ],
      [
        decl(
          funcaoDe(SRC_350, V23),
          `${funcaoDe(SRC_350, V23).corpo}\n-- sabotagem\n`,
        ),
        "create_marketplace_order_v23: corpo inalterado, o da 20261350000000 (md5)",
      ],
    ];
    for (const [sabotar, itemQueCai] of casos)
      await emTransacao(
        async () => {
          await C.query(sabotar);
          const caiu = (await rodarConsulta(A89))
            .filter((l) => !l.ok)
            .map((l) => l.item);
          assert.ok(
            caiu.includes(itemQueCai),
            `${sabotar.slice(0, 50)}: caiu ${JSON.stringify(caiu)}`,
          );
        },
        { estado: "depois" },
      );
  },
);

// ---------------------------------------------------------------------------

async function main() {
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  ADM = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  await ADM.connect();
  let ok = 0;
  const falhas = [];
  // No modo mutante de arquivo roda SO a prova de comportamento (ver MUTADO).
  const lista = MUTADO
    ? PROVAS.filter((p) =>
        p.nome.startsWith("DEPOIS: visitante + online recusa"),
      )
    : PROVAS;
  try {
    for (const { nome, corpo } of lista) {
      try {
        await corpo();
        ok++;
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push({ nome, erro: e });
        console.log(
          `  FALHOU  ${nome}\n      ${String(e.stack || e.message)
            .split("\n")
            .join("\n      ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
    await ADM.end().catch(() => {});
  }
  console.log(`\n${ok}/${lista.length} provas passaram.`);
  if (falhas.length) falhar("FALHOU", `${falhas.length} prova(s) reprovadas.`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
