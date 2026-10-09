"use strict";

/**
 * PROVA VIVA da migration 20261208000000_o_checkout_mostra_os_cupons_da_cliente
 * (dinheiro + dado de cliente) contra o Postgres EFÊMERO com as migrations
 * aplicadas do zero.
 *
 * O contrato é o pedido do dono: o checkout mostra os cupons liberados,
 * "inclusive os exclusivos" — e NENHUM cupom exclusivo ou secreto vaza para
 * outra pessoa. Cada lado é provado pelos caminhos que existem:
 *   - a LISTA (`cupons_do_checkout`), como anon, como a dona do exclusivo e
 *     como outra cliente;
 *   - a VALIDAÇÃO antecipada (`validate_coupon_secure_v2`) e a GARANTIA final
 *     (gatilho no INSERT do pedido, pela v24 e pela v23): o exclusivo de outra
 *     conta responde "não existe", mesmo vencido, esgotado ou com mínimo;
 *   - o gatilho TEM o atalho de retentativa da 20261203: a lojista que tira a
 *     cliente da lista no meio de uma compra repetida não faz nascer pedido em
 *     DOBRO — provado com 2 conexões reais e COMMIT de verdade;
 *   - o PAINEL: só o admin ATUAL (nunca o JWT velho) lê e grava a lista;
 *   - os GRANTS/RLS com `SET ROLE anon|authenticated` (a prova roda como
 *     superusuário, que passaria por cima de tudo);
 *   - a IDA E VOLTA: aplicar, reaplicar, rollback (devolve o corpo da 20261203
 *     byte a byte), reaplicar de novo — com dado que já existia antes da
 *     migration, envelope REPEATABLE READ com escritor concorrente, atomicidade
 *     e trava com pedido em andamento;
 *   - MUTANTES por guarda: cada guarda tirada deixa uma prova VERMELHA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cupons-do-checkout-viva.cjs
 * (depois de provisionar.cjs e aplicar-migrations.cjs, como no rpc-ci.yml)
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos arquivos lidos são as migrations deste repositório, por nome
 * fixo (constantes abaixo), nunca entrada de rede nem de terceiro. */

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const NOME = "20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql";
const NOME_203 = "20261203000000_cupons_desligados_nao_dao_desconto.sql";
// LF sempre: o corpo gravado no banco tem de ser o mesmo em checkout Linux e Windows.
const lerLF = (nome) =>
  fs.readFileSync(path.join(PASTA, nome), "utf8").replace(/\r\n/g, "\n");
const SQL_MIGRATION = lerLF(NOME);
const SQL_ROLLBACK = lerLF(`rollback-manual-${NOME}`);
const SQL_203 = lerLF(NOME_203);

const sha256 = (s) =>
  crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

function corpoDeValidate(texto) {
  const ini = texto.indexOf(
    "CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(",
  );
  const apos = texto.indexOf("AS $$", ini) + "AS $$".length;
  return texto.slice(apos, texto.indexOf("$$;", apos));
}
const CORPO_203 = corpoDeValidate(SQL_203);
/** O corpo que o baseline 20260806000000 deixou (a loja que ainda NÃO tem a 203). */
function corpoDoBaseline() {
  const base = lerLF("20260806000000_baseline_do_schema_vivo.sql");
  const ini = base.indexOf("CREATE FUNCTION public.validate_coupon_secure_v2(");
  const apos = base.indexOf("AS $$", ini) + "AS $$".length;
  return base.slice(apos, base.indexOf("$$;", apos));
}
const CORPO_208 = corpoDeValidate(SQL_MIGRATION);
const H203 = "489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3";
assert.equal(sha256(CORPO_203), H203, "a 20261203 mudou: o hash travado caiu");

const OID_VALIDATE = "public.validate_coupon_secure_v2(text, numeric)";
const OID_LISTA = "public.cupons_do_checkout(numeric)";
const OID_LER = "public.admin_cupom_clientes(uuid)";
const OID_DEFINIR = "public.admin_cupom_definir_clientes(uuid, uuid[])";
const OID_GATILHO = "public.pedido_com_cupom_so_nasce_para_a_lista()";
const GATILHO = "tr_pedido_com_cupom_so_nasce_para_a_lista";
const GATILHO_CHAVE = "tr_pedido_com_cupom_exige_a_chave_ligada";
const POLITICA = "cupom_clientes_admin_select_policy";

const MENSAGEM_CHAVE = "Os cupons estão desativados nesta loja.";
const LIMITE = "Cupom atingiu o limite de uso.";
const INVALIDO = "Cupom inválido ou expirado.";
const naoExiste = (codigo) => `O cupom ${codigo} não existe. Confira o código.`;

// Fixtures FICTÍCIAS (nenhum dado real).
const U_DONA = "c0c80000-0000-4000-8000-000000000001";
const U_OUTRA = "c0c80000-0000-4000-8000-000000000002";
const U_ADMIN = "c0c80000-0000-4000-8000-00000000000a";
// Rebaixados: o JWT velho ainda diz admin (is_admin() antigo deixaria entrar).
const U_REB_PERFIL = "c0c80000-0000-4000-8000-0000000000b1"; // profiles=customer, auth.users=admin
const U_REB_AUTH = "c0c80000-0000-4000-8000-0000000000b2"; // profiles=admin, auth.users=customer
const U_REB_AMBOS = "c0c80000-0000-4000-8000-0000000000b3"; // as duas fontes dizem customer
const CPF_DONA = "12345678909";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
/** Roda uma consulta num savepoint: {ok, r} ou {ok:false, e} sem abortar a transação. */
async function tentar(c, sql, params = []) {
  await c.query("SAVEPOINT tentativa");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT tentativa");
    return { ok: true, r };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa");
    await c.query("RELEASE SAVEPOINT tentativa");
    return { ok: false, e };
  }
}

async function numaTransacao(c, fn) {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

/** Espera que o `caso` FALHE (o mutante tem de ser pego). Dentro de uma transação. */
async function exigirVermelho(c, rotulo, caso) {
  await c.query("SAVEPOINT mutante");
  let vermelho = false;
  try {
    await caso();
  } catch (e) {
    vermelho = true;
    console.log(
      `    mutante "${rotulo}" MORTO: ${String(e.message).split("\n")[0].slice(0, 120)}`,
    );
  }
  await c.query("ROLLBACK TO SAVEPOINT mutante");
  await c.query("RELEASE SAVEPOINT mutante");
  assert.ok(vermelho, `mutante "${rotulo}" SOBREVIVEU — a prova não o pegou`);
}

/** Troca o papel do Postgres (o SET ROLE do PostgREST) num savepoint que sempre volta. */
async function comoPapel(c, papel, uid, fn, { jwt = "" } = {}) {
  await c.query("SAVEPOINT papel");
  try {
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [uid ?? "", jwt],
    );
    // Explícito: é o padrão do Postgres do Supabase, e a prova não pode
    // depender do default do servidor efêmero.
    await c.query("SET LOCAL row_security = on");
    await c.query(`SET LOCAL ROLE ${papel}`);
    return await fn();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT papel");
    await c.query("RELEASE SAVEPOINT papel");
  }
}

/** Define quem está logado para o que roda como o dono da conexão (superusuário). */
async function logar(c, uid, jwt = "") {
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid ?? "", jwt],
  );
}

async function prosrcDe(c, oid) {
  const r = await c.query(
    "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
    [oid],
  );
  return r.rows[0]?.prosrc ?? null;
}

async function esperarTrava(observador, pidAlvo, rotulo) {
  for (let i = 0; i < 150; i += 1) {
    const w = await observador.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pidAlvo],
    );
    if (w.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`${rotulo}: a conexão devia estar esperando um lock`);
}

// ---------------------------------------------------------------------------
// Cenário: loja, contas, produto e um cupom de cada caso (códigos únicos)
// ---------------------------------------------------------------------------
async function base(c, { chave = true } = {}) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
       ($1, 'dona@cupons208.teste', '{}'::jsonb),
       ($2, 'outra@cupons208.teste', '{}'::jsonb),
       ($3, 'admin@cupons208.teste', '{}'::jsonb),
       ($4, 'rebperfil@cupons208.teste', '{}'::jsonb),
       ($5, 'rebauth@cupons208.teste', '{}'::jsonb),
       ($6, 'rebambos@cupons208.teste', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_DONA, U_OUTRA, U_ADMIN, U_REB_PERFIL, U_REB_AUTH, U_REB_AMBOS],
  );
  // O INSERT em profiles leva o papel a auth.users (gatilho de sincronia).
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role, cpf) VALUES
       ($1, 'Dona do Exclusivo', 'customer', $7),
       ($2, 'Outra Cliente', 'customer', NULL),
       ($3, 'Admin Atual', 'admin', NULL),
       ($4, 'Rebaixado Perfil', 'customer', NULL),
       ($5, 'Rebaixado Auth', 'admin', NULL),
       ($6, 'Rebaixado Ambos', 'customer', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [U_DONA, U_OUTRA, U_ADMIN, U_REB_PERFIL, U_REB_AUTH, U_REB_AMBOS, CPF_DONA],
  );
  // As contradições, direto em auth.users (como o painel do Supabase faz).
  for (const [id, papel] of [
    [U_ADMIN, "admin"],
    [U_REB_PERFIL, "admin"],
    [U_REB_AUTH, "customer"],
    [U_REB_AMBOS, "customer"],
  ]) {
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = jsonb_build_object('role', $2::text) WHERE id = $1`,
      [id, papel],
    );
  }
  await c.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', $1)
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons`,
    [chave],
  );
  const produto = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto Prova Cupons 208', 40, 100, 50, true, false)`,
    [produto],
  );
  return produto;
}

/**
 * Um cupom de cada caso. `isolar`: desativa os outros cupons do banco (a prova
 * mede a LISTA e não pode enxergar sobra de outra prova) — só dentro de transação.
 */
async function cenario(c, { chave = true, isolar = false } = {}) {
  const produto = await base(c, { chave });
  const pre = `C8${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const cod = (n) => `${pre}${n}`;
  if (isolar)
    await c.query(
      "UPDATE public.coupons SET active = false WHERE code NOT LIKE $1",
      [`${pre}%`],
    );
  const linhas = [
    // [sufixo, tipo, valor, minimo, limite, usos, valid_until, ativo, alcance]
    ["V10", "percentage", 10, 0, null, 0, null, true, "vitrine"],
    [
      "V150",
      "fixed",
      30,
      150,
      null,
      0,
      "now() + interval '5 days'",
      true,
      "vitrine",
    ],
    ["SEC", "fixed", 50, 0, null, 0, null, true, "codigo"],
    ["EXC", "fixed", 15, 0, null, 0, null, true, "exclusivo"],
    [
      "EXCVENC",
      "fixed",
      15,
      0,
      null,
      0,
      "now() - interval '1 day'",
      true,
      "exclusivo",
    ],
    ["EXCESGO", "fixed", 15, 0, 1, 1, null, true, "exclusivo"],
    ["EXCMIN", "fixed", 15, 150, null, 0, null, true, "exclusivo"],
    ["EXCVAZIO", "fixed", 10, 0, null, 0, null, true, "exclusivo"],
    ["VOFF", "fixed", 10, 0, null, 0, null, false, "vitrine"],
    [
      "VVENC",
      "fixed",
      10,
      0,
      null,
      0,
      "now() - interval '1 minute'",
      true,
      "vitrine",
    ],
    ["VESGO", "fixed", 10, 0, 2, 2, null, true, "vitrine"],
    ["V0", "fixed", 0, 0, null, 0, null, true, "vitrine"],
  ];
  const ids = new Map();
  for (const [
    suf,
    tipo,
    valor,
    min,
    lim,
    usos,
    ate,
    ativo,
    alcance,
  ] of linhas) {
    const r = await c.query(
      `INSERT INTO public.coupons
         (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active, alcance)
       VALUES ($1, $2, $3, $4, $5, $6, ${ate ?? "NULL"}, $7, $8) RETURNING id`,
      [cod(suf), tipo, valor, min, lim, usos, ativo, alcance],
    );
    ids.set(suf, r.rows[0].id);
  }
  // A lista de quem pode usar: a dona nos 4 exclusivos com gente; EXCVAZIO fica vazio.
  for (const suf of ["EXC", "EXCVENC", "EXCESGO", "EXCMIN"]) {
    await c.query(
      "INSERT INTO public.cupom_clientes (coupon_id, user_id) VALUES ($1, $2)",
      [ids.get(suf), U_DONA],
    );
  }
  return { produto, pre, cod, ids };
}

function chamar(rpc, cen, { cupom, total, chave }) {
  const metodo = rpc === "create_marketplace_order_v24" ? "pix" : "cash";
  return [
    `SELECT public.${rpc}($1::jsonb, $2::numeric, 0::numeric, $3::text, NULL::uuid, $4::text,
       'Comprador', '5539000000000', NULL::text, $5::jsonb, '38500-000', 'local-delivery', $6::uuid) AS id`,
    [
      JSON.stringify([
        { product_id: cen.produto, variant_id: null, quantity: 1 },
      ]),
      total,
      metodo,
      cupom,
      JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
      chave ?? null,
    ],
  ];
}

async function medir(c, cen, suf = "EXC") {
  return (
    await c.query(
      `SELECT (SELECT estoque FROM public.produtos WHERE id = $1)::int AS estoque,
              (SELECT usage_count FROM public.coupons WHERE id = $2)::int AS usos,
              (SELECT count(*) FROM public.marketplace_orders
                WHERE coupon_id IN (SELECT id FROM public.coupons WHERE code LIKE $3))::int AS pedidos`,
      [cen.produto, cen.ids.get(suf), `${cen.pre}%`],
    )
  ).rows[0];
}

const RPCS = ["create_marketplace_order_v24", "create_marketplace_order_v23"];

async function lista(c, subtotal) {
  return (
    await c.query("SELECT * FROM public.cupons_do_checkout($1::numeric)", [
      subtotal,
    ])
  ).rows;
}

async function validar(c, codigo, subtotal) {
  return (
    await c.query(
      "SELECT public.validate_coupon_secure_v2($1, $2::numeric) AS r",
      [codigo, subtotal],
    )
  ).rows[0].r;
}

/** Códigos de uma lista sem o prefixo do cenário. */
const sufixos = (cen, linhas) =>
  linhas.map((l) => l.codigo.slice(cen.pre.length)).sort();

// ---------------------------------------------------------------------------
// Casos (cada um é chamado no estado normal E depois de cada mutante)
// ---------------------------------------------------------------------------
/** A lista do checkout. */
async function casoLista(c) {
  const cen = await cenario(c, { isolar: true });
  const anon = await comoPapel(c, "anon", null, () => lista(c, 100));
  assert.deepEqual(
    sufixos(cen, anon),
    ["V10", "V150"],
    "anon: só 'todos os clientes' ativo, válido e não esgotado (nem o de valor 0)",
  );

  const dona = await comoPapel(c, "authenticated", U_DONA, () => lista(c, 100));
  assert.deepEqual(
    sufixos(cen, dona),
    ["EXC", "EXCMIN", "V10", "V150"],
    "dona: vitrine + os exclusivos DELA (o vencido e o esgotado não)",
  );
  assert.equal(
    dona.find((l) => l.codigo === cen.cod("EXC")).exclusivo,
    true,
    "o exclusivo chega marcado",
  );

  const outra = await comoPapel(c, "authenticated", U_OUTRA, () =>
    lista(c, 100),
  );
  assert.deepEqual(
    sufixos(cen, outra),
    ["V10", "V150"],
    "outra cliente: nunca o exclusivo da dona",
  );
  for (const [quem, linhas] of [
    ["anon", anon],
    ["dona", dona],
    ["outra", outra],
  ]) {
    assert.ok(
      !sufixos(cen, linhas).includes("SEC"),
      `${quem}: o cupom secreto (só de código) NUNCA aparece`,
    );
    assert.ok(
      !sufixos(cen, linhas).includes("EXCVAZIO"),
      `${quem}: exclusivo sem ninguém na lista vale para ninguém`,
    );
  }

  // Nenhuma coluna de identificação, contador ou pessoa.
  assert.deepEqual(Object.keys(dona[0]).sort(), [
    "aplica",
    "codigo",
    "desconto",
    "exclusivo",
    "falta",
    "minimo",
    "tipo",
    "valido_ate",
    "valor",
  ]);

  // Conta do subtotal 100: EXC 15 fixo, V10 10%, V150 e EXCMIN não valem (faltam
  // 50). Ordem: aplica, desconto maior primeiro, depois quem falta menos.
  assert.deepEqual(
    dona.map((l) => [
      l.codigo.slice(cen.pre.length),
      l.aplica,
      Number(l.desconto),
      Number(l.falta),
    ]),
    [
      ["EXC", true, 15, 0],
      ["V10", true, 10, 0],
      ["V150", false, 0, 50],
      ["EXCMIN", false, 0, 50],
    ],
  );

  // Desconto nunca passa do subtotal; subtotal nulo/negativo vira 0.
  const pequeno = await comoPapel(c, "anon", null, () => lista(c, 5));
  assert.equal(
    Number(pequeno.find((l) => l.codigo === cen.cod("V10")).desconto),
    0.5,
  );
  const nulo = await comoPapel(c, "anon", null, () => lista(c, null));
  assert.equal(
    Number(nulo.find((l) => l.codigo === cen.cod("V150")).falta),
    150,
  );
  const negativo = await comoPapel(c, "anon", null, () => lista(c, -20));
  assert.equal(
    Number(negativo.find((l) => l.codigo === cen.cod("V150")).falta),
    150,
  );

  // Cupom que esgota SOME da lista da dona (limite 1 alcançado agora).
  await c.query(
    "UPDATE public.coupons SET usage_limit = 1, usage_count = 1 WHERE code = $1",
    [cen.cod("EXC")],
  );
  const esgotado = await comoPapel(c, "authenticated", U_DONA, () =>
    lista(c, 100),
  );
  assert.ok(!sufixos(cen, esgotado).includes("EXC"), "esgotado some");
  await c.query(
    "UPDATE public.coupons SET usage_limit = NULL, usage_count = 0 WHERE code = $1",
    [cen.cod("EXC")],
  );

  // Vence NO instante: valid_until = now() já não aparece (corte `>`).
  await c.query(
    "UPDATE public.coupons SET valid_until = now() WHERE code = $1",
    [cen.cod("V10")],
  );
  const noInstante = await comoPapel(c, "anon", null, () => lista(c, 100));
  assert.ok(
    !sufixos(cen, noInstante).includes("V10"),
    "cupom que vence agora não aparece",
  );
  await c.query(
    "UPDATE public.coupons SET valid_until = NULL WHERE code = $1",
    [cen.cod("V10")],
  );

  // LIMIT 20: 25 cupons de "todos os clientes" válidos devolvem 20.
  for (let i = 0; i < 25; i += 1)
    await c.query(
      `INSERT INTO public.coupons (code, type, value, active, alcance)
       VALUES ($1, 'fixed', 5, true, 'vitrine')`,
      [cen.cod(`MUITO${i}`)],
    );
  const muitos = await comoPapel(c, "anon", null, () => lista(c, 100));
  assert.equal(muitos.length, 20, "no máximo 20 cupons na lista");
  await c.query("DELETE FROM public.coupons WHERE code LIKE $1", [
    cen.cod("MUITO%"),
  ]);

  // Chave de cupons: NULL ou linha ausente = ligada; só `false` esvazia a lista.
  await c.query(
    "UPDATE public.store_config SET enable_coupons = NULL WHERE id = 1",
  );
  const nula = await comoPapel(c, "anon", null, () => lista(c, 100));
  assert.deepEqual(sufixos(cen, nula), ["V10", "V150"], "chave NULL = ligada");
  await c.query(
    "UPDATE public.store_config SET enable_coupons = false WHERE id = 1",
  );
  const desligada = await comoPapel(c, "authenticated", U_DONA, () =>
    lista(c, 100),
  );
  assert.equal(
    desligada.filter((l) => l.codigo.startsWith(cen.pre)).length,
    0,
    "loja desligada não lista nada",
  );
}

/** A validação antecipada. */
async function casoValidar(c) {
  const cen = await cenario(c);
  await logar(c, U_OUTRA);
  const exatoInvalido = {
    is_valid: false,
    discount_value: 0,
    error_message: INVALIDO,
  };
  assert.deepEqual(await validar(c, cen.cod("EXC"), 100), exatoInvalido);
  for (const suf of ["EXCVENC", "EXCESGO", "EXCMIN", "EXCVAZIO"]) {
    assert.equal(
      (await validar(c, cen.cod(suf).toLowerCase(), 100)).error_message,
      INVALIDO,
      `${suf} de outra conta responde 'inválido' ANTES de 'expirou', 'limite' ou 'faltam'`,
    );
  }

  await logar(c, null);
  assert.equal(
    (await validar(c, cen.cod("EXC"), 100)).error_message,
    INVALIDO,
    "anon com o código do exclusivo",
  );
  assert.equal(
    (await validar(c, cen.cod("SEC"), 100)).is_valid,
    true,
    "o secreto continua valendo para quem digita (visitante)",
  );

  await logar(c, U_DONA);
  const ok = await validar(c, cen.cod("EXC").toLowerCase(), 100);
  assert.equal(ok.is_valid, true, "a dona valida o dela");
  assert.equal(Number(ok.discount_value), 15);
  assert.deepEqual(Object.keys(ok).sort(), [
    "discount_value",
    "error_message",
    "is_valid",
  ]);
  assert.equal(
    (await validar(c, cen.cod("EXCVENC"), 100)).error_message,
    "Este cupom expirou.",
    "para a dona, o motivo real",
  );
  assert.equal(
    (await validar(c, cen.cod("EXCESGO"), 100)).error_message,
    LIMITE,
    "a frase do limite de uso NÃO mudou",
  );
  assert.equal(
    (await validar(c, cen.cod("V150"), 129.5)).error_message,
    "Faltam R$ 20,50 em produtos para usar este cupom (mínimo de R$ 150,00).",
  );
  assert.equal(
    (await validar(c, cen.cod("EXCMIN"), 100)).error_message,
    "Faltam R$ 50,00 em produtos para usar este cupom (mínimo de R$ 150,00).",
  );
  assert.equal(
    (await validar(c, cen.cod("V150"), 150)).is_valid,
    true,
    "no mínimo exato vale",
  );
  // Limite de uso de cupom comum (vitrine) segue com a mesma frase.
  assert.equal((await validar(c, cen.cod("VESGO"), 100)).error_message, LIMITE);

  // Vence NO instante (corte `<=`, como a v24): valid_until = now() já expirou.
  await c.query(
    "UPDATE public.coupons SET valid_until = now() WHERE code = $1",
    [cen.cod("V10")],
  );
  assert.equal(
    (await validar(c, cen.cod("V10"), 100)).error_message,
    "Este cupom expirou.",
    "o cupom morre NO instante de valid_until",
  );
  await c.query(
    "UPDATE public.coupons SET valid_until = now() + interval '1 second' WHERE code = $1",
    [cen.cod("V10")],
  );
  assert.equal((await validar(c, cen.cod("V10"), 100)).is_valid, true);

  // Chave desligada: a frase da 20261203, ANTES de olhar o cupom (inclusive o
  // exclusivo de outra conta e o código que não existe).
  await c.query(
    "UPDATE public.store_config SET enable_coupons = false WHERE id = 1",
  );
  await logar(c, U_OUTRA);
  for (const codigo of [cen.cod("EXC"), cen.cod("V10"), "NAOEXISTE"]) {
    assert.deepEqual(await validar(c, codigo, 100), {
      is_valid: false,
      discount_value: 0,
      error_message: MENSAGEM_CHAVE,
    });
  }
  await logar(c, U_DONA);
  assert.equal(
    (await validar(c, cen.cod("EXC"), 100)).error_message,
    MENSAGEM_CHAVE,
  );
}

/** O gatilho do pedido (pela v24 e pela v23). */
async function casoGatilho(c) {
  const cen = await cenario(c);
  const EXC = cen.cod("EXC");
  for (const rpc of RPCS) {
    // Outra conta, com e sem chave de compra (uma chave NOVA não escapa).
    for (const chave of [crypto.randomUUID(), null]) {
      await logar(c, U_OUTRA);
      const antes = await medir(c, cen);
      const [sql, par] = chamar(rpc, cen, { cupom: EXC, total: 85, chave });
      const r = await tentar(c, sql, par);
      assert.ok(!r.ok, `${rpc}: outra conta com o exclusivo da dona nasceu`);
      assert.equal(r.e.code, "P0001");
      assert.equal(r.e.message, naoExiste(EXC), `${rpc}: a frase da recusa`);
      assert.deepEqual(
        await medir(c, cen),
        antes,
        `${rpc}: a recusa não gasta vaga, estoque nem deixa pedido`,
      );
      if (chave)
        assert.equal(
          (
            await c.query(
              "SELECT 1 FROM public.marketplace_orders WHERE idempotency_key = $1",
              [chave],
            )
          ).rowCount,
          0,
          `${rpc}: a recusa não consome a chave de compra`,
        );
    }
    // Convidado (sem conta).
    await logar(c, null);
    const [sqlG, parG] = chamar(rpc, cen, {
      cupom: EXC,
      total: 85,
      chave: crypto.randomUUID(),
    });
    const g = await tentar(c, sqlG, parG);
    assert.ok(!g.ok, `${rpc}: convidado com o exclusivo nasceu`);
    assert.equal(g.e.message, naoExiste(EXC));
  }
  assert.equal((await medir(c, cen)).usos, 0, "nenhuma vaga foi gasta");

  // A dona: nasce, com o desconto de sempre e a vaga gasta.
  for (const rpc of RPCS) {
    await logar(c, U_DONA);
    const antes = await medir(c, cen);
    const [sql, par] = chamar(rpc, cen, {
      cupom: EXC,
      total: 85,
      chave: crypto.randomUUID(),
    });
    const r = await tentar(c, sql, par);
    assert.ok(r.ok, `${rpc}: a dona tem de conseguir: ${r.e?.message}`);
    const linha = (
      await c.query(
        "SELECT user_id, discount, total, coupon_code FROM public.marketplace_orders WHERE id = $1",
        [r.r.rows[0].id],
      )
    ).rows[0];
    assert.equal(linha.user_id, U_DONA);
    assert.equal(Number(linha.discount), 15);
    assert.equal(Number(linha.total), 85);
    const depois = await medir(c, cen);
    assert.equal(depois.usos, antes.usos + 1, "a vaga foi gasta");
    assert.equal(depois.estoque, antes.estoque - 1);
  }

  // 'Todos os clientes' e o secreto continuam valendo para qualquer conta.
  await logar(c, U_OUTRA);
  for (const [suf, total] of [
    ["V10", 90],
    ["SEC", 50],
  ]) {
    const [sql, par] = chamar("create_marketplace_order_v24", cen, {
      cupom: cen.cod(suf),
      total,
      chave: crypto.randomUUID(),
    });
    const r = await tentar(c, sql, par);
    assert.ok(r.ok, `${suf} vale para qualquer conta: ${r.e?.message}`);
  }

  // Chave desligada + exclusivo de OUTRA conta: manda a frase da CHAVE (o gatilho
  // da 20261203 roda primeiro; o desta migration vem depois, pela ordem do nome).
  await c.query(
    "UPDATE public.store_config SET enable_coupons = false WHERE id = 1",
  );
  for (const [suf, total] of [
    ["EXC", 85],
    ["SEC", 50],
  ]) {
    const [sql, par] = chamar("create_marketplace_order_v24", cen, {
      cupom: cen.cod(suf),
      total,
      chave: crypto.randomUUID(),
    });
    const r = await tentar(c, sql, par);
    assert.ok(!r.ok);
    assert.equal(
      r.e.message,
      MENSAGEM_CHAVE,
      `chave desligada + ${suf}: a frase da chave vem ANTES da do exclusivo`,
    );
  }
}

/** A retentativa gêmea, em sequência (a corrida de verdade é a prova 2 conexões). */
async function casoRetentativa(c) {
  const cen = await cenario(c);
  const EXC = cen.cod("EXC");
  await logar(c, U_DONA);
  const K = crypto.randomUUID();
  const [sql, par] = chamar("create_marketplace_order_v24", cen, {
    cupom: EXC,
    total: 85,
    chave: K,
  });
  const a = await tentar(c, sql, par);
  assert.ok(a.ok, `1ª compra da dona: ${a.e?.message}`);
  // A lojista tira a cliente da lista no meio da compra repetida.
  await c.query(
    "DELETE FROM public.cupom_clientes WHERE coupon_id = $1 AND user_id = $2",
    [cen.ids.get("EXC"), U_DONA],
  );
  const antes = await medir(c, cen);
  const b = await tentar(c, sql, par);
  assert.ok(b.ok, `a retentativa devolve o pedido, recusou: ${b.e?.message}`);
  assert.equal(b.r.rows[0].id, a.r.rows[0].id, "o MESMO pedido");
  assert.deepEqual(
    await medir(c, cen),
    antes,
    "a retentativa não cria nem gasta nada",
  );

  // Mas uma compra NOVA (chave nova) já não vale: ela saiu da lista.
  const [sql2, par2] = chamar("create_marketplace_order_v24", cen, {
    cupom: EXC,
    total: 85,
    chave: crypto.randomUUID(),
  });
  const novo = await tentar(c, sql2, par2);
  assert.ok(!novo.ok, "fora da lista, a compra nova com a chave nova nasceu");
  assert.equal(novo.e.message, naoExiste(EXC));
  assert.deepEqual(await medir(c, cen), antes);

  // O atalho NÃO abre brecha: outra conta com a chave da dona não leva pedido.
  await logar(c, U_OUTRA);
  const brecha = await tentar(c, sql, par);
  assert.ok(!brecha.ok, "outra conta reusando a chave da dona nasceu");
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM public.marketplace_orders WHERE user_id = $1 AND coupon_id = $2",
        [U_OUTRA, cen.ids.get("EXC")],
      )
    ).rows[0].n,
    0,
    "nenhum pedido com o exclusivo para quem está fora da lista",
  );
  assert.deepEqual(await medir(c, cen), antes);
}

// ---------------------------------------------------------------------------
// O painel e os grants
// ---------------------------------------------------------------------------
const PERSONAS_REBAIXADAS = [
  ["rebaixado só no profiles", U_REB_PERFIL],
  ["rebaixado só no auth.users", U_REB_AUTH],
  ["rebaixado nas duas fontes", U_REB_AMBOS],
];

async function erroDoPainel(c, uid, sql, params) {
  await logar(c, uid, claims(uid, "admin"));
  const r = await tentar(c, sql, params);
  return r;
}

async function casoAdmin(c) {
  const cen = await cenario(c);
  const idExc = cen.ids.get("EXC");
  const idVazio = cen.ids.get("EXCVAZIO");

  // Precondição das rebaixadas (sem ela a prova seria vazia): a porta ANTIGA deixa
  // entrar (JWT velho / fonte antiga) e a atual não.
  for (const [rotulo, uid] of PERSONAS_REBAIXADAS) {
    await logar(c, uid, claims(uid, "admin"));
    const p = (
      await c.query(
        "SELECT public.is_admin() AS antiga, public.is_admin_atual() AS atual",
      )
    ).rows[0];
    assert.equal(
      p.antiga,
      true,
      `${rotulo}: is_admin() antigo ainda deixa entrar`,
    );
    assert.equal(p.atual, false, `${rotulo}: is_admin_atual() recusa`);
  }
  await logar(c, U_ADMIN, claims(U_ADMIN, "admin"));
  assert.equal(
    (await c.query("SELECT public.is_admin_atual() AS a")).rows[0].a,
    true,
    "o admin atual passa",
  );

  const SQL_DEFINIR =
    "SELECT public.admin_cupom_definir_clientes($1, $2::uuid[]) AS n";
  const SQL_LER = "SELECT * FROM public.admin_cupom_clientes($1)";

  // Cliente comum e rebaixados: recusados NAS DUAS funções, e a lista não muda.
  const quem = [["cliente comum", U_OUTRA], ...PERSONAS_REBAIXADAS];
  for (const [rotulo, uid] of quem) {
    const w = await erroDoPainel(c, uid, SQL_DEFINIR, [idVazio, [U_DONA]]);
    assert.ok(!w.ok, `${rotulo}: gravou a lista do cupom`);
    assert.equal(w.e.code, "42501", `${rotulo}: ${w.e.message}`);
    assert.equal(w.e.message, "Não autorizado");
    const l = await erroDoPainel(c, uid, SQL_LER, [idExc]);
    assert.ok(
      !l.ok,
      `${rotulo}: leu a lista do cupom (nome e e-mail de clientes)`,
    );
    assert.equal(l.e.code, "42501");
  }
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM public.cupom_clientes WHERE coupon_id = $1",
        [idVazio],
      )
    ).rows[0].n,
    0,
    "nenhuma gravação passou",
  );

  // Pelo papel de verdade (SET ROLE authenticated), a mesma recusa.
  for (const [rotulo, uid] of quem) {
    const r = await comoPapel(
      c,
      "authenticated",
      uid,
      () => tentar(c, SQL_LER, [idExc]),
      { jwt: claims(uid, "admin") },
    );
    assert.ok(!r.ok, `${rotulo} (authenticated): leu a lista`);
    assert.equal(r.e.code, "42501");
  }

  // O admin atual: recusa id desconhecido, tira duplicata e nulo, troca a lista.
  await logar(c, U_ADMIN, claims(U_ADMIN, "admin"));
  const desc = await tentar(c, SQL_DEFINIR, [
    idVazio,
    [U_DONA, "c0c80000-9999-4000-8000-000000000000"],
  ]);
  assert.ok(!desc.ok);
  assert.equal(desc.e.message, "Cliente não encontrado (1 de 2).");
  const semCupom = await tentar(c, SQL_DEFINIR, [
    "c0c80000-9999-4000-8000-000000000001",
    [U_DONA],
  ]);
  assert.ok(!semCupom.ok);
  assert.equal(semCupom.e.message, "Cupom não encontrado.");
  const n1 = (
    await c.query(
      "SELECT public.admin_cupom_definir_clientes($1, ARRAY[$2, $3, $2, NULL]::uuid[]) AS n",
      [idVazio, U_DONA, U_OUTRA],
    )
  ).rows[0].n;
  assert.equal(n1, 2, "dedup e sem nulo: 2 clientes");
  const n2 = (await c.query(SQL_DEFINIR, [idVazio, [U_DONA]])).rows[0].n;
  assert.equal(n2, 1, "a outra SAI da lista (troca inteira)");
  const n0 = (await c.query(SQL_DEFINIR, [idVazio, null])).rows[0].n;
  assert.equal(n0, 0, "lista nula esvazia");
  await c.query(SQL_DEFINIR, [idVazio, [U_DONA]]);

  const lidos = (await c.query(SQL_LER, [idVazio])).rows;
  assert.deepEqual(
    lidos.map((l) => [l.user_id, l.nome, l.email]),
    [[U_DONA, "Dona do Exclusivo", "dona@cupons208.teste"]],
    "o painel lê só a dona, com nome e e-mail",
  );
  assert.deepEqual(
    Object.keys(lidos[0]).sort(),
    ["email", "nome", "user_id"],
    "nada de CPF nem outro dado na leitura do painel",
  );
  assert.ok(
    !JSON.stringify(lidos).includes(CPF_DONA),
    "o CPF da dona (que existe em profiles) não aparece",
  );

  // Teto de 500 clientes.
  const muitos = Array.from({ length: 501 }, () => crypto.randomUUID());
  const teto = await tentar(c, SQL_DEFINIR, [idVazio, muitos]);
  assert.ok(!teto.ok);
  assert.equal(teto.e.message, "No máximo 500 clientes por cupom.");

  // Anon não executa nenhuma das duas; o gatilho não é de ninguém.
  for (const sql of [
    "SELECT * FROM public.admin_cupom_clientes(gen_random_uuid())",
    "SELECT public.admin_cupom_definir_clientes(gen_random_uuid(), '{}'::uuid[])",
    "SELECT public.pedido_com_cupom_so_nasce_para_a_lista()",
  ]) {
    const r = await comoPapel(c, "anon", null, () => tentar(c, sql));
    assert.ok(!r.ok, `anon executou: ${sql}`);
    assert.match(r.e.message, /permission denied/);
  }
  const gat = await comoPapel(c, "authenticated", U_ADMIN, () =>
    tentar(c, "SELECT public.pedido_com_cupom_so_nasce_para_a_lista()"),
  );
  assert.ok(!gat.ok);
  assert.match(gat.e.message, /permission denied/);
}

/** Grants e RLS da tabela cupom_clientes. */
async function casoGrantsERls(c) {
  const cen = await cenario(c);
  const SQL_LISTA = "SELECT coupon_id FROM public.cupom_clientes";
  // O admin ATUAL lê as linhas.
  const admin = await comoPapel(
    c,
    "authenticated",
    U_ADMIN,
    async () => (await c.query(SQL_LISTA)).rows,
    { jwt: claims(U_ADMIN, "admin") },
  );
  assert.ok(admin.length >= 4, "o admin atual lê a lista");
  // Cliente comum, dona e rebaixados (JWT velho dizendo admin): 0 linhas, sem erro.
  for (const [rotulo, uid] of [
    ["dona", U_DONA],
    ["outra", U_OUTRA],
    ...PERSONAS_REBAIXADAS,
  ]) {
    const linhas = await comoPapel(
      c,
      "authenticated",
      uid,
      async () => (await c.query(SQL_LISTA)).rows,
      { jwt: claims(uid, "admin") },
    );
    assert.equal(
      linhas.length,
      0,
      `${rotulo}: lê ${linhas.length} linhas de cupom_clientes (a política tem de usar o admin ATUAL)`,
    );
  }
  // anon nem SELECT.
  const anon = await comoPapel(c, "anon", null, () => tentar(c, SQL_LISTA));
  assert.ok(!anon.ok && /permission denied/.test(anon.e.message));

  // Ninguém escreve por PostgREST (nem o admin atual): só pela RPC.
  for (const [papel, uid] of [
    ["authenticated", U_ADMIN],
    ["authenticated", U_DONA],
    ["anon", null],
  ]) {
    for (const sql of [
      "INSERT INTO public.cupom_clientes (coupon_id, user_id) SELECT id, $1 FROM public.coupons WHERE code = $2",
      "UPDATE public.cupom_clientes SET user_id = $1 WHERE coupon_id = (SELECT id FROM public.coupons WHERE code = $2)",
      "DELETE FROM public.cupom_clientes WHERE user_id = $1 AND coupon_id = (SELECT id FROM public.coupons WHERE code = $2)",
    ]) {
      const r = await comoPapel(
        c,
        papel,
        uid,
        () => tentar(c, sql, [U_OUTRA, cen.cod("SEC")]),
        { jwt: uid ? claims(uid, "admin") : "" },
      );
      assert.ok(
        !r.ok && /permission denied/.test(r.e.message),
        `${papel}/${uid}: escrita direta em cupom_clientes devia cair no grant`,
      );
    }
  }

  // A tabela coupons continua fechada para quem não é admin (20261052).
  const cuponsDaCliente = await comoPapel(
    c,
    "authenticated",
    U_DONA,
    async () => (await c.query("SELECT code FROM public.coupons")).rows,
  );
  assert.equal(cuponsDaCliente.length, 0, "coupons segue fechado");
}

// ---------------------------------------------------------------------------
// Impressão digital do que a migration cria (comparar antes/depois)
// ---------------------------------------------------------------------------
async function funcoes(c) {
  const linhas = [];
  for (const oid of [
    OID_VALIDATE,
    OID_LISTA,
    OID_LER,
    OID_DEFINIR,
    OID_GATILHO,
  ]) {
    const r = await c.query(
      `SELECT $2::text AS f, md5(p.prosrc) AS h,
              COALESCE(p.proacl::text, '') AS acl, p.prosecdef AS definer,
              COALESCE(array_to_string(p.proconfig, ','), '') AS cfg, p.provolatile AS vol
         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [oid, oid],
    );
    if (r.rows[0]) linhas.push(r.rows[0]);
  }
  return linhas;
}

async function digital(c) {
  const q = async (sql) => (await c.query(sql)).rows;
  return {
    funcoes: await funcoes(c),
    coluna: await q(`
      SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'coupons' AND column_name = 'alcance'`),
    check: await q(`
      SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
       WHERE conrelid = 'public.coupons'::regclass AND conname = 'coupons_alcance_check'`),
    tabela: await q(`
      SELECT relacl::text AS acl, relrowsecurity AS rls FROM pg_class
       WHERE oid = to_regclass('public.cupom_clientes')`),
    politicas: await q(`
      SELECT polname, polcmd::text AS cmd, polroles::regrole[]::text AS papeis,
             pg_get_expr(polqual, polrelid) AS qual
        FROM pg_policy WHERE polrelid = to_regclass('public.cupom_clientes')`),
    indices: await q(`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'cupom_clientes' ORDER BY 1`),
    gatilhos: await q(`
      SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def FROM pg_trigger
       WHERE tgrelid = 'public.marketplace_orders'::regclass AND NOT tgisinternal
         AND tgname LIKE 'tr_pedido_com_cupom_%' ORDER BY tgname`),
  };
}

const PRE_ESPERADO_DO_ROLLBACK = {
  coluna: [],
  check: [],
  tabela: [],
  politicas: [],
  indices: [],
};

// ---------------------------------------------------------------------------
// Provas
// ---------------------------------------------------------------------------
const PROVAS = [];

PROVAS.push({
  nome: "(0) a migration 208 está no ar: coluna com default 'codigo', tabela com RLS, 4 funções com o ACL certo, gatilho ativo DEPOIS do da chave, validação com o hash do arquivo",
  corpo: async (c) => {
    const d = await digital(c);
    assert.deepEqual(d.coluna, [
      {
        data_type: "text",
        is_nullable: "NO",
        column_default: "'codigo'::text",
      },
    ]);
    assert.equal(d.tabela[0].rls, true, "cupom_clientes com RLS");
    assert.equal(d.funcoes.length, 5);
    // O ACL: lista = anon+authenticated; painel = authenticated; gatilho = ninguém.
    const acl = new Map(d.funcoes.map((f) => [f.f, f.acl]));
    assert.match(acl.get(OID_LISTA), /anon=X/);
    assert.match(acl.get(OID_LISTA), /authenticated=X/);
    for (const oid of [OID_LER, OID_DEFINIR]) {
      assert.match(acl.get(oid), /authenticated=X/, oid);
      assert.doesNotMatch(acl.get(oid), /anon=X|(^|,)=X/, oid);
    }
    assert.doesNotMatch(acl.get(OID_GATILHO), /anon=X|authenticated=X|(^|,)=X/);
    assert.deepEqual(
      d.gatilhos.map((g) => [g.tgname, g.tgenabled]),
      [
        [GATILHO_CHAVE, "O"],
        [GATILHO, "O"],
      ],
      "os dois gatilhos de cupom, na ordem em que disparam (nome)",
    );
    assert.match(d.gatilhos[1].def, /BEFORE INSERT/);
    assert.match(d.gatilhos[1].def, /WHEN \(\(new\.coupon_id IS NOT NULL\)\)/);
    assert.equal(
      sha256(await prosrcDe(c, OID_VALIDATE)),
      sha256(CORPO_208),
      "o corpo vivo da validação é o do ARQUIVO",
    );
    assert.notEqual(sha256(CORPO_208), H203);
    // Só as colunas esperadas em cupom_clientes.
    const cols = await c.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cupom_clientes' ORDER BY ordinal_position`,
    );
    assert.deepEqual(
      cols.rows.map((r) => r.column_name),
      ["coupon_id", "user_id", "criado_em"],
    );
    // A coluna duplicada morreu (#784) e NENHUM corpo novo a cita.
    assert.equal(
      (
        await c.query(
          `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosrc ~* 'used_count'
              AND p.oid = ANY (ARRAY[to_regprocedure('${OID_VALIDATE}'), to_regprocedure('${OID_LISTA}'),
                to_regprocedure('${OID_LER}'), to_regprocedure('${OID_DEFINIR}'),
                to_regprocedure('${OID_GATILHO}')]::oid[])`,
        )
      ).rows[0].n,
      0,
    );
  },
});

PROVAS.push({
  nome: "(1) cupons_do_checkout: anon vê só 'todos os clientes'; a dona vê o exclusivo dela, outra não; secreto nunca; sem esgotado/vencido/inativo/valor 0; LIMIT 20; chave desligada esvazia",
  corpo: async (c) => {
    await numaTransacao(c, () => casoLista(c));
  },
});

PROVAS.push({
  nome: "(2) validate_coupon_secure_v2: exclusivo alheio responde 'inválido' ANTES de qualquer motivo; 'Faltam R$'; corte `<=`; a frase do limite intacta; chave desligada manda a frase da 203",
  corpo: async (c) => {
    await numaTransacao(c, () => casoValidar(c));
  },
});

PROVAS.push({
  nome: "(3) gatilho do pedido: exclusivo só nasce no pedido da dona (v24 e v23); outra conta e convidado recusados sem gastar a vaga, mesmo com chave nova; chave desligada manda a frase da chave",
  corpo: async (c) => {
    await numaTransacao(c, () => casoGatilho(c));
  },
});

PROVAS.push({
  nome: "(4) retentativa: a cliente tirada da lista entre as duas tentativas recebe o MESMO pedido; chave nova é recusada; outra conta com a chave dela não leva pedido",
  corpo: async (c) => {
    await numaTransacao(c, () => casoRetentativa(c));
  },
});

PROVAS.push({
  nome: "(5) painel: só o admin ATUAL lê e grava a lista (cliente comum e admin rebaixado com sessão velha recusados nas 2 funções, por superusuário e por SET ROLE); sem CPF; teto 500; anon sem EXECUTE",
  corpo: async (c) => {
    await numaTransacao(c, () => casoAdmin(c));
  },
});

PROVAS.push({
  nome: "(6) grants e RLS: cupom_clientes só o admin ATUAL lê (rebaixado lê 0 linhas) e ninguém escreve; coupons segue fechado",
  corpo: async (c) => {
    await numaTransacao(c, () => casoGrantsERls(c));
  },
});

PROVAS.push({
  nome: "(7) ida e volta numa transação: reaplicar 2x é idempotente; o rollback devolve o corpo da 20261203 BYTE A BYTE, desativa os exclusivos e apaga lista/coluna; rollback repetido não faz nada; reaplicar volta ao mesmo estado; corpo divergente recusa (CRLF é aceito)",
  corpo: async (c) => {
    await numaTransacao(c, async () => {
      const cen = await cenario(c);
      const d0 = await digital(c);

      // Reaplicar sobre o estado novo: idempotente, nada muda.
      await c.query(SQL_MIGRATION);
      await c.query(SQL_MIGRATION);
      assert.deepEqual(await digital(c), d0, "reaplicar 2x mudou o estado");

      // Rollback: corpo da 20261203 byte a byte; exclusivos desativados; coluna fora.
      const antesCupons = (
        await c.query(
          "SELECT code, active, alcance FROM public.coupons WHERE code LIKE $1 ORDER BY code",
          [`${cen.pre}%`],
        )
      ).rows;
      assert.ok(antesCupons.some((l) => l.alcance === "exclusivo" && l.active));
      await c.query(SQL_ROLLBACK);
      const corpo = await prosrcDe(c, OID_VALIDATE);
      assert.equal(corpo, CORPO_203, "rollback = corpo da 203 byte a byte");
      assert.equal(sha256(corpo), H203);
      const d1 = await digital(c);
      assert.deepEqual(
        d1.funcoes.map((f) => f.f),
        [OID_VALIDATE],
      );
      const digitalD1 = new Map(Object.entries(d1));
      for (const [k, esperado] of Object.entries(PRE_ESPERADO_DO_ROLLBACK))
        assert.deepEqual(digitalD1.get(k), esperado, `rollback: ${k}`);
      assert.deepEqual(
        d1.gatilhos.map((g) => g.tgname),
        [GATILHO_CHAVE],
        "o rollback NÃO toca o gatilho da chave (203)",
      );
      assert.equal(
        d1.funcoes[0].acl,
        d0.funcoes.find((f) => f.f === OID_VALIDATE).acl,
        "o rollback não mexe no ACL da validação",
      );
      const depoisCupons = (
        await c.query(
          "SELECT code, active FROM public.coupons WHERE code LIKE $1 ORDER BY code",
          [`${cen.pre}%`],
        )
      ).rows;
      assert.equal(
        depoisCupons.length,
        antesCupons.length,
        "nenhum cupom apagado",
      );
      for (const [i, l] of depoisCupons.entries()) {
        const era = antesCupons.at(i);
        assert.equal(
          l.active,
          era.alcance === "exclusivo" ? false : era.active,
          `${l.code}: só os exclusivos foram desativados`,
        );
      }
      // Sem a 208 a validação é a de antes: sem o bloco do exclusivo.
      assert.equal(
        (await validar(c, cen.cod("SEC"), 100)).is_valid,
        true,
        "o secreto continua valendo",
      );

      // Rollback repetido: idempotente.
      await c.query(SQL_ROLLBACK);
      assert.deepEqual(await digital(c), d1);

      // Reaplica: volta ao mesmo estado; o exclusivo desativado volta como 'codigo'.
      await c.query(SQL_MIGRATION);
      await c.query(SQL_MIGRATION);
      assert.deepEqual(await digital(c), d0, "reaplicar depois do rollback");
      const voltou = (
        await c.query(
          "SELECT alcance, active FROM public.coupons WHERE code = $1",
          [cen.cod("EXC")],
        )
      ).rows[0];
      assert.deepEqual(voltou, { alcance: "codigo", active: false });
      assert.equal(
        (await c.query("SELECT count(*)::int AS n FROM public.cupom_clientes"))
          .rows[0].n,
        0,
        "a lista de clientes não volta (era dado da lojista, o rollback a apagou)",
      );

      // Corpo DIVERGENTE: a migration recusa e o rollback recusa.
      await c.query("SAVEPOINT divergente");
      await c.query(
        `CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
         RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $divergente$
         BEGIN RETURN jsonb_build_object('divergente', true); END;
         $divergente$`,
      );
      await c.query("SAVEPOINT s1");
      await assert.rejects(c.query(SQL_MIGRATION), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT s1");
      await assert.rejects(c.query(SQL_ROLLBACK), /migration posterior/);
      await c.query("ROLLBACK TO SAVEPOINT divergente");
      assert.equal(
        sha256(await prosrcDe(c, OID_VALIDATE)),
        sha256(CORPO_208),
        "a divergência de prova não vazou",
      );

      // O corpo NOVO em CRLF (checkout do Windows) também é aceito.
      await c.query("SAVEPOINT crlf");
      await c.query(
        `CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
         RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $crlf$${CORPO_208.replace(/\n/g, "\r\n")}$crlf$`,
      );
      await c.query(SQL_MIGRATION);
      await c.query("ROLLBACK TO SAVEPOINT crlf");
      // E o da 203 em CRLF também (o banco pode ter vindo de um checkout do Windows).
      await c.query("SAVEPOINT crlf203");
      await c.query(SQL_ROLLBACK);
      await c.query(
        `CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
         RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $crlf$${CORPO_203.replace(/\n/g, "\r\n")}$crlf$`,
      );
      await c.query(SQL_MIGRATION);
      await c.query("ROLLBACK TO SAVEPOINT crlf203");
    });
  },
});

// Guardas do pré-voo: cada recusa nomeada, SEM gravar nada.
async function exigirRecusa(c, rotulo, preparo, sql, padrao) {
  await c.query("SAVEPOINT recusa");
  const antes = await digital(c).catch(() => null);
  let erro = null;
  try {
    await preparo();
    await c.query("SAVEPOINT recusa_interna");
    try {
      await c.query(sql);
    } catch (e) {
      erro = e;
    }
    await c.query("ROLLBACK TO SAVEPOINT recusa_interna");
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa");
    await c.query("RELEASE SAVEPOINT recusa");
  }
  assert.ok(erro, `${rotulo}: a migration NÃO recusou`);
  assert.match(erro.message, padrao, `${rotulo}: ${erro.message}`);
  assert.deepEqual(
    await digital(c).catch(() => null),
    antes,
    `${rotulo}: gravou`,
  );
}

PROVAS.push({
  nome: "(8) pré-voo: recusa, nomeando o que diverge, corpo da validação fora dos 4 hashes, gatilho da 203 ausente/desabilitado, índice único ausente/de outra forma, admin atual ausente, alcance/tabela/funções com outra forma",
  corpo: async (c) => {
    await numaTransacao(c, async () => {
      // O estado ANTES da 208: rollback dentro da transação, para a migration recusar de um estado sem ela.
      await c.query(SQL_ROLLBACK);
      const divergente = `CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
         RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $d$
         BEGIN RETURN jsonb_build_object('divergente', true); END; $d$`;
      const casos = [
        [
          "corpo da validação com 1 byte a mais",
          async () => c.query(divergente),
          /B1_BASELINE_DIVERGENT/,
        ],
        [
          "corpo do baseline da validação (loja sem a 20261203)",
          async () =>
            c.query(
              `CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
         RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $d$${corpoDoBaseline()}$d$`,
            ),
          /B1_BASELINE_DIVERGENT/,
        ],
        [
          "gatilho da 203 ausente",
          async () =>
            c.query(
              `DROP TRIGGER ${GATILHO_CHAVE} ON public.marketplace_orders`,
            ),
          /tr_pedido_com_cupom_exige_a_chave_ligada/,
        ],
        [
          "gatilho da 203 desabilitado",
          async () =>
            c.query(
              `ALTER TABLE public.marketplace_orders DISABLE TRIGGER ${GATILHO_CHAVE}`,
            ),
          /tr_pedido_com_cupom_exige_a_chave_ligada/,
        ],
        [
          "índice único da chave de compra ausente",
          async () =>
            c.query(
              "DROP INDEX public.marketplace_orders_chave_da_compra_unica",
            ),
          /marketplace_orders_chave_da_compra_unica/,
        ],
        [
          "índice único da chave de compra sem o predicado parcial",
          async () => {
            await c.query(
              "DROP INDEX public.marketplace_orders_chave_da_compra_unica",
            );
            await c.query(
              "CREATE UNIQUE INDEX marketplace_orders_chave_da_compra_unica ON public.marketplace_orders (idempotency_key)",
            );
          },
          /marketplace_orders_chave_da_compra_unica/,
        ],
        [
          "is_admin_atual ausente",
          async () => {
            // Com dependentes (as 42 RPCs) o DROP é recusado: quem apaga é o rollback
            // da 97 na prova dela. Aqui só renomeia, o que ao pré-voo é "ausente".
            await c.query(
              "ALTER FUNCTION public.is_admin_atual() RENAME TO is_admin_atual_sumiu",
            );
          },
          /is_admin_atual/,
        ],
        [
          "alcance já existe como boolean",
          async () =>
            c.query("ALTER TABLE public.coupons ADD COLUMN alcance boolean"),
          /coupons\.alcance ja existe com outra forma/,
        ],
        [
          "alcance já existe aceitando NULL",
          async () =>
            c.query(
              "ALTER TABLE public.coupons ADD COLUMN alcance text DEFAULT 'codigo'",
            ),
          /coupons\.alcance ja existe com outra forma/,
        ],
        [
          "alcance já existe com outro default",
          async () =>
            c.query(
              "ALTER TABLE public.coupons ADD COLUMN alcance text NOT NULL DEFAULT 'vitrine'",
            ),
          /coupons\.alcance ja existe com outra forma/,
        ],
        [
          "CHECK com outra definição",
          async () => {
            await c.query(
              "ALTER TABLE public.coupons ADD COLUMN alcance text NOT NULL DEFAULT 'codigo'",
            );
            await c.query(
              "ALTER TABLE public.coupons ADD CONSTRAINT coupons_alcance_check CHECK (alcance IN ('codigo'))",
            );
          },
          /coupons_alcance_check ja existe com outra definicao/,
        ],
        [
          "cupom_clientes já existe com outra forma",
          async () =>
            c.query("CREATE TABLE public.cupom_clientes (qualquer int)"),
          /cupom_clientes ja existe com outra forma/,
        ],
        [
          "cupons_do_checkout já existe com outra assinatura",
          async () =>
            c.query(
              "CREATE FUNCTION public.cupons_do_checkout(a text, b text) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$",
            ),
          /ja existe public\.cupons_do_checkout com outra assinatura/,
        ],
        [
          "admin_cupom_clientes já existe com outra assinatura",
          async () =>
            c.query(
              "CREATE FUNCTION public.admin_cupom_clientes(a text) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$",
            ),
          /ja existe public\.admin_cupom_clientes com outra assinatura/,
        ],
      ];
      for (const [rotulo, preparo, padrao] of casos) {
        await exigirRecusa(c, rotulo, preparo, SQL_MIGRATION, padrao);
      }
      // E o controle: sem nenhuma sabotagem a migration passa.
      await c.query("SAVEPOINT controle");
      await c.query(SQL_MIGRATION);
      await c.query("ROLLBACK TO SAVEPOINT controle");
    });
  },
});

PROVAS.push({
  nome: "(9) MUTANTES por guarda: sem o gatilho, sem a ordem do gatilho, sem o admin ATUAL, política com is_admin(), validação sem o bloco do exclusivo, corte `<`, lista vazando o secreto/o exclusivo alheio, atalho sem checar a colisão — cada um deixa uma prova VERMELHA; e o pré-voo sem a guarda do índice/do hash deixa a recusa passar",
  corpo: async (c) => {
    await numaTransacao(c, async () => {
      const mutarFuncao = async (oid, de, para) => {
        const def = (
          await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
            oid,
          ])
        ).rows[0].d;
        assert.ok(def.includes(de), `a mutação não achou: ${de}`);
        await c.query(def.split(de).join(para));
      };

      // M1: gatilho removido.
      await exigirVermelho(c, "sem o gatilho do exclusivo", async () => {
        await c.query(`DROP TRIGGER ${GATILHO} ON public.marketplace_orders`);
        await casoGatilho(c);
      });
      // M2: o gatilho do exclusivo passa a rodar ANTES do da chave (ordem do nome).
      await exigirVermelho(
        c,
        "gatilho do exclusivo antes do da chave",
        async () => {
          await c.query(
            `ALTER TRIGGER ${GATILHO} ON public.marketplace_orders RENAME TO tr_pedido_com_cupom_a_lista`,
          );
          await casoGatilho(c);
        },
      );
      // (O atalho de retentativa TIRADO só aparece na corrida com 2 conexões: em
      // sequência a v23/v24 devolve o pedido ANTES do INSERT e o gatilho nem roda --
      // é o mutante da prova (11).)
      // M3: atalho só por chave preenchida (sem checar que o pedido existe): chave
      // NOVA escaparia e o exclusivo nasceria para quem está fora da lista.
      await exigirVermelho(c, "atalho só por chave preenchida", async () => {
        await mutarFuncao(
          OID_GATILHO,
          "IF NEW.idempotency_key IS NOT NULL\n       AND EXISTS (SELECT 1 FROM public.marketplace_orders WHERE idempotency_key = NEW.idempotency_key) THEN",
          "IF NEW.idempotency_key IS NOT NULL THEN",
        );
        await casoGatilho(c);
      });
      // M5/M6: funções do painel com is_admin() sozinho (JWT velho passa).
      for (const oid of [OID_DEFINIR, OID_LER]) {
        await exigirVermelho(c, `${oid} só com is_admin()`, async () => {
          await mutarFuncao(
            oid,
            "IF NOT (public.is_admin() AND public.is_admin_atual()) THEN",
            "IF NOT public.is_admin() THEN",
          );
          await casoAdmin(c);
        });
      }
      // M7: a política de leitura da lista volta a is_admin().
      await exigirVermelho(c, "política com is_admin()", async () => {
        await c.query(`DROP POLICY ${POLITICA} ON public.cupom_clientes`);
        await c.query(
          `CREATE POLICY ${POLITICA} ON public.cupom_clientes FOR SELECT TO authenticated USING ((SELECT public.is_admin()))`,
        );
        await casoGrantsERls(c);
      });
      // M8: authenticated ganha escrita direta na lista.
      await exigirVermelho(
        c,
        "authenticated com INSERT em cupom_clientes",
        async () => {
          await c.query(
            "GRANT INSERT ON public.cupom_clientes TO authenticated",
          );
          await casoGrantsERls(c);
        },
      );
      // M9: anon ganha EXECUTE no painel.
      await exigirVermelho(c, "anon executa o painel", async () => {
        await c.query(`GRANT EXECUTE ON FUNCTION ${OID_LER} TO anon`);
        await casoAdmin(c);
      });
      // M10: validação sem o bloco do exclusivo (o corpo da 203).
      await exigirVermelho(
        c,
        "validação sem o bloco do exclusivo",
        async () => {
          await c.query(
            `CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
           RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $m$${CORPO_203}$m$`,
          );
          await casoValidar(c);
        },
      );
      // M11: corte de validade `<` (o cupom viveria um instante a mais).
      await exigirVermelho(c, "corte de validade `<`", async () => {
        await mutarFuncao(
          OID_VALIDATE,
          "v_coupon.valid_until <= NOW()",
          "v_coupon.valid_until < NOW()",
        );
        await casoValidar(c);
      });
      // M12: a frase do limite alterada.
      await exigirVermelho(c, "frase do limite alterada", async () => {
        await mutarFuncao(
          OID_VALIDATE,
          "'Cupom atingiu o limite de uso.'",
          "'Cupom esgotado.'",
        );
        await casoValidar(c);
      });
      // M13: a lista vaza o secreto.
      await exigirVermelho(c, "lista vaza o cupom secreto", async () => {
        await mutarFuncao(
          OID_LISTA,
          "c.alcance = 'vitrine'",
          "c.alcance IN ('vitrine', 'codigo')",
        );
        await casoLista(c);
      });
      // M14: a lista vaza o exclusivo de outra conta.
      await exigirVermelho(c, "lista vaza o exclusivo alheio", async () => {
        await mutarFuncao(
          OID_LISTA,
          "cc.user_id = e.uid",
          "cc.user_id IS NOT NULL",
        );
        await casoLista(c);
      });
      // M15: a lista sem o LIMIT 20.
      await exigirVermelho(c, "lista sem o limite de 20", async () => {
        await mutarFuncao(OID_LISTA, "LIMIT 20", "LIMIT 100");
        await casoLista(c);
      });
      // M16: a lista mostra esgotado.
      await exigirVermelho(c, "lista mostra cupom esgotado", async () => {
        await mutarFuncao(
          OID_LISTA,
          "COALESCE(c.usage_count, 0) >= c.usage_limit",
          "false",
        );
        await casoLista(c);
      });
      // M17: a lista ignora a chave desligada.
      await exigirVermelho(c, "lista ignora a chave desligada", async () => {
        await mutarFuncao(OID_LISTA, "WHERE l.ligados", "WHERE true");
        await casoLista(c);
      });
      // M18: a leitura do painel devolve o CPF (a coluna a mais).
      await exigirVermelho(c, "painel devolve o CPF", async () => {
        await c.query(`DROP FUNCTION ${OID_LER}`);
        await c.query(
          `CREATE FUNCTION public.admin_cupom_clientes(p_coupon_id uuid)
           RETURNS TABLE (user_id uuid, nome text, email text, cpf text)
           LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $m$
           BEGIN
             IF NOT (public.is_admin() AND public.is_admin_atual()) THEN
               RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
             END IF;
             RETURN QUERY SELECT cc.user_id, p.full_name, u.email::text, p.cpf
               FROM public.cupom_clientes cc JOIN public.profiles p ON p.id = cc.user_id
               LEFT JOIN auth.users u ON u.id = cc.user_id WHERE cc.coupon_id = p_coupon_id;
           END; $m$`,
        );
        await c.query(
          `REVOKE ALL ON FUNCTION ${OID_LER} FROM PUBLIC, anon, authenticated`,
        );
        await c.query(
          `GRANT EXECUTE ON FUNCTION ${OID_LER} TO authenticated, service_role`,
        );
        await casoAdmin(c);
      });

      // Guardas do PRÉ-VOO: sem a guarda do índice (ou do hash), a recusa que a
      // prova (8) exige PASSA sem recusar -- a prova ficaria vermelha.
      const semBloco = (inicio, fim) => {
        const i = SQL_MIGRATION.indexOf(inicio);
        const j = SQL_MIGRATION.indexOf(fim, i);
        assert.ok(i > 0 && j > i, `não achei o bloco ${inicio}`);
        return SQL_MIGRATION.slice(0, i) + SQL_MIGRATION.slice(j);
      };
      const migrationSemGuardaDoIndice = semBloco(
        "  -- O atalho de retentativa do gatilho novo deixa o INDICE UNICO agir",
        "  -- `alcance`: ausente, ou EXATAMENTE como esta migration o deixa.",
      );
      const migrationSemGuardaDoHash = semBloco(
        "  IF v_hash IS NULL OR v_hash NOT IN (\n    '489c0cd1",
        "  -- O conserto dos cupons desligados (20261203000000) tem de estar de pe",
      );
      await c.query(SQL_ROLLBACK);
      for (const [rotulo, sql, sabotagem, padrao] of [
        [
          "pré-voo sem a guarda do índice único",
          migrationSemGuardaDoIndice,
          "DROP INDEX public.marketplace_orders_chave_da_compra_unica",
          /marketplace_orders_chave_da_compra_unica/,
        ],
        [
          "pré-voo sem a guarda do hash da validação",
          migrationSemGuardaDoHash,
          `CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
           RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $d$
           BEGIN RETURN jsonb_build_object('divergente', true); END; $d$`,
          /B1_BASELINE_DIVERGENT/,
        ],
      ]) {
        // Com a guarda (migration inteira): recusa.
        await exigirRecusa(
          c,
          rotulo,
          () => c.query(sabotagem),
          SQL_MIGRATION,
          padrao,
        );
        // Sem a guarda: o pré-voo (os outros itens) deixa passar -- logo ESTA guarda é quem recusa.
        await c.query("SAVEPOINT sem_guarda");
        let passou = true;
        try {
          await c.query(sabotagem);
          await c.query(sql);
        } catch (e) {
          if (!padrao.test(e.message)) throw e;
          passou = false;
        }
        await c.query("ROLLBACK TO SAVEPOINT sem_guarda");
        await c.query("RELEASE SAVEPOINT sem_guarda");
        assert.ok(
          passou,
          `${rotulo}: sem a guarda a migration ainda recusou pelo motivo da guarda`,
        );
        console.log(
          `    mutante "${rotulo}" MORTO: sem a guarda a recusa some`,
        );
      }

      // Controle dos controles: tudo restaurado, os casos passam de novo.
      await c.query("SAVEPOINT controle");
      await c.query(SQL_MIGRATION);
      await casoGatilho(c);
      await casoRetentativa(c);
      await casoAdmin(c);
      await casoGrantsERls(c);
      await casoValidar(c);
      await casoLista(c);
      await c.query("ROLLBACK TO SAVEPOINT controle");
    });
  },
});

// ---------------------------------------------------------------------------
// Duas+ conexões reais, COMMIT de verdade
// ---------------------------------------------------------------------------
/**
 * A CORRIDA da retentativa gêmea: A cria o pedido da dona (exclusivo, na lista)
 * e ainda não commitou; a lojista tira a dona da lista (gravado e commitado);
 * B (a retentativa, mesma chave K) espera a trava do cupom; A commita. B tem de
 * receber o pedido de A: sem o atalho do gatilho, B era recusada com "não
 * existe", a tela oferecia "Tirar o cupom", girava a chave e nascia um SEGUNDO
 * pedido (cobrança e estoque em dobro).
 */
async function corridaGemea(url) {
  const s = new Client({ connectionString: url });
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await s.connect();
  await a.connect();
  await b.connect();
  try {
    const cen = await cenario(s);
    const EXC = cen.cod("EXC");
    const K = crypto.randomUUID();
    const [sql, par] = chamar("create_marketplace_order_v24", cen, {
      cupom: EXC,
      total: 85,
      chave: K,
    });
    for (const x of [a, b]) {
      await x.query("SELECT set_config('app.rpc.user_id', $1, false)", [
        U_DONA,
      ]);
    }
    await a.query("BEGIN");
    const ra = await a.query(sql, par);
    // A lojista tira a dona da lista: commitado, sem passar pela trava do cupom
    // (gravado direto, como o painel faria depois de A terminar).
    await s.query(
      "DELETE FROM public.cupom_clientes WHERE coupon_id = $1 AND user_id = $2",
      [cen.ids.get("EXC"), U_DONA],
    );
    const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const pb = b.query(sql, par).then(
      (r) => ({ ok: true, id: r.rows[0].id }),
      (e) => ({ ok: false, code: e.code, message: e.message }),
    );
    await esperarTrava(s, pidB, "B (retentativa gêmea)");
    await a.query("COMMIT");
    const rb = await pb;
    const n = (
      await s.query(
        "SELECT count(*)::int AS n FROM public.marketplace_orders WHERE idempotency_key = $1",
        [K],
      )
    ).rows[0].n;
    const m = await medir(s, cen);
    return { idA: ra.rows[0].id, rb, n, usos: m.usos, estoque: m.estoque, EXC };
  } finally {
    await a.end().catch(() => {});
    await b.end().catch(() => {});
    await s.end().catch(() => {});
  }
}

async function exigirCorridaCerta(url) {
  const r = await corridaGemea(url);
  assert.ok(
    r.rb.ok,
    `B (retentativa gêmea) tem de receber o pedido de A, recebeu: ${r.rb.message}`,
  );
  assert.equal(r.rb.id, r.idA, "B recebe o MESMO pedido de A");
  assert.equal(r.n, 1, "1 pedido só com a chave K");
  assert.equal(r.usos, 1, "o cupom gastou 1 uso");
  assert.equal(r.estoque, 49, "o estoque baixou 1");
}

PROVAS.push({
  nome: "(10) CORRIDA com 2 conexões e COMMIT real: A cria o pedido da dona, a lojista a tira da lista, a retentativa gêmea B (mesma chave) devolve o pedido de A — 1 pedido só, 1 uso, 1 baixa de estoque",
  corpo: async (_c, url) => {
    await exigirCorridaCerta(url);
  },
});

PROVAS.push({
  nome: "(11) MUTANTE da corrida: sem o atalho de retentativa a retentativa B é recusada (o defeito que daria pedido em dobro); depois de reaplicar a migration, passa de novo",
  corpo: async (c, url) => {
    // DDL COMMITADA (a corrida usa 3 conexões); o `finally` reaplica a migration.
    try {
      await c.query(`CREATE OR REPLACE FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista()
        RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $m$
        DECLARE v_alcance text;
        BEGIN
          IF NEW.coupon_id IS NULL THEN RETURN NEW; END IF;
          SELECT alcance INTO v_alcance FROM public.coupons WHERE id = NEW.coupon_id;
          IF v_alcance = 'exclusivo' AND (NEW.user_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.cupom_clientes cc
                WHERE cc.coupon_id = NEW.coupon_id AND cc.user_id = NEW.user_id)) THEN
            RAISE EXCEPTION 'O cupom % não existe. Confira o código.', NEW.coupon_code;
          END IF;
          RETURN NEW;
        END; $m$`);
      const r = await corridaGemea(url);
      assert.ok(
        !r.rb.ok && r.rb.message === naoExiste(r.EXC),
        `sem o atalho B tinha de ser recusada com a frase do exclusivo: ${JSON.stringify(r.rb)}`,
      );
      console.log(
        `    mutante "sem o atalho" MORTO: B recusada (${r.rb.code}: ${r.rb.message}); pedidos com a chave: ${r.n}`,
      );
    } finally {
      await c.query(SQL_MIGRATION);
    }
    await exigirCorridaCerta(url);
  },
});

PROVAS.push({
  nome: "(12) trava com pedido em andamento: um pedido que segura o cupom e a tabela faz a migration FALHAR em ~5 s (55P03) sem gravar nada e sem enfileirar o checkout atrás dela; terminado o pedido, a migration aplica",
  corpo: async (c, url) => {
    const x = new Client({ connectionString: url });
    const m = new Client({ connectionString: url });
    await x.connect();
    await m.connect();
    try {
      const cen = await cenario(c);
      await x.query("SELECT set_config('app.rpc.user_id', $1, false)", [
        U_DONA,
      ]);
      const [sql, par] = chamar("create_marketplace_order_v24", cen, {
        cupom: cen.cod("EXC"),
        total: 85,
        chave: crypto.randomUUID(),
      });
      await x.query("BEGIN");
      await x.query(sql, par); // segura a linha do cupom e escreveu em marketplace_orders
      const d0 = await digital(c);
      const t0 = Date.now();
      await assert.rejects(
        m.query(SQL_MIGRATION),
        (e) => e.code === "55P03",
        "a migration tinha de falhar por lock_timeout",
      );
      const dt = Date.now() - t0;
      assert.ok(dt >= 4500 && dt < 9000, `falhou em ${dt} ms (esperava ~5 s)`);
      assert.deepEqual(
        await digital(c),
        d0,
        "a migration que falhou gravou algo",
      );
      // O checkout (leitura do cupom) NÃO ficou enfileirado atrás da migration
      // que desistiu: responde na hora.
      const t1 = Date.now();
      await c.query("SELECT * FROM public.cupons_do_checkout(100)");
      assert.ok(Date.now() - t1 < 2000, "o checkout esperou a migration");
      await x.query("COMMIT");
      await m.query(SQL_MIGRATION);
      assert.deepEqual(await digital(c), d0, "reaplicada, o estado é o mesmo");
    } finally {
      await x.query("ROLLBACK").catch(() => {});
      await x.end().catch(() => {});
      await m.end().catch(() => {});
    }
  },
});

PROVAS.push({
  nome: "(13) dado que JÁ EXISTIA antes da migration, atomicidade e envelope REPEATABLE READ: com a 208 desfeita de verdade (COMMIT), cupons e pedido antigos ficam intactos ao aplicar (cupom antigo = 'codigo', secreto, mesmo uso); migration que falha no fim não deixa NADA; aplicar sob RR com escritor concorrente passa; o cupom antigo continua comprando",
  corpo: async (c, url) => {
    const d08 = await digital(c);
    let restaurar = true;
    try {
      // (a) a 208 desfeita de verdade (autocommit); o banco volta a ter só a 203.
      await c.query(SQL_ROLLBACK);
      const pre = await digital(c);
      assert.deepEqual(
        pre.funcoes.map((f) => f.f),
        [OID_VALIDATE],
      );
      assert.equal(sha256(await prosrcDe(c, OID_VALIDATE)), H203);

      // (b) o que JÁ EXISTIA: 3 cupons, uma compra com cupom (pelo caminho real da 203).
      const sufx = crypto.randomUUID().slice(0, 8).toUpperCase();
      const produto = await base(c);
      const antigo = {
        pct: `OLD${sufx}A`,
        lim: `OLD${sufx}B`,
        ven: `OLD${sufx}C`,
      };
      await c.query(
        `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active)
         VALUES ($1, 'percentage', 10, 80, NULL, 0, NULL, true),
                ($2, 'fixed', 10, 0, 3, 2, NULL, true),
                ($3, 'fixed', 10, 0, NULL, 0, now() - interval '1 day', true)`,
        [antigo.pct, antigo.lim, antigo.ven],
      );
      const cenAntigo = {
        produto,
        pre: `OLD${sufx}`,
        ids: new Map([
          [
            "EXC",
            (
              await c.query("SELECT id FROM public.coupons WHERE code = $1", [
                antigo.lim,
              ])
            ).rows[0].id,
          ],
        ]),
      };
      await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [
        U_DONA,
      ]);
      const [sqlP, parP] = chamar("create_marketplace_order_v24", cenAntigo, {
        cupom: antigo.lim,
        total: 90,
        chave: crypto.randomUUID(),
      });
      const pedidoAntigo = (await c.query(sqlP, parP)).rows[0].id;
      const fotoPedido = async () =>
        (
          await c.query(
            "SELECT to_jsonb(o)::text AS j FROM public.marketplace_orders o WHERE id = $1",
            [pedidoAntigo],
          )
        ).rows[0].j;
      const fotoCupons = async () =>
        (
          await c.query(
            `SELECT code, type, value::text, min_purchase::text, usage_limit, usage_count,
                    valid_until IS NULL AS sem_data, active
               FROM public.coupons WHERE code LIKE $1 ORDER BY code`,
            [`OLD${sufx}%`],
          )
        ).rows;
      const pedidoAntes = await fotoPedido();
      const cuponsAntes = await fotoCupons();
      assert.equal(
        cuponsAntes.find((l) => l.code === antigo.lim).usage_count,
        3,
      );
      await c.query("SELECT set_config('app.rpc.user_id', '', false)");

      // (c) ATOMICIDADE: a mesma migration com um erro DEPOIS do pós-voo (a
      // transação "interrompida no meio") não deixa NADA — nem a coluna, nem a tabela.
      const quebrada = `${SQL_MIGRATION}\nSELECT 1 / 0;\n`;
      await assert.rejects(c.query(quebrada), (e) => e.code === "22012");
      assert.deepEqual(
        await digital(c),
        pre,
        "a migration quebrada deixou resto",
      );
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'coupons' AND column_name = 'alcance'",
          )
        ).rows[0].n,
        0,
      );

      // (d) ENVELOPE REPEATABLE READ (como o aplicar-migrations.yml): o escritor
      // concorrente grava num cupom DEPOIS da foto da transação da migration.
      const m = new Client({ connectionString: url });
      const w = new Client({ connectionString: url });
      await m.connect();
      await w.connect();
      try {
        await m.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await m.query("SELECT count(*) FROM public.coupons"); // tira a foto
        await w.query(
          "UPDATE public.coupons SET usage_count = usage_count + 1 WHERE code = $1",
          [antigo.pct],
        );
        await m.query(SQL_MIGRATION);
        await m.query("COMMIT");
      } finally {
        await m.query("ROLLBACK").catch(() => {});
        await m.end().catch(() => {});
        await w.end().catch(() => {});
      }
      restaurar = false;
      const cuponsDepois = await fotoCupons();
      const esperado = cuponsAntes.map((l) =>
        l.code === antigo.pct ? { ...l, usage_count: l.usage_count + 1 } : l,
      );
      assert.deepEqual(
        cuponsDepois,
        esperado,
        "os cupons antigos ficaram IGUAIS (a escrita concorrente também sobreviveu)",
      );
      assert.equal(
        await fotoPedido(),
        pedidoAntes,
        "o pedido antigo ficou intacto",
      );
      const novos = (
        await c.query(
          "SELECT code, alcance FROM public.coupons WHERE code LIKE $1 ORDER BY code",
          [`OLD${sufx}%`],
        )
      ).rows;
      assert.ok(
        novos.length === 3 && novos.every((l) => l.alcance === "codigo"),
        "todo cupom antigo nasce 'codigo' (secreto)",
      );
      assert.deepEqual(await digital(c), d08, "o estado final é o da 208");

      // (e) O cupom antigo continua funcionando como antes.
      await c.query("BEGIN");
      try {
        await logar(c, null);
        const v = await validar(c, antigo.pct.toLowerCase(), 100);
        assert.equal(v.is_valid, true);
        assert.equal(Number(v.discount_value), 10);
        assert.equal(
          (await validar(c, antigo.pct, 50)).error_message,
          "Faltam R$ 30,00 em produtos para usar este cupom (mínimo de R$ 80,00).",
        );
        assert.equal(
          (await validar(c, antigo.ven, 100)).error_message,
          "Este cupom expirou.",
        );
        // 'codigo' é secreto: nunca na lista.
        const lst = await comoPapel(c, "anon", null, () => lista(c, 100));
        assert.ok(
          !lst.some((l) => l.codigo.startsWith("OLD")),
          "cupom antigo nunca aparece na lista do checkout",
        );
        // E ainda compra: o gatilho novo deixa passar cupom 'codigo'.
        await logar(c, U_DONA);
        const [sqlN, parN] = chamar("create_marketplace_order_v24", cenAntigo, {
          cupom: antigo.pct,
          total: 90,
          chave: crypto.randomUUID(),
        });
        const r = await tentar(c, sqlN, parN);
        assert.ok(
          r.ok,
          `o cupom antigo tem de continuar comprando: ${r.e?.message}`,
        );
        // O que fechou o limite continua fechando, com a mesma frase.
        await c.query(
          "UPDATE public.coupons SET usage_count = 3 WHERE code = $1",
          [antigo.lim],
        );
        assert.equal((await validar(c, antigo.lim, 100)).error_message, LIMITE);
      } finally {
        await c.query("ROLLBACK");
      }

      // (f) Reaplicar mais 2x: o mesmo estado.
      await c.query(SQL_MIGRATION);
      await c.query(SQL_MIGRATION);
      assert.deepEqual(await digital(c), d08);
    } finally {
      if (restaurar) await c.query(SQL_MIGRATION);
    }
  },
});

// ---------------------------------------------------------------------------
async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }

  const linhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente, url);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.stack || erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary("Cupons do checkout (rpc-ci)", linhas.join("\n"));
        falhar(
          "FALHOU",
          "Uma prova dos cupons do checkout quebrou — ver acima.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }

  console.log(
    `\n[cupons-do-checkout] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Cupons do checkout (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
