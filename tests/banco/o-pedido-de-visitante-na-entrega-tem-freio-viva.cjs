"use strict";

/**
 * Prova VIVA da migration 20261394000000 (o pedido de visitante na entrega tem freio: `create_marketplace_order_v23` e
 * `create_marketplace_order_v24` recusam, SEM sessao e fora do pagamento online, (a) mais de 10 unidades num pedido e (b)
 * o pedido quando a loja ja tem 10 pedidos de visitante pendentes nas ultimas 72 horas; e recusam p_address_id sem sessao;
 * dinheiro + estoque; decisao do dono de 27/10/2026), num Postgres EFEMERO local, sem rede, com os papeis de verdade
 * (anon, authenticated, service_role).
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore ja tem a 20261394 (em CI ela tem), TODO caso
 * comeca pelo estado ANTES (os corpos da 20261350 [v23] e da 20261384 [v24], instalados por CREATE OR REPLACE direto, byte
 * a byte, lidos dos arquivos) ou pelo estado DEPOIS (a propria migration). Cada caso roda numa transacao que termina em
 * ROLLBACK (exceto a CONCORRENCIA, que usa conexoes reais e dados commitados no clone descartavel).
 *
 *  ANTES      controle: sem sessao, fora do online, a v23 e a v24 aceitam 5000 unidades, 40 pedidos seguidos e o
 *             p_address_id de OUTRA pessoa (o defeito).
 *  DEPOIS     (a) o TETO DE UNIDADES: 10 passam (numa linha ou somadas em varias), 11 recusam (P0001, a frase, o
 *             identificador no DETAIL) e NADA e' reservado nem gasto (uma SEQUENCIA movida por gatilhos prova a ordem);
 *             quantidade textual '0xFF' (o cast do Postgres 17) conta; logado nao e' limitado; (b) o TETO DA LOJA: o 10o
 *             pendente passa e o 11o recusa; a janela de 72 h (a borda); so conta visitante + pending + fora do online;
 *             logado e online seguem; a RETENTATIVA de um pedido que ja existe (mesma chave, inclusive acima do teto de
 *             unidades) devolve o MESMO pedido; (c) o ENDERECO: visitante com p_address_id e' recusado, logado com o proprio
 *             endereco nasce, com o de outro continua recusado como sempre; (d) o que nao e' do freio (itens vazios,
 *             quantidade 0/negativa/textual, produto inexistente) recebe o MESMO erro de antes.
 *  CONCORRENCIA  conexoes reais: 14 visitantes simultaneos com a loja vazia => exatamente 10 pedidos (duas rodadas); o
 *             lock da loja e' deterministico (o 11o espera o 10o, que commita ou desiste); logado e online nao esperam por
 *             ele; carrinhos em ordem oposta (visitante x logado) nao dao deadlock.
 *  INTACTO    cada corpo novo e' o antigo mais UM trecho (byte a byte) e o trecho e' o mesmo nas duas; o mesmo roteiro de
 *             compras que passam grava linhas identicas antes e depois; so v23 e v24 mudam (oid, ACL, atributos, dados,
 *             outras funcoes iguais).
 *  MUTANTES   cada regra sabotada deixa a verificacao certa VERMELHA (inclusive o lock da loja, na concorrencia).
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve os `prosrc` IDENTICOS (md5 e sha256) e a mesma ACL e o
 *             segundo rollback recusa; o pre-voo recusa SEM escrever em cada estado ruim; o pos-voo reprovando desfaz a
 *             troca (conexao sem BEGIN); consultas 106a/106b e as que aceitam os corpos novos.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-pedido-de-visitante-na-entrega-tem-freio-viva.cjs
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
const ARQ = "20261394000000_o_pedido_de_visitante_na_entrega_tem_freio.sql";
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
const SRC_384 = ler(
  "20261384000000_o_pedido_pelo_app_exige_conta_e_nao_prende_estoque_de_visitante.sql",
);
const A106 = lerConsulta(
  "106a-conferir-o-pedido-de-visitante-na-entrega-tem-freio-aplicado.sql",
);
const B106 = lerConsulta(
  "106b-antes-o-pedido-de-visitante-na-entrega-tem-freio-base-vigente.sql",
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
  "89a-conferir-o-pedido-pelo-app-exige-conta-aplicado.sql",
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

// Os corpos ANTIGOS sao os VIVOS (v23 = 350, v24 = 384), LIDOS DOS ARQUIVOS, nunca copiados para ca.
const ANTIGA = {
  [V23]: funcaoDe(SRC_350, V23),
  [V24]: funcaoDe(SRC_384, V24),
};
const NOVA = {
  [V23]: funcaoDe(MIGRATION, V23),
  [V24]: funcaoDe(MIGRATION, V24),
};
const ROLL = {
  [V23]: funcaoDe(ROLLBACK, V23),
  [V24]: funcaoDe(ROLLBACK, V24),
};
const H_ANTIGO = {
  [V23]: "6b71cb823967518955407b532904ae91",
  [V24]: "f8d6ed0c3622ab41123bacb98911a98f",
};
const H_NOVO = {
  [V23]: "89c99662346d47a4d6b3d13612ca4acb",
  [V24]: "36c80a107f3ed16853c1c5b2b0cbc911",
};
// MODO MUTANTE DE ARQUIVO (PROVA_ARQUIVO_MUTADO=1): quem edita o ARQUIVO da migration para sabotar o corpo roda so a
// prova de COMPORTAMENTO (a que fica vermelha pelo que o corpo faz), sem as travas de hash e de bytes que reprovariam a
// edicao antes de qualquer comportamento ser medido. Nunca roda em CI.
const MUTADO = process.env.PROVA_ARQUIVO_MUTADO === "1";
for (const fn of [V23, V24]) {
  assert.equal(
    md5(ANTIGA[fn].corpo),
    H_ANTIGO[fn],
    `o corpo vivo de ${fn} mudou`,
  );
  if (!MUTADO)
    assert.equal(
      md5(NOVA[fn].corpo),
      H_NOVO[fn],
      `o corpo de ${fn} nesta migration mudou`,
    );
  assert.equal(
    ROLL[fn].corpo,
    ANTIGA[fn].corpo,
    `o rollback nao e o corpo vivo de ${fn} byte a byte`,
  );
  assert.equal(
    ROLL[fn].cabeca,
    ANTIGA[fn].cabeca,
    `a declaracao do rollback de ${fn} mudou`,
  );
  assert.equal(
    NOVA[fn].cabeca,
    ANTIGA[fn].cabeca,
    `a declaracao de ${fn} mudou (assinatura, atributos)`,
  );
}

// O corpo NOVO = o antigo + UM trecho (0-quater), antes do passo 1, e mais nada; o MESMO trecho nas duas funcoes.
const ANCORA_PASSO_1 =
  "    -- 1. Address Ownership Check (Only if user is logged in)\n";
const ANCORA_PASSO_0 =
  "    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO (laudo caça-bugs do molde, 31/08/2026, A1):\n";
const ANCORA_0_BIS =
  "    -- 0-bis. FORMA DE PAGAMENTO DESLIGADA NA LOJA (formas de pagamento por\n";
const ANCORA_PASSO_7 = "    -- 7. Create Order Header\n";
const FIM_DA_FUNCAO = "\n    RETURN v_order_id;\nEND;\n";
const MARCA_LOCK =
  "PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pedido_visitante_na_entrega', 0));";
let BLOCO = "";
if (!MUTADO) {
  const corte = (c) => {
    const ini = c.indexOf("    -- 0-quater.");
    assert.ok(ini > 0, "o trecho 0-quater nao esta no corpo novo");
    return c.slice(ini, c.indexOf(ANCORA_PASSO_1));
  };
  BLOCO = corte(NOVA[V24].corpo);
  assert.equal(
    corte(NOVA[V23].corpo),
    BLOCO,
    "o trecho difere entre a v23 e a v24",
  );
  for (const fn of [V23, V24]) {
    assert.equal(ANTIGA[fn].corpo.split(ANCORA_PASSO_1).length - 1, 1);
    assert.equal(
      ANTIGA[fn].corpo.replace(ANCORA_PASSO_1, () => BLOCO + ANCORA_PASSO_1),
      NOVA[fn].corpo,
      `o corpo novo de ${fn} nao e o antigo mais o trecho 0-quater, byte a byte`,
    );
    assert.equal(NOVA[fn].corpo.split(MARCA_LOCK).length - 1, 1);
    for (const [rotulo, ancora] of [
      ["passo 0", ANCORA_PASSO_0],
      ["0-bis", ANCORA_0_BIS],
      ["passo 7", ANCORA_PASSO_7],
      ["fim da funcao", FIM_DA_FUNCAO],
    ])
      assert.equal(
        ANTIGA[fn].corpo.split(ancora).length - 1,
        1,
        `ancora do ${rotulo} nao e unica em ${fn}`,
      );
  }
}

let C;
let ADM; // conexao de autocommit: semeia dados COMMITADOS e observa pg_locks/pg_stat_activity
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/**
 * O estado DEPOIS: a migration inteira (pre-voo, troca e conferencia) ou, no modo mutante, so os corpos do arquivo.
 * A arvore pode ter migrations MAIS NOVAS que redefinem a v23 (20261394200000: a v23 recusa o pagamento pelo app) e o pre-voo
 * desta migration recusa corpo vivo que nao seja o de antes nem o dela; por isso o DEPOIS parte SEMPRE do ANTES (como diz o cabecalho).
 */
const instalarNova = async () => {
  await instalarAntiga();
  await C.query(
    MUTADO ? `${decl(NOVA[V23])}\n${decl(NOVA[V24])}` : MIGRATION,
  );
};
/** O estado ANTES: os corpos vivos de antes (CREATE OR REPLACE direto; vale como o rollback, sem depender do pre-voo). */
const instalarAntiga = () =>
  C.query(`${decl(ANTIGA[V23])}\n${decl(ANTIGA[V24])}`);

const FRASE_UNIDADES =
  "Sem entrar na conta, o pedido aceita até 10 unidades. Entre na conta para comprar mais.";
const FRASE_LOJA =
  "Estamos com muitos pedidos aguardando agora. Entre na conta para finalizar o seu.";
const FRASE_ENDERECO = "Endereço inválido ou não pertence ao usuário.";
const FRASE_384 =
  "Para pagar pelo app é preciso entrar na sua conta. Sem conta, escolha pagar na retirada ou na entrega.";
const ID_UNIDADES = "visitante_teto_unidades:";
const ID_LOJA = "visitante_teto_da_loja:";
const ID_ENDERECO = "endereco_invalido:";
const ACL_DE_SEMPRE = [
  "anon=X/postgres",
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];

const U = {
  cliente: "7e7e2394-0000-4000-8000-0000000000d1",
  outro: "7e7e2394-0000-4000-8000-0000000000d2",
};
const END = {
  cliente: "7e7e2394-0000-4000-8000-0000000000e1",
  outro: "7e7e2394-0000-4000-8000-0000000000e2",
};
const PROD = "7e7e2394-0000-4000-8000-0000000000f0";
const PROD_B = "7e7e2394-0000-4000-8000-0000000000f3";
const PROD_VAR = "7e7e2394-0000-4000-8000-0000000000f1";
const VAR = "7e7e2394-0000-4000-8000-0000000000f2";
const DIGITADO = {
  cep: "38500-120",
  street: "Rua Digitada",
  number: "5",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
};
const CEP_LOCAL = "38500-100";

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

/** Uma transacao por caso, sempre desfeita, ja no estado pedido: "antes" (corpos vivos de antes) ou "depois" (migration). */
async function emTransacao(fn, { estado = "antes" } = {}) {
  await C.query("BEGIN");
  try {
    if (estado === "antes" || estado === "depois") {
      await instalarAntiga();
      for (const f of [V23, V24])
        assert.equal(
          await hashVivo(f),
          H_ANTIGO[f],
          "o estado ANTES nao montou",
        );
    }
    if (estado === "depois") {
      await instalarNova();
      if (!MUTADO)
        for (const f of [V23, V24])
          assert.equal(
            await hashVivo(f),
            H_NOVO[f],
            "o estado DEPOIS nao montou",
          );
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
  `SELECT public.${rpc}($1::jsonb, $2::numeric, $3::numeric, $4::text, $10::uuid, $5::text,
     'Comprador Prova', '5534999990000', NULL::text, $6::jsonb, $7::text, $8::text, $9::uuid) AS id`;

const item = (produto, quantity, variant = null) => ({
  product_id: produto,
  variant_id: variant,
  quantity,
});
const UM = [item(PROD, 1)];
const ITEM_COM_VARIACAO = [item(PROD_VAR, 1, VAR)];

/**
 * Faz o pedido pelo CAMINHO do checkout (`useOrders.createOrder`): R$ 100 por unidade, frete zero (a loja de prova tem
 * frete gratis "sempre" na entrega local e na retirada), `total` e' o que a tela mandou. Sem `uid`: visitante (anon).
 */
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
  return tentar(
    papel,
    SQL_PEDIDO(rpc),
    [
      JSON.stringify(itens),
      total ?? 100 * soma,
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
/** Quantas vezes a SEQUENCIA-SONDA andou: o rollback do savepoint nao a desfaz. */
const ticks = async () => {
  const r = (
    await C.query("SELECT is_called, last_value::int AS v FROM probe_freio_seq")
  ).rows[0];
  return r.is_called ? r.v : 0;
};
/** O que uma recusa NAO pode mexer: pedidos, itens, estoques e a sequencia-sonda. */
const foto = async () => ({
  pedidos: await num("SELECT count(*) AS n FROM public.marketplace_orders"),
  itens: await num("SELECT count(*) AS n FROM public.marketplace_order_items"),
  estoque: await estoque(PROD),
  estoqueB: await estoque(PROD_B),
  estoqueProdutoComVariacao: await estoque(PROD_VAR),
  estoqueVariacao: await estoqueVariacao(),
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

/** Pessoas, enderecos, produtos (simples e com variacao), loja e a sonda de ordem dentro da transacao do caso. */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@394.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente Prova', 'customer'), ($2, 'Outra Prova', 'customer')`,
    [U.cliente, U.outro],
  );
  await C.query(SQL_LOJA);
  for (const [id, dono, rua] of [
    [END.cliente, U.cliente, "Rua da Cliente"],
    [END.outro, U.outro, "Rua da Outra Pessoa"],
  ])
    await C.query(
      `INSERT INTO public.user_addresses (id, user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default)
       VALUES ($1, $2, 'Casa', 'Dona Prova', '38500-100', $3, '1', 'Centro', 'Cidade Prova', 'MG', true)`,
      [id, dono, rua],
    );
  for (const [id, nome, preco] of [
    [PROD, "Camiseta Azul 394", 100],
    [PROD_B, "Caneca Branca 394", 100],
    [PROD_VAR, "Camiseta Grade 394", 100],
  ])
    await C.query(
      "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, $2, $3, 1000, true, 40, false)",
      [id, nome, preco],
    );
  await C.query(
    "INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES ($1, $2, 'Tamanho', 'M', 50, true)",
    [VAR, PROD_VAR],
  );
  // A SONDA DE ORDEM: uma sequencia que um gatilho move em cada coisa que a recusa NAO pode ter feito. Sequencia
  // nao e' desfeita por ROLLBACK (nem de savepoint): se a recusa viesse DEPOIS de inserir o pedido ou baixar o
  // estoque (produto ou variacao), o estado final voltaria limpo, mas a sequencia teria andado.
  await C.query(`
    CREATE SEQUENCE public.probe_freio_seq;
    CREATE FUNCTION public.probe_freio_tick() RETURNS trigger LANGUAGE plpgsql AS
      $f$ BEGIN PERFORM nextval('public.probe_freio_seq'); RETURN NEW; END $f$;
    CREATE TRIGGER probe_freio_pedido BEFORE INSERT ON public.marketplace_orders
      FOR EACH ROW EXECUTE FUNCTION public.probe_freio_tick();
    CREATE TRIGGER probe_freio_estoque BEFORE UPDATE ON public.produtos
      FOR EACH ROW EXECUTE FUNCTION public.probe_freio_tick();
    CREATE TRIGGER probe_freio_variacao BEFORE UPDATE ON public.product_variants
      FOR EACH ROW EXECUTE FUNCTION public.probe_freio_tick();
  `);
}

/** Insere `n` pedidos direto na tabela (a fila que ja existe): visitante pending fora do online, salvo o que `o` mudar. */
async function fila(
  n,
  {
    userId = null,
    metodo = "cash",
    status = "pending",
    idade = "1 hour",
    marca = "fila-prova",
  } = {},
) {
  await C.query(
    `INSERT INTO public.marketplace_orders
       (user_id, total, subtotal, shipping, payment_method, status, customer_name, customer_data, created_at)
     SELECT $1::uuid, 100, 100, 0, $2::text, $3::text, $4::text, '{}'::jsonb, now() - $5::interval
       FROM generate_series(1, $6)`,
    [userId, metodo, status, marca, idade, n],
  );
}
const limparFila = (marca = "fila-prova") =>
  C.query("DELETE FROM public.marketplace_orders WHERE customer_name = $1", [
    marca,
  ]);

const comparar = (rotulo, antes, depois, f) => {
  for (const campo of Object.keys(antes))
    if (depois[campo] !== antes[campo])
      f.push(
        `${rotulo}: ${campo} foi de ${antes[campo]} para ${depois[campo]} (a recusa tem de vir ANTES de reservar)`,
      );
};
/** Confere uma recusa do freio: a frase, o P0001, o identificador no DETAIL e que nada foi reservado nem gasto. */
async function recusaEsperada(rotulo, r, frase, id, f, antes) {
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
// O COMPORTAMENTO esperado — uma verificacao por chave; devolve a lista de falhas (vazia = passou). E' a
// MESMA que roda sobre o corpo certo (tem de dar vazio) e sobre cada mutante (tem de dar nao vazio).
// ---------------------------------------------------------------------------
const CHECKS = {
  /** (a) o TETO DE UNIDADES. */
  async unidades() {
    const f = [];
    // 10 passam: numa linha, e somadas em varias linhas; v23 e v24 direto.
    for (const [rotulo, extra] of [
      ["v23, cash, 10 numa linha", { itens: [item(PROD, 10)] }],
      [
        "v23, cash, 6+4 em duas linhas",
        { itens: [item(PROD, 6), item(PROD_B, 4)] },
      ],
      [
        "v24 direto, pix, 10 numa linha",
        { rpc: V24, metodo: "pix", itens: [item(PROD, 10)] },
      ],
      [
        "v23, cash, retirada na loja, 10",
        { opcao: "store-pickup", itens: [item(PROD, 10)] },
      ],
    ]) {
      const r = await pedir(extra);
      if (!r.linhas) f.push(`unidades(${rotulo}): recusado: ${r.erro}`);
    }
    // 11 recusam, nada e' reservado.
    for (const [rotulo, extra] of [
      ["v23, cash, 11 numa linha", { itens: [item(PROD, 11)] }],
      [
        "v23, cash, 6+5 em duas linhas",
        { itens: [item(PROD, 6), item(PROD_B, 5)] },
      ],
      [
        "v23, cash, a mesma linha repetida (4+4+3)",
        { itens: [item(PROD, 4), item(PROD, 4), item(PROD, 3)] },
      ],
      [
        "v23, pix, 5000 de uma vez",
        { metodo: "pix", itens: [item(PROD, 5000)] },
      ],
      [
        "v24 direto, pix, 11",
        { rpc: V24, metodo: "pix", itens: [item(PROD, 11)] },
      ],
      [
        "v24 direto, card, 6+5",
        { rpc: V24, metodo: "card", itens: [item(PROD, 6), item(PROD_B, 5)] },
      ],
      [
        "v23, cash, produto com variacao, 11",
        { itens: [item(PROD_VAR, 11, VAR)] },
      ],
      [
        "service_role (auth.uid() nulo), 11",
        { papel: "service_role", itens: [item(PROD, 11)] },
      ],
      // O cast do Postgres 17 aceita '0xFF' (255): se o freio nao usasse o MESMO cast, passaria despercebido.
      [
        "v23, cash, quantidade textual 0xFF",
        { itens: [item(PROD, "0xFF")], total: 25500 },
      ],
      [
        "v23, cash, quantidade textual '11'",
        { itens: [item(PROD, "11")], total: 1100 },
      ],
      [
        "retirada na loja, 11",
        { opcao: "store-pickup", itens: [item(PROD, 11)] },
      ],
    ]) {
      const antes = await foto();
      const r = await pedir(extra);
      await recusaEsperada(
        `unidades(${rotulo})`,
        r,
        FRASE_UNIDADES,
        ID_UNIDADES,
        f,
        antes,
      );
    }
    // Quem tem conta nao e' limitado, em nenhum meio (v23 na entrega, v24 direto, v24 online).
    for (const [rotulo, extra] of [
      ["logado, v23, cash, 50", { metodo: "cash" }],
      ["logado, v24 direto, pix, 50", { rpc: V24, metodo: "pix" }],
      ["logado, v24, online, 50", { rpc: V24, metodo: "online" }],
    ]) {
      const r = await pedirLogado({ ...extra, itens: [item(PROD_B, 50)] });
      if (!r.linhas)
        f.push(`unidades(${rotulo}): o logado foi recusado: ${r.erro}`);
    }
    // Visitante + online na v24 segue com a frase do 0-ter (ele vem antes), nao com a do freio.
    const online = await pedir({
      rpc: V24,
      metodo: "online",
      itens: [item(PROD, 11)],
    });
    if (online.erro !== FRASE_384)
      f.push(
        `unidades(online): esperava a frase da 20261384, veio: ${online.erro ?? "pedido criado"}`,
      );
    return f;
  },

  /** (b) o TETO DA LOJA: 10 pedidos de visitante pendentes, fora do online, em 72 horas. */
  async lojaCheia() {
    const f = [];
    // 9 na fila: o 10o passa; com 10 na fila o 11o e' recusado; nada e' reservado.
    await fila(9);
    const decimo = await pedir({});
    if (!decimo.linhas)
      f.push(`loja(9 na fila, o 10o): recusado: ${decimo.erro}`);
    for (const [rotulo, extra] of [
      ["v23, cash", {}],
      ["v23, pix, retirada", { metodo: "pix", opcao: "store-pickup" }],
      ["v24 direto, cash", { rpc: V24 }],
      ["produto com variacao", { itens: ITEM_COM_VARIACAO }],
      ["service_role", { papel: "service_role" }],
    ]) {
      const antes = await foto();
      const r = await pedir(extra);
      await recusaEsperada(
        `loja(10 na fila, ${rotulo})`,
        r,
        FRASE_LOJA,
        ID_LOJA,
        f,
        antes,
      );
    }
    // 30 chamadas seguidas: nenhuma passa, estoque e sonda intactos (o ataque que o freio existe para parar).
    const antes30 = await foto();
    let nasceu = 0;
    for (let i = 0; i < 30; i++) if ((await pedir({})).linhas) nasceu += 1;
    if (nasceu > 0)
      f.push(`loja(30x): ${nasceu} pedidos nasceram acima do teto`);
    comparar("loja(30x)", antes30, await foto(), f);
    // O teto de unidades vem antes do da loja (nao toma o lock a toa) e a frase de cada um e' a dele.
    const unid = await pedir({ itens: [item(PROD, 11)] });
    if (unid.erro !== FRASE_UNIDADES)
      f.push(
        `loja(cheia + 11 unidades): esperava a frase das unidades, veio: ${unid.erro ?? "pedido criado"}`,
      );

    // Quem tem conta e o pagamento online nao sentem a fila.
    for (const [rotulo, r] of [
      ["logado, v23, cash", await pedirLogado({})],
      ["logado, v24, pix", await pedirLogado({ rpc: V24, metodo: "pix" })],
      [
        "logado, v24, online",
        await pedirLogado({ rpc: V24, metodo: "online" }),
      ],
    ])
      if (!r.linhas)
        f.push(`loja(cheia, ${rotulo}): o logado foi recusado: ${r.erro}`);
    const onlineVisitante = await pedir({ rpc: V24, metodo: "online" });
    if (onlineVisitante.erro !== FRASE_384)
      f.push(
        `loja(cheia, visitante online): esperava a frase da 20261384, veio: ${onlineVisitante.erro ?? "pedido criado"}`,
      );
    await limparFila();
    await C.query(
      "DELETE FROM public.marketplace_orders WHERE customer_name = 'Comprador Prova'",
    );

    // O que NAO entra na conta dos 10: outro status, pedido de logado, pagamento online, fora da janela de 72 h.
    for (const [rotulo, opcoes] of [
      ["status processing", { status: "processing" }],
      ["status shipping", { status: "shipping" }],
      ["status delivered (o balcao nasce assim)", { status: "delivered" }],
      ["status cancelled", { status: "cancelled" }],
      ["status new", { status: "new" }],
      ["pedido de usuario logado", { userId: U.outro }],
      ["pagamento online", { metodo: "online" }],
      ["73 horas atras", { idade: "73 hours" }],
      ["72 horas e 5 minutos atras", { idade: "72 hours 5 minutes" }],
    ]) {
      await fila(10, opcoes);
      const r = await pedir({});
      if (!r.linhas)
        f.push(
          `loja(10 com ${rotulo}): nao deviam contar, mas o pedido foi recusado: ${r.erro}`,
        );
      await limparFila();
      await C.query(
        "DELETE FROM public.marketplace_orders WHERE customer_name = 'Comprador Prova'",
      );
    }
    // O que ENTRA na conta: pending de visitante, fora do online, ate a borda das 72 h (aqui 71 h 55 min).
    for (const [rotulo, opcoes] of [
      ["pix", { metodo: "pix" }],
      ["card", { metodo: "card" }],
      ["71 horas e 55 minutos atras", { idade: "71 hours 55 minutes" }],
      ["agora", { idade: "0 seconds" }],
    ]) {
      await fila(10, opcoes);
      const r = await pedir({});
      if (r.linhas)
        f.push(`loja(10 com ${rotulo}): contam, mas o pedido nasceu`);
      else if (r.erro !== FRASE_LOJA)
        f.push(`loja(10 com ${rotulo}): frase inesperada: ${r.erro}`);
      await limparFila();
    }
    // Pedido sem forma de pagamento gravada (NULL) tambem conta: "diferente de online" nao pode sumir com ele.
    await C.query(
      `INSERT INTO public.marketplace_orders (user_id, total, subtotal, shipping, payment_method, status, customer_name, customer_data)
       SELECT NULL, 100, 100, 0, NULL, 'pending', 'fila-prova', '{}'::jsonb FROM generate_series(1, 10)`,
    );
    const nulo = await pedir({});
    if (nulo.linhas)
      f.push(
        "loja(10 com forma de pagamento NULL): contam, mas o pedido nasceu",
      );
    await limparFila();
    return f;
  },

  /** (b-2) a RETENTATIVA de um pedido que ja existe nunca e' recusada, nem acima dos tetos; chave nova e'. */
  async retentativa(montar) {
    const f = [];
    // Pedidos LEGADOS, criados pelo corpo ANTIGO (o que a loja tem hoje no ar).
    await instalarAntiga();
    const k14 = crypto.randomUUID();
    const kUltimo = crypto.randomUUID();
    await fila(9);
    const legado14 = await pedir({ chave: k14, itens: [item(PROD, 14)] });
    const legadoUltimo = await pedir({ chave: kUltimo });
    if (!legado14.linhas || !legadoUltimo.linhas) {
      f.push(
        `retentativa: o corpo ANTIGO devia criar os legados: ${legado14.erro} | ${legadoUltimo.erro}`,
      );
      await montar();
      return f;
    }
    await montar();
    // Agora a loja esta cheia (11 pendentes) e o legado tem 14 unidades; a retentativa devolve o MESMO pedido.
    const antes = await foto();
    for (const [rotulo, chave, esperado, rpc] of [
      ["14 unidades, v23", k14, legado14, V23],
      ["14 unidades, v24 direto", k14, legado14, V24],
      ["o 11o da fila, v23", kUltimo, legadoUltimo, V23],
    ]) {
      const r = await pedir({
        rpc,
        chave,
        itens: chave === k14 ? [item(PROD, 14)] : UM,
      });
      if (!r.linhas) f.push(`retentativa(${rotulo}): foi recusada: ${r.erro}`);
      else if (r.linhas[0].id !== esperado.linhas[0].id)
        f.push(`retentativa(${rotulo}): devolveu outro pedido`);
    }
    const depois = await foto();
    if (depois.pedidos !== antes.pedidos || depois.estoque !== antes.estoque)
      f.push(
        `retentativa: mexeu em pedidos/estoque (${antes.pedidos}/${antes.estoque} -> ${depois.pedidos}/${depois.estoque})`,
      );
    // Chave NOVA: com a loja cheia e acima do teto de unidades, recusa.
    const nova = await pedir({});
    if (nova.erro !== FRASE_LOJA)
      f.push(
        `retentativa(chave nova com a loja cheia): ${nova.erro ?? "pedido criado"}`,
      );
    const nova14 = await pedir({ itens: [item(PROD, 14)] });
    if (nova14.erro !== FRASE_UNIDADES)
      f.push(
        `retentativa(chave nova, 14 unidades): ${nova14.erro ?? "pedido criado"}`,
      );
    return f;
  },

  /**
   * (b-3) o pagamento ONLINE nao muda: o freio e' SO fora do online. Visitante na v23 com 'online' (nenhum caminho do
   * app manda isso; a 20261384 so fechou o online sem conta na v24) recebe o MESMO resultado de antes, acima do teto de
   * unidades e com a loja cheia. Compara o corpo ANTIGO com o estado sob teste, na mesma fixture.
   */
  async onlineIgual(montar) {
    const f = [];
    const casos = [
      ["20 unidades", {}, { itens: [item(PROD, 20)] }],
      ["1 unidade, loja cheia", { fila: 10 }, {}],
      ["11 unidades, loja cheia", { fila: 10 }, { itens: [item(PROD_B, 11)] }],
    ];
    const rodar = async () => {
      const out = [];
      for (const [rotulo, { fila: n }, extra] of casos) {
        if (n) await fila(n, { marca: "fila-online" });
        const r = await pedir({ rpc: V23, metodo: "online", ...extra });
        out.push([rotulo, r.erro ?? "nasceu"]);
        await limparFila("fila-online");
      }
      return out;
    };
    await instalarAntiga();
    const antes = await rodar();
    await montar();
    const depois = await rodar();
    if (JSON.stringify(antes) !== JSON.stringify(depois))
      f.push(
        `onlineIgual: o freio mexeu no pagamento online: antes ${JSON.stringify(antes)} / depois ${JSON.stringify(depois)}`,
      );
    return f;
  },

  /** (c) o ENDERECO salvo nao e' de visitante; o do logado segue como sempre. */
  async endereco() {
    const f = [];
    for (const [rotulo, extra] of [
      ["v23, cash, endereco de OUTRA pessoa", { enderecoId: END.outro }],
      [
        "v23, cash, endereco da cliente (mas sem sessao)",
        { enderecoId: END.cliente },
      ],
      [
        "v23, cash, id inexistente",
        { enderecoId: "7e7e2394-0000-4000-8000-0000000000ff" },
      ],
      [
        "v24 direto, pix, endereco de outra pessoa",
        { rpc: V24, metodo: "pix", enderecoId: END.outro },
      ],
      [
        "v23, retirada, endereco de outra pessoa",
        { opcao: "store-pickup", enderecoId: END.outro },
      ],
      [
        "service_role, endereco de outra pessoa",
        { papel: "service_role", enderecoId: END.outro },
      ],
    ]) {
      const antes = await foto();
      const r = await pedir(extra);
      await recusaEsperada(
        `endereco(${rotulo})`,
        r,
        FRASE_ENDERECO,
        ID_ENDERECO,
        f,
        antes,
      );
    }
    // O visitante que manda o endereco DIGITADO (o checkout de sempre) segue comprando, com o endereco no pedido.
    const ok = await pedir({});
    if (!ok.linhas)
      f.push(`endereco(visitante com endereco digitado): recusado: ${ok.erro}`);
    else {
      const o = await lerPedido(ok.linhas[0].id);
      if (o.address_id !== null)
        f.push(
          `endereco(digitado): address_id ${o.address_id} (devia ser nulo)`,
        );
      if (o.customer_data?.address?.street !== "Rua Digitada")
        f.push("endereco(digitado): o endereco digitado nao foi para o pedido");
    }
    // Quem tem conta: o proprio endereco nasce (com o retrato do endereco), o de outra pessoa e' recusado como sempre.
    for (const [rotulo, extra] of [
      ["logado, v23, cash", { metodo: "cash" }],
      ["logado, v24, pix", { rpc: V24, metodo: "pix" }],
      ["logado, v24, online", { rpc: V24, metodo: "online" }],
    ]) {
      const r = await pedirLogado({ ...extra, enderecoId: END.cliente });
      if (!r.linhas) {
        f.push(`endereco(${rotulo}, o proprio): recusado: ${r.erro}`);
        continue;
      }
      const o = await lerPedido(r.linhas[0].id);
      if (o.address_id !== END.cliente)
        f.push(`endereco(${rotulo}): address_id ${o.address_id}`);
      if (o.customer_data?.address?.street !== "Rua da Cliente")
        f.push(
          `endereco(${rotulo}): o retrato do endereco nao foi para o pedido`,
        );
      const alheio = await pedirLogado({ ...extra, enderecoId: END.outro });
      if (alheio.linhas)
        f.push(`endereco(${rotulo}, de outra pessoa): o pedido NASCEU`);
      else if (alheio.erro !== FRASE_ENDERECO)
        f.push(`endereco(${rotulo}, de outra pessoa): frase ${alheio.erro}`);
      else if (alheio.detalhe)
        f.push(
          `endereco(${rotulo}, de outra pessoa): a recusa de sempre ganhou DETAIL: ${alheio.detalhe}`,
        );
    }
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
  "ANTES: com os corpos de antes, sem sessao e fora do online, a v23 e a v24 aceitam 5000 unidades, 40 pedidos seguidos de visitante e o p_address_id de OUTRA pessoa (o defeito)",
  () =>
    emTransacao(async () => {
      await semear();
      for (const fn of [V23, V24])
        assert.equal(await prosrcVivo(fn), ANTIGA[fn].corpo);
      assert.deepEqual(await acl(V23), ACL_DE_SEMPRE);
      assert.deepEqual(await acl(V24), ACL_DE_SEMPRE);
      const antes = await foto();
      const grande = await pedir({ itens: [item(PROD, 500)] });
      assert.ok(grande.linhas, `o controle devia nascer: ${grande.erro}`);
      assert.equal(
        (await foto()).estoque,
        antes.estoque - 500,
        "baixou 500 unidades sem conta",
      );
      // O ataque: sem conta nenhuma, 40 pedidos pendentes seguidos.
      for (let i = 0; i < 40; i++)
        assert.ok((await pedir({})).linhas, `pedido ${i}`);
      assert.equal(
        await num(
          "SELECT count(*) AS n FROM public.marketplace_orders WHERE user_id IS NULL AND status = 'pending'",
        ),
        41,
      );
      const viaV24 = await pedir({
        rpc: V24,
        metodo: "pix",
        itens: [item(PROD, 20)],
      });
      assert.ok(viaV24.linhas, `a v24 direto tambem aceitava: ${viaV24.erro}`);
      // O endereco de OUTRA pessoa pendurado no pedido do visitante (achado 3).
      const alheio = await pedir({ enderecoId: END.outro });
      assert.ok(alheio.linhas, `o corpo antigo aceitava: ${alheio.erro}`);
      assert.equal(
        (await lerPedido(alheio.linhas[0].id)).address_id,
        END.outro,
      );
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: teto de 10 unidades (10 passam, 11 recusam; somadas em varias linhas; '0xFF'; logado livre); teto de 10 pedidos de visitante pendentes por loja (a borda, a janela de 72 h, o que conta e o que nao conta); a retentativa nunca e' recusada; p_address_id de visitante recusado; nada reservado nem gasto na recusa",
  async () => {
    const falhas = await todasAsVerificacoes(instalarNova);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

/** O que NAO e' do freio recebe o MESMO erro de antes: itens vazios, quantidade 0/negativa/textual, produto inexistente. */
prova(
  "DEPOIS: o que nao e' do freio recebe o MESMO erro de antes (itens vazios ou nulos, quantidade 0, negativa, textual, soma de positivas dentro do teto, produto inexistente, loja sem CEP)",
  async () => {
    const casos = [
      ["itens vazios", { itens: [] }],
      ["quantidade 0", { itens: [item(PROD, 0)], total: 0 }],
      ["quantidade negativa", { itens: [item(PROD, -3)], total: -300 }],
      [
        "negativa + positivas dentro do teto",
        { itens: [item(PROD, 5), item(PROD_B, -2)], total: 300 },
      ],
      [
        "quantidade textual invalida",
        { itens: [item(PROD, "abc")], total: 100 },
      ],
      ["quantidade decimal", { itens: [item(PROD, 1.5)], total: 150 }],
      [
        "quantidade ausente",
        { itens: [{ product_id: PROD, variant_id: null }], total: 100 },
      ],
      [
        "produto inexistente",
        {
          itens: [item("7e7e2394-0000-4000-8000-0000000000ff", 3)],
          total: 300,
        },
      ],
      ["total adulterado", { itens: [item(PROD, 3)], total: 50 }],
      ["sem opcao de entrega", { opcao: null }],
      ["metodo nulo", { metodo: null }],
      ["metodo desconhecido", { metodo: "fiado" }],
    ];
    const rodar = (estado) =>
      emTransacao(
        async () => {
          await semear();
          const r = [];
          for (const [rotulo, extra] of casos) {
            for (const rpc of [V23, V24]) {
              const x = await pedir({ ...extra, rpc });
              r.push([
                `${rotulo} (${rpc})`,
                x.erro ?? "nasceu",
                x.codigo ?? "",
              ]);
            }
          }
          return r;
        },
        { estado },
      );
    const antes = await rodar("antes");
    const depois = await rodar("depois");
    assert.deepEqual(
      depois,
      antes,
      "o freio mudou o erro de algo que nao e' dele",
    );
    // E o controle nao e' vacuo: pelo menos alguns recusam, pelo menos um nasce ou recusa por motivo de negocio.
    assert.ok(antes.filter((x) => x[1] !== "nasceu").length >= 8);
  },
);

// ---------------------------------------------------------------------------
// CONCORRENCIA: conexoes reais, dados commitados no clone descartavel
// ---------------------------------------------------------------------------

const U2 = { cliente: "7e7e2394-0000-4000-8000-0000000002d1" };
const PC = [
  "7e7e2394-0000-4000-8000-0000000002f0",
  "7e7e2394-0000-4000-8000-0000000002f1",
  "7e7e2394-0000-4000-8000-0000000002f2",
  "7e7e2394-0000-4000-8000-0000000002f3",
];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function semearCommitado() {
  await ADM.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@394c.teste', '{}'::jsonb) ON CONFLICT DO NOTHING",
    [U2.cliente],
  );
  await ADM.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente 394 c', 'customer') ON CONFLICT DO NOTHING",
    [U2.cliente],
  );
  await ADM.query(SQL_LOJA);
  for (const [i, p] of PC.entries())
    await ADM.query(
      "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, $2, 100, 1000, true, 40, false) ON CONFLICT (id) DO UPDATE SET estoque = 1000",
      [p, `Produto Concorrente 394 ${i}`],
    );
}
async function limparCommitado() {
  await ADM.query(
    "DELETE FROM public.marketplace_order_items WHERE product_id = ANY($1::uuid[])",
    [PC],
  ).catch(() => {});
  await ADM.query(
    "DELETE FROM public.marketplace_orders WHERE customer_name IN ('Comprador Prova', 'fila-conc') OR user_id = $1",
    [U2.cliente],
  ).catch(() => {});
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
const comprarConc = (
  c,
  {
    produtos = [PC[0]],
    metodo = "cash",
    rpc = V23,
    chave = crypto.randomUUID(),
  } = {},
) =>
  c.query(SQL_PEDIDO(rpc), [
    JSON.stringify(produtos.map((p) => item(p, 1))),
    100 * produtos.length,
    0,
    metodo,
    null,
    JSON.stringify(DIGITADO),
    DIGITADO.cep,
    "local-delivery",
    chave,
    null,
  ]);
/** Observa uma promessa de consulta sem derrubar o teste: { fim, p: Promise<{ok}|{erro, detalhe}> }. */
function observar(promessa) {
  const e = { fim: false };
  e.p = promessa
    .then(
      (r) => ({ ok: r.rows[0].id }),
      (x) => ({ erro: x.message, detalhe: x.detail, codigo: x.code }),
    )
    .then((r) => {
      e.fim = true;
      return r;
    });
  return e;
}
/** A sessao `pid` esta PARADA numa espera por advisory lock (pg_locks) ou por trava de linha. */
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
const pendentesDeVisitante = async () =>
  Number(
    (
      await ADM.query(
        "SELECT count(*) AS n FROM public.marketplace_orders WHERE user_id IS NULL AND status = 'pending' AND payment_method IS DISTINCT FROM 'online'",
      )
    ).rows[0].n,
  );
const filaCommitada = (n) =>
  ADM.query(
    `INSERT INTO public.marketplace_orders (user_id, total, subtotal, shipping, payment_method, status, customer_name, customer_data)
     SELECT NULL, 100, 100, 0, 'cash', 'pending', 'fila-conc', '{}'::jsonb FROM generate_series(1, $1)`,
    [n],
  );

/** A CONCORRENCIA inteira; devolve a lista de falhas (vazia = passou). Roda sobre o corpo certo e sobre o mutante sem lock. */
async function concorrencia() {
  const f = [];
  await semearCommitado();
  try {
    // (1) 14 visitantes SIMULTANEOS com a loja vazia: exatamente 10 pedidos (duas rodadas).
    for (const rodada of [1, 2]) {
      await limparCommitado();
      const sessoes = [];
      try {
        for (let i = 0; i < 14; i++) sessoes.push(await sessao("anon"));
        const obs = sessoes.map((c, i) => {
          // O carrinho gira entre os produtos, e alguns carrinhos tem os dois em ordem oposta (a ordem global das
          // travas de linha da funcao tem de continuar valendo com o lock da loja na frente).
          const produtos =
            i % 3 === 0
              ? [PC[0], PC[1]]
              : i % 3 === 1
                ? [PC[1], PC[0]]
                : [PC[2]];
          return observar(
            (async () => {
              await c.query("BEGIN");
              try {
                const r = await comprarConc(c, { produtos });
                await c.query("COMMIT");
                return r;
              } catch (e) {
                await c.query("ROLLBACK").catch(() => {});
                throw e;
              }
            })(),
          );
        });
        const rs = await Promise.all(obs.map((o) => o.p));
        const ok = rs.filter((r) => r.ok).length;
        const teto = rs.filter((r) =>
          String(r.detalhe).startsWith(ID_LOJA),
        ).length;
        const outros = rs.filter(
          (r) => !r.ok && !String(r.detalhe).startsWith(ID_LOJA),
        );
        if (ok !== 10)
          f.push(
            `concorrencia(rodada ${rodada}): ${ok} pedidos nasceram (esperado exatamente 10)`,
          );
        if (teto !== 4)
          f.push(
            `concorrencia(rodada ${rodada}): ${teto} recusas do teto da loja (esperado 4)`,
          );
        if (outros.length)
          f.push(
            `concorrencia(rodada ${rodada}): erros inesperados: ${JSON.stringify(outros.slice(0, 2))}`,
          );
        const n = await pendentesDeVisitante();
        if (n !== 10)
          f.push(
            `concorrencia(rodada ${rodada}): ${n} pendentes gravados (esperado 10)`,
          );
      } finally {
        await fechar(...sessoes);
      }
    }

    // (2) DETERMINISTICO: com 9 na fila, o 10o ainda nao commitou e o 11o chega => espera o lock da loja.
    for (const desfecho of ["commit", "rollback"]) {
      await limparCommitado();
      await filaCommitada(9);
      const A = await sessao("anon");
      const B = await sessao("anon");
      try {
        await A.query("BEGIN");
        const idA = (await comprarConc(A)).rows[0].id;
        await B.query("BEGIN");
        const eb = observar(comprarConc(B));
        if (!(await emEspera(B.pid, "advisory")))
          f.push(
            `concorrencia(${desfecho}): o 11o devia esperar o lock da loja e passou direto`,
          );
        else if (eb.fim)
          f.push(
            `concorrencia(${desfecho}): o 11o terminou antes de o 10o soltar o lock`,
          );
        await A.query(desfecho === "commit" ? "COMMIT" : "ROLLBACK");
        const rb = await eb.p;
        if (desfecho === "commit") {
          if (!String(rb.detalhe).startsWith(ID_LOJA))
            f.push(
              `concorrencia(commit): o 11o devia ser recusado pelo teto da loja: ${JSON.stringify(rb)}`,
            );
        } else if (!rb.ok) {
          f.push(
            `concorrencia(rollback): o 10o desistiu, o 11o devia nascer: ${JSON.stringify(rb)}`,
          );
        }
        await B.query(rb.ok ? "COMMIT" : "ROLLBACK");
        const esperado = desfecho === "commit" ? 10 : 10;
        const n = await pendentesDeVisitante();
        if (n !== esperado)
          f.push(
            `concorrencia(${desfecho}): ${n} pendentes (esperado ${esperado}); idA ${idA}`,
          );
      } finally {
        await fechar(A, B);
      }
    }

    // (3) logado e online NAO esperam o lock da loja; o visitante com a fila cheia e' recusado sem esperar linha de produto.
    {
      await limparCommitado();
      const A = await sessao("anon");
      const L = await sessao("authenticated");
      const O = await sessao("anon");
      try {
        await A.query("BEGIN");
        await comprarConc(A, { produtos: [PC[2]] }); // A segura o lock da loja ate o fim
        const el = observar(
          comprarConc(L, { produtos: [PC[3]], metodo: "cash" }),
        );
        if (!(await terminaAte(el, 5000)))
          f.push("concorrencia(logado): esperou o lock do visitante");
        else if (!(await el.p).ok)
          f.push(
            `concorrencia(logado): recusado: ${JSON.stringify(await el.p)}`,
          );
        const eo = observar(
          comprarConc(O, { produtos: [PC[3]], metodo: "online", rpc: V24 }),
        );
        if (!(await terminaAte(eo, 5000)))
          f.push("concorrencia(online): esperou o lock do visitante");
        else if (!String((await eo.p).erro).includes("entrar na sua conta"))
          f.push(
            `concorrencia(online): esperava a frase da 20261384: ${JSON.stringify(await eo.p)}`,
          );
        await A.query("COMMIT");
      } finally {
        await fechar(A, L, O);
      }
    }

    // (4) carrinhos em ordem OPOSTA, visitante x logado, ao mesmo tempo: nenhum deadlock (40P01), todos nascem.
    for (let rodada = 0; rodada < 4; rodada++) {
      await limparCommitado();
      const sv = [];
      const sl = [];
      try {
        for (let i = 0; i < 2; i++) {
          sv.push(await sessao("anon"));
          sl.push(await sessao("authenticated"));
        }
        const obs = [
          ...sv.map((c) =>
            observar(comprarConc(c, { produtos: [PC[0], PC[1]] })),
          ),
          ...sl.map((c) =>
            observar(comprarConc(c, { produtos: [PC[1], PC[0]] })),
          ),
        ];
        const rs = await Promise.all(obs.map((o) => o.p));
        const ruins = rs.filter((r) => !r.ok);
        if (ruins.length)
          f.push(
            `concorrencia(ordem oposta, rodada ${rodada}): ${JSON.stringify(ruins.slice(0, 2))}`,
          );
      } finally {
        await fechar(...sv, ...sl);
      }
    }
  } finally {
    await limparCommitado();
  }
  return f;
}

prova(
  "CONCORRENCIA: 14 visitantes simultaneos com a loja vazia => exatamente 10 pedidos (2 rodadas); o 11o ESPERA o lock da loja e e' recusado se o 10o commita, ou nasce se o 10o desiste; logado e online nao esperam por ele; carrinhos em ordem oposta (visitante x logado) nao dao deadlock",
  async () => {
    await ADM.query(`${decl(ANTIGA[V23])}\n${decl(ANTIGA[V24])}`);
    await ADM.query(
      MUTADO ? `${decl(NOVA[V23])}\n${decl(NOVA[V24])}` : MIGRATION,
    );
    const falhas = await concorrencia();
    assert.deepEqual(falhas, [], falhas.join("\n"));
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

/** O mesmo roteiro de compras que passam (pelo app logado, na entrega, retirada, produto com variacao, visitante). */
async function roteiro() {
  await semear();
  const passos = [
    { logado: true, rpc: V24, metodo: "online" },
    { logado: true, rpc: V24, metodo: "online", opcao: "store-pickup" },
    { logado: true, rpc: V24, metodo: "online", itens: ITEM_COM_VARIACAO },
    { logado: true, rpc: V24, metodo: "pix", enderecoId: END.cliente },
    { logado: true, rpc: V23, metodo: "cash" },
    { logado: true, rpc: V23, metodo: "cash", itens: [item(PROD, 30)] },
    { rpc: V23, metodo: "cash" },
    { rpc: V23, metodo: "pix", opcao: "store-pickup" },
    { rpc: V24, metodo: "cash", itens: [item(PROD, 10)] },
    { rpc: V23, metodo: "card", itens: [item(PROD, 4), item(PROD_B, 6)] },
  ];
  const pedidos = [];
  for (const [i, { logado, ...p }] of passos.entries()) {
    const chave = `7e7e2394-0000-4000-8000-00000000c0${i}${i}`;
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
  return {
    pedidos,
    estoque: await estoque(),
    estoqueB: await estoque(PROD_B),
    estoqueVariacao: await estoqueVariacao(),
  };
}

prova(
  "INTACTO: o MESMO roteiro de compras que passam (logado online/pix/na entrega, retirada, variacao, 30 unidades de logado, visitante na entrega com ate 10 unidades) grava linhas identicas no estado ANTES e no DEPOIS — total, subtotal, frete, itens, estoque",
  async () => {
    const antes = await emTransacao(roteiro, { estado: "antes" });
    const depois = await emTransacao(roteiro, { estado: "depois" });
    assert.ok(antes.estoque < 1000 - 40, "o roteiro baixou o estoque");
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
    "user_addresses",
  ])
    out[t] = (
      await C.query(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.${t} x`,
      )
    ).rows[0];
  return out;
}

prova(
  "SO OS CORPOS: aplicar a migration muda SO o corpo da v23 e o da v24 (nenhuma outra funcao, nenhuma tabela, nenhuma ACL, nenhuma linha de dado); oid, ACL, atributos e assinatura ficam; o corpo novo de cada uma e' o antigo mais o trecho 0-quater; o pedido LEGADO (14 unidades, sem conta) fica byte a byte",
  () =>
    emTransacao(async () => {
      await semear();
      const legado = await pedir({ itens: [item(PROD, 14)] });
      assert.ok(
        legado.linhas,
        `o corpo antigo devia criar o legado: ${legado.erro}`,
      );
      const legadoLogado = await pedirLogado({});
      assert.ok(legadoLogado.linhas);
      const antes = await retratoDoSchema();
      const dadosAntes = await retratoDosDados();
      const oids = { [V23]: await oidVivo(V23), [V24]: await oidVivo(V24) };
      const acls = { [V23]: await aclBruto(V23), [V24]: await aclBruto(V24) };
      assert.equal(await aplicar(MIGRATION), null);
      const depois = await retratoDoSchema();
      assert.deepEqual(depois.tabelas, antes.tabelas, "ACL de tabela mudou");
      assert.equal(depois.funcoes.length, antes.funcoes.length);
      const mudou = depois.funcoes.filter(
        (f, i) => JSON.stringify(f) !== JSON.stringify(antes.funcoes[i]),
      );
      assert.deepEqual(
        mudou.map((f) => f.f.replace(/\(.*$/, "")).sort(),
        [V23, V24],
        "so a v23 e a v24 podem mudar",
      );
      for (const m of mudou) {
        const velho = antes.funcoes.find((x) => x.f === m.f);
        assert.deepEqual(
          { ...m, corpo: 0 },
          { ...velho, corpo: 0 },
          "so o corpo muda (oid, ACL, atributos)",
        );
      }
      for (const fn of [V23, V24]) {
        assert.equal(await oidVivo(fn), oids[fn]);
        assert.equal(await aclBruto(fn), acls[fn]);
        assert.deepEqual(await acl(fn), ACL_DE_SEMPRE);
        assert.equal(await prosrcVivo(fn), NOVA[fn].corpo);
        assert.equal(await hashVivo(fn), H_NOVO[fn]);
      }
      assert.deepEqual(
        await retratoDosDados(),
        dadosAntes,
        "a migration mexeu em dado (o legado inclusive)",
      );
      // O legado continua sendo devolvido pelo retry (mesma chave), mesmo acima do teto de unidades.
      const o = await lerPedido(legado.linhas[0].id);
      assert.equal(o.user_id, null);
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
const mover = (c, ancora) => {
  const r = sem(c);
  assert.equal(
    r.split(ancora).length - 1,
    1,
    `ancora nao unica: ${ancora.slice(0, 50)}`,
  );
  return r.replace(ancora, () => BLOCO + ancora);
};
/** Troca uma vez, dentro do BLOCO, e devolve o corpo com o bloco trocado (a sabotagem tem de mudar o texto). */
const trocar = (de, para) => (c) => {
  assert.equal(
    BLOCO.split(de).length - 1 >= 1,
    true,
    `trecho nao achado no bloco: ${de}`,
  );
  return c.replace(BLOCO, () => BLOCO.split(de).join(para));
};
const BLOCO_UNIDADES = BLOCO
  ? BLOCO.slice(
      BLOCO.indexOf("        -- (b) TETO DE UNIDADES"),
      BLOCO.indexOf("        -- (c) TETO DA LOJA"),
    )
  : "";
const BLOCO_ENDERECO = BLOCO
  ? BLOCO.slice(
      BLOCO.indexOf(
        "    IF p_address_id IS NOT NULL AND v_user_id IS NULL THEN",
      ),
      BLOCO.indexOf(
        "    IF v_user_id IS NULL AND p_payment_method IS DISTINCT FROM 'online' THEN",
      ),
    )
  : "";
const COND_VISITANTE =
  "IF v_user_id IS NULL AND p_payment_method IS DISTINCT FROM 'online' THEN";
const TROCAS = {
  "sem o freio (os corpos antigos)": {
    aplica: null,
    vermelho: ["unidades", "loja(", "endereco("],
  },
  "sem o teto de unidades": {
    aplica: (c) => c.replace(BLOCO, () => BLOCO.replace(BLOCO_UNIDADES, "")),
    vermelho: ["unidades("],
  },
  "teto de unidades em 11 (erra a borda)": {
    aplica: trocar(
      "FROM jsonb_array_elements(p_items) AS e) > 10 THEN",
      "FROM jsonb_array_elements(p_items) AS e) > 11 THEN",
    ),
    vermelho: ["unidades(v23, cash, 11 numa linha)"],
  },
  "o teto de unidades conta so a primeira linha (nao soma)": {
    aplica: trocar(
      "SELECT COALESCE(sum(GREATEST((e->>'quantity')::integer, 0)), 0)",
      "SELECT COALESCE(max(GREATEST((e->>'quantity')::integer, 0)), 0)",
    ),
    vermelho: ["unidades(v23, cash, 6+5 em duas linhas)"],
  },
  "o teto de unidades le a quantidade por regex (nao pelo cast do laco)": {
    aplica: trocar(
      "sum(GREATEST((e->>'quantity')::integer, 0))",
      "sum(CASE WHEN (e->>'quantity') ~ '^[0-9]+$' THEN (e->>'quantity')::integer ELSE 0 END)",
    ),
    vermelho: ["unidades(v23, cash, quantidade textual 0xFF)"],
  },
  "sem o teto da loja": {
    aplica: (c) =>
      c.replace(BLOCO, () =>
        BLOCO.replace(/ {8}-- \(c\) TETO DA LOJA[\s\S]*?\n {8}END IF;\n/, ""),
      ),
    vermelho: ["loja("],
  },
  "teto da loja em 11 (erra a borda)": {
    aplica: trocar(
      "AND created_at > now() - interval '72 hours') >= 10 THEN",
      "AND created_at > now() - interval '72 hours') >= 11 THEN",
    ),
    vermelho: ["loja(10 na fila"],
  },
  "janela de 24 horas em vez de 72": {
    aplica: trocar("interval '72 hours'", "interval '24 hours'"),
    vermelho: ["loja(10 com 71 horas e 55 minutos atras)"],
  },
  "conta pedido em qualquer status (sem o status pending)": {
    aplica: trocar("AND status = 'pending'\n", ""),
    vermelho: ["loja(10 com status"],
  },
  "conta pedido de usuario logado (sem o user_id nulo)": {
    aplica: trocar("WHERE user_id IS NULL\n", "WHERE true\n"),
    vermelho: ["loja(10 com pedido de usuario logado)"],
  },
  "conta tambem o pagamento online (sem o filtro de meio)": {
    aplica: trocar(
      "               AND payment_method IS DISTINCT FROM 'online'\n",
      "",
    ),
    vermelho: ["loja(10 com pagamento online)"],
  },
  "o freio vale para o logado (sem a checagem de sessao)": {
    aplica: trocar(
      COND_VISITANTE,
      "IF p_payment_method IS DISTINCT FROM 'online' THEN",
    ),
    vermelho: ["unidades(logado", "loja(cheia, logado"],
  },
  "o freio vale para o pagamento online (sem a checagem do meio)": {
    aplica: trocar(COND_VISITANTE, "IF v_user_id IS NULL THEN"),
    vermelho: ["onlineIgual"],
  },
  "a recusa vem DEPOIS de reservar estoque e criar o pedido (so antes do RETURN)":
    {
      aplica: (c) => mover(c, FIM_DA_FUNCAO),
      vermelho: ["unidades(", "loja("],
    },
  "o freio vem ANTES do passo 0 (a idempotencia): o retry de um pedido que ja existe e' recusado":
    {
      aplica: (c) => mover(c, ANCORA_PASSO_0),
      vermelho: ["retentativa("],
    },
  "o freio so vem antes do INSERT do pedido (depois da leitura do carrinho e dos portoes)":
    {
      aplica: (c) => mover(c, ANCORA_PASSO_7),
      // So o teto de unidades distingue: a recusa da loja cheia nao muda de mensagem quando o carrinho e' valido.
      vermelho: ["unidades("],
    },
  "sem a recusa do endereco de visitante": {
    aplica: (c) => c.replace(BLOCO, () => BLOCO.replace(BLOCO_ENDERECO, "")),
    vermelho: ["endereco("],
  },
  "a recusa do endereco vale tambem para o logado com o proprio endereco": {
    aplica: trocar(
      "IF p_address_id IS NOT NULL AND v_user_id IS NULL THEN",
      "IF p_address_id IS NOT NULL THEN",
    ),
    vermelho: ["endereco(logado"],
  },
};

for (const [nome, { aplica, vermelho }] of Object.entries(TROCAS)) {
  prova(`MUTANTE vermelho — ${nome}`, async () => {
    const instalar = async () => {
      await instalarAntiga();
      if (aplica === null) return;
      for (const fn of [V23, V24]) {
        const mutado = aplica(NOVA[fn].corpo);
        assert.notEqual(
          mutado,
          NOVA[fn].corpo,
          "a sabotagem nao mudou o corpo",
        );
        await C.query(decl(NOVA[fn], mutado));
      }
    };
    const falhas = await todasAsVerificacoes(instalar);
    assert.ok(falhas.length > 0, `o mutante "${nome}" NAO ficou vermelho`);
    for (const alvo of vermelho)
      assert.ok(
        falhas.some((x) => x.includes(alvo)),
        `o mutante "${nome}" devia reprovar a verificacao "${alvo}"; reprovou: ${falhas.slice(0, 6).join(" | ")}`,
      );
    console.log(
      `    (vermelho em ${falhas.length} verificacoes; ex.: ${falhas[0]})`,
    );
  });
}

prova(
  "MUTANTE vermelho — sem o advisory lock da loja (a contagem nao serializa): a concorrencia deterministica passa do teto",
  async () => {
    await ADM.query(`${decl(ANTIGA[V23])}\n${decl(ANTIGA[V24])}`);
    for (const fn of [V23, V24]) {
      const mutado = NOVA[fn].corpo.replace(MARCA_LOCK, () => "PERFORM 1;");
      assert.notEqual(mutado, NOVA[fn].corpo);
      await ADM.query(decl(NOVA[fn], mutado));
    }
    const falhas = await concorrencia();
    assert.ok(
      falhas.length > 0,
      "sem o lock a concorrencia devia ficar vermelha",
    );
    assert.ok(
      falhas.some((x) => /concorrencia\((commit|rollback)\)|rodada/.test(x)),
      `devia reprovar a espera ou a contagem: ${falhas.join(" | ")}`,
    );
    console.log(
      `    (vermelho em ${falhas.length} verificacoes; ex.: ${falhas[0]})`,
    );
    // Devolve o estado novo ao clone: o pre-voo da migration so aceita o corpo antigo (ou o novo), nao o mutado.
    await ADM.query(`${decl(ANTIGA[V23])}\n${decl(ANTIGA[V24])}`);
    await ADM.query(MIGRATION);
  },
);

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, CRLF, rollback, pre-voo, pos-voo, atomicidade
// ---------------------------------------------------------------------------

const retrato = async () => ({
  h: [await hashVivo(V23), await hashVivo(V24)],
  src: [sha256(await prosrcVivo(V23)), sha256(await prosrcVivo(V24))],
  oid: [await oidVivo(V23), await oidVivo(V24)],
  acl: [await aclBruto(V23), await aclBruto(V24)],
});

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL); o rollback devolve os prosrc IDENTICOS (md5 e sha256 dos corpos vivos) e a mesma ACL; o segundo rollback RECUSA; ida e volta termina igual",
  () =>
    emTransacao(async () => {
      const original = await retrato();
      assert.deepEqual(original.src, [
        sha256(ANTIGA[V23].corpo),
        sha256(ANTIGA[V24].corpo),
      ]);
      assert.equal(await aplicar(MIGRATION), null);
      const um = await retrato();
      assert.deepEqual(um.h, [H_NOVO[V23], H_NOVO[V24]]);
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retrato(), um, "reaplicar mudou o estado");
      assert.equal(await aplicar(emCRLF(MIGRATION)), null);
      const crlf = await retrato();
      assert.deepEqual(
        crlf.h,
        um.h,
        "CRLF: o hash (sem CR) tem de ser o mesmo",
      );
      assert.deepEqual(crlf.oid, um.oid);
      assert.deepEqual(crlf.acl, um.acl);
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
      assert.deepEqual(
        (await retrato()).h,
        [H_ANTIGO[V23], H_ANTIGO[V24]],
        "rollback em CRLF",
      );
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retrato(), um, "ida, volta e ida");
    }),
);

const ESTADOS_RUINS = {};
for (const fn of [V23, V24]) {
  const outra = fn === V23 ? V24 : V23;
  Object.assign(ESTADOS_RUINS, {
    [`corpo desconhecido (${fn} com um comentario a mais)`]: async () => {
      await C.query(
        decl(
          ANTIGA[fn],
          `${ANTIGA[fn].corpo}\n-- redefinicao que ninguem revisou\n`,
        ),
      );
    },
    [`atributo diferente (${fn} STABLE)`]: async () => {
      await C.query(`ALTER FUNCTION ${FN.get(fn)} STABLE`);
    },
    [`atributo diferente (${fn} SECURITY INVOKER)`]: async () => {
      await C.query(`ALTER FUNCTION ${FN.get(fn)} SECURITY INVOKER`);
    },
    [`sobrecarga (outra ${fn})`]: async () => {
      await C.query(
        `CREATE FUNCTION public.${fn}(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
      );
    },
    [`funcao ausente (${fn} apagada)`]: async () => {
      await C.query(`DROP FUNCTION ${FN.get(fn)}`);
    },
    [`ACL aberta (PUBLIC executa ${fn})`]: async () => {
      await C.query(`GRANT EXECUTE ON FUNCTION ${FN.get(fn)} TO PUBLIC`);
    },
    [`anon sem EXECUTE em ${fn}: o checkout da convidada quebraria`]:
      async () => {
        await C.query(`REVOKE EXECUTE ON FUNCTION ${FN.get(fn)} FROM anon`);
      },
    [`authenticated sem EXECUTE em ${fn}`]: async () => {
      await C.query(
        `REVOKE EXECUTE ON FUNCTION ${FN.get(fn)} FROM authenticated`,
      );
    },
    [`service_role sem EXECUTE em ${fn}`]: async () => {
      await C.query(
        `REVOKE EXECUTE ON FUNCTION ${FN.get(fn)} FROM service_role`,
      );
    },
    [`so ${fn} voltou a um corpo mais velho e ${outra} segue no vigente`]:
      async () => {
        // Um corpo da 20261244 (anterior ao vivo): nao e' o vigente nem o desta migration.
        const velha = funcaoDe(
          ler("20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql"),
          fn,
        );
        await C.query(decl(velha));
      },
  });
}

prova(
  "MIGRATION: o pre-voo recusa SEM escrever em cada estado ruim (B1_BASELINE_DIVERGENT; nenhum corpo muda, nas DUAS funcoes) e o rollback-manual tambem",
  () =>
    emTransacao(async () => {
      for (const [nome, ruim] of Object.entries(ESTADOS_RUINS)) {
        await C.query("SAVEPOINT ruim");
        await ruim();
        const fotoAntes = [await prosrcVivo(V23), await prosrcVivo(V24)];
        const erro = await aplicar(MIGRATION);
        assert.ok(erro, `${nome}: a migration devia recusar`);
        assert.match(
          erro.erro,
          /B1_BASELINE_DIVERGENT/,
          `${nome}: ${erro.erro}`,
        );
        assert.deepEqual(
          [await prosrcVivo(V23), await prosrcVivo(V24)],
          fotoAntes,
          `${nome}: o pre-voo escreveu`,
        );
        const rb = await aplicar(ROLLBACK);
        assert.ok(rb, `${nome}: o rollback-manual devia recusar`);
        assert.match(
          rb.erro,
          /B1_BASELINE_DIVERGENT/,
          `${nome}: rollback: ${rb.erro}`,
        );
        assert.deepEqual(
          [await prosrcVivo(V23), await prosrcVivo(V24)],
          fotoAntes,
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
  "MIGRATION: o pos-voo PASSA no estado novo e RECUSA corpo antigo, atributo mudado, PUBLIC aberto, anon sem EXECUTE e o trecho duplicado, nas duas funcoes",
  () =>
    emTransacao(async () => {
      // O pos-voo depende da fotografia que o pre-voo grava (GUC): roda o pre-voo no estado novo (reaplicavel) e depois o
      // pos-voo isolado, em cada estrago.
      const PREVOO = bloco(MIGRATION, "preflight_20261394");
      const POSVOO = bloco(MIGRATION, "posvoo_20261394");
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(PREVOO), null);
      assert.equal(
        await aplicar(POSVOO),
        null,
        "o pos-voo reprovou o estado bom",
      );
      for (const fn of [V23, V24]) {
        for (const [nome, estrago, padrao] of [
          [
            "corpo antigo",
            () => C.query(decl(ANTIGA[fn])),
            /nao ficou com o corpo desta migration/,
          ],
          [
            "o trecho duplicado (hash diferente)",
            () =>
              C.query(
                decl(
                  NOVA[fn],
                  NOVA[fn].corpo.replace(
                    ANCORA_PASSO_1,
                    () => BLOCO + ANCORA_PASSO_1,
                  ),
                ),
              ),
            /nao ficou com o corpo desta migration/,
          ],
          [
            "atributo (STABLE)",
            () => C.query(`ALTER FUNCTION ${FN.get(fn)} STABLE`),
            /atributos (de .* nao sao os conhecidos|, dono, OID ou ACL)/,
          ],
          [
            "PUBLIC aberto",
            () => C.query(`GRANT EXECUTE ON FUNCTION ${FN.get(fn)} TO PUBLIC`),
            /ACL de .* nao e a de sempre/,
          ],
          [
            "anon sem EXECUTE",
            () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN.get(fn)} FROM anon`),
            /ACL de .* nao e a de sempre/,
          ],
        ]) {
          await C.query("SAVEPOINT estrago");
          await estrago();
          const erro = await aplicar(POSVOO);
          assert.ok(erro, `${fn}: ${nome}: o pos-voo devia recusar`);
          assert.match(erro.erro, /POSVOO_20261394000000/);
          assert.match(erro.erro, padrao, `${fn}: ${nome}: ${erro.erro}`);
          await C.query("ROLLBACK TO SAVEPOINT estrago");
        }
      }
      // A fotografia: mudar o DONO da funcao entre o pre-voo e o pos-voo tambem reprova.
      await C.query("SAVEPOINT dono");
      await C.query("CREATE ROLE freio394_dono NOLOGIN");
      await C.query(`ALTER FUNCTION ${FN.get(V23)} OWNER TO freio394_dono`);
      const erroDono = await aplicar(POSVOO);
      assert.ok(erroDono, "mudar o dono devia reprovar o pos-voo");
      assert.match(erroDono.erro, /POSVOO_20261394000000/);
      await C.query("ROLLBACK TO SAVEPOINT dono");
    }),
);

prova(
  "MIGRATION: o pos-voo reprovando DESFAZ a troca das DUAS funcoes — uma migration cujo corpo novo da v24 sai com 1 byte a mais aborta no pos-voo e nem a v23 fica trocada; o pre-voo recusando tambem nao escreve (o arquivo vai como UMA mensagem, uma transacao implicita, conexao SEM BEGIN)",
  async () => {
    const sabotada = MIGRATION.replace(decl(NOVA[V24]), () =>
      decl(NOVA[V24], `${NOVA[V24].corpo}\n-- um byte a mais\n`),
    );
    assert.notEqual(sabotada, MIGRATION);
    const solto = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await solto.connect();
    try {
      await solto.query(`${decl(ANTIGA[V23])}\n${decl(ANTIGA[V24])}`); // estado ANTES, de verdade (clone descartavel)
      const lido = async (fn) =>
        (
          await solto.query(
            "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
            [FN.get(fn)],
          )
        ).rows[0].h;
      assert.equal(await lido(V23), H_ANTIGO[V23]);
      assert.equal(await lido(V24), H_ANTIGO[V24]);
      let erro = null;
      try {
        await solto.query(sabotada);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "a migration sabotada devia abortar no pos-voo");
      assert.match(erro.message, /POSVOO_20261394000000/);
      assert.equal(
        await lido(V23),
        H_ANTIGO[V23],
        "a v23 ficou trocada apesar do pos-voo reprovar",
      );
      assert.equal(
        await lido(V24),
        H_ANTIGO[V24],
        "a v24 ficou trocada apesar do pos-voo reprovar",
      );
      // E o arquivo de verdade aplica de fora de BEGIN e grava de uma vez
      await solto.query(MIGRATION);
      assert.equal(await lido(V23), H_NOVO[V23]);
      assert.equal(await lido(V24), H_NOVO[V24]);
      // Rollback em conexao solta tambem aplica inteiro; e o pre-voo recusando (segundo rollback) nao escreve.
      await solto.query(ROLLBACK);
      assert.equal(await lido(V23), H_ANTIGO[V23]);
      assert.equal(await lido(V24), H_ANTIGO[V24]);
      await assert.rejects(
        () => solto.query(ROLLBACK),
        /B1_BASELINE_DIVERGENT/,
      );
      assert.equal(await lido(V24), H_ANTIGO[V24]);
      await solto.query(MIGRATION);
      assert.equal(await lido(V23), H_NOVO[V23]);
    } finally {
      await solto.end();
    }
  },
);

// ---------------------------------------------------------------------------
// CONSULTAS 106a / 106b (e as que aceitam os corpos novos como sucessores)
// ---------------------------------------------------------------------------

const rodarConsulta = async (sql) => (await C.query(sql)).rows;
const mapa = (linhas) => Object.fromEntries(linhas.map((l) => [l.item, l.ok]));

prova(
  "CONSULTAS: 106a/106b tem rol fechado de 9 linhas (os rotulos do conferir-banco), positivas no estado certo; a 106a reprova no ANTES e a 106b no DEPOIS, nos itens certos; 31a, 37a, 47a, 81a e 89a seguem positivas nos DOIS estados; cada desvio da 106a cai no item certo",
  async () => {
    const rodarTodas = async () => {
      const r = {
        a: await rodarConsulta(A106),
        b: await rodarConsulta(B106),
        aceitam: [],
      };
      for (const { n, sql } of CONSULTAS_QUE_ACEITAM)
        r.aceitam.push({ n, linhas: await rodarConsulta(sql) });
      return r;
    };
    const depois = await emTransacao(rodarTodas, { estado: "depois" });
    const antes = await emTransacao(rodarTodas, { estado: "antes" });
    for (const c of [depois.a, depois.b, antes.a, antes.b]) {
      assert.equal(c.length, 9, "rol fechado de 9 linhas");
      assert.equal(new Set(c.map((l) => l.item)).size, 9);
    }
    for (const l of [...depois.a, ...depois.b])
      assert.ok(
        CONFERIR_BANCO.includes(`"${l.item}"`),
        `rotulo fora do rol do conferir-banco: ${l.item}`,
      );
    const FIXOS = [
      "controle: funcoes de public visiveis a este papel",
      "create_marketplace_order_v23: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)",
      "create_marketplace_order_v24: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)",
      "create_marketplace_order_v23: EXECUTE para anon, authenticated e service_role, sem PUBLIC",
      "create_marketplace_order_v24: EXECUTE para anon, authenticated e service_role, sem PUBLIC",
    ];
    // DEPOIS: a 106a toda verdadeira; a 106b reprova justamente nos itens que dizem "antes" (corpos e freio).
    assert.ok(
      depois.a.every((l) => l.ok),
      JSON.stringify(depois.a.filter((l) => !l.ok)),
    );
    for (const [item, ok] of Object.entries(mapa(depois.b)))
      assert.equal(ok, FIXOS.includes(item), `106b DEPOIS: ${item}`);
    // ANTES: o contrario
    assert.ok(
      antes.b.every((l) => l.ok),
      JSON.stringify(antes.b.filter((l) => !l.ok)),
    );
    for (const [item, ok] of Object.entries(mapa(antes.a)))
      assert.equal(ok, FIXOS.includes(item), `106a ANTES: ${item}`);
    for (const estado of [depois, antes])
      for (const { n, linhas } of estado.aceitam)
        assert.ok(
          linhas.every((l) => l.ok),
          `${n}: ${JSON.stringify(linhas.filter((l) => !l.ok))}`,
        );
    // Cada desvio da 106a (no estado novo) cai no item certo.
    const casos = [];
    for (const fn of [V23, V24]) {
      casos.push(
        [
          `GRANT EXECUTE ON FUNCTION ${FN.get(fn)} TO PUBLIC`,
          `${fn}: EXECUTE para anon, authenticated e service_role, sem PUBLIC`,
        ],
        [
          `REVOKE EXECUTE ON FUNCTION ${FN.get(fn)} FROM anon`,
          `${fn}: EXECUTE para anon, authenticated e service_role, sem PUBLIC`,
        ],
        [
          `ALTER FUNCTION ${FN.get(fn)} SECURITY INVOKER`,
          `${fn}: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)`,
        ],
        [
          decl(NOVA[fn], `${NOVA[fn].corpo}\n-- sabotagem\n`),
          `${fn}: corpo exato (md5)`,
        ],
        [
          decl(ANTIGA[fn]),
          `${fn}: o corpo traz o freio do visitante (uma vez)`,
        ],
      );
    }
    for (const [sabotar, itemQueCai] of casos)
      await emTransacao(
        async () => {
          await C.query(sabotar);
          const caiu = (await rodarConsulta(A106))
            .filter((l) => !l.ok)
            .map((l) => l.item);
          assert.ok(
            caiu.includes(itemQueCai),
            `${sabotar.slice(0, 60)}: caiu ${JSON.stringify(caiu)}`,
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
    ? PROVAS.filter(
        (p) =>
          p.nome.startsWith("DEPOIS: teto de 10 unidades") ||
          p.nome.startsWith("CONCORRENCIA"),
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
