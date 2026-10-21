"use strict";

/**
 * Prova VIVA da migration 20261244000000 (a loja escolhe como entrega na cidade dela e em quantos dias:
 * "Entrego" / "Entrego e retiro" / "Só retiro" + o prazo da entrega própria; dinheiro + permissão + contrato), num
 * Postgres EFEMERO local, sem rede, com os papeis de verdade (anon, authenticated).
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore ja tem a 20261244 (em CI ela tem), TODO caso
 * comeca pelo estado ANTES (o rollback-manual dela; ou o ANTES REAL, com as colunas apagadas pelo rollback destrutivo)
 * ou pelo estado DEPOIS (a propria migration). Cada caso roda numa transacao que termina em ROLLBACK.
 *
 *  CORPOS     os corpos novos de v23, v24 e upsert_store_config sao os vivos (20261229, 20261236, 20261239, lidos dos
 *             ARQUIVOS) mais SO as edicoes combinadas: o diff de linhas tem exatamente as linhas de codigo do desenho.
 *  MATRIZ     v23 e v24 x convidado/logado x CEP local/fora x os 3 modos x as opcoes (entrega propria, retirada,
 *             transportadora, ids nao canonicos) x cobertura nacional/local: cada celula e' comparada com o MODELO do
 *             desenho (a tabela do arquiteto), com a frase e o DETAIL de cada recusa; pedido que nasce grava frete zero,
 *             o retrato do endereco da loja na retirada e o CEP.
 *  PADRAO     loja que nao mexe em nada (Entrego, Entrego e retiro) responde IDENTICO ao banco de antes: a matriz inteira,
 *             com as mensagens, e um roteiro de compras, comparados entre o ANTES REAL (sem as colunas) e o DEPOIS.
 *  CONTROLE   com o corpo antigo, uma loja marcada "Só retiro" ainda aceita a entrega propria e recusa a retirada de
 *             fora da cidade (o defeito que a migration conserta).
 *  GATILHO    "Só retiro" sem retirada ou sem endereco e' recusado em todos os caminhos (UPDATE, INSERT, upsert), o
 *             INSERT fantasma do upsert e' ignorado, o prazo so aceita 0 a 30, a funcao da trigger nao tem EXECUTE.
 *  UPSERT     aceita e ignora as duas chaves como o desenho diz (so grava o que veio no payload), valida a linha final,
 *             recusa quem nao e' admin ATUAL sem escrever; duas conexoes reais: salvar "Só retiro" e tirar a retirada ao
 *             mesmo tempo nunca deixa a loja sem entrega, nas duas ordens.
 *  DADOS      a linha que ja existia antes da migration ganha true / 1 sem ser reescrita; pedido ja criado fica como
 *             esta; a retentativa de um pedido que ja nasceu devolve o pedido mesmo com a loja em "Só retiro".
 *  MUTANTES   cada guarda tirada (a trava do convidado, a da cobertura, a do ramo da retirada, a recusa da entrega
 *             propria, a condicao da opcao, o fantasma do INSERT, a checagem de retirada e de endereco, o CASE do
 *             prazo, a chave ignorada) deixa a verificacao certa VERMELHA, e restaurada volta a VERDE.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve os 3 `prosrc` IDENTICOS (md5 e sha256), a view de
 *             45 colunas, sem a trigger, e NAO apaga as colunas; recusa com loja em "Só retiro"; o destrutivo recusa
 *             fora de ordem e com dado escolhido; o pre-voo recusa SEM escrever; o pos-voo reprovando desfaz tudo.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-escolhe-como-entrega-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const ARQ = "20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const MIGRATION = ler(ARQ);
const ROLLBACK = ler(`rollback-manual-${ARQ}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${ARQ}`);
const SRC_229 = ler("20261229000000_o_endereco_da_compra_fica_no_pedido.sql");
const SRC_236 = ler(
  "20261236000000_a_compra_que_da_zero_reais_nao_se_paga_pelo_app.sql",
);
const SRC_239 = ler(
  "20261239000000_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela.sql",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const UPSERT = "upsert_store_config";
const TRIG = "store_config_so_retirada_exige_retirada";
const ASSINATURA =
  "(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)";
const FN = {
  [V23]: `public.${V23}${ASSINATURA}`,
  [V24]: `public.${V24}${ASSINATURA}`,
  [UPSERT]: "public.upsert_store_config(jsonb)",
  [TRIG]: `public.${TRIG}()`,
};

// Os hashes: o corpo vivo ANTES (as tres migrations anteriores) e o corpo DESTA migration.
const H = {
  [V23]: {
    antes: "6cb5a00cfa290f00dc9de053fee40759",
    depois: "79445d64a87843be2d42bf601c7090ec",
  },
  [V24]: {
    antes: "6002fc8db6c1d402bc704f018a0c2621",
    depois: "85c37af4baa2f5ce1375bdd9e943c746",
  },
  [UPSERT]: {
    antes: "b562669936df1cda31d4bdd4d075bff3",
    depois: "391e8e1064400df5aea579f3472b203c",
  },
};

/** Do `CREATE OR REPLACE FUNCTION public.<fn>(` ao delimitador de fechamento: { cabeca (ate o `AS <delim>`), corpo }. */
function funcaoDe(sql, fn, delim = "$function$") {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `declaracao de ${fn} nao achada`);
  const ab = sql.indexOf(delim, ini);
  const corpoIni = ab + delim.length;
  const fim = sql.indexOf(delim, corpoIni);
  return {
    cabeca: sql.slice(ini, corpoIni),
    corpo: sql.slice(corpoIni, fim),
    delim,
  };
}
const decl = (f, corpo) => `${f.cabeca + corpo}${f.delim};`;

// Os corpos ANTIGOS sao LIDOS DOS ARQUIVOS das migrations anteriores, nunca copiados para ca.
const ANTIGA = {
  [V23]: funcaoDe(SRC_229, V23),
  [V24]: funcaoDe(SRC_236, V24),
  [UPSERT]: funcaoDe(SRC_239, UPSERT, "$$"),
};
const NOVA = {
  [V23]: funcaoDe(MIGRATION, V23),
  [V24]: funcaoDe(MIGRATION, V24),
  [UPSERT]: funcaoDe(MIGRATION, UPSERT, "$$"),
};
const ROLL = {
  [V23]: funcaoDe(ROLLBACK, V23),
  [V24]: funcaoDe(ROLLBACK, V24),
  [UPSERT]: funcaoDe(ROLLBACK, UPSERT, "$$"),
};
const TRIGGER = funcaoDe(MIGRATION, TRIG);
// MODO MUTANTE DE ARQUIVO (PROVA_ARQUIVO_MUTADO=1): quem edita o ARQUIVO da migration para sabotar um corpo roda so a
// prova de COMPORTAMENTO, sem as travas de hash e de bytes que reprovariam a edicao antes de qualquer comportamento ser
// medido; o corpo sabotado entra por CREATE OR REPLACE (o pre-voo e o pos-voo da migration, que exigem o hash certo,
// ficam de fora). Nunca roda em CI.
const MUTADO = process.env.PROVA_ARQUIVO_MUTADO === "1";
for (const fn of [V23, V24, UPSERT]) {
  assert.equal(
    md5(ANTIGA[fn].corpo),
    H[fn].antes,
    `o corpo anterior de ${fn} mudou`,
  );
  assert.equal(
    ROLL[fn].corpo,
    ANTIGA[fn].corpo,
    `o rollback de ${fn} nao e o corpo anterior byte a byte`,
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
  if (!MUTADO)
    assert.equal(
      md5(NOVA[fn].corpo),
      H[fn].depois,
      `o corpo novo de ${fn} mudou`,
    );
}

/** O estado DEPOIS: a migration inteira (pre-voo, troca e pos-voo) ou, no modo mutante, so os corpos do arquivo. */
const instalarNova = async () => {
  if (!MUTADO) return C.query(MIGRATION);
  for (const fn of [V23, V24, UPSERT])
    await C.query(decl(NOVA[fn], NOVA[fn].corpo));
};

// ---------------------------------------------------------------------------
// O DIFF DE LINHAS: as edicoes sao as combinadas e mais nada.
// ---------------------------------------------------------------------------

/** Diff por LCS: { removidas, adicionadas } (linhas aparadas, em multiconjunto). */
function diffDeLinhas(antigo, novo) {
  const a = antigo.split("\n").map((l) => l.trim());
  const b = novo.split("\n").map((l) => l.trim());
  const n = a.length;
  const m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i][j] =
        a[i] === b[j]
          ? t[i + 1][j + 1] + 1
          : Math.max(t[i + 1][j], t[i][j + 1]);
  const removidas = [];
  const adicionadas = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) removidas.push(a[i++]);
    else adicionadas.push(b[j++]);
  }
  while (i < n) removidas.push(a[i++]);
  while (j < m) adicionadas.push(b[j++]);
  return { removidas, adicionadas };
}
const soCodigo = (linhas) =>
  linhas.filter((l) => l !== "" && !l.startsWith("--")).sort();

const IS_LOCAL =
  "public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range)";
const CODIGO_ADICIONADO_DAS_COMPRAS = [
  "v_so_retirada boolean := false;",
  "v_retirada_livre boolean := false;",
  "v_so_retirada := (COALESCE(v_store_config.local_delivery_enabled, true) = false);",
  "v_retirada_livre := (v_so_retirada AND p_shipping_option_id IS NOT DISTINCT FROM 'store-pickup');",
  `IF NOT v_retirada_livre AND NOT ${IS_LOCAL} THEN`,
  `IF NOT v_retirada_livre AND NOT ${IS_LOCAL} THEN`,
  "IF v_so_retirada THEN",
  "RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'",
  "USING DETAIL = 'entrega_propria_desligada';",
  "END IF;",
  `OR (NOT v_retirada_livre AND COALESCE(${IS_LOCAL}, false) = false) THEN`,
].sort();
const CODIGO_REMOVIDO_DAS_COMPRAS = [
  `IF NOT ${IS_LOCAL} THEN`,
  `IF NOT ${IS_LOCAL} THEN`,
  `OR COALESCE(${IS_LOCAL}, false) = false THEN`,
].sort();
const CODIGO_ADICIONADO_DO_UPSERT = [
  "store_legal_name, store_legal_document, store_support_email,",
  "local_delivery_enabled, local_delivery_days",
  "config_json->>'store_support_email',",
  "COALESCE((config_json->>'local_delivery_enabled')::boolean, true),",
  "COALESCE((config_json->>'local_delivery_days')::integer, 1)",
  "local_delivery_enabled = CASE WHEN config_json ? 'local_delivery_enabled'",
  "THEN (config_json->>'local_delivery_enabled')::boolean",
  "ELSE store_config.local_delivery_enabled END,",
  "local_delivery_days = CASE WHEN config_json ? 'local_delivery_days'",
  "THEN (config_json->>'local_delivery_days')::integer",
  "ELSE store_config.local_delivery_days END,",
].sort();
const CODIGO_REMOVIDO_DO_UPSERT = [
  "store_legal_name, store_legal_document, store_support_email",
  "config_json->>'store_support_email'",
].sort();

// ---------------------------------------------------------------------------
// Constantes do cenario
// ---------------------------------------------------------------------------

const ACL_DAS_COMPRAS = [
  "anon=X/postgres",
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];
const ACL_DO_UPSERT = [
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];
const COLUNAS_NOVAS = ["local_delivery_enabled", "local_delivery_days"];
const COLUNAS_DA_VIEW_ANTES =
  "id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega,store_legal_name,store_legal_document,store_support_email";
const COLUNAS_DA_VIEW_DEPOIS = `${COLUNAS_DA_VIEW_ANTES},${COLUNAS_NOVAS.join(",")}`;
assert.equal(COLUNAS_DA_VIEW_ANTES.split(",").length, 45);

const U = {
  cliente: "7e7e2440-0000-4000-8000-0000000000d1",
  admin: "7e7e2440-0000-4000-8000-0000000000a1",
  rebaixado: "7e7e2440-0000-4000-8000-0000000000c3",
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const JWT_CLIENTE = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "customer" },
});
const PROD = "7e7e2440-0000-4000-8000-0000000000f0";
const ENDERECO_DA_LOJA = "Rua da Loja, 100 - Centro";
const CEPS = { local: "38500-100", fora: "01310-100" };
const DIGITADO = {
  street: "Rua Digitada",
  number: "5",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
};

// As tres respostas do painel, como combinacao de colunas que ja existem + a nova.
const MODOS = {
  entrego: { enabled: true, metodos: ["local-delivery"] },
  entrego_e_retiro: {
    enabled: true,
    metodos: ["local-delivery", "store-pickup"],
  },
  so_retiro: { enabled: false, metodos: ["store-pickup"] },
};

// As frases (o app no ar classifica varias por texto: nao podem mudar).
const M_CONVIDADO = "Compra sem conta é só com entrega na cidade da loja.";
const M_COBERTURA = "Esta loja só faz entrega na cidade dela.";
const M_LOCAL_INDISPONIVEL =
  "Entrega local não disponível para o CEP informado.";
const M_INVALIDA =
  "Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.";
const M_TRANSPORTADORA = "Envio por transportadora exige pagamento antecipado.";
const M_COTACAO = "A cotação de frete expirou.";
const M_CONFIGURANDO = "A loja ainda está configurando a entrega.";

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashVivo = async (fn) =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN[fn]],
    )
  ).rows[0]?.h;
const prosrcVivo = async (fn) =>
  (
    await C.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN[fn]],
    )
  ).rows[0]?.prosrc;
const oidVivo = async (fn) =>
  (await C.query("SELECT to_regprocedure($1)::oid::text AS o", [FN[fn]]))
    .rows[0].o;
async function acl(fn) {
  const r = await C.query(
    `SELECT coalesce(array_agg(x::text ORDER BY x::text), '{}') AS a
       FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) AS x
      WHERE p.oid = to_regprocedure($1)`,
    [FN[fn]],
  );
  return r.rows[0].a;
}
const colunasDaView = async () =>
  (
    await C.query(
      `SELECT string_agg(attname, ',' ORDER BY attnum) AS c FROM pg_attribute
        WHERE attrelid = 'public.v_store_config'::regclass AND attnum > 0 AND NOT attisdropped`,
    )
  ).rows[0].c;
const temColunas = async () =>
  (
    await C.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'store_config' AND column_name = ANY($1)`,
      [COLUNAS_NOVAS],
    )
  ).rows[0].n === 2;
const temTrigger = async () =>
  (
    await C.query(
      "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal",
      [TRIG],
    )
  ).rows[0].n === 1;

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

/**
 * Uma transacao por caso, sempre desfeita, no estado pedido: "antes" (rollback-manual: corpos antigos, SEM a trigger,
 * colunas ainda la), "antes-real" (rollback + destrutivo: o banco de ANTES da migration, sem as colunas) ou "depois".
 */
async function emTransacao(fn, { estado = "antes" } = {}) {
  await C.query("BEGIN");
  try {
    if (estado === "antes" || estado === "antes-real") {
      await C.query(ROLLBACK);
      for (const f of [V23, V24, UPSERT])
        assert.equal(await hashVivo(f), H[f].antes, `ANTES: ${f}`);
      if (estado === "antes-real") {
        await C.query(DESTRUTIVO);
        assert.equal(
          await temColunas(),
          false,
          "ANTES REAL: as colunas ficaram",
        );
      }
    } else if (estado === "depois") {
      await instalarNova();
      if (!MUTADO)
        for (const f of [V23, V24, UPSERT])
          assert.equal(await hashVivo(f), H[f].depois, `DEPOIS: ${f}`);
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`, com o auth.uid() e os claims pedidos; devolve as linhas (o erro sobe). */
async function como(papel, sql, params = [], { uid = "", claims = "" } = {}) {
  await C.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
    await C.query("RESET ROLE").catch(() => {});
  }
}
/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo, detalhe}. */
async function tentar(papel, sql, params = [], id = {}) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, id);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code, detalhe: e.detail };
  }
}
/** SQL direto como o dono do banco (o painel nao escreve assim; serve para provar a trigger sem a upsert). */
async function tentarDireto(sql, params = []) {
  return tentar(null, sql, params, {});
}

const SQL_PEDIDO = (rpc) =>
  `SELECT public.${rpc}($1::jsonb, $2::numeric, $3::numeric, $4::text, NULL::uuid, $5::text,
     'Comprador Prova', '5534999990000', NULL::text, $6::jsonb, $7::text, $8::text, $9::uuid) AS id`;

/** O pedido pelo CAMINHO do checkout: uma unidade do produto de R$ 100, frete zero (a loja tem frete gratis "sempre"). */
async function pedir({
  rpc = V24,
  metodo = "online",
  uid = U.cliente,
  papel = "authenticated",
  dados = null,
  opcao = "local-delivery",
  cupom = null,
  chave = crypto.randomUUID(),
  cep = CEPS.local,
  total = 100,
}) {
  return tentar(
    papel,
    SQL_PEDIDO(rpc),
    [
      JSON.stringify([{ product_id: PROD, variant_id: null, quantity: 1 }]),
      total,
      0,
      metodo,
      cupom,
      dados === null ? null : JSON.stringify(dados),
      cep,
      opcao,
      chave,
    ],
    { uid },
  );
}
const lerPedido = async (id) =>
  (
    await C.query(
      "SELECT to_jsonb(o) AS o FROM public.marketplace_orders o WHERE o.id = $1",
      [id],
    )
  ).rows[0]?.o;
const estoque = async () =>
  Number(
    (await C.query("SELECT estoque FROM public.produtos WHERE id = $1", [PROD]))
      .rows[0].estoque,
  );

/** Pessoas, produto e a loja (no estado "Entrego e retiro", o mais comum) dentro da transacao do caso. */
async function semear({ admin = true } = {}) {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@44.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente 44', 'customer'), ($2, 'Admin 44', 'admin'), ($3, 'Rebaixado 44', 'customer')`,
    [U.cliente, U.admin, U.rebaixado],
  );
  if (admin)
    await C.query(
      'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
      [U.admin],
    );
  await C.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons,
        pagamento_online, formas_pagamento_entrega, store_address, enabled_shipping_methods)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true,
        true, ARRAY['pix', 'card', 'cash'], $1, ARRAY['local-delivery', 'store-pickup'])
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons, pagamento_online = EXCLUDED.pagamento_online,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods`,
    [ENDERECO_DA_LOJA],
  );
  await C.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Camiseta Azul 44', 100, 1000, true, 40, false)",
    [PROD],
  );
}

/** Poe a loja num dos tres modos (e na cobertura pedida). As colunas novas so existem no DEPOIS e no ANTES simples. */
async function setarLoja({
  modo,
  cobertura = "national",
  origin = "38500-000",
}) {
  const m = MODOS[modo];
  const sets = [
    "enabled_shipping_methods = $1",
    "shipping_coverage = $2",
    "origin_cep = $3",
  ];
  const params = [m.metodos, cobertura, origin];
  if (await temColunas()) {
    sets.push("local_delivery_enabled = $4");
    params.push(m.enabled);
  }
  await C.query(
    `UPDATE public.store_config SET ${sets.join(", ")} WHERE id = 1`,
    params,
  );
}

// ---------------------------------------------------------------------------
// O MODELO do desenho: o que cada celula DEVE responder, escrito a partir da tabela do arquiteto, nao do corpo.
// ---------------------------------------------------------------------------

/** { ok: true } ou { erro: <frase>, detalhe?: <trecho do DETAIL> }. */
function esperado({ rpc, ator, cep, modo, cobertura, opcao }) {
  const local = cep === "local";
  const soRetiro = modo === "so_retiro";
  // A retirada so e' "livre de CEP" com o id EXATO 'store-pickup' (nada de espaco de sobra nem maiuscula).
  const livre = soRetiro && opcao === "store-pickup";
  const temRetirada = MODOS[modo].metodos.includes("store-pickup");
  if (ator === "convidado" && !local && !livre) return { erro: M_CONVIDADO };
  if (cobertura === "local" && !local && !livre) return { erro: M_COBERTURA };
  if (opcao === "local-delivery") {
    if (soRetiro)
      return { erro: M_INVALIDA, detalhe: "entrega_propria_desligada" };
    if (!local) return { erro: M_LOCAL_INDISPONIVEL };
    return { ok: true };
  }
  if (opcao === "store-pickup") {
    if (!temRetirada) return { erro: M_INVALIDA, detalhe: "não habilitou" };
    if (!livre && !local) return { erro: M_LOCAL_INDISPONIVEL };
    return { ok: true };
  }
  if (opcao === " store-pickup") {
    // id fora da forma canonica: o ramo da retirada recusa antes de qualquer outra coisa.
    return { erro: M_INVALIDA, detalhe: "forma canônica" };
  }
  // Transportadora (melhor-envio-1): a v23 recusa SEMPRE; a v24 com pagamento pelo app segue para o bloco do frete.
  if (rpc === V23) return { erro: M_TRANSPORTADORA };
  if (local)
    return {
      erro: M_INVALIDA,
      detalhe: "exige CEP de entrega conhecido e fora da área local",
    };
  return { erro: M_COTACAO };
}

async function celula(c) {
  const { rpc, ator, cep, modo, cobertura, opcao } = c;
  await C.query("SAVEPOINT celula");
  try {
    await setarLoja({ modo, cobertura });
    const convidado = ator === "convidado";
    const r = await pedir({
      rpc,
      metodo: rpc === V24 ? "online" : "cash",
      uid: convidado ? "" : U.cliente,
      papel: convidado ? "anon" : "authenticated",
      dados: convidado ? { ...DIGITADO, cep: CEPS[cep] } : null,
      cep: CEPS[cep],
      opcao,
    });
    if (r.erro) return { erro: r.erro, detalhe: r.detalhe ?? null };
    const o = await lerPedido(r.linhas[0].id);
    return {
      ok: true,
      frete: Number(o.shipping),
      total: Number(o.total),
      opcao: o.customer_data.shipping_option_id,
      retrato: o.customer_data.pickup_address ?? null,
      destino: o.customer_data.destination_cep,
      pagamento: `${o.payment_method}/${o.payment_status}`,
    };
  } finally {
    await C.query("ROLLBACK TO SAVEPOINT celula");
    await C.query("RELEASE SAVEPOINT celula");
  }
}

function todasAsCelulas({ modos = Object.keys(MODOS) } = {}) {
  const lista = [];
  for (const rpc of [V23, V24])
    for (const ator of ["convidado", "logado"])
      for (const cep of ["local", "fora"])
        for (const modo of modos)
          for (const cobertura of ["national", "local"])
            for (const opcao of [
              "local-delivery",
              "store-pickup",
              "melhor-envio-1",
              " store-pickup",
            ])
              lista.push({ rpc, ator, cep, modo, cobertura, opcao });
  return lista;
}
const nomeDaCelula = (c) =>
  `${c.rpc.replace("create_marketplace_order_", "")}/${c.ator}/${c.cep}/${c.modo}/cob-${c.cobertura}/${c.opcao}`;

/** Roda a lista de celulas e devolve { chave: resultado }. */
async function rodarCelulas(lista) {
  const out = {};
  for (const c of lista) out[nomeDaCelula(c)] = await celula(c);
  return out;
}

// ---------------------------------------------------------------------------
// As VERIFICACOES: uma por assunto; devolvem a lista de falhas (vazia = passou). SAO as mesmas que rodam sobre o corpo
// certo (tem de dar vazio) e sobre cada mutante (tem de dar nao vazio).
// ---------------------------------------------------------------------------
const CHECKS = {
  /** A matriz inteira contra o modelo do desenho. */
  async matrizDaCompra() {
    const f = [];
    const lista = todasAsCelulas();
    for (const c of lista) {
      const obtido = await celula(c);
      const esp = esperado(c);
      const nome = nomeDaCelula(c);
      if (esp.ok) {
        if (!obtido.ok) {
          f.push(
            `matrizDaCompra ${nome}: devia nascer, recusou: ${obtido.erro} [${obtido.detalhe}]`,
          );
          continue;
        }
        const retirada = c.opcao === "store-pickup";
        if (obtido.frete !== 0 || obtido.total !== 100)
          f.push(
            `matrizDaCompra ${nome}: frete/total ${obtido.frete}/${obtido.total}`,
          );
        if (
          obtido.opcao !== c.opcao ||
          obtido.destino !== CEPS[c.cep].replace("-", "")
        )
          f.push(
            `matrizDaCompra ${nome}: opcao/destino gravados ${obtido.opcao}/${obtido.destino}`,
          );
        if (retirada && obtido.retrato !== ENDERECO_DA_LOJA)
          f.push(
            `matrizDaCompra ${nome}: sem o retrato do endereco da loja (${obtido.retrato})`,
          );
        if (!retirada && obtido.retrato !== null)
          f.push(
            `matrizDaCompra ${nome}: retrato do endereco da loja numa entrega`,
          );
      } else {
        if (obtido.ok) {
          f.push(
            `matrizDaCompra ${nome}: devia recusar com "${esp.erro}", NASCEU`,
          );
          continue;
        }
        if (!obtido.erro.startsWith(esp.erro))
          f.push(
            `matrizDaCompra ${nome}: recusou com "${obtido.erro}", devia ser "${esp.erro}"`,
          );
        else if (
          esp.detalhe &&
          !String(obtido.detalhe ?? "").includes(esp.detalhe)
        )
          f.push(
            `matrizDaCompra ${nome}: DETAIL "${obtido.detalhe}" nao tem "${esp.detalhe}"`,
          );
      }
    }
    return f;
  },

  /** A trigger: "Só retiro" sem retirada ou sem endereco e' recusado em todos os caminhos de escrita. */
  async gatilhoDoSoRetiro() {
    const f = [];
    const set = (sql, params = []) => tentarDireto(sql, params);
    const recusou = (r, quem, trecho) => {
      if (!r.erro) f.push(`gatilhoDoSoRetiro ${quem}: devia recusar`);
      else if (!r.erro.includes("LOJA_SO_RETIRADA_SEM_RETIRADA"))
        f.push(`gatilhoDoSoRetiro ${quem}: recusou com "${r.erro}"`);
      else if (trecho && !String(r.detalhe ?? "").startsWith(trecho))
        f.push(
          `gatilhoDoSoRetiro ${quem}: DETAIL "${r.detalhe}" nao comeca com "${trecho}"`,
        );
    };
    const aceitou = (r, quem) => {
      if (r.erro)
        f.push(`gatilhoDoSoRetiro ${quem}: devia aceitar, recusou: ${r.erro}`);
    };
    const estado = async () =>
      (
        await C.query(
          "SELECT local_delivery_enabled AS e, enabled_shipping_methods AS m, store_address AS a FROM public.store_config WHERE id = 1",
        )
      ).rows[0];
    const sp = async (quem, corpo) => {
      await C.query("SAVEPOINT g");
      try {
        await corpo();
      } catch (e) {
        f.push(`gatilhoDoSoRetiro ${quem}: ${e.message}`);
      } finally {
        await C.query("ROLLBACK TO SAVEPOINT g");
        await C.query("RELEASE SAVEPOINT g");
      }
    };
    const UPD = "UPDATE public.store_config SET";
    await sp("com retirada e endereco: aceita", async () => {
      aceitou(
        await set(`${UPD} local_delivery_enabled = false WHERE id = 1`),
        "so retiro com tudo",
      );
      assert.equal((await estado()).e, false);
    });
    await sp("sem retirada: recusa", async () => {
      aceitou(
        await set(
          `${UPD} local_delivery_enabled = true, enabled_shipping_methods = ARRAY['local-delivery'] WHERE id = 1`,
        ),
        "preparo",
      );
      const r = await set(`${UPD} local_delivery_enabled = false WHERE id = 1`);
      recusou(r, "so retiro sem retirada", "sem_retirada");
      assert.equal((await estado()).e, true, "gravou apesar da recusa");
    });
    await sp("methods NULL ou so NULL: recusa (fail-closed)", async () => {
      recusou(
        await set(
          `${UPD} local_delivery_enabled = false, enabled_shipping_methods = NULL WHERE id = 1`,
        ),
        "methods NULL",
        "sem_retirada",
      );
      recusou(
        await set(
          `${UPD} local_delivery_enabled = false, enabled_shipping_methods = ARRAY[NULL]::text[] WHERE id = 1`,
        ),
        "methods so NULL",
        "sem_retirada",
      );
      recusou(
        await set(
          `${UPD} local_delivery_enabled = false, enabled_shipping_methods = '{}' WHERE id = 1`,
        ),
        "methods vazio",
        "sem_retirada",
      );
    });
    for (const [rotulo, valor] of [
      ["NULL", null],
      ["vazio", ""],
      ["so espacos", "   "],
    ])
      await sp(`sem endereco (${rotulo}): recusa`, async () => {
        recusou(
          await set(
            `${UPD} local_delivery_enabled = false, store_address = $1 WHERE id = 1`,
            [valor],
          ),
          `so retiro com endereco ${rotulo}`,
          "sem_endereco",
        );
      });
    await sp(
      "ja em so retiro: tirar a retirada ou o endereco recusa; o resto passa",
      async () => {
        aceitou(
          await set(`${UPD} local_delivery_enabled = false WHERE id = 1`),
          "preparo",
        );
        recusou(
          await set(
            `${UPD} enabled_shipping_methods = ARRAY['local-delivery'] WHERE id = 1`,
          ),
          "tirar a retirada",
          "sem_retirada",
        );
        recusou(
          await set(`${UPD} store_address = NULL WHERE id = 1`),
          "apagar o endereco",
          "sem_endereco",
        );
        recusou(
          await set(`${UPD} store_address = '   ' WHERE id = 1`),
          "endereco so com espacos (ja em so retiro)",
          "sem_endereco",
        );
        aceitou(
          await set(`${UPD} store_name = 'Outro nome' WHERE id = 1`),
          "mudar so o nome",
        );
        aceitou(
          await set(
            `${UPD} enabled_shipping_methods = ARRAY['store-pickup', 'sedex'] WHERE id = 1`,
          ),
          "retirada e transportadora",
        );
        aceitou(
          await set(
            `${UPD} local_delivery_enabled = true, enabled_shipping_methods = ARRAY['local-delivery'] WHERE id = 1`,
          ),
          "voltar para Entrego, sem retirada",
        );
      },
    );
    await sp(
      "INSERT real (sem linha) recusa e aceita como o UPDATE",
      async () => {
        await C.query("DELETE FROM public.store_config");
        recusou(
          await set(
            "INSERT INTO public.store_config (id, local_delivery_enabled) VALUES (1, false)",
          ),
          "INSERT so retiro sem retirada nem endereco",
          "sem_retirada",
        );
        aceitou(
          await set(
            "INSERT INTO public.store_config (id, local_delivery_enabled, enabled_shipping_methods, store_address) VALUES (1, false, ARRAY['store-pickup'], 'Rua X, 1')",
          ),
          "INSERT so retiro completo",
        );
      },
    );
    await sp(
      "o INSERT fantasma (a linha ja existe) e' ignorado; a linha FINAL e' que vale",
      async () => {
        // Candidato so retiro SEM retirada (os defaults) que vai desviar para o ON CONFLICT: nao pode ser validado.
        aceitou(
          await set(
            "INSERT INTO public.store_config (id, local_delivery_enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING",
          ),
          "fantasma com DO NOTHING",
        );
        assert.equal((await estado()).e, true, "o DO NOTHING mudou a linha");
        aceitou(
          await set(
            "INSERT INTO public.store_config (id, local_delivery_enabled) VALUES (1, false) ON CONFLICT (id) DO UPDATE SET local_delivery_days = 5",
          ),
          "fantasma com DO UPDATE que nao toca o modo",
        );
        // ... e o UPDATE que o ON CONFLICT executa de verdade e' validado sobre a linha final.
        recusou(
          await set(
            "INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET local_delivery_enabled = false, enabled_shipping_methods = ARRAY['sedex']",
          ),
          "ON CONFLICT DO UPDATE que cria so retiro sem retirada",
          "sem_retirada",
        );
      },
    );
    await sp("o prazo: 0 e 30 passam; -1, 31 e NULL nao", async () => {
      for (const ok of [0, 1, 7, 30])
        aceitou(
          await set(`${UPD} local_delivery_days = $1 WHERE id = 1`, [ok]),
          `prazo ${ok}`,
        );
      for (const ruim of [-1, 31, 1000]) {
        const r = await set(`${UPD} local_delivery_days = $1 WHERE id = 1`, [
          ruim,
        ]);
        if (!r.erro || r.codigo !== "23514")
          f.push(
            `gatilhoDoSoRetiro prazo ${ruim}: devia recusar com 23514, deu ${r.codigo}`,
          );
      }
      const nulo = await set(`${UPD} local_delivery_days = NULL WHERE id = 1`);
      if (!nulo.erro || nulo.codigo !== "23502")
        f.push(
          `gatilhoDoSoRetiro prazo NULL: devia recusar com 23502, deu ${nulo.codigo}`,
        );
      const nuloModo = await set(
        `${UPD} local_delivery_enabled = NULL WHERE id = 1`,
      );
      if (!nuloModo.erro || nuloModo.codigo !== "23502")
        f.push(
          `gatilhoDoSoRetiro modo NULL: devia recusar com 23502, deu ${nuloModo.codigo}`,
        );
    });
    // A funcao da trigger nao e' porta: ninguem a executa a mao.
    for (const papel of ["anon", "authenticated", "service_role"]) {
      const r = await C.query(
        "SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS p",
        [papel, FN[TRIG]],
      );
      if (r.rows[0].p)
        f.push(`gatilhoDoSoRetiro: ${papel} executa a funcao da trigger`);
    }
    return f;
  },

  /** A upsert: aceita e ignora as duas chaves como o desenho diz. */
  async upsertDasDuasChaves() {
    const f = [];
    const upsert = (config) =>
      tentar(
        "authenticated",
        "SELECT public.upsert_store_config($1::jsonb) AS r",
        [JSON.stringify(config)],
        { uid: U.admin, claims: JWT_ADMIN },
      );
    const loja = async () =>
      (await C.query("SELECT * FROM public.store_config WHERE id = 1")).rows[0];
    const sp = async (quem, corpo) => {
      await C.query("SAVEPOINT u");
      try {
        await corpo();
      } catch (e) {
        f.push(`upsertDasDuasChaves ${quem}: ${e.message}`);
      } finally {
        await C.query("ROLLBACK TO SAVEPOINT u");
        await C.query("RELEASE SAVEPOINT u");
      }
    };
    const ok = (r, quem) => {
      if (r.erro)
        f.push(
          `upsertDasDuasChaves ${quem}: devia aceitar, recusou: ${r.erro}`,
        );
      return r;
    };
    const recusa = (r, quem, trecho) => {
      if (!r.erro) f.push(`upsertDasDuasChaves ${quem}: devia recusar`);
      else if (trecho && !r.erro.includes(trecho) && r.codigo !== trecho)
        f.push(
          `upsertDasDuasChaves ${quem}: recusou com "${r.erro}" (${r.codigo}), esperava ${trecho}`,
        );
    };
    const igual = (a, b, quem) => {
      if (JSON.stringify(a) !== JSON.stringify(b))
        f.push(
          `upsertDasDuasChaves ${quem}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`,
        );
    };

    await sp("payload sem as chaves nao mexe em nada", async () => {
      const antes = await loja();
      const r = ok(
        await upsert({ store_name: "Loja Prova" }),
        "salvar so o nome",
      );
      const depois = await loja();
      igual(
        [depois.local_delivery_enabled, depois.local_delivery_days],
        [antes.local_delivery_enabled, antes.local_delivery_days],
        "o salvar do nome mexeu no modo/prazo",
      );
      if (r.linhas && r.linhas[0].r.local_delivery_enabled !== true)
        f.push(
          "upsertDasDuasChaves: o retorno nao traz local_delivery_enabled",
        );
    });
    await sp(
      "o prazo sozinho: grava; nao apaga o modo nem o resto",
      async () => {
        ok(
          await upsert({
            local_delivery_enabled: false,
            store_name: "Loja Prova",
          }),
          "ligar so retiro",
        );
        const r = ok(
          await upsert({ local_delivery_days: 3 }),
          "salvar so o prazo",
        );
        const l = await loja();
        igual(
          [l.local_delivery_days, l.local_delivery_enabled, l.store_name],
          [3, false, "Loja Prova"],
          "o prazo apagou o modo ou o nome",
        );
        if (r.linhas && r.linhas[0].r.local_delivery_days !== 3)
          f.push("upsertDasDuasChaves: o retorno nao traz o prazo gravado");
      },
    );
    await sp(
      "o modo sozinho: so retiro com retirada e endereco da loja passa (o INSERT fantasma nao e' validado)",
      async () => {
        ok(await upsert({ local_delivery_days: 4 }), "prazo");
        ok(
          await upsert({ local_delivery_enabled: false }),
          "so retiro, payload so com o modo",
        );
        const l = await loja();
        igual(
          [
            l.local_delivery_enabled,
            l.local_delivery_days,
            l.enabled_shipping_methods,
            l.store_address,
          ],
          [false, 4, ["local-delivery", "store-pickup"], ENDERECO_DA_LOJA],
          "o modo sozinho mexeu em outra coisa",
        );
        ok(
          await upsert({ local_delivery_enabled: true }),
          "voltar para entrego e retiro",
        );
        igual((await loja()).local_delivery_enabled, true, "voltar nao gravou");
      },
    );
    await sp(
      "prazo: 0 e 30 gravam; 31, -1, 2.5, null e texto recusam sem gravar; '2' vira 2",
      async () => {
        ok(await upsert({ local_delivery_days: 0 }), "prazo 0");
        igual((await loja()).local_delivery_days, 0, "prazo 0");
        ok(await upsert({ local_delivery_days: 30 }), "prazo 30");
        igual((await loja()).local_delivery_days, 30, "prazo 30");
        ok(await upsert({ local_delivery_days: "2" }), "prazo '2'");
        igual((await loja()).local_delivery_days, 2, "prazo '2'");
        recusa(await upsert({ local_delivery_days: 31 }), "prazo 31", "23514");
        recusa(await upsert({ local_delivery_days: -1 }), "prazo -1", "23514");
        recusa(
          await upsert({ local_delivery_days: 2.5 }),
          "prazo 2.5",
          "22P02",
        );
        recusa(
          await upsert({ local_delivery_days: null }),
          "prazo null",
          "23502",
        );
        recusa(
          await upsert({ local_delivery_days: "abc" }),
          "prazo abc",
          "22P02",
        );
        igual((await loja()).local_delivery_days, 2, "uma recusa gravou");
      },
    );
    await sp(
      "so retiro: tirar a retirada pelo upsert e' recusado e nada muda; sair do so retiro e tirar a retirada juntos passa",
      async () => {
        ok(await upsert({ local_delivery_enabled: false }), "so retiro");
        const antes = await loja();
        recusa(
          await upsert({ enabled_shipping_methods: ["local-delivery"] }),
          "tirar a retirada",
          "LOJA_SO_RETIRADA_SEM_RETIRADA",
        );
        recusa(
          await upsert({ store_address: "" }),
          "esvaziar o endereco",
          "LOJA_SO_RETIRADA_SEM_RETIRADA",
        );
        igual(
          [
            (await loja()).enabled_shipping_methods,
            (await loja()).store_address,
          ],
          [antes.enabled_shipping_methods, antes.store_address],
          "uma recusa gravou",
        );
        ok(
          await upsert({
            local_delivery_enabled: true,
            enabled_shipping_methods: ["local-delivery"],
          }),
          "Entrego, sem retirada, de uma vez",
        );
        const l = await loja();
        igual(
          [l.local_delivery_enabled, l.enabled_shipping_methods],
          [true, ["local-delivery"]],
          "sair do so retiro",
        );
      },
    );
    await sp(
      "so retiro: salvar um campo SEM relacao com frete (WhatsApp, nome) passa — o candidato do INSERT com o default de enabled_shipping_methods nao e julgado; e nada de frete muda",
      async () => {
        ok(await upsert({ local_delivery_enabled: false }), "so retiro");
        const antes = await loja();
        ok(
          await upsert({ whatsapp_number: "5534999990000" }),
          "salvar so o WhatsApp numa loja so-retiro",
        );
        ok(
          await upsert({
            store_name: "Outro nome",
            logo_url: "https://x.test/l.png",
          }),
          "salvar so nome e logo numa loja so-retiro",
        );
        const depois = await loja();
        igual(
          [
            depois.local_delivery_enabled,
            depois.local_delivery_days,
            depois.enabled_shipping_methods,
            depois.store_address,
            depois.whatsapp_number,
            depois.store_name,
          ],
          [
            false,
            antes.local_delivery_days,
            antes.enabled_shipping_methods,
            antes.store_address,
            "5534999990000",
            "Outro nome",
          ],
          "salvar campo sem relacao com frete mexeu no frete (ou nao gravou o campo)",
        );
      },
    );
    await sp(
      "so retiro numa loja SEM retirada: recusa; com a retirada e o endereco no mesmo salvar: passa",
      async () => {
        ok(
          await upsert({ enabled_shipping_methods: ["local-delivery"] }),
          "preparo: so entrega",
        );
        recusa(
          await upsert({ local_delivery_enabled: false }),
          "so retiro sem retirada",
          "LOJA_SO_RETIRADA_SEM_RETIRADA",
        );
        igual(
          (await loja()).local_delivery_enabled,
          true,
          "gravou apesar da recusa",
        );
        ok(
          await upsert({
            local_delivery_enabled: false,
            enabled_shipping_methods: ["store-pickup"],
          }),
          "so retiro + retirada de uma vez",
        );
        igual(
          (await loja()).local_delivery_enabled,
          false,
          "so retiro + retirada",
        );
      },
    );
    await sp(
      "primeira vez da loja (sem linha): so retiro sem endereco recusa; completo cria",
      async () => {
        await C.query("DELETE FROM public.store_config");
        recusa(
          await upsert({ local_delivery_enabled: false }),
          "primeira vez so retiro sem nada",
          "LOJA_SO_RETIRADA_SEM_RETIRADA",
        );
        recusa(
          await upsert({
            local_delivery_enabled: false,
            enabled_shipping_methods: ["store-pickup"],
          }),
          "primeira vez sem endereco",
          "LOJA_SO_RETIRADA_SEM_RETIRADA",
        );
        ok(
          await upsert({
            local_delivery_enabled: false,
            enabled_shipping_methods: ["store-pickup"],
            store_address: "Rua Y, 2",
            local_delivery_days: 2,
          }),
          "primeira vez completa",
        );
        const l = await loja();
        igual(
          [l.local_delivery_enabled, l.local_delivery_days],
          [false, 2],
          "primeira vez completa",
        );
      },
    );
    await sp(
      "permissao: cliente, visitante e admin rebaixado (JWT velho) sao recusados e NADA e' escrito",
      async () => {
        const antes = await loja();
        const sql = "SELECT public.upsert_store_config($1::jsonb) AS r";
        const corpo = JSON.stringify({
          local_delivery_enabled: false,
          local_delivery_days: 9,
        });
        const quem = [
          ["cliente", "authenticated", { uid: U.cliente, claims: JWT_CLIENTE }],
          [
            "admin rebaixado",
            "authenticated",
            { uid: U.rebaixado, claims: JWT_ADMIN },
          ],
        ];
        for (const [rotulo, papel, id] of quem) {
          const r = await tentar(papel, sql, [corpo], id);
          if (!r.erro || !/N.o autorizado/.test(r.erro))
            f.push(
              `upsertDasDuasChaves permissao ${rotulo}: devia recusar com Nao autorizado, deu ${r.erro}`,
            );
        }
        const anon = await tentar("anon", sql, [corpo], {});
        if (!anon.erro)
          f.push("upsertDasDuasChaves permissao visitante: devia recusar");
        igual(await loja(), antes, "uma recusa de permissao escreveu na loja");
      },
    );
    return f;
  },

  /** A view e as colunas: os defaults, a leitura publica e a forma. */
  async viewEColunas() {
    const f = [];
    const cols = await colunasDaView();
    if (cols !== COLUNAS_DA_VIEW_DEPOIS)
      f.push(`viewEColunas: colunas da view ${cols}`);
    const r = await como(
      "anon",
      "SELECT local_delivery_enabled, local_delivery_days FROM public.v_store_config",
    );
    if (
      r.length !== 1 ||
      r[0].local_delivery_enabled !== true ||
      r[0].local_delivery_days !== 1
    )
      f.push(
        `viewEColunas: o visitante nao le os defaults true/1 pela view: ${JSON.stringify(r)}`,
      );
    return f;
  },
};

/** Roda TODAS as verificacoes sobre o estado que `instalar` monta (dentro de uma transacao que termina em ROLLBACK). */
async function todasAsVerificacoes(instalar, nomes = Object.keys(CHECKS)) {
  const falhas = [];
  await C.query("BEGIN");
  try {
    await instalar();
    await semear();
    for (const nome of nomes) falhas.push(...(await CHECKS[nome]()));
  } finally {
    await C.query("ROLLBACK");
  }
  return falhas;
}

// ---------------------------------------------------------------------------
// ARQUIVOS: so as edicoes combinadas
// ---------------------------------------------------------------------------

prova(
  "CORPOS: os corpos novos de v23, v24 e upsert sao os vivos (arquivos das tres migrations anteriores, md5 conferido) mais SO as linhas de codigo do desenho; assinatura, atributos e rollback byte a byte",
  () => {
    if (MUTADO) return;
    for (const fn of [V23, V24]) {
      const d = diffDeLinhas(ANTIGA[fn].corpo, NOVA[fn].corpo);
      assert.deepEqual(
        soCodigo(d.removidas),
        CODIGO_REMOVIDO_DAS_COMPRAS,
        `${fn}: linhas de codigo removidas`,
      );
      assert.deepEqual(
        soCodigo(d.adicionadas),
        CODIGO_ADICIONADO_DAS_COMPRAS,
        `${fn}: linhas de codigo adicionadas`,
      );
      assert.equal(
        d.removidas.filter((l) => l.startsWith("--")).length,
        0,
        `${fn}: comentario removido`,
      );
    }
    const d = diffDeLinhas(ANTIGA[UPSERT].corpo, NOVA[UPSERT].corpo);
    assert.deepEqual(
      soCodigo(d.removidas),
      CODIGO_REMOVIDO_DO_UPSERT,
      "upsert: linhas de codigo removidas",
    );
    assert.deepEqual(
      soCodigo(d.adicionadas),
      CODIGO_ADICIONADO_DO_UPSERT,
      "upsert: linhas de codigo adicionadas",
    );
    assert.equal(
      d.removidas.filter((l) => l.startsWith("--")).length,
      0,
      "upsert: comentario removido",
    );
    // Nenhum DDL de permissao no arquivo: a migration nao mexe em GRANT nem REVOKE (so o REVOKE da funcao da trigger).
    const grants = MIGRATION.match(/^\s*(GRANT|REVOKE)\b.*$/gim) ?? [];
    assert.deepEqual(
      grants.map((g) => g.trim()),
      [
        "REVOKE ALL ON FUNCTION public.store_config_so_retirada_exige_retirada() FROM PUBLIC, anon, authenticated, service_role;",
      ],
      "a migration so pode revogar a funcao da trigger",
    );
    // Regra da casa: sem BEGIN/COMMIT de nivel superior (com eles o ROLLBACK do aplicador viraria no-op).
    for (const [rotulo, sql] of [
      ["migration", MIGRATION],
      ["rollback", ROLLBACK],
      ["destrutivo", DESTRUTIVO],
    ])
      assert.equal(
        /^\s*(BEGIN|COMMIT|START TRANSACTION)\s*;/im.test(sql),
        false,
        `${rotulo}: BEGIN/COMMIT de nivel superior`,
      );
    // is_local_cep nao e' tocada.
    assert.equal(
      /FUNCTION\s+public\.is_local_cep/i.test(MIGRATION),
      false,
      "is_local_cep foi redefinida",
    );
  },
);

// ---------------------------------------------------------------------------
// PADRAO: a loja que nao mexe em nada responde igual a antes
// ---------------------------------------------------------------------------

prova(
  "PADRAO: a matriz inteira dos modos Entrego e Entrego e retiro (as frases, o DETAIL, os pedidos gravados) e' IDENTICA entre o ANTES REAL (sem as colunas, corpos antigos) e o DEPOIS; e o MODELO do desenho reproduz o ANTES",
  async () => {
    const lista = todasAsCelulas({ modos: ["entrego", "entrego_e_retiro"] });
    const antes = await emTransacao(
      async () => {
        await semear();
        assert.equal(await temColunas(), false);
        return rodarCelulas(lista);
      },
      { estado: "antes-real" },
    );
    const depois = await emTransacao(
      async () => {
        await semear();
        return rodarCelulas(lista);
      },
      { estado: "depois" },
    );
    assert.equal(Object.keys(antes).length, lista.length);
    assert.deepEqual(
      depois,
      antes,
      "a matriz do padrao mudou entre o ANTES REAL e o DEPOIS",
    );
    // O modelo escrito a partir do desenho tem de descrever o comportamento de ANTES (se o modelo errasse, a matriz do
    // DEPOIS contra ele seria enganosa).
    for (const c of lista) {
      const esp = esperado(c);
      const obtido = antes[nomeDaCelula(c)];
      if (esp.ok)
        assert.ok(
          obtido.ok,
          `modelo x ANTES ${nomeDaCelula(c)}: ${obtido.erro}`,
        );
      else {
        assert.ok(!obtido.ok, `modelo x ANTES ${nomeDaCelula(c)}: nasceu`);
        assert.ok(
          obtido.erro.startsWith(esp.erro),
          `modelo x ANTES ${nomeDaCelula(c)}: "${obtido.erro}" != "${esp.erro}"`,
        );
      }
    }
  },
);

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
async function roteiro() {
  await semear();
  const passos = [
    {},
    { opcao: "store-pickup" },
    { rpc: V23, metodo: "cash" },
    { rpc: V23, metodo: "pix", opcao: "store-pickup" },
    {
      uid: "",
      papel: "anon",
      dados: { ...DIGITADO, cep: CEPS.local },
      cep: CEPS.local,
    },
    {
      uid: "",
      papel: "anon",
      rpc: V23,
      metodo: "cash",
      dados: { ...DIGITADO, cep: CEPS.local },
      cep: CEPS.local,
      opcao: "store-pickup",
    },
  ];
  const pedidos = [];
  for (const [i, p] of passos.entries()) {
    const r = await pedir({
      ...p,
      chave: `7e7e2440-0000-4000-8000-00000000c0${i}${i}`,
    });
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
  return { pedidos, estoque: await estoque() };
}
prova(
  "PADRAO: o MESMO roteiro de compras que passam grava linhas identicas no ANTES REAL e no DEPOIS — total, frete, retrato da retirada, itens, estoque",
  async () => {
    const antes = await emTransacao(roteiro, { estado: "antes-real" });
    const depois = await emTransacao(roteiro, { estado: "depois" });
    assert.equal(antes.estoque, 1000 - 6);
    assert.deepEqual(depois, antes);
  },
);

prova(
  "DADOS: a linha da loja e o pedido que JA existiam antes da migration ficam como estao; a loja ganha true / 1 sem ser reescrita (updated_at, ctid e as outras colunas iguais)",
  () =>
    emTransacao(
      async () => {
        await semear();
        await C.query(
          "UPDATE public.store_config SET store_name = 'Loja Antiga', business_hours = 'Seg a Sex' WHERE id = 1",
        );
        const nasceu = await pedir({
          opcao: "local-delivery",
          chave: crypto.randomUUID(),
        });
        assert.ok(nasceu.linhas, nasceu.erro);
        const fotoLoja = async () =>
          (
            await C.query(
              `SELECT (to_jsonb(s) - 'local_delivery_enabled' - 'local_delivery_days')::text AS j, s.ctid::text AS x
                 FROM public.store_config s WHERE id = 1`,
            )
          ).rows[0];
        const lojaAntes = await fotoLoja();
        const pedidoAntes = JSON.stringify(
          await lerPedido(nasceu.linhas[0].id),
        );
        assert.equal(await temColunas(), false);
        assert.equal(await aplicar(MIGRATION), null);
        assert.equal(await temColunas(), true);
        const depois = await fotoLoja();
        assert.equal(
          depois.j,
          lojaAntes.j,
          "a migration reescreveu uma coluna da loja",
        );
        assert.equal(
          depois.x,
          lojaAntes.x,
          "a migration reescreveu a linha da loja (o ctid mudou)",
        );
        assert.equal(
          JSON.stringify(await lerPedido(nasceu.linhas[0].id)),
          pedidoAntes,
          "o pedido mudou",
        );
        const novas = (
          await C.query(
            "SELECT local_delivery_enabled AS e, local_delivery_days AS d FROM public.store_config WHERE id = 1",
          )
        ).rows[0];
        assert.deepEqual(novas, { e: true, d: 1 });
      },
      { estado: "antes-real" },
    ),
);

prova(
  "DADOS: a RETENTATIVA de um pedido que ja nasceu (mesma chave) devolve o pedido mesmo com a loja agora em 'Só retiro'; a chave nova com a entrega propria recusa",
  () =>
    emTransacao(
      async () => {
        await semear();
        const chave = crypto.randomUUID();
        const nasceu = await pedir({ opcao: "local-delivery", chave });
        assert.ok(nasceu.linhas, nasceu.erro);
        await setarLoja({ modo: "so_retiro" });
        const retentativa = await pedir({ opcao: "local-delivery", chave });
        assert.ok(
          retentativa.linhas,
          `a retentativa foi recusada: ${retentativa.erro}`,
        );
        assert.equal(retentativa.linhas[0].id, nasceu.linhas[0].id);
        const nova = await pedir({ opcao: "local-delivery" });
        assert.ok(
          nova.erro?.startsWith(M_INVALIDA),
          `a chave nova devia recusar: ${nova.erro}`,
        );
        assert.equal(nova.detalhe, "entrega_propria_desligada");
        // O pedido de entrega que ja existe continua como esta.
        assert.equal(
          (await lerPedido(nasceu.linhas[0].id)).customer_data
            .shipping_option_id,
          "local-delivery",
        );
      },
      { estado: "depois" },
    ),
);

// ---------------------------------------------------------------------------
// CONTROLE: o defeito que a migration conserta
// ---------------------------------------------------------------------------

prova(
  "CONTROLE: com os corpos antigos, a loja marcada 'Só retiro' ainda ACEITA a entrega propria e RECUSA a retirada de fora da cidade (o defeito); com os novos, o contrario",
  async () => {
    const roda = (estado) =>
      emTransacao(
        async () => {
          await semear();
          const lista = [
            {
              rpc: V24,
              ator: "logado",
              cep: "local",
              modo: "so_retiro",
              cobertura: "national",
              opcao: "local-delivery",
            },
            {
              rpc: V24,
              ator: "logado",
              cep: "fora",
              modo: "so_retiro",
              cobertura: "national",
              opcao: "store-pickup",
            },
            {
              rpc: V24,
              ator: "convidado",
              cep: "fora",
              modo: "so_retiro",
              cobertura: "national",
              opcao: "store-pickup",
            },
            {
              rpc: V23,
              ator: "logado",
              cep: "fora",
              modo: "so_retiro",
              cobertura: "local",
              opcao: "store-pickup",
            },
          ];
          return rodarCelulas(lista);
        },
        { estado },
      );
    const antes = await roda("antes");
    const chaves = Object.keys(antes);
    assert.ok(
      antes[chaves[0]].ok,
      "ANTES: a entrega propria devia nascer (o defeito)",
    );
    assert.ok(
      antes[chaves[1]].erro?.startsWith(M_LOCAL_INDISPONIVEL),
      "ANTES: a retirada de fora devia recusar (o defeito)",
    );
    assert.ok(
      antes[chaves[2]].erro?.startsWith(M_CONVIDADO),
      "ANTES: o convidado de fora devia recusar (o defeito)",
    );
    assert.ok(
      antes[chaves[3]].erro?.startsWith(M_COBERTURA),
      "ANTES: a cobertura local devia recusar (o defeito)",
    );
    const depois = await roda("depois");
    assert.ok(depois[chaves[0]].erro?.startsWith(M_INVALIDA));
    assert.equal(depois[chaves[0]].detalhe, "entrega_propria_desligada");
    assert.ok(
      depois[chaves[1]].ok,
      `DEPOIS: a retirada de fora devia nascer: ${depois[chaves[1]].erro}`,
    );
    assert.ok(
      depois[chaves[2]].ok,
      `DEPOIS: o convidado de fora devia retirar: ${depois[chaves[2]].erro}`,
    );
    assert.ok(
      depois[chaves[3]].ok,
      `DEPOIS: a retirada vale mesmo com cobertura local: ${depois[chaves[3]].erro}`,
    );
  },
);

// ---------------------------------------------------------------------------
// DEPOIS: a matriz, a trigger, a upsert, a view
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: a MATRIZ inteira (v23 e v24 x convidado/logado x CEP local/fora x 3 modos x cobertura x 4 opcoes) responde o que o desenho manda, com a frase e o DETAIL de cada recusa",
  async () => {
    const falhas = await todasAsVerificacoes(instalarNova, ["matrizDaCompra"]);
    assert.deepEqual(falhas, [], falhas.slice(0, 30).join("\n"));
  },
);
prova(
  "DEPOIS: a trigger (so retiro sem retirada ou sem endereco recusa em UPDATE, INSERT e ON CONFLICT; o INSERT fantasma e' ignorado; prazo 0 a 30; NULL nao; a funcao nao tem EXECUTE)",
  async () => {
    const falhas = await todasAsVerificacoes(instalarNova, [
      "gatilhoDoSoRetiro",
    ]);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);
prova(
  "DEPOIS: a upsert aceita as duas chaves e so grava o que veio; valida a linha final; recusa quem nao e' admin ATUAL sem escrever; primeira vez da loja",
  async () => {
    const falhas = await todasAsVerificacoes(instalarNova, [
      "upsertDasDuasChaves",
    ]);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);
prova(
  "DEPOIS: a view tem as 47 colunas e o visitante le true / 1",
  async () => {
    const falhas = await todasAsVerificacoes(instalarNova, ["viewEColunas"]);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

prova(
  "LIMITE DECLARADO: loja em 'Só retiro' SEM CEP de origem ainda recusa a retirada ('A loja ainda está configurando a entrega'): a migration nao relaxa essa checagem, e o desenho nao pediu",
  () =>
    emTransacao(
      async () => {
        await semear();
        await C.query("SAVEPOINT limite");
        await setarLoja({ modo: "so_retiro", origin: "" });
        const r = await pedir({ opcao: "store-pickup", cep: CEPS.fora });
        assert.ok(
          r.erro?.startsWith(M_CONFIGURANDO),
          `esperava a frase da loja em configuracao: ${r.erro}`,
        );
        const c = await pedir({
          opcao: "store-pickup",
          cep: CEPS.fora,
          uid: "",
          papel: "anon",
          dados: { ...DIGITADO, cep: CEPS.fora },
        });
        assert.ok(c.erro?.startsWith(M_CONFIGURANDO), `convidado: ${c.erro}`);
        await C.query("ROLLBACK TO SAVEPOINT limite");
      },
      { estado: "depois" },
    ),
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------

const CONVIDADO_TRAVA = `IF NOT v_retirada_livre AND NOT ${IS_LOCAL} THEN\n            RAISE EXCEPTION 'Compra sem conta`;
const COBERTURA_TRAVA = `IF NOT v_retirada_livre AND NOT ${IS_LOCAL} THEN\n            RAISE EXCEPTION 'Esta loja só faz entrega`;
const PICKUP_CEP = `OR (NOT v_retirada_livre AND COALESCE(${IS_LOCAL}, false) = false) THEN`;
const RECUSA_LOCAL = `        IF v_so_retirada THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = 'entrega_propria_desligada';
        END IF;
`;
const LIVRE =
  "v_retirada_livre := (v_so_retirada AND p_shipping_option_id IS NOT DISTINCT FROM 'store-pickup');";
const SO_RETIRADA =
  "v_so_retirada := (COALESCE(v_store_config.local_delivery_enabled, true) = false);";

const trocaCompra = (de, para) => (c) => {
  assert.equal(
    c.split(de).length - 1,
    1,
    `ancora do mutante nao e' unica: ${de.slice(0, 60)}`,
  );
  return c.replace(de, () => para);
};

const MUTANTES = [
  {
    nome: "a trava do CONVIDADO ignora a retirada livre (o convidado de fora nao retira)",
    alvo: "compras",
    troca: trocaCompra(
      CONVIDADO_TRAVA,
      CONVIDADO_TRAVA.replace("NOT v_retirada_livre AND ", ""),
    ),
    vermelho: ["matrizDaCompra"],
  },
  {
    nome: "a trava da COBERTURA local ignora a retirada livre",
    alvo: "compras",
    troca: trocaCompra(
      COBERTURA_TRAVA,
      COBERTURA_TRAVA.replace("NOT v_retirada_livre AND ", ""),
    ),
    vermelho: ["matrizDaCompra"],
  },
  {
    nome: "o ramo da RETIRADA ainda exige CEP local em 'Só retiro'",
    alvo: "compras",
    troca: trocaCompra(
      PICKUP_CEP,
      `OR COALESCE(${IS_LOCAL}, false) = false THEN`,
    ),
    vermelho: ["matrizDaCompra"],
  },
  {
    nome: "a entrega propria NAO e' recusada em 'Só retiro' (a recusa tirada)",
    alvo: "compras",
    troca: trocaCompra(RECUSA_LOCAL, ""),
    vermelho: ["matrizDaCompra"],
  },
  {
    nome: "a retirada livre nao confere a OPCAO (qualquer id passa livre em 'Só retiro')",
    alvo: "compras",
    troca: trocaCompra(LIVRE, "v_retirada_livre := v_so_retirada;"),
    vermelho: ["matrizDaCompra"],
  },
  {
    nome: "a retirada livre aceita o id com espaco (compara o id normalizado, nao o canonico)",
    alvo: "compras",
    troca: trocaCompra(
      LIVRE,
      "v_retirada_livre := (v_so_retirada AND v_opcao IS NOT DISTINCT FROM 'store-pickup');",
    ),
    vermelho: ["matrizDaCompra"],
  },
  {
    nome: "'Só retiro' nunca liga (v_so_retirada sempre false): a coluna e' ignorada",
    alvo: "compras",
    troca: trocaCompra(SO_RETIRADA, "v_so_retirada := false;"),
    vermelho: ["matrizDaCompra"],
  },
  {
    nome: "a trigger NAO confere a retirada (so retiro sem retirada passa)",
    alvo: "trigger",
    troca: trocaCompra(
      "IF COALESCE('store-pickup' = ANY(COALESCE(NEW.enabled_shipping_methods, '{}'::text[])), false) = false THEN",
      "IF false THEN",
    ),
    vermelho: ["gatilhoDoSoRetiro", "upsertDasDuasChaves"],
  },
  {
    nome: "a trigger NAO confere o endereco da loja",
    alvo: "trigger",
    troca: trocaCompra(
      "IF NULLIF(btrim(COALESCE(NEW.store_address, '')), '') IS NULL THEN",
      "IF false THEN",
    ),
    vermelho: ["gatilhoDoSoRetiro", "upsertDasDuasChaves"],
  },
  {
    nome: "a trigger valida o INSERT FANTASMA do upsert (sem o desvio quando a linha ja existe)",
    alvo: "trigger",
    troca: trocaCompra(
      "IF TG_OP = 'INSERT' AND EXISTS (",
      "IF TG_OP = 'INSERT' AND false AND EXISTS (",
    ),
    vermelho: ["gatilhoDoSoRetiro", "upsertDasDuasChaves"],
  },
  {
    nome: "a trigger conta o array so com a primeira chave (compara 'store-pickup' = methods[1])",
    alvo: "trigger",
    troca: trocaCompra(
      "COALESCE('store-pickup' = ANY(COALESCE(NEW.enabled_shipping_methods, '{}'::text[])), false) = false",
      "COALESCE('store-pickup' = NEW.enabled_shipping_methods[1], false) = false",
    ),
    vermelho: ["gatilhoDoSoRetiro"],
  },
  {
    nome: "a upsert ignora a chave do prazo (nao grava)",
    alvo: "upsert",
    troca: trocaCompra(
      "THEN (config_json->>'local_delivery_days')::integer\n      ELSE store_config.local_delivery_days END,",
      "THEN store_config.local_delivery_days\n      ELSE store_config.local_delivery_days END,",
    ),
    vermelho: ["upsertDasDuasChaves"],
  },
  {
    nome: "a upsert apaga o prazo quando a chave nao vem (sem o CASE por coluna)",
    alvo: "upsert",
    troca: trocaCompra(
      "local_delivery_days = CASE WHEN config_json ? 'local_delivery_days'\n      THEN (config_json->>'local_delivery_days')::integer\n      ELSE store_config.local_delivery_days END,",
      "local_delivery_days = COALESCE((config_json->>'local_delivery_days')::integer, 1),",
    ),
    vermelho: ["upsertDasDuasChaves"],
  },
  {
    nome: "a upsert ignora a chave do modo (nao grava local_delivery_enabled)",
    alvo: "upsert",
    troca: trocaCompra(
      "THEN (config_json->>'local_delivery_enabled')::boolean\n      ELSE store_config.local_delivery_enabled END,",
      "THEN store_config.local_delivery_enabled\n      ELSE store_config.local_delivery_enabled END,",
    ),
    vermelho: ["upsertDasDuasChaves"],
  },
];

for (const m of MUTANTES) {
  prova(`MUTANTE vermelho e restaurado — ${m.nome}`, async () => {
    const instalarMutante = async () => {
      await instalarNova();
      if (m.alvo === "compras") {
        for (const fn of [V23, V24]) {
          const mutado = m.troca(NOVA[fn].corpo);
          assert.notEqual(
            mutado,
            NOVA[fn].corpo,
            "a sabotagem nao mudou o corpo",
          );
          await C.query(decl(NOVA[fn], mutado));
        }
      } else if (m.alvo === "upsert") {
        const mutado = m.troca(NOVA[UPSERT].corpo);
        assert.notEqual(
          mutado,
          NOVA[UPSERT].corpo,
          "a sabotagem nao mudou o corpo",
        );
        await C.query(decl(NOVA[UPSERT], mutado));
      } else {
        const mutado = m.troca(TRIGGER.corpo);
        assert.notEqual(mutado, TRIGGER.corpo, "a sabotagem nao mudou o corpo");
        await C.query(decl(TRIGGER, mutado));
      }
    };
    const falhas = await todasAsVerificacoes(instalarMutante, m.vermelho);
    assert.ok(falhas.length > 0, `o mutante "${m.nome}" NAO ficou vermelho`);
    console.log(
      `    ${m.nome}\n      VERMELHO em ${falhas.length} verificacao(oes); ex.: ${falhas[0].slice(0, 160)}`,
    );
    // Restaurado (o corpo certo de volta): VERDE.
    const restaurado = await todasAsVerificacoes(instalarNova, m.vermelho);
    assert.deepEqual(
      restaurado,
      [],
      `restaurado ainda vermelho: ${restaurado.slice(0, 5).join(" | ")}`,
    );
  });
}

// ---------------------------------------------------------------------------
// SO O QUE DEVE: a migration muda so o que diz
// ---------------------------------------------------------------------------

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
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl, c.reloptions::text AS opts, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  const politicas = (
    await C.query(
      "SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2",
    )
  ).rows;
  const gatilhos = (
    await C.query(
      `SELECT tgrelid::regclass::text AS t, tgname FROM pg_trigger WHERE NOT tgisinternal
        AND tgrelid::regclass::text <> 'store_config' ORDER BY 1, 2`,
    )
  ).rows;
  return { funcoes, tabelas, politicas, gatilhos };
}

prova(
  "SO O QUE DEVE: aplicar a migration muda SO os corpos de v23, v24 e upsert (e cria a funcao da trigger); oid, ACL, atributos e assinatura ficam; nenhuma ACL de tabela, politica ou outra trigger muda",
  () =>
    emTransacao(
      async () => {
        const antes = await retratoDoSchema();
        const oids = {};
        const acls = {};
        for (const fn of [V23, V24, UPSERT]) {
          oids[fn] = await oidVivo(fn);
          acls[fn] = await acl(fn);
        }
        assert.equal(await aplicar(MIGRATION), null);
        const depois = await retratoDoSchema();
        assert.deepEqual(depois.politicas, antes.politicas, "politica mudou");
        assert.deepEqual(
          depois.gatilhos,
          antes.gatilhos,
          "trigger de OUTRA tabela mudou",
        );
        // As tabelas: a ACL de cada uma fica (a coluna nova nao muda ACL de tabela).
        assert.deepEqual(
          depois.tabelas,
          antes.tabelas,
          "ACL/RLS de tabela ou view mudou",
        );
        const nomes = (l) => l.map((f) => f.f);
        const criadas = nomes(depois.funcoes).filter(
          (f) => !nomes(antes.funcoes).includes(f),
        );
        assert.deepEqual(
          criadas,
          [`${TRIG}()`],
          "so a funcao da trigger pode nascer",
        );
        const mudou = depois.funcoes.filter((f) => {
          const velho = antes.funcoes.find((x) => x.f === f.f);
          return velho && JSON.stringify(f) !== JSON.stringify(velho);
        });
        assert.deepEqual(
          mudou.map((f) => f.f.replace(/\(.*$/, "")).sort(),
          [UPSERT, V23, V24].sort(),
          "so v23, v24 e upsert podem mudar",
        );
        for (const f of mudou) {
          const velho = antes.funcoes.find((x) => x.f === f.f);
          assert.deepEqual(
            { ...f, corpo: 0 },
            { ...velho, corpo: 0 },
            `${f.f}: so o corpo muda (oid, ACL, atributos)`,
          );
        }
        for (const fn of [V23, V24, UPSERT]) {
          assert.equal(await oidVivo(fn), oids[fn]);
          assert.deepEqual(await acl(fn), acls[fn]);
          assert.equal(await hashVivo(fn), H[fn].depois);
        }
        assert.deepEqual(await acl(V23), ACL_DAS_COMPRAS);
        assert.deepEqual(await acl(V24), ACL_DAS_COMPRAS);
        assert.deepEqual(await acl(UPSERT), ACL_DO_UPSERT);
        assert.equal(await colunasDaView(), COLUNAS_DA_VIEW_DEPOIS);
      },
      { estado: "antes-real" },
    ),
);

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, CRLF, rollback, destrutivo, pre-voo, pos-voo, atomicidade, corrida
// ---------------------------------------------------------------------------

const retrato = async () => {
  const out = {};
  for (const fn of [V23, V24, UPSERT]) {
    out[fn] = {
      h: await hashVivo(fn),
      src: sha256(await prosrcVivo(fn)),
      oid: await oidVivo(fn),
      acl: (
        await C.query(
          "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
          [FN[fn]],
        )
      ).rows[0].a,
    };
  }
  out.view = await colunasDaView();
  out.trigger = await temTrigger();
  return out;
};

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo estado; o rollback devolve os TRES prosrc IDENTICOS (md5 e sha256) e as ACL, a view de 45 colunas e tira a trigger (colunas ficam); rodado 2x; ida, volta e ida terminam iguais",
  () =>
    emTransacao(
      async () => {
        assert.equal(await aplicar(MIGRATION), null);
        const um = await retrato();
        assert.equal(um.trigger, true);
        assert.equal(um.view, COLUNAS_DA_VIEW_DEPOIS);
        assert.equal(await aplicar(MIGRATION), null);
        assert.deepEqual(await retrato(), um, "reaplicar mudou o estado");
        assert.equal(await aplicar(emCRLF(MIGRATION)), null);
        const crlf = await retrato();
        for (const fn of [V23, V24, UPSERT]) {
          assert.equal(
            crlf[fn].h,
            H[fn].depois,
            `CRLF: o hash (sem CR) de ${fn} tem de ser o mesmo`,
          );
          assert.equal(crlf[fn].oid, um[fn].oid);
          assert.equal(crlf[fn].acl, um[fn].acl);
        }
        assert.equal(await aplicar(ROLLBACK), null);
        const volta = await retrato();
        for (const fn of [V23, V24, UPSERT]) {
          assert.equal(
            volta[fn].h,
            H[fn].antes,
            `rollback: ${fn} nao voltou ao md5 anterior`,
          );
          assert.equal(
            volta[fn].src,
            sha256(ANTIGA[fn].corpo),
            `rollback: ${fn} nao voltou ao prosrc byte a byte`,
          );
          assert.equal(volta[fn].oid, um[fn].oid);
          assert.equal(volta[fn].acl, um[fn].acl);
        }
        assert.equal(
          volta.view,
          COLUNAS_DA_VIEW_ANTES,
          "a view nao voltou as 45 colunas",
        );
        assert.equal(volta.trigger, false, "a trigger ficou");
        assert.equal(
          await temColunas(),
          true,
          "o rollback comum apagou as colunas",
        );
        assert.equal(await aplicar(ROLLBACK), null);
        assert.deepEqual(await retrato(), volta, "rollback 2x");
        assert.equal(await aplicar(emCRLF(ROLLBACK)), null);
        assert.equal(await hashVivo(V24), H[V24].antes, "rollback em CRLF");
        assert.equal(await aplicar(MIGRATION), null);
        assert.deepEqual(await retrato(), um, "ida, volta e ida");
        // A view recriada pelo rollback mantem os papeis de leitura.
        assert.equal(await aplicar(ROLLBACK), null);
        const r = await como("anon", "SELECT id FROM public.v_store_config");
        assert.ok(Array.isArray(r));
      },
      { estado: "antes" },
    ),
);

prova(
  "MIGRATION: o rollback RECUSA com a loja em 'Só retiro' (nada muda) e passa depois de a lojista voltar; o destrutivo recusa fora de ordem e com escolha da lojista, e apaga so no padrao",
  () =>
    emTransacao(
      async () => {
        await semear();
        assert.equal(await aplicar(MIGRATION), null);
        await setarLoja({ modo: "so_retiro" });
        const antes = await retrato();
        const rb = await aplicar(ROLLBACK);
        assert.ok(rb, "o rollback devia recusar com loja em so retiro");
        assert.match(rb.erro, /LOJA_EM_SO_RETIRO_NAO_SE_REVERTE_SEM_QUERER/);
        assert.deepEqual(
          await retrato(),
          antes,
          "o rollback recusado escreveu",
        );
        // o destrutivo: fora de ordem (o comum ainda nao rodou)
        const d0 = await aplicar(DESTRUTIVO);
        assert.ok(
          d0 && /ENTREGA_NA_CIDADE_ROLLBACK_COMUM_PRIMEIRO/.test(d0.erro),
          `fora de ordem: ${d0?.erro}`,
        );
        assert.equal(await temColunas(), true);
        // a lojista volta ao padrao DE PROPOSITO: o rollback comum passa
        await C.query(
          "UPDATE public.store_config SET local_delivery_enabled = true WHERE id = 1",
        );
        assert.equal(await aplicar(ROLLBACK), null);
        assert.equal(await temColunas(), true);
        // com um prazo escolhido, o destrutivo recusa
        await C.query(
          "UPDATE public.store_config SET local_delivery_days = 3 WHERE id = 1",
        );
        const d1 = await aplicar(DESTRUTIVO);
        assert.ok(
          d1 && /ESCOLHA_DA_LOJISTA_NAO_SE_APAGA_SEM_QUERER/.test(d1.erro),
          `prazo escolhido: ${d1?.erro}`,
        );
        assert.equal(await temColunas(), true);
        // com o modo escolhido (so retiro) o destrutivo tambem recusa (mesmo com o comum rodado, forcando o dado)
        await C.query(
          "UPDATE public.store_config SET local_delivery_days = 1, local_delivery_enabled = false WHERE id = 1",
        );
        const d2 = await aplicar(DESTRUTIVO);
        assert.ok(
          d2 && /ESCOLHA_DA_LOJISTA_NAO_SE_APAGA_SEM_QUERER/.test(d2.erro),
          `so retiro: ${d2?.erro}`,
        );
        // no padrao apaga; rodar de novo e' no-op
        await C.query(
          "UPDATE public.store_config SET local_delivery_enabled = true WHERE id = 1",
        );
        assert.equal(await aplicar(DESTRUTIVO), null);
        assert.equal(await temColunas(), false);
        assert.equal(await aplicar(DESTRUTIVO), null, "destrutivo 2x");
        // sem as colunas, o rollback comum rodado de novo tambem e' no-op, e a migration recria tudo no padrao
        assert.equal(
          await aplicar(ROLLBACK),
          null,
          "rollback comum sem colunas",
        );
        assert.equal(await aplicar(MIGRATION), null);
        assert.equal(await temColunas(), true);
        const novas = (
          await C.query(
            "SELECT local_delivery_enabled AS e, local_delivery_days AS d FROM public.store_config WHERE id = 1",
          )
        ).rows[0];
        assert.deepEqual(novas, { e: true, d: 1 });
      },
      { estado: "depois" },
    ),
);

const ESTADOS_RUINS = {
  "v24 com corpo desconhecido (1 comentario a mais)": async () => {
    await C.query(
      decl(
        ANTIGA[V24],
        `${ANTIGA[V24].corpo}\n-- redefinicao que ninguem revisou\n`,
      ),
    );
  },
  "v23 com corpo desconhecido": async () => {
    await C.query(
      decl(
        ANTIGA[V23],
        `${ANTIGA[V23].corpo}\n-- redefinicao que ninguem revisou\n`,
      ),
    );
  },
  "upsert com corpo desconhecido": async () => {
    await C.query(
      decl(
        ANTIGA[UPSERT],
        `${ANTIGA[UPSERT].corpo}\n-- redefinicao que ninguem revisou\n`,
      ),
    );
  },
  "atributo diferente (v23 STABLE)": async () => {
    await C.query(`ALTER FUNCTION ${FN[V23]} STABLE`);
  },
  "atributo diferente (upsert SECURITY INVOKER)": async () => {
    await C.query(`ALTER FUNCTION ${FN[UPSERT]} SECURITY INVOKER`);
  },
  "sobrecarga (outra create_marketplace_order_v24)": async () => {
    await C.query(
      "CREATE FUNCTION public.create_marketplace_order_v24(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    );
  },
  "funcao ausente (v23 apagada)": async () => {
    await C.query(`DROP FUNCTION ${FN[V23]}`);
  },
  "ACL aberta (PUBLIC executa a v24)": async () => {
    await C.query(`GRANT EXECUTE ON FUNCTION ${FN[V24]} TO PUBLIC`);
  },
  "anon sem EXECUTE: o checkout da convidada quebraria": async () => {
    await C.query(`REVOKE EXECUTE ON FUNCTION ${FN[V24]} FROM anon`);
  },
  "anon passa a executar a upsert": async () => {
    await C.query(`GRANT EXECUTE ON FUNCTION ${FN[UPSERT]} TO anon`);
  },
  "view com uma coluna a mais (alguem mexeu por fora)": async () => {
    await C.query(
      "ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS coluna_de_fora text",
    );
    await C.query(
      `CREATE OR REPLACE VIEW public.v_store_config WITH (security_invoker=on) AS SELECT ${COLUNAS_DA_VIEW_ANTES}, coluna_de_fora FROM store_config WHERE id = 1`,
    );
  },
  "a coluna do prazo ja existe com outro tipo": async () => {
    await C.query(
      "ALTER TABLE public.store_config ADD COLUMN local_delivery_days text",
    );
  },
  "a funcao da trigger ja existe com outro corpo": async () => {
    await C.query(
      "CREATE FUNCTION public.store_config_so_retirada_exige_retirada() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'",
    );
  },
};

prova(
  "MIGRATION: o pre-voo recusa SEM escrever em cada estado ruim (B1_BASELINE_DIVERGENT; nenhum corpo, coluna, trigger ou view muda) e o rollback-manual tambem recusa quando o corpo e' desconhecido",
  () =>
    emTransacao(
      async () => {
        for (const [nome, ruim] of Object.entries(ESTADOS_RUINS)) {
          await C.query("SAVEPOINT ruim");
          await ruim();
          const antes = {
            v23: await prosrcVivo(V23),
            v24: await prosrcVivo(V24),
            up: await prosrcVivo(UPSERT),
            cols: await temColunas(),
            trig: await temTrigger(),
            view: await colunasDaView(),
          };
          const erro = await aplicar(MIGRATION);
          assert.ok(erro, `${nome}: a migration devia recusar`);
          assert.match(
            erro.erro,
            /B1_BASELINE_DIVERGENT/,
            `${nome}: ${erro.erro}`,
          );
          const depois = {
            v23: await prosrcVivo(V23),
            v24: await prosrcVivo(V24),
            up: await prosrcVivo(UPSERT),
            cols: await temColunas(),
            trig: await temTrigger(),
            view: await colunasDaView(),
          };
          assert.deepEqual(depois, antes, `${nome}: o pre-voo escreveu`);
          await C.query("ROLLBACK TO SAVEPOINT ruim");
        }
        // O rollback-manual tambem confere o corpo (so quando o estrago e' de corpo de funcao).
        for (const nome of [
          "v24 com corpo desconhecido (1 comentario a mais)",
          "v23 com corpo desconhecido",
          "upsert com corpo desconhecido",
        ]) {
          await C.query("SAVEPOINT ruim");
          await C.query(decl(ANTIGA[V24], ANTIGA[V24].corpo)); // garante o mesmo ponto de partida
          await C.query(MIGRATION);
          await ESTADOS_RUINS[nome]();
          const erro = await aplicar(ROLLBACK);
          assert.ok(
            erro && /B1_BASELINE_DIVERGENT/.test(erro.erro),
            `${nome}: rollback: ${erro?.erro}`,
          );
          await C.query("ROLLBACK TO SAVEPOINT ruim");
        }
      },
      { estado: "antes-real" },
    ),
);

prova(
  "MIGRATION: o pos-voo reprovando DESFAZ tudo — a migration sabotada (v24 com 1 byte a mais) aborta no fim e nenhuma coluna, trigger, view ou corpo muda (o arquivo vai como UMA mensagem, uma transacao implicita); o arquivo de verdade aplica depois",
  async () => {
    if (MUTADO) return;
    const sabotada = MIGRATION.replace(decl(NOVA[V24], NOVA[V24].corpo), () =>
      decl(NOVA[V24], `${NOVA[V24].corpo}\n-- um byte a mais\n`),
    );
    assert.notEqual(sabotada, MIGRATION);
    const solto = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await solto.connect();
    try {
      // estado ANTES REAL, de verdade (clone descartavel): rollback + destrutivo, cada um numa transacao propria.
      await solto
        .query(`BEGIN; ${ROLLBACK}; ${DESTRUTIVO}; COMMIT;`)
        .catch(async (e) => {
          await solto.query("ROLLBACK").catch(() => {});
          throw e;
        });
      const lido = async () =>
        (
          await solto.query(
            `SELECT (SELECT md5(replace(prosrc, E'\\r', '')) FROM pg_proc WHERE oid = to_regprocedure($1)) AS v24,
                    (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'store_config' AND column_name = ANY($2)) AS cols,
                    (SELECT count(*)::int FROM pg_trigger WHERE tgname = $3 AND NOT tgisinternal) AS trig,
                    (SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'public.v_store_config'::regclass AND attnum > 0 AND NOT attisdropped) AS view`,
            [FN[V24], COLUNAS_NOVAS, TRIG],
          )
        ).rows[0];
      const antes = await lido();
      assert.deepEqual(antes, {
        v24: H[V24].antes,
        cols: 0,
        trig: 0,
        view: 45,
      });
      let erro = null;
      try {
        await solto.query(sabotada);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "a migration sabotada devia abortar no pos-voo");
      assert.match(
        erro.message,
        /POSVOO_20261244000000: create_marketplace_order_v24 não ficou com o corpo desta migration/,
      );
      assert.deepEqual(
        await lido(),
        antes,
        "a migration sabotada gravou algo apesar do pos-voo reprovar",
      );
      // O arquivo de verdade aplica de fora de BEGIN e grava de uma vez.
      await solto.query(MIGRATION);
      assert.deepEqual(await lido(), {
        v24: H[V24].depois,
        cols: 2,
        trig: 1,
        view: 47,
      });
    } finally {
      await solto.end();
    }
  },
);

prova(
  "CORRIDA: duas conexoes reais — salvar 'Só retiro' e tirar a retirada AO MESMO TEMPO nunca deixa a loja sem entrega, nas duas ordens (a segunda espera a trava da linha e e' validada sobre a linha FINAL)",
  async () => {
    if (MUTADO) return;
    const nova = async () => {
      const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
      await c.connect();
      return c;
    };
    const a = await nova();
    const b = await nova();
    const adm = await nova();
    const upsertSql =
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)";
    const salvar = async (c, config) => {
      await c.query(upsertSql, [U.admin, JWT_ADMIN]);
      await c.query("SET LOCAL ROLE authenticated");
      return c.query("SELECT public.upsert_store_config($1::jsonb) AS r", [
        JSON.stringify(config),
      ]);
    };
    const lerLoja = async () =>
      (
        await adm.query(
          "SELECT local_delivery_enabled AS e, enabled_shipping_methods AS m, store_address AS a FROM public.store_config WHERE id = 1",
        )
      ).rows[0];
    try {
      // Garante o estado DEPOIS (a prova anterior pode ter deixado o clone no ANTES REAL) e a fixture COMMITADA no
      // clone (limpa no fim): admin, e a loja em "Entrego e retiro".
      await adm.query(MIGRATION);
      await adm.query("BEGIN");
      await adm.query(
        "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'corrida@44.teste', '{\"role\":\"admin\"}'::jsonb)",
        [U.admin],
      );
      await adm.query(
        "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Corrida', 'admin')",
        [U.admin],
      );
      await adm.query("DELETE FROM public.store_config");
      await adm.query(
        "INSERT INTO public.store_config (id, store_address, enabled_shipping_methods) VALUES (1, 'Rua da Corrida, 1', ARRAY['local-delivery', 'store-pickup'])",
      );
      await adm.query("COMMIT");
      const cenario = async (primeiro, segundo, rotulo) => {
        await adm.query(
          "UPDATE public.store_config SET local_delivery_enabled = true, enabled_shipping_methods = ARRAY['local-delivery', 'store-pickup'] WHERE id = 1",
        );
        await a.query("BEGIN");
        await b.query("BEGIN");
        await salvar(a, primeiro); // A segura a linha (nao commitou)
        const espera = salvar(b, segundo).then(
          (r) => ({ ok: r }),
          (e) => ({ erro: e.message }),
        );
        // Dar tempo de B bater na trava de A: B precisa estar BLOQUEADO (nao ter terminado).
        let terminouAntes = false;
        espera.then(() => {
          terminouAntes = true;
        });
        await new Promise((r) => setTimeout(r, 400));
        assert.equal(
          terminouAntes,
          false,
          `${rotulo}: a segunda conexao nao esperou a trava da linha`,
        );
        await a.query("COMMIT");
        const rb = await espera;
        if (rb.ok) await b.query("COMMIT");
        else await b.query("ROLLBACK");
        const l = await lerLoja();
        assert.ok(
          l.e === true || (l.m ?? []).includes("store-pickup"),
          `${rotulo}: a loja ficou em so retiro SEM retirada: ${JSON.stringify(l)}`,
        );
        assert.ok(l.e === true || l.a, `${rotulo}: so retiro sem endereco`);
        return { rb, l };
      };
      // Ordem 1: A liga "so retiro", B tira a retirada. B (2a) e' recusada sobre a linha final.
      const o1 = await cenario(
        { local_delivery_enabled: false },
        { enabled_shipping_methods: ["local-delivery"] },
        "A=so retiro, B=tira a retirada",
      );
      assert.ok(
        o1.rb.erro?.includes("LOJA_SO_RETIRADA_SEM_RETIRADA"),
        `ordem 1: a segunda devia ser recusada: ${JSON.stringify(o1.rb)}`,
      );
      assert.equal(o1.l.e, false);
      assert.deepEqual(o1.l.m, ["local-delivery", "store-pickup"]);
      // Ordem 2: A tira a retirada, B liga "so retiro". B (2a) e' recusada: ve a linha sem retirada.
      const o2 = await cenario(
        { enabled_shipping_methods: ["local-delivery"] },
        { local_delivery_enabled: false },
        "A=tira a retirada, B=so retiro",
      );
      assert.ok(
        o2.rb.erro?.includes("LOJA_SO_RETIRADA_SEM_RETIRADA"),
        `ordem 2: a segunda devia ser recusada: ${JSON.stringify(o2.rb)}`,
      );
      assert.equal(o2.l.e, true);
      assert.deepEqual(o2.l.m, ["local-delivery"]);
      // Ordem 3 (sem conflito): duas gravacoes que se completam passam as duas.
      const o3 = await cenario(
        { local_delivery_days: 5 },
        { local_delivery_enabled: false },
        "A=prazo, B=so retiro",
      );
      assert.ok(o3.rb.ok, `ordem 3: ${JSON.stringify(o3.rb)}`);
      const fim = (
        await adm.query(
          "SELECT local_delivery_enabled AS e, local_delivery_days AS d FROM public.store_config WHERE id = 1",
        )
      ).rows[0];
      assert.deepEqual(
        fim,
        { e: false, d: 5 },
        "as duas gravacoes que se completam tem de ficar as duas",
      );
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await b.query("ROLLBACK").catch(() => {});
      await adm.query("BEGIN").catch(() => {});
      await adm.query("DELETE FROM public.store_config").catch(() => {});
      await adm
        .query("DELETE FROM public.profiles WHERE id = $1", [U.admin])
        .catch(() => {});
      await adm
        .query("DELETE FROM auth.users WHERE id = $1", [U.admin])
        .catch(() => {});
      await adm.query("COMMIT").catch(() => {});
      await a.end();
      await b.end();
      await adm.end();
    }
  },
);

// ---------------------------------------------------------------------------

async function main() {
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  await C.query("BEGIN");
  // A 20261350000000 (trava o preço e espera a mesma chave) é a sucessora dos corpos de v23/v24 desta migration: cai
  // ANTES, para a prova medir os corpos da 244 (ver a-compra-online-trava-posterior.cjs).
  await require("./a-compra-online-trava-posterior.cjs").desfazerCompraOnlineTravaNaTransacao(
    C,
  );
  await require("./estilo-card-frete-posterior.cjs").desfazerEstiloCardFreteNaTransacao(
    C,
  );
  await C.query("COMMIT");
  let ok = 0;
  const falhas = [];
  // No modo mutante de arquivo roda SO a prova de comportamento (ver MUTADO).
  const lista = MUTADO
    ? PROVAS.filter((p) => p.nome.startsWith("DEPOIS:"))
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
          `  FALHOU  ${nome}\n      ${String(e.message).split("\n").join("\n      ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end();
  }
  console.log(`\n${ok}/${lista.length} provas passaram.`);
  if (falhas.length) falhar("FALHOU", `${falhas.length} prova(s) reprovadas.`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
