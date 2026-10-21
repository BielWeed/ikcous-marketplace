"use strict";

/**
 * Prova VIVA da migration 20261350000000 (a compra online trava o preço-base e a mesma chave de idempotência espera a
 * primeira: `create_marketplace_order_v23` e `v24`; DINHEIRO), num Postgres EFÊMERO local, sem rede, com os papéis de
 * verdade (anon, authenticated, service_role) e CONEXÕES REAIS em paralelo (a espera é medida em pg_locks e
 * pg_stat_activity, nunca por dormir e torcer).
 *
 * O banco é o clone do rodar-isolado.cjs: a árvore migrada (a 20261350 já está no ar). Os cenários de concorrência
 * COMMITAM no clone (o clone some no fim) e trocam o corpo das funções entre o ANTES (rollback-manual: corpos da
 * 20261244000000) e o DEPOIS (a migration), para cada defeito ser medido nos DOIS corpos: o controle mostra o defeito
 * com o corpo antigo, e o corpo novo o impede.
 *
 *  CORPOS     os corpos novos são os da 20261244000000 (lidos do ARQUIVO) mais SÓ as três edições combinadas: o diff de
 *             linhas tem exatamente a linha `OF v, p` no lugar de `OF v`, o PERFORM do advisory lock e o bloco da ordem
 *             global das travas (duas variáveis e as linhas do golden); o rollback devolve os dois corpos BYTE A BYTE
 *             (md5 e sha256 do `prosrc` vivo) e a declaração é idêntica.
 *  D4         ORDEM GLOBAL das travas: duas compras SIMULTÂNEAS de carrinho misto (A = camiseta M + caneca, B = caneca +
 *             camiseta G) e de duas variações em ordem oposta CONCLUEM, sem deadlock (40P01), na v23 e na v24, numa
 *             coreografia de duas conexões reais seguradas por sessões de prova (esperas medidas em pg_stat_activity) e
 *             em 20 rodadas de corrida livre. CONTROLE: o corpo da 244 (variações em ordem oposta) e o corpo desta
 *             migration SEM o bloco da ordem global (carrinho misto) derrubam uma das duas com "deadlock detected". O
 *             painel que salva uma variação (a trigger tranca o produto DEPOIS da variação) não cruza com a compra, e a
 *             recusa de payload malformado, item inexistente e quantidade inválida é a MESMA dos corpos da 244.
 *  D3         reenvio SIMULTÂNEO com a mesma chave: a segunda chamada espera (advisory lock) e devolve o MESMO pedido, na
 *             última unidade do estoque e com o cupom no limite, na v23 e na v24. Controle: com o corpo antigo a segunda
 *             recebe "estoque insuficiente" / "limite de usos do cupom" de um pedido que já existe. A primeira
 *             desistir no meio (ROLLBACK depois de criar) deixa a segunda criar o pedido (uma vez). Chave diferente e
 *             chave nula NÃO esperam.
 *  D2         preço-base salvo no meio da gravação (a segunda sessão é o painel): o cabeçalho e o item gravam o MESMO
 *             preço, e o painel espera o pedido terminar. Controle: com o corpo antigo o item sai com o preço novo e o
 *             cabeçalho com o antigo. Na v23 e na v24, com variação sem price_override.
 *  DADOS      o pedido que JÁ existia antes da migration não muda (md5 das tabelas) e o reenvio da chave dele depois
 *             devolve o mesmo pedido.
 *  PERMISSÃO  atributos e ACL iguais antes e depois; anon, authenticated e service_role executam; PUBLIC não.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback repetido é recusado; o pré-voo recusa SEM escrever (corpo
 *             desconhecido, corpo anterior à 244, atributo trocado, ACL aberta, sobrecarga, função ausente); o pós-voo
 *             reprovando desfaz tudo; a troca do corpo com uma sessão no meio de uma compra não trava nem erra.
 *  CONSULTAS  81a/81b: rol exato de 7 linhas, positivas no estado certo, cada desvio no item certo; 31a, 37a e 47a seguem
 *             positivas nos dois estados.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/compra-online-travas-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório (as migrations e as consultas), nunca de entrada de rede; os índices vêm de
 * contadores e de listas fechadas deste arquivo. */

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
  "20261350000000_a_compra_online_trava_o_preco_e_espera_a_mesma_chave.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, nome), "utf8");
const MIGRATION = ler(ARQ).replace(/\r\n/g, "\n");
const ROLLBACK = ler(`rollback-manual-${ARQ}`).replace(/\r\n/g, "\n");
const SRC_244 = ler("20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql");
const SRC_229 = ler("20261229000000_o_endereco_da_compra_fica_no_pedido.sql");
const SRC_236 = ler(
  "20261236000000_a_compra_que_da_zero_reais_nao_se_paga_pelo_app.sql",
);
const A81 = lerConsulta(
  "81a-conferir-compra-online-trava-preco-e-chave-aplicado.sql",
);
const B81 = lerConsulta(
  "81b-antes-compra-online-trava-preco-e-chave-base-vigente.sql",
);
const CONFERIR_BANCO = fs.readFileSync(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
  "utf8",
);
const CONSULTAS_QUE_ACEITAM = [
  "31a-conferir-endereco-da-compra-fica-no-pedido.sql",
  "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado.sql",
  "47a-conferir-a-loja-escolhe-como-entrega-aplicado.sql",
].map((n) => ({ n, sql: lerConsulta(n) }));
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const ASSINATURA =
  "(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)";
const FN = {
  [V23]: `public.${V23}${ASSINATURA}`,
  [V24]: `public.${V24}${ASSINATURA}`,
};
const H = {
  [V23]: {
    antes: "79445d64a87843be2d42bf601c7090ec",
    depois: "6b71cb823967518955407b532904ae91",
  },
  [V24]: {
    antes: "85c37af4baa2f5ce1375bdd9e943c746",
    depois: "e3c124d25632aaa9bcf1995153bc5a7e",
  },
};
const MUTADO = process.env.PROVA_ARQUIVO_MUTADO === "1";

/** Do `CREATE OR REPLACE FUNCTION public.<fn>(` ao `$function$;`: { cabeca (até o `AS $function$`), corpo }. */
function funcaoDe(sql, fn) {
  const delim = "$function$";
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `declaração de ${fn} não achada`);
  const ab = sql.indexOf(delim, ini);
  const corpoIni = ab + delim.length;
  const fim = sql.indexOf(delim, corpoIni);
  return { cabeca: sql.slice(ini, corpoIni), corpo: sql.slice(corpoIni, fim) };
}
const decl = (f, corpo = f.corpo) => `${f.cabeca + corpo}$function$;`;
const norm = (s) => s.replace(/\r\n/g, "\n");
const ANTIGA = {
  [V23]: funcaoDe(norm(SRC_244), V23),
  [V24]: funcaoDe(norm(SRC_244), V24),
};
const NOVA = {
  [V23]: funcaoDe(MIGRATION, V23),
  [V24]: funcaoDe(MIGRATION, V24),
};
const ROLL = {
  [V23]: funcaoDe(ROLLBACK, V23),
  [V24]: funcaoDe(ROLLBACK, V24),
};
const DE_229_V23 = funcaoDe(norm(SRC_229), V23);
const DE_236_V24 = funcaoDe(norm(SRC_236), V24);

for (const fn of [V23, V24]) {
  assert.equal(
    md5(ANTIGA[fn].corpo),
    H[fn].antes,
    `o corpo da 244 de ${fn} mudou`,
  );
  assert.equal(
    ROLL[fn].corpo,
    ANTIGA[fn].corpo,
    `o rollback de ${fn} não é o corpo da 244 byte a byte`,
  );
  assert.equal(
    ROLL[fn].cabeca,
    ANTIGA[fn].cabeca,
    `a declaração do rollback de ${fn} mudou`,
  );
  assert.equal(
    NOVA[fn].cabeca,
    ANTIGA[fn].cabeca,
    `a declaração de ${fn} mudou (assinatura, atributos)`,
  );
  // MODO MUTANTE DE ARQUIVO (PROVA_ARQUIVO_MUTADO=1): quem edita o ARQUIVO da migration para sabotar um corpo (e
  // regenera os hashes dela) roda a prova de COMPORTAMENTO sem a trava de hash fixo, que reprovaria a edição antes de
  // qualquer comportamento ser medido. Nunca roda em CI.
  if (MUTADO) H[fn].depois = md5(NOVA[fn].corpo);
  else
    assert.equal(
      md5(NOVA[fn].corpo),
      H[fn].depois,
      `o corpo novo de ${fn} mudou`,
    );
}

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

const TRAVA_DA_CHAVE =
  "PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pedido_online:' || p_idempotency_key::text, 0));";

// O bloco "ordem global das travas" (D4) vem entre dois marcadores, iguais nas duas funções.
const INI_ORDEM = "-- >>> ordem global das travas (20261350000000)";
const FIM_ORDEM = "-- <<< ordem global das travas (20261350000000)";
/** As linhas de CÓDIGO do bloco, aparadas (o golden do diff de linhas), na ordem em que aparecem. */
const LINHAS_DA_ORDEM = [
  "FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)",
  "LOOP",
  "BEGIN",
  "v_product_id := (v_item->>'product_id')::uuid;",
  "v_variant_id := (v_item->>'variant_id')::uuid;",
  "EXCEPTION WHEN invalid_text_representation THEN",
  "CONTINUE;",
  "END;",
  "IF v_product_id IS NOT NULL THEN",
  "v_trava_produtos := array_append(v_trava_produtos, v_product_id);",
  "END IF;",
  "IF v_variant_id IS NOT NULL THEN",
  "v_trava_variantes := array_append(v_trava_variantes, v_variant_id);",
  "END IF;",
  "END LOOP;",
  "IF cardinality(v_trava_variantes) > 0 THEN",
  "PERFORM 1",
  "FROM public.product_variants v",
  "WHERE v.id = ANY(v_trava_variantes)",
  "ORDER BY v.id",
  "FOR NO KEY UPDATE;",
  "END IF;",
  "IF cardinality(v_trava_produtos) > 0 THEN",
  "PERFORM 1",
  "FROM public.produtos p",
  "WHERE p.id = ANY(v_trava_produtos)",
  "ORDER BY p.id",
  "FOR NO KEY UPDATE;",
  "END IF;",
];
const DECLARES_DA_ORDEM = [
  "v_trava_variantes uuid[] := ARRAY[]::uuid[];",
  "v_trava_produtos uuid[] := ARRAY[]::uuid[];",
];
/**
 * O corpo da migration SEM o bloco da ordem global: é o corpo que esta migration tinha ANTES de D4 (`OF v, p` e o advisory
 * lock, sem a ordem global) — o CONTROLE do deadlock do carrinho misto, que o corpo da 244 não tem.
 */
function semOrdemGlobal(corpo) {
  const i = corpo.indexOf(INI_ORDEM);
  const f = corpo.indexOf(FIM_ORDEM);
  assert.ok(i > 0 && f > i, "marcadores do bloco da ordem global não achados");
  const inicioDaLinha = corpo.lastIndexOf("\n", i) + 1;
  const fimDaLinha = corpo.indexOf("\n", f) + 1;
  // some também a linha em branco que o bloco deixa depois do marcador final
  const depois = corpo[fimDaLinha] === "\n" ? fimDaLinha + 1 : fimDaLinha;
  return corpo.slice(0, inicioDaLinha) + corpo.slice(depois);
}
/** Instala o CONTROLE (corpo sem a ordem global) nas duas funções, COMMITADO. */
async function instalarControleSemOrdem(c) {
  for (const fn of [V23, V24])
    await c.query(decl(NOVA[fn], semOrdemGlobal(NOVA[fn].corpo)));
  assert.match(
    await estadoDe(c),
    /^misto/,
    "o controle devia ser um corpo à parte",
  );
}

// ---------------------------------------------------------------------------
// Cenário
// ---------------------------------------------------------------------------

const ACL_DAS_COMPRAS = [
  "anon=X/postgres",
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];
const U_CLIENTE = "7e350000-0000-4000-8000-0000000000d1";
const JWT_CLIENTE = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "customer" },
});
const ENDERECO_DA_LOJA = "Rua da Loja, 100 - Centro";
const CEP_LOCAL = "38500-100";
const DIGITADO = {
  street: "Rua Digitada",
  number: "5",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
  cep: CEP_LOCAL,
};
const GANCHO = 7350001; // o advisory lock que o gatilho de prova usa para segurar a compra no meio

let C; // conexão única das provas de estado (cada caso numa transação desfeita)
let ADM; // conexão de autocommit: troca o corpo e semeia dados COMMITADOS no clone
let seq = 0;
const uid = (n) => `7e350000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashVivo = async (c, fn) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN[fn]],
    )
  ).rows[0]?.h;
const prosrcVivo = async (c, fn) =>
  (
    await c.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN[fn]],
    )
  ).rows[0]?.prosrc;
async function estadoDe(c) {
  const h23 = await hashVivo(c, V23);
  const h24 = await hashVivo(c, V24);
  if (h23 === H[V23].depois && h24 === H[V24].depois) return "depois";
  if (h23 === H[V23].antes && h24 === H[V24].antes) return "antes";
  return `misto:${h23}/${h24}`;
}
/** Põe o clone (COMMITADO) no estado pedido: "antes" = corpos da 244 (rollback), "depois" = a migration. */
async function noEstado(c, alvo) {
  if ((await estadoDe(c)) === alvo) return;
  // Corpo "misto" (um CONTROLE instalado à mão, sem o bloco da ordem global): volta ao corpo da migration direto, sem
  // passar pelo pré-voo (que só aceita o corpo da 244 ou o da migration).
  if ((await estadoDe(c)).startsWith("misto"))
    for (const fn of [V23, V24]) await c.query(decl(NOVA[fn]));
  if ((await estadoDe(c)) === alvo) return;
  await c.query(alvo === "antes" ? ROLLBACK : MIGRATION);
  assert.equal(await estadoDe(c), alvo, `não consegui pôr o clone em ${alvo}`);
}
async function acl(c, fn) {
  const r = await c.query(
    `SELECT coalesce(array_agg(x::text ORDER BY x::text), '{}') AS a
       FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) AS x
      WHERE p.oid = to_regprocedure($1)`,
    [FN[fn]],
  );
  return r.rows[0].a;
}
async function atributos(c, fn) {
  const r = await c.query(
    `SELECT l.lanname, p.prosecdef, p.provolatile, p.proretset, p.proisstrict, p.pronargs, p.proconfig,
            pg_get_function_result(p.oid) AS retorno, pg_get_function_arguments(p.oid) AS args,
            pg_get_userbyid(p.proowner) AS dono
       FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure($1)`,
    [FN[fn]],
  );
  return r.rows[0];
}

/** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(c, sql) {
  await c.query("SAVEPOINT arquivo");
  try {
    await c.query(sql);
    await c.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}
/** Uma transação por caso, sempre desfeita, no estado pedido ("antes" ou "depois"), na conexão C. */
async function emTransacao(fn, { estado = "depois" } = {}) {
  await noEstado(ADM, "depois");
  await C.query("BEGIN");
  try {
    if (estado === "antes") {
      await C.query(ROLLBACK);
      assert.equal(await estadoDe(C), "antes", "ANTES: corpos da 244");
    } else {
      assert.equal(await estadoDe(C), "depois", "DEPOIS: corpos da migration");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

// ---- semente COMMITADA (cada cenário cria o seu produto, com id novo) ----

async function semearBase(c) {
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@1350.teste', '{}'::jsonb) ON CONFLICT DO NOTHING",
    [U_CLIENTE],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente 1350', 'customer') ON CONFLICT DO NOTHING",
    [U_CLIENTE],
  );
  await c.query(
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
}
async function novoProduto(
  c,
  { estoque = 1000, preco = 100, variacao = false },
) {
  seq += 1;
  const id = uid(100 + seq);
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, $2, $3, $4, true, 40, false)",
    [id, `Produto 1350 ${seq}`, preco, estoque],
  );
  let varId = null;
  if (variacao) {
    varId = uid(5000 + seq);
    await c.query(
      "INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES ($1, $2, 'Tamanho', 'M', 50, true)",
      [varId, id],
    );
  }
  return { id, varId };
}
async function novoCupom(c, { limite }) {
  seq += 1;
  const codigo = `P1350X${seq}`;
  const r = await c.query(
    `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active)
     VALUES ($1, 'fixed', 10, 0, $2, 0, NULL, true) RETURNING id`,
    [codigo, limite],
  );
  return { id: r.rows[0].id, codigo };
}

// ---- sessões reais e compras ----

async function sessao(papel = "authenticated") {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  c.pid = (await c.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  if (papel) {
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, false), set_config('request.jwt.claims', $2, false)",
      [papel === "anon" ? "" : U_CLIENTE, papel === "anon" ? "" : JWT_CLIENTE],
    );
    await c.query(`SET ROLE ${papel}`);
  }
  return c;
}
const SQL_PEDIDO = (rpc) =>
  `SELECT public.${rpc}($1::jsonb, $2::numeric, $3::numeric, $4::text, NULL::uuid, $5::text,
     'Comprador Prova', '5534999990000', NULL::text, $6::jsonb, $7::text, $8::text, $9::uuid) AS id`;
function comprar(
  c,
  { rpc = V24, prod, total = 100, chave, cupom = null, dados = null, metodo },
) {
  return c.query(SQL_PEDIDO(rpc), [
    JSON.stringify([
      { product_id: prod.id, variant_id: prod.varId ?? null, quantity: 1 },
    ]),
    total,
    0,
    metodo ?? (rpc === V24 ? "online" : "cash"),
    cupom,
    dados === null ? null : JSON.stringify(dados),
    CEP_LOCAL,
    "local-delivery",
    chave,
  ]);
}
/** Observa uma promessa de consulta sem derrubar o teste: { fim, p: Promise<{ok}|{erro}> }. */
function observar(promessa, tirar = (r) => r.rows[0].id) {
  const e = { fim: false };
  e.p = promessa
    .then(
      (r) => ({ ok: tirar(r) }),
      (x) => ({ erro: x.message }),
    )
    .then((r) => {
      e.fim = true;
      return r;
    });
  return e;
}
/**
 * A sessão `pid` está PARADA numa espera: "advisory" (pg_locks), "linha" (trava de linha: esperando a transação dona
 * da linha OU a fila da linha) ou "fila" (só a FILA da linha: já há outra sessão esperando a mesma linha na frente).
 */
async function emEspera(pid, tipo) {
  for (let i = 0; i < 120; i++) {
    const r =
      tipo === "advisory"
        ? await ADM.query(
            "SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted",
            [pid],
          )
        : await ADM.query(
            `SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'
                AND wait_event IN (${tipo === "fila" ? "'tuple'" : "'transactionid', 'tuple'"})`,
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

// ---- carrinhos com mais de um item e linhas seguradas à mão (D4) ----

async function novaVariacao(c, prod, valor) {
  seq += 1;
  const id = uid(7000 + seq);
  await c.query(
    "INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES ($1, $2, 'Tamanho', $3, 50, true)",
    [id, prod.id, valor],
  );
  return id;
}
/** Carrinho de vários itens (1 unidade de cada, R$ 100 cada, entrega local grátis): itens = [{ prod, varId? }]. */
function comprarCarrinho(c, { rpc = V24, itens, chave }) {
  return c.query(SQL_PEDIDO(rpc), [
    JSON.stringify(
      itens.map((i) => ({
        product_id: i.prod.id,
        variant_id: i.varId ?? null,
        quantity: 1,
      })),
    ),
    100 * itens.length,
    0,
    rpc === V24 ? "online" : "cash",
    null,
    null,
    CEP_LOCAL,
    "local-delivery",
    chave,
  ]);
}
/** Uma sessão que SEGURA (transação aberta) as linhas pedidas: [["produtos" | "product_variants", id], ...]. */
async function segurar(linhas) {
  const g = await sessao(null);
  await g.query("BEGIN");
  for (const [tabela, id] of linhas) {
    assert.ok(["produtos", "product_variants"].includes(tabela), tabela);
    await g.query(`SELECT 1 FROM public.${tabela} WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
  }
  return g;
}

// ---------------------------------------------------------------------------
// CORPOS
// ---------------------------------------------------------------------------

prova(
  "CORPOS: o corpo novo é o da 244 mais SÓ as três edições (diff de linhas: OF v, p; a trava da chave; as duas variáveis e o bloco da ordem global), igual nas duas funções; o rollback é a 244 byte a byte",
  async () => {
    for (const fn of [V23, V24]) {
      const d = diffDeLinhas(ANTIGA[fn].corpo, NOVA[fn].corpo);
      assert.deepEqual(
        soCodigo(d.removidas),
        ["FOR NO KEY UPDATE OF v;"],
        `${fn}: linhas de código removidas`,
      );
      assert.deepEqual(
        soCodigo(d.adicionadas),
        [
          "FOR NO KEY UPDATE OF v, p;",
          TRAVA_DA_CHAVE,
          ...DECLARES_DA_ORDEM,
          ...LINHAS_DA_ORDEM,
        ].sort(),
        `${fn}: linhas de código adicionadas`,
      );
      // O bloco da ordem global: um só, entre os marcadores, logo antes do laço do passo 3 e depois de todo o resto
      // do preâmbulo; as variações são trancadas ANTES dos produtos (a ordem da trigger sync_produto_ultima_atualizacao).
      const c = NOVA[fn].corpo;
      assert.equal(c.split(INI_ORDEM).length - 1, 1, `${fn}: um bloco`);
      assert.equal(c.split(FIM_ORDEM).length - 1, 1, `${fn}: um fim de bloco`);
      const iIni = c.indexOf(INI_ORDEM);
      const iFim = c.indexOf(FIM_ORDEM);
      const iPasso3 = c.indexOf("-- 3. Validation Loop");
      assert.ok(iIni < iFim && iFim < iPasso3, `${fn}: bloco antes do passo 3`);
      assert.ok(
        c.slice(iFim, iPasso3).split("\n").length <= 4,
        `${fn}: nada entre o bloco e o passo 3`,
      );
      const bloco = c.slice(iIni, iFim);
      assert.ok(
        bloco.indexOf("public.product_variants v") <
          bloco.indexOf("public.produtos p"),
        `${fn}: variações antes dos produtos`,
      );
      assert.equal(
        bloco.split("ORDER BY").length - 1,
        2,
        `${fn}: as duas travas ordenadas por id`,
      );
      assert.equal(
        soCodigo(bloco.split("\n").map((l) => l.trim())).length,
        LINHAS_DA_ORDEM.length,
        `${fn}: o bloco não tem código além do golden`,
      );
      assert.equal(
        d.removidas.filter((l) => l !== "").length,
        1,
        `${fn}: só a linha da trava sai (nenhum comentário some)`,
      );
      // A trava da chave é a PRIMEIRA coisa do bloco do passo 0, antes da busca do pedido pela chave.
      const corpo = NOVA[fn].corpo;
      const iTrava = corpo.indexOf(TRAVA_DA_CHAVE);
      const iBusca = corpo.indexOf("WHERE idempotency_key = p_idempotency_key");
      const iSe = corpo.lastIndexOf(
        "IF p_idempotency_key IS NOT NULL THEN",
        iTrava,
      );
      assert.ok(iSe >= 0 && iSe < iTrava && iTrava < iBusca, `${fn}: ordem`);
      assert.equal(
        corpo.split("pg_advisory_xact_lock").length - 1,
        1,
        `${fn}: um advisory lock só`,
      );
      assert.equal(corpo.split("OF v, p;").length - 1, 1, `${fn}: um OF v, p`);
      assert.equal(corpo.split("OF v;").length - 1, 0, `${fn}: nenhum OF v`);
    }
    // Nenhum BEGIN/COMMIT de nível superior (com eles o ROLLBACK do aplicador viraria no-op) e nenhum GRANT/REVOKE.
    for (const [rotulo, sql] of [
      ["migration", MIGRATION],
      ["rollback", ROLLBACK],
    ]) {
      assert.equal(
        /^\s*(BEGIN|COMMIT|START TRANSACTION)\s*;/im.test(sql),
        false,
        `${rotulo}: BEGIN/COMMIT de nível superior`,
      );
      assert.deepEqual(
        sql.match(/^\s*(GRANT|REVOKE)\b.*$/gim) ?? [],
        [],
        `${rotulo}: nenhuma mudança de permissão`,
      );
      assert.ok(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
    }
  },
);

prova(
  "CORPOS: com o rollback aplicado o prosrc vivo é IDÊNTICO ao da 244 (md5 e sha256, v23 e v24); a migration o troca e o rollback de novo o devolve",
  async () => {
    await emTransacao(
      async () => {
        for (const fn of [V23, V24]) {
          const src = await prosrcVivo(C, fn);
          assert.equal(md5(src), H[fn].antes);
          assert.equal(sha256(src), sha256(ANTIGA[fn].corpo), fn);
        }
        assert.equal(await aplicar(C, MIGRATION), null);
        for (const fn of [V23, V24])
          assert.equal(await hashVivo(C, fn), H[fn].depois, fn);
        assert.equal(await aplicar(C, ROLLBACK), null);
        for (const fn of [V23, V24])
          assert.equal(
            sha256(await prosrcVivo(C, fn)),
            sha256(ANTIGA[fn].corpo),
          );
      },
      { estado: "antes" },
    );
  },
);

// ---------------------------------------------------------------------------
// D3: a mesma chave espera a primeira
// ---------------------------------------------------------------------------

/**
 * A (transação aberta) cria o pedido e SEGURA; B repete a MESMA chave enquanto A não commitou; A commita; devolve o que B
 * recebeu. `esperaEm` diz onde B deve parar: "advisory" (corpo novo) ou "linha" (corpo antigo: a trava de linha do item).
 */
async function reenvioSimultaneo({ rpc, ultimaUnidade, comCupom, esperaEm }) {
  const A = await sessao();
  const B = await sessao();
  try {
    const prod = await novoProduto(ADM, {
      estoque: ultimaUnidade ? 1 : 1000,
    });
    const cupom = comCupom ? await novoCupom(ADM, { limite: 1 }) : null;
    const chave = crypto.randomUUID();
    const dados = {
      rpc,
      prod,
      chave,
      total: comCupom ? 90 : 100,
      cupom: cupom?.codigo ?? null,
    };
    await A.query("BEGIN");
    const idA = (await comprar(A, dados)).rows[0].id;
    const eB = observar(comprar(B, dados));
    assert.ok(
      await emEspera(B.pid, esperaEm),
      `a segunda chamada não parou em ${esperaEm}`,
    );
    assert.equal(eB.fim, false, "a segunda terminou antes de A commitar");
    await A.query("COMMIT");
    const rB = await eB.p;
    const contagem = (
      await ADM.query(
        `SELECT (SELECT count(*)::int FROM public.marketplace_orders WHERE idempotency_key = $1) AS pedidos,
                (SELECT count(*)::int FROM public.marketplace_order_items WHERE product_id = $2) AS itens,
                (SELECT estoque FROM public.produtos WHERE id = $2) AS estoque,
                (SELECT usage_count FROM public.coupons WHERE id = $3) AS usos`,
        [chave, prod.id, cupom?.id ?? null],
      )
    ).rows[0];
    return { idA, rB, contagem };
  } finally {
    await fechar(A, B);
  }
}

for (const rpc of [V24, V23]) {
  for (const [rotulo, opcoes] of [
    ["última unidade do estoque", { ultimaUnidade: true, comCupom: false }],
    ["cupom no limite de uso", { ultimaUnidade: false, comCupom: true }],
  ]) {
    prova(
      `D3 (${rpc}): reenvio SIMULTÂNEO com a mesma chave na ${rotulo}: a segunda espera e devolve o MESMO pedido (uma venda, um item); CONTROLE: com o corpo da 244 ela recebe recusa de um pedido que já existe`,
      async () => {
        await noEstado(ADM, "antes");
        try {
          const antes = await reenvioSimultaneo({
            rpc,
            ...opcoes,
            esperaEm: "linha",
          });
          assert.ok(
            antes.rB.erro,
            `CONTROLE: com o corpo antigo a segunda devia ser recusada, devolveu ${JSON.stringify(antes.rB)}`,
          );
          assert.match(
            antes.rB.erro,
            opcoes.comCupom
              ? /atingiu o limite de usos/
              : /Estoque insuficiente/,
            `CONTROLE: a recusa é a do defeito (veio: ${antes.rB.erro})`,
          );
          assert.equal(antes.contagem.pedidos, 1);
        } finally {
          await noEstado(ADM, "depois");
        }
        const depois = await reenvioSimultaneo({
          rpc,
          ...opcoes,
          esperaEm: "advisory",
        });
        assert.deepEqual(
          depois.rB,
          { ok: depois.idA },
          "a segunda devia devolver o MESMO pedido",
        );
        assert.equal(depois.contagem.pedidos, 1, "um pedido só para a chave");
        assert.equal(depois.contagem.itens, 1, "um item só (nada em dobro)");
        if (opcoes.comCupom)
          assert.equal(
            Number(depois.contagem.usos),
            1,
            "o cupom gasta uma vez",
          );
        else assert.equal(Number(depois.contagem.estoque), 0, "baixa uma vez");
      },
    );
  }
}

prova(
  "D3: a primeira compra DESISTE no meio (ROLLBACK depois de criar o pedido, antes do commit): a segunda, que esperava, cria o pedido, uma vez, e o estoque baixa uma vez (a trava solta no rollback)",
  async () => {
    await noEstado(ADM, "depois");
    const A = await sessao();
    const B = await sessao();
    try {
      const prod = await novoProduto(ADM, { estoque: 5 });
      const chave = crypto.randomUUID();
      await A.query("BEGIN");
      // A cria o pedido (baixa o estoque, grava o item) e segura a transação aberta; depois desiste.
      // (Um ERRO dentro da função solta as travas na hora; o que prende a segunda é a transação aberta de A.)
      const idA = (await comprar(A, { prod, chave })).rows[0].id;
      assert.ok(idA);
      const eB = observar(comprar(B, { prod, chave }));
      assert.ok(
        await emEspera(B.pid, "advisory"),
        "B devia esperar a trava de A",
      );
      await A.query("ROLLBACK");
      const rB = await eB.p;
      assert.ok(rB.ok, `B devia criar o pedido: ${JSON.stringify(rB)}`);
      const n = (
        await ADM.query(
          "SELECT count(*)::int AS n FROM public.marketplace_orders WHERE idempotency_key = $1",
          [chave],
        )
      ).rows[0].n;
      assert.equal(n, 1, "um pedido só");
      assert.equal(
        Number(
          (
            await ADM.query(
              "SELECT estoque FROM public.produtos WHERE id = $1",
              [prod.id],
            )
          ).rows[0].estoque,
        ),
        4,
        "o estoque baixou uma vez (a falha de A não baixou nada)",
      );
    } finally {
      await fechar(A, B);
    }
  },
);

prova(
  "D3: a trava é pela CHAVE — chave igual espera; chave diferente e chave nula (convidado) NÃO esperam; CONTROLE: com o corpo da 244 nem a chave igual espera nessa trava",
  async () => {
    const travaDe = (A, chave) =>
      A.query(
        "SELECT pg_advisory_xact_lock(pg_catalog.hashtextextended('pedido_online:' || $1::text, 0))",
        [chave],
      );
    // CONTROLE: no ANTES a chave igual não pára em advisory lock nenhum.
    await noEstado(ADM, "antes");
    {
      const A = await sessao(null);
      const B = await sessao();
      try {
        const prod = await novoProduto(ADM, {});
        const chave = crypto.randomUUID();
        await A.query("BEGIN");
        await travaDe(A, chave);
        const eB = observar(comprar(B, { prod, chave }));
        assert.ok(await terminaAte(eB, 5000), "CONTROLE: B devia terminar");
        assert.ok((await eB.p).ok);
      } finally {
        await fechar(A, B);
      }
    }
    await noEstado(ADM, "depois");
    const A = await sessao(null);
    const B = await sessao();
    const Cc = await sessao();
    const D = await sessao("anon");
    try {
      const [pb, pc, pd] = [
        await novoProduto(ADM, {}),
        await novoProduto(ADM, {}),
        await novoProduto(ADM, {}),
      ];
      const chave = crypto.randomUUID();
      await A.query("BEGIN");
      await travaDe(A, chave); // uma compra desta chave "em andamento"
      const eB = observar(comprar(B, { prod: pb, chave }));
      assert.ok(await emEspera(B.pid, "advisory"), "mesma chave devia esperar");
      const eC = observar(
        comprar(Cc, { prod: pc, chave: crypto.randomUUID() }),
      );
      assert.ok(
        await terminaAte(eC, 5000),
        "chave diferente não devia esperar",
      );
      assert.ok((await eC.p).ok, JSON.stringify(await eC.p));
      const eD = observar(
        comprar(D, { prod: pd, chave: null, dados: DIGITADO }),
      );
      assert.ok(await terminaAte(eD, 5000), "chave nula não devia esperar");
      assert.ok((await eD.p).ok, JSON.stringify(await eD.p));
      assert.equal(eB.fim, false, "B ainda devia estar esperando");
      await A.query("ROLLBACK");
      assert.ok((await eB.p).ok, "liberada a trava, B cria o pedido");
    } finally {
      await fechar(A, B, Cc, D);
    }
  },
);

// ---------------------------------------------------------------------------
// D2: o preço-base não muda no meio da gravação
// ---------------------------------------------------------------------------

/**
 * A compra com variação SEM price_override é segurada no meio (depois da leitura do passo 3, antes da releitura do passo 8)
 * por um gatilho de prova no INSERT do cabeçalho, que espera o advisory lock GANCHO; o "painel" salva um preço novo nesse
 * intervalo. Devolve o preço do cabeçalho, o do item, se o painel esperou e o preço final do produto.
 */
async function precoSalvoNoMeio({ rpc }) {
  const G = await sessao(null);
  const A = await sessao();
  const P = await sessao(null);
  await ADM.query(
    `CREATE OR REPLACE FUNCTION public.zz_prova_1350_espera() RETURNS trigger LANGUAGE plpgsql AS
     $$ BEGIN PERFORM pg_advisory_xact_lock(${GANCHO}); RETURN NEW; END $$`,
  );
  await ADM.query(
    "CREATE TRIGGER zz_prova_1350 BEFORE INSERT ON public.marketplace_orders FOR EACH ROW EXECUTE FUNCTION public.zz_prova_1350_espera()",
  );
  try {
    const prod = await novoProduto(ADM, { variacao: true, preco: 100 });
    const chave = crypto.randomUUID();
    await G.query("SELECT pg_advisory_lock($1)", [GANCHO]);
    const eA = observar(comprar(A, { rpc, prod, chave, total: 100 }));
    assert.ok(
      await emEspera(A.pid, "advisory"),
      "a compra devia parar no gancho (depois da leitura do passo 3)",
    );
    const eP = observar(
      P.query(
        "UPDATE public.produtos SET preco_venda = 150 WHERE id = $1 RETURNING id",
        [prod.id],
      ),
      (r) => r.rowCount,
    );
    const painelTerminou = await terminaAte(eP, 1500);
    if (!painelTerminou)
      assert.ok(
        await emEspera(P.pid, "linha"),
        "o painel devia estar esperando uma trava de linha",
      );
    await G.query("SELECT pg_advisory_unlock($1)", [GANCHO]);
    const rA = await eA.p;
    assert.ok(rA.ok, `a compra devia concluir: ${JSON.stringify(rA)}`);
    assert.equal((await eP.p).ok, 1, "o painel salvou o preço");
    const lido = (
      await ADM.query(
        `SELECT o.total::numeric AS cabecalho,
                (SELECT sum(i.price * i.quantity)::numeric FROM public.marketplace_order_items i WHERE i.order_id = o.id) AS itens,
                (SELECT preco_venda::numeric FROM public.produtos WHERE id = $2) AS preco_final
           FROM public.marketplace_orders o WHERE o.id = $1`,
        [rA.ok, prod.id],
      )
    ).rows[0];
    return {
      cabecalho: Number(lido.cabecalho),
      itens: Number(lido.itens),
      precoFinal: Number(lido.preco_final),
      painelEsperou: !painelTerminou,
    };
  } finally {
    await G.query("SELECT pg_advisory_unlock_all()").catch(() => {});
    await fechar(G, A, P);
    await ADM.query(
      "DROP TRIGGER IF EXISTS zz_prova_1350 ON public.marketplace_orders",
    ).catch(() => {});
    await ADM.query(
      "DROP FUNCTION IF EXISTS public.zz_prova_1350_espera()",
    ).catch(() => {});
  }
}

for (const rpc of [V24, V23]) {
  prova(
    `D2 (${rpc}): preço-base salvo no meio da gravação — o painel ESPERA o pedido terminar e cabeçalho e item gravam o MESMO preço; CONTROLE: com o corpo da 244 o item sai com o preço novo e o cabeçalho com o antigo`,
    async () => {
      await noEstado(ADM, "antes");
      try {
        const antes = await precoSalvoNoMeio({ rpc });
        assert.equal(
          antes.painelEsperou,
          false,
          "CONTROLE: o painel não esperava",
        );
        assert.equal(
          antes.cabecalho,
          100,
          "CONTROLE: cabeçalho com o preço velho",
        );
        assert.equal(
          antes.itens,
          150,
          "CONTROLE: item com o preço novo (o defeito)",
        );
      } finally {
        await noEstado(ADM, "depois");
      }
      const depois = await precoSalvoNoMeio({ rpc });
      assert.equal(
        depois.painelEsperou,
        true,
        "o painel devia esperar o pedido",
      );
      assert.equal(depois.cabecalho, 100, "cabeçalho com o preço lido");
      assert.equal(
        depois.itens,
        depois.cabecalho,
        "o item grava o MESMO preço do cabeçalho",
      );
      assert.equal(
        depois.precoFinal,
        150,
        "o preço novo vale para a compra seguinte",
      );
    },
  );
}

prova(
  "D2: a trava nova não prende o que não é da compra — outro produto salva o preço enquanto a compra segura, sem esperar; e o produto sem variação segue travando como antes",
  async () => {
    await noEstado(ADM, "depois");
    const A = await sessao();
    const P = await sessao(null);
    try {
      const comVar = await novoProduto(ADM, { variacao: true });
      const outro = await novoProduto(ADM, {});
      const simples = await novoProduto(ADM, { estoque: 10 });
      await A.query("BEGIN");
      await comprar(A, { prod: comVar, chave: crypto.randomUUID() });
      const eOutro = observar(
        P.query(
          "UPDATE public.produtos SET preco_venda = 123 WHERE id = $1 RETURNING id",
          [outro.id],
        ),
        (r) => r.rowCount,
      );
      assert.ok(
        await terminaAte(eOutro, 5000),
        "outro produto não devia esperar",
      );
      assert.equal((await eOutro.p).ok, 1);
      await A.query("COMMIT");
      // produto SEM variação: a trava de linha de sempre (o painel espera a compra)
      await A.query("BEGIN");
      await comprar(A, { prod: simples, chave: crypto.randomUUID() });
      const eSimples = observar(
        P.query(
          "UPDATE public.produtos SET preco_venda = 111 WHERE id = $1 RETURNING id",
          [simples.id],
        ),
        (r) => r.rowCount,
      );
      assert.ok(
        await emEspera(P.pid, "linha"),
        "o produto simples devia travar",
      );
      await A.query("COMMIT");
      assert.equal((await eSimples.p).ok, 1);
    } finally {
      await fechar(A, P);
    }
  },
);

// ---------------------------------------------------------------------------
// D4: a ordem global das travas — compras simultâneas não se derrubam por deadlock
// ---------------------------------------------------------------------------

/** A = camiseta M + caneca; B = caneca + camiseta G (carrinho MISTO: um item com variação e um sem). */
async function cenarioMisto() {
  const camiseta = await novoProduto(ADM, { variacao: true });
  const g = await novaVariacao(ADM, camiseta, "G");
  const caneca = await novoProduto(ADM, {});
  return {
    itensA: [{ prod: camiseta, varId: camiseta.varId }, { prod: caneca }],
    itensB: [{ prod: caneca }, { prod: camiseta, varId: g }],
    // A coreografia: A espera o produto da camiseta e B espera a caneca; solta-se a caneca primeiro.
    primeira: [["produtos", caneca.id]],
    segunda: [["produtos", camiseta.id]],
    // Com a caneca solta, B (que passa a segurar a caneca e a variação G) entra na FILA do produto da camiseta.
    entraNaFila: "B",
    caneca,
    camiseta,
  };
}
/** A = variação M + G; B = G + M (as duas variações da mesma camiseta em ordem oposta). */
async function cenarioVariacoes() {
  const camiseta = await novoProduto(ADM, { variacao: true });
  const m = camiseta.varId;
  const g = await novaVariacao(ADM, camiseta, "G");
  return {
    itensA: [
      { prod: camiseta, varId: m },
      { prod: camiseta, varId: g },
    ],
    itensB: [
      { prod: camiseta, varId: g },
      { prod: camiseta, varId: m },
    ],
    // A espera a variação M e B espera a G; solta-se a M primeiro: A passa a segurar M e entra na FILA da G.
    primeira: [["product_variants", m]],
    segunda: [["product_variants", g]],
    entraNaFila: "A",
    camiseta,
    m,
    g,
  };
}
const eDeadlock = (r) => Boolean(r.erro) && /deadlock detected/.test(r.erro);

/**
 * Duas compras SIMULTÂNEAS de carrinhos que pedem as mesmas linhas em ordem cruzada. Duas sessões seguram as linhas
 * (primeira e segunda); A e B entram e param nelas (cada espera é MEDIDA em pg_stat_activity); solta-se a primeira, e
 * então a segunda. No corpo sem a ordem global isso leva cada compra a segurar o que a outra espera (deadlock, e o banco
 * derruba uma delas com 40P01 depois do deadlock_timeout); com a ordem global as duas concluem. `controle` pede a espera
 * medida pela FILA (só existe no cruzamento); sem ele, só se dá um instante entre as duas solturas.
 */
async function coreografia({ rpc, cenario, controle }) {
  const A = await sessao();
  const B = await sessao();
  let g1;
  let g2;
  try {
    const cen = await cenario();
    const chaves = [crypto.randomUUID(), crypto.randomUUID()];
    g1 = await segurar(cen.primeira);
    g2 = await segurar(cen.segunda);
    const eA = observar(
      comprarCarrinho(A, { rpc, itens: cen.itensA, chave: chaves[0] }),
    );
    assert.ok(await emEspera(A.pid, "linha"), "A devia parar numa trava");
    const eB = observar(
      comprarCarrinho(B, { rpc, itens: cen.itensB, chave: chaves[1] }),
    );
    assert.ok(await emEspera(B.pid, "linha"), "B devia parar numa trava");
    await g1.query("COMMIT");
    if (controle)
      assert.ok(
        await emEspera((cen.entraNaFila === "A" ? A : B).pid, "fila"),
        `${cen.entraNaFila} devia entrar na fila da linha que a outra compra espera`,
      );
    else await dormir(200);
    await g2.query("COMMIT");
    const [rA, rB] = await Promise.all([eA.p, eB.p]);
    const pedidos = (
      await ADM.query(
        "SELECT count(*)::int AS n FROM public.marketplace_orders WHERE idempotency_key = ANY($1::uuid[])",
        [chaves],
      )
    ).rows[0].n;
    return { rA, rB, pedidos };
  } finally {
    await fechar(g1, g2, A, B);
  }
}

for (const [rotuloCenario, cenario, controleSemOrdem] of [
  [
    "carrinho MISTO (A = camiseta M + caneca, B = caneca + camiseta G)",
    cenarioMisto,
    true,
  ],
  [
    "duas VARIAÇÕES em ordem oposta (A = M + G, B = G + M)",
    cenarioVariacoes,
    false,
  ],
]) {
  for (const rpc of [V24, V23]) {
    prova(
      `D4 (${rpc}): ${rotuloCenario} ao mesmo tempo — as duas compras CONCLUEM sem deadlock; CONTROLE: ${controleSemOrdem ? "o corpo sem a ordem global (o desta migration antes de D4)" : "o corpo da 244"} derruba uma delas com 40P01`,
      async () => {
        try {
          if (controleSemOrdem) await instalarControleSemOrdem(ADM);
          else await noEstado(ADM, "antes");
          const antes = await coreografia({ rpc, cenario, controle: true });
          assert.equal(
            [antes.rA, antes.rB].filter(eDeadlock).length,
            1,
            `CONTROLE: exatamente uma compra devia cair em deadlock: ${JSON.stringify([antes.rA, antes.rB])}`,
          );
          assert.equal(
            [antes.rA, antes.rB].filter((r) => r.ok).length,
            1,
            "CONTROLE: a outra compra conclui",
          );
          assert.equal(antes.pedidos, 1, "CONTROLE: um pedido só nasceu");
        } finally {
          await noEstado(ADM, "depois");
        }
        const depois = await coreografia({ rpc, cenario, controle: false });
        assert.ok(
          depois.rA.ok && depois.rB.ok,
          `as duas compras deviam concluir: ${JSON.stringify([depois.rA, depois.rB])}`,
        );
        assert.notEqual(depois.rA.ok, depois.rB.ok, "dois pedidos distintos");
        assert.equal(depois.pedidos, 2, "cada compra gravou o seu pedido");
      },
    );
  }
}

prova(
  "D4: a compra tranca a VARIAÇÃO antes do PRODUTO — o painel que salva uma variação (a trigger atualiza a variação e só então tranca o produto) entra na fila e as duas terminam, sem deadlock",
  async () => {
    await noEstado(ADM, "depois");
    const trigger = await ADM.query(
      "SELECT 1 FROM pg_trigger WHERE tgname = 'sync_produto_ultima_atualizacao' AND NOT tgisinternal",
    );
    assert.equal(
      trigger.rowCount,
      1,
      "a trigger que tranca o produto depois da variação devia existir",
    );
    const cen = await cenarioVariacoes();
    const gate = await segurar([["product_variants", cen.m]]);
    const X = await sessao(null); // o painel
    const A = await sessao();
    try {
      // 1) o painel entra primeiro na fila da variação M (segurada pela sessão de prova)
      const eX = observar(
        X.query(
          "UPDATE public.product_variants SET stock_increment = stock_increment + 1 WHERE id = $1 RETURNING id",
          [cen.m],
        ),
        (r) => r.rowCount,
      );
      assert.ok(await emEspera(X.pid, "linha"), "o painel devia esperar a M");
      // 2) a compra da mesma variação chega depois: entra atrás do painel
      const eA = observar(
        comprarCarrinho(A, {
          itens: [{ prod: cen.camiseta, varId: cen.m }],
          chave: crypto.randomUUID(),
        }),
      );
      assert.ok(
        await emEspera(A.pid, "fila"),
        "a compra devia entrar na fila atrás do painel",
      );
      // 3) solta: o painel pega a M, a trigger pede o PRODUTO; a compra, que ainda não segura o produto, espera a M
      await gate.query("COMMIT");
      const [rX, rA] = await Promise.all([eX.p, eA.p]);
      assert.equal(rX.ok, 1, `o painel devia concluir: ${JSON.stringify(rX)}`);
      assert.ok(rA.ok, `a compra devia concluir: ${JSON.stringify(rA)}`);
    } finally {
      await fechar(gate, X, A);
    }
  },
);

for (const rpc of [V24, V23]) {
  for (const [rotulo, cenario] of [
    ["carrinho misto", cenarioMisto],
    ["variações em ordem oposta", cenarioVariacoes],
  ]) {
    prova(
      `D4 (${rpc}): ${rotulo} em CORRIDA LIVRE, 20 rodadas com produtos novos — nenhuma compra cai em deadlock`,
      async () => {
        await noEstado(ADM, "depois");
        const A = await sessao();
        const B = await sessao();
        try {
          for (let i = 0; i < 20; i++) {
            const cen = await cenario();
            const eA = observar(
              comprarCarrinho(A, {
                rpc,
                itens: cen.itensA,
                chave: crypto.randomUUID(),
              }),
            );
            const eB = observar(
              comprarCarrinho(B, {
                rpc,
                itens: cen.itensB,
                chave: crypto.randomUUID(),
              }),
            );
            const [rA, rB] = await Promise.all([eA.p, eB.p]);
            assert.ok(
              rA.ok && rB.ok,
              `rodada ${i}: ${JSON.stringify([rA, rB])}`,
            );
          }
        } finally {
          await fechar(A, B);
        }
      },
    );
  }
}

prova(
  "D4: o bloco da ordem global não muda a recusa — payload malformado, produto ou variação inexistente, variação de outro produto, quantidade inválida, variação faltando e carrinho vazio dão o MESMO resultado que o corpo da 244 (v23 e v24)",
  async () => {
    const camiseta = await novoProduto(ADM, { variacao: true });
    const caneca = await novoProduto(ADM, {});
    const fantasma = crypto.randomUUID();
    const bom = { product_id: caneca.id, variant_id: null, quantity: 1 };
    const casos = [
      ["product_id malformado", [{ ...bom, product_id: "isto-nao-e-uuid" }]],
      ["variant_id malformado", [{ ...bom, variant_id: "nao-uuid" }]],
      ["product_id ausente", [{ variant_id: null, quantity: 1 }]],
      ["produto inexistente", [{ ...bom, product_id: fantasma }]],
      ["variação de outro produto", [{ ...bom, variant_id: camiseta.varId }]],
      [
        "variação inexistente",
        [{ product_id: camiseta.id, variant_id: fantasma, quantity: 1 }],
      ],
      ["quantidade zero", [{ ...bom, quantity: 0 }]],
      [
        "produto com variação sem escolher a variação",
        [{ product_id: camiseta.id, variant_id: null, quantity: 1 }],
      ],
      [
        "malformado DEPOIS de um item válido",
        [bom, { ...bom, product_id: "x" }],
      ],
      [
        "quantidade zero ANTES de um id malformado",
        [
          { ...bom, quantity: 0 },
          { ...bom, product_id: "x" },
        ],
      ],
      ["carrinho vazio", []],
      ["item repetido (mesmo produto duas vezes)", [bom, bom]],
    ];
    const A = await sessao();
    const resultado = async (rpc, itens) => {
      const r = await observar(
        A.query(SQL_PEDIDO(rpc), [
          JSON.stringify(itens),
          100 * itens.length,
          0,
          rpc === V24 ? "online" : "cash",
          null,
          null,
          CEP_LOCAL,
          "local-delivery",
          crypto.randomUUID(),
        ]),
      ).p;
      return r.ok ? "ok" : r.erro;
    };
    try {
      for (const rpc of [V23, V24]) {
        await noEstado(ADM, "antes");
        const da244 = [];
        for (const [, itens] of casos) da244.push(await resultado(rpc, itens));
        await noEstado(ADM, "depois");
        for (const [i, [rotulo, itens]] of casos.entries())
          assert.equal(
            await resultado(rpc, itens),
            da244[i],
            `${rpc}: ${rotulo}: o resultado devia ser o da 244`,
          );
        // o controle de que os casos recusam de verdade: ao menos os malformados e os inexistentes
        assert.match(da244[0], /uuid/, "product_id malformado recusado");
        assert.match(
          da244[3],
          /não disponível/,
          "produto inexistente recusado",
        );
      }
    } finally {
      await fechar(A);
      await noEstado(ADM, "depois");
    }
  },
);

// ---------------------------------------------------------------------------
// DADOS EXISTENTES e PERMISSÃO
// ---------------------------------------------------------------------------

prova(
  "DADOS: o pedido que JÁ existia antes da migration não muda (md5 das tabelas) e o reenvio da chave dele depois devolve o mesmo pedido, sem esperar",
  async () => {
    await noEstado(ADM, "antes");
    const A = await sessao();
    try {
      const prod = await novoProduto(ADM, { estoque: 3 });
      const chave = crypto.randomUUID();
      const id = (await comprar(A, { prod, chave })).rows[0].id;
      const retrato = async () =>
        (
          await ADM.query(
            `SELECT (SELECT md5(coalesce(string_agg(o::text, ',' ORDER BY o.id), '')) FROM public.marketplace_orders o) AS pedidos,
                    (SELECT md5(coalesce(string_agg(i::text, ',' ORDER BY i.id), '')) FROM public.marketplace_order_items i) AS itens,
                    (SELECT md5(coalesce(string_agg(p::text, ',' ORDER BY p.id), '')) FROM public.produtos p) AS produtos`,
          )
        ).rows[0];
      const antes = await retrato();
      await noEstado(ADM, "depois");
      assert.deepEqual(
        await retrato(),
        antes,
        "a migration não pode tocar dado",
      );
      const de = await sessao();
      try {
        const e = observar(comprar(de, { prod, chave }));
        assert.ok(await terminaAte(e, 5000), "o reenvio não devia esperar");
        assert.deepEqual(await e.p, { ok: id });
      } finally {
        await fechar(de);
      }
      assert.deepEqual(await retrato(), antes, "o reenvio não criou nada");
    } finally {
      await fechar(A);
    }
  },
);

prova(
  "PERMISSÃO: atributos e ACL iguais antes e depois da migration (PUBLIC não; anon, authenticated, service_role sim); a migration e o rollback não mexem em permissão",
  async () => {
    const retrato = async () => {
      const r = {};
      for (const fn of [V23, V24]) {
        r[fn] = {
          acl: await acl(C, fn),
          atributos: await atributos(C, fn),
          sobrecargas: (
            await C.query(
              "SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = $1",
              [fn],
            )
          ).rows[0].n,
        };
      }
      return r;
    };
    const depois = await emTransacao(retrato);
    const antes = await emTransacao(retrato, { estado: "antes" });
    assert.deepEqual(depois, antes);
    for (const fn of [V23, V24]) {
      assert.deepEqual(depois[fn].acl, ACL_DAS_COMPRAS, `${fn}: ACL`);
      assert.equal(depois[fn].atributos.prosecdef, true);
      assert.equal(depois[fn].atributos.provolatile, "v");
      assert.deepEqual(depois[fn].atributos.proconfig, ["search_path=public"]);
      assert.equal(depois[fn].atributos.retorno, "uuid");
      assert.equal(depois[fn].sobrecargas, 1);
    }
    // anon (convidado) compra pelas duas funções com o corpo novo
    const D = await sessao("anon");
    try {
      for (const rpc of [V23, V24]) {
        const prod = await novoProduto(ADM, {});
        const r = await observar(
          comprar(D, {
            rpc,
            prod,
            chave: crypto.randomUUID(),
            dados: DIGITADO,
          }),
        ).p;
        assert.ok(
          r.ok,
          `${rpc}: o convidado devia comprar: ${JSON.stringify(r)}`,
        );
      }
    } finally {
      await fechar(D);
    }
  },
);

// ---------------------------------------------------------------------------
// MIGRATION: reaplicar, CRLF, rollback, pré-voo, pós-voo, troca com sessão aberta
// ---------------------------------------------------------------------------

prova(
  "MIGRATION: reaplicar (2x) e em CRLF dá o mesmo estado; o rollback repetido é recusado sem escrever; migration depois do rollback volta ao mesmo corpo",
  async () => {
    const estaEm = async (chave, rotulo) => {
      for (const fn of [V23, V24])
        assert.equal(await hashVivo(C, fn), H[fn][chave], `${rotulo}: ${fn}`);
    };
    await emTransacao(async () => {
      assert.equal(await aplicar(C, MIGRATION), null);
      assert.equal(await aplicar(C, MIGRATION), null);
      assert.equal(await aplicar(C, emCRLF(MIGRATION)), null);
      await estaEm("depois", "migration 3x");
      assert.equal(await aplicar(C, emCRLF(ROLLBACK)), null);
      await estaEm("antes", "rollback em CRLF");
      const duas = await aplicar(C, ROLLBACK);
      assert.match(duas?.erro ?? "", /B1_BASELINE_DIVERGENT/);
      await estaEm("antes", "rollback repetido recusado");
      assert.equal(await aplicar(C, MIGRATION), null);
      await estaEm("depois", "migration depois do rollback");
    });
  },
);

const SABOTAGENS = [
  [
    "corpo desconhecido na v23",
    () => decl(ANTIGA[V23], `${ANTIGA[V23].corpo}\n-- sabotagem\n`),
  ],
  [
    "corpo desconhecido na v24",
    () => decl(ANTIGA[V24], `${ANTIGA[V24].corpo}\n-- sabotagem\n`),
  ],
  ["corpo anterior à 244 na v23 (o da 229)", () => decl(DE_229_V23)],
  ["corpo anterior à 244 na v24 (o da 236)", () => decl(DE_236_V24)],
  ["v24 SECURITY INVOKER", () => `ALTER FUNCTION ${FN[V24]} SECURITY INVOKER`],
  [
    "v23 com search_path trocado",
    () => `ALTER FUNCTION ${FN[V23]} SET search_path = public, pg_temp`,
  ],
  ["v23 STABLE", () => `ALTER FUNCTION ${FN[V23]} STABLE`],
  [
    "v24 com EXECUTE para PUBLIC",
    () => `GRANT EXECUTE ON FUNCTION ${FN[V24]} TO PUBLIC`,
  ],
  [
    "v23 sem EXECUTE para anon",
    () => `REVOKE EXECUTE ON FUNCTION ${FN[V23]} FROM anon`,
  ],
  [
    "v24 sem EXECUTE para service_role",
    () => `REVOKE EXECUTE ON FUNCTION ${FN[V24]} FROM service_role`,
  ],
  [
    "sobrecarga de v23",
    () =>
      "CREATE FUNCTION public.create_marketplace_order_v23(p_x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
  ],
  ["v24 ausente", () => `DROP FUNCTION ${FN[V24]}`],
];
prova(
  `MIGRATION: o pré-voo RECUSA sem escrever nada em ${SABOTAGENS.length} sabotagens do estado (a v23 e a v24 ficam como estavam)`,
  async () => {
    for (const [rotulo, sabotar] of SABOTAGENS) {
      await emTransacao(
        async () => {
          await C.query(sabotar());
          const fotos = async () => ({
            h23: await hashVivo(C, V23),
            h24: await hashVivo(C, V24),
          });
          const antes = await fotos();
          const r = await aplicar(C, MIGRATION);
          assert.match(
            r?.erro ?? "",
            /B1_BASELINE_DIVERGENT/,
            `${rotulo}: devia recusar com B1_BASELINE_DIVERGENT, deu ${JSON.stringify(r)}`,
          );
          assert.deepEqual(await fotos(), antes, `${rotulo}: escreveu`);
        },
        { estado: "antes" },
      );
    }
  },
);

prova(
  "MIGRATION: o pós-voo reprovando DESFAZ TUDO (as duas funções voltam aos corpos da 244, mesmo com a v23 já trocada dentro do arquivo)",
  async () => {
    await noEstado(ADM, "antes");
    try {
      const fim = "END;\n$function$;";
      const i = MIGRATION.lastIndexOf(fim);
      assert.ok(i > 0);
      // muda 1 byte do corpo da v24: o pré-voo passa, a v23 e a v24 são trocadas e o pós-voo reprova
      const torta = `${MIGRATION.slice(0, i)}END; \n$function$;${MIGRATION.slice(i + fim.length)}`;
      let erro = null;
      try {
        await ADM.query(torta);
      } catch (e) {
        erro = e.message;
      }
      assert.match(erro ?? "", /POSVOO_20261350000000/);
      assert.equal(await estadoDe(ADM), "antes", "o pós-voo não desfez tudo");
      for (const fn of [V23, V24])
        assert.equal(
          sha256(await prosrcVivo(ADM, fn)),
          sha256(ANTIGA[fn].corpo),
          fn,
        );
    } finally {
      await noEstado(ADM, "depois");
    }
  },
);

prova(
  "MIGRATION: trocar o corpo com uma sessão no meio de uma compra não trava nem erra (CREATE OR REPLACE não espera a compra); a sessão termina com o corpo antigo e a próxima já usa o novo",
  async () => {
    await noEstado(ADM, "antes");
    const A = await sessao();
    try {
      const prod = await novoProduto(ADM, {});
      const prod2 = await novoProduto(ADM, {});
      await A.query("BEGIN");
      const idA = (await comprar(A, { prod, chave: crypto.randomUUID() }))
        .rows[0].id;
      await ADM.query("SET statement_timeout = 8000");
      await ADM.query(MIGRATION); // troca ENQUANTO a compra de A está aberta: não pode esperar
      await ADM.query("RESET statement_timeout");
      assert.equal(await estadoDe(ADM), "depois");
      await A.query("COMMIT");
      assert.ok(idA);
      const r = await observar(
        comprar(A, { prod: prod2, chave: crypto.randomUUID() }),
      ).p;
      assert.ok(r.ok, JSON.stringify(r));
    } finally {
      await ADM.query("RESET statement_timeout").catch(() => {});
      await fechar(A);
      await noEstado(ADM, "depois");
    }
  },
);

// ---------------------------------------------------------------------------
// CONSULTAS 81a / 81b (e as que aceitam o corpo novo como sucessor)
// ---------------------------------------------------------------------------

const rodarConsulta = async (sql) => (await C.query(sql)).rows;
const mapa = (linhas) => Object.fromEntries(linhas.map((l) => [l.item, l.ok]));

prova(
  "CONSULTAS: 81a/81b têm rol fechado de 7 linhas (os rótulos do conferir-banco), positivas no estado certo; a 81a reprova no ANTES e a 81b no DEPOIS, nos itens certos; 31a, 37a e 47a seguem positivas nos dois estados",
  async () => {
    const itensDe = (linhas) => linhas.map((l) => l.item);
    const rodarTodas = async () => {
      const r = {
        a: await rodarConsulta(A81),
        b: await rodarConsulta(B81),
        aceitam: [],
      };
      for (const { n, sql } of CONSULTAS_QUE_ACEITAM)
        r.aceitam.push({ n, linhas: await rodarConsulta(sql) });
      return r;
    };
    const depois = await emTransacao(rodarTodas);
    const antes = await emTransacao(rodarTodas, { estado: "antes" });
    for (const c of [depois.a, depois.b, antes.a, antes.b]) {
      assert.equal(c.length, 7, "rol fechado de 7 linhas");
      assert.equal(new Set(itensDe(c)).size, 7);
    }
    for (const l of [...depois.a, ...depois.b])
      assert.ok(
        CONFERIR_BANCO.includes(`"${l.item}"`),
        `rótulo fora do rol do conferir-banco: ${l.item}`,
      );
    const CONTROLE = "controle: funcoes de public visiveis a este papel";
    const FIXOS = [
      CONTROLE,
      "as duas compras: uma assinatura so cada e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)",
      "as duas compras: EXECUTE como sempre (PUBLIC nao; anon, authenticated e service_role sim)",
    ];
    // DEPOIS: a 81a toda verdadeira; a 81b reprova justamente nos itens que dizem "ainda sem".
    assert.ok(
      depois.a.every((l) => l.ok),
      JSON.stringify(depois.a.filter((l) => !l.ok)),
    );
    const bDepois = mapa(depois.b);
    for (const [item, ok] of Object.entries(bDepois))
      assert.equal(ok, FIXOS.includes(item), `81b DEPOIS: ${item}`);
    // ANTES: o contrário
    assert.ok(
      antes.b.every((l) => l.ok),
      JSON.stringify(antes.b.filter((l) => !l.ok)),
    );
    const aAntes = mapa(antes.a);
    for (const [item, ok] of Object.entries(aAntes))
      assert.equal(ok, FIXOS.includes(item), `81a ANTES: ${item}`);
    for (const estado of [depois, antes])
      for (const { n, linhas } of estado.aceitam)
        assert.ok(
          linhas.every((l) => l.ok),
          `${n}: ${JSON.stringify(linhas.filter((l) => !l.ok))}`,
        );
  },
);

prova(
  "CONSULTAS: cada desvio da 81a cai no item certo (ACL aberta, atributo trocado, corpo alterado)",
  async () => {
    const casos = [
      [
        `GRANT EXECUTE ON FUNCTION ${FN[V23]} TO PUBLIC`,
        "as duas compras: EXECUTE como sempre (PUBLIC nao; anon, authenticated e service_role sim)",
      ],
      [
        `ALTER FUNCTION ${FN[V24]} SECURITY INVOKER`,
        "as duas compras: uma assinatura so cada e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)",
      ],
      [
        decl(NOVA[V24], `${NOVA[V24].corpo}\n-- sabotagem\n`),
        "create_marketplace_order_v24: corpo e o da 20261350000000, com a ordem global das travas, a trava do produto e a espera da mesma chave (md5)",
      ],
    ];
    for (const [sabotar, itemQueCai] of casos) {
      await emTransacao(async () => {
        await C.query(sabotar);
        const caiu = (await rodarConsulta(A81))
          .filter((l) => !l.ok)
          .map((l) => l.item);
        assert.deepEqual(caiu, [itemQueCai], sabotar.slice(0, 60));
      });
    }
  },
);

// ---------------------------------------------------------------------------

async function main() {
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  ADM = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  await ADM.connect();
  await semearBase(ADM);
  await noEstado(ADM, "depois");
  let ok = 0;
  const falhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
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
        await noEstado(ADM, "depois").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
    await ADM.end().catch(() => {});
  }
  console.log(`\n${ok}/${PROVAS.length} provas passaram.`);
  if (falhas.length) falhar("FALHOU", `${falhas.length} prova(s) reprovadas.`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
