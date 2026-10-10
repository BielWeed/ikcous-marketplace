"use strict";

/**
 * PROVA VIVA da migration 20261203000000_cupons_desligados_nao_dao_desconto.sql
 * (dinheiro, issue #645, decisão do dono de 08/10/2026: chave
 * `store_config.enable_coupons` DESLIGADA = nenhum desconto de cupom em pedido
 * novo) contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 *   (0) a migration está no ar: gatilho BEFORE INSERT ativo + validação nova.
 *   (a) REGRESSÃO — chave LIGADA, NULL ou linha AUSENTE: o cupom aplica como
 *       antes (validação válida; v24 e v23 criam o pedido com desconto,
 *       coupon_id, +1 uso do cupom e -1 de estoque). Linha AUSENTE: as RPCs
 *       recusam por OUTRO motivo (forma de pagamento: sem a linha id=1,
 *       `forma_de_pagamento_aceita` devolve false), então ali se prova a
 *       validação e o gatilho com INSERT direto.
 *   (b) chave DESLIGADA: a validação devolve inválido com o motivo (mesmo
 *       formato jsonb, até para código que não existe); v24 e v23 RECUSAM com
 *       a frase (P0001, inclusive COM chave de idempotência — o `WHEN
 *       unique_violation` em volta do INSERT não engole a recusa) e não deixam
 *       nada: nenhum pedido, estoque intacto, usage_count intacto, a chave de
 *       idempotência NÃO é consumida (religada, a mesma chamada nasce); INSERT
 *       direto com coupon_id também é recusado (porta única).
 *   (c) pedido SEM cupom (NULL e '') continua nascendo com a chave desligada.
 *   (d) IDEMPOTÊNCIA: o pedido criado COM cupom antes de desligar a chave, na
 *       repetição da mesma chamada (mesma chave) devolve o MESMO pedido, sem
 *       erro e sem 2º uso do cupom — o atalho vem antes do INSERT.
 *   (e) ACL e rollback: grants de validate_coupon_secure_v2, v23, v24 e das
 *       tabelas iguais antes/depois; o rollback devolve o corpo do baseline
 *       BYTE A BYTE (a falha volta: desligada + cupom válido) e remove o
 *       gatilho; reaplicar a migration é idempotente; corpo divergente (LF
 *       alterado) recusa a migration e o rollback; CRLF do corpo novo é aceito.
 *   (f) MUTANTES: sem o gatilho a prova (b) fica VERMELHA; gatilho com `IS NOT
 *       TRUE` deixa o caso NULL/ausente VERMELHO; validação sem a checagem
 *       deixa (b) validação VERMELHA; curto-circuito só por "chave preenchida"
 *       deixa (b) VERMELHA.
 *   (g) chave de compra de OUTRO cliente com a chave de cupons desligada: o
 *       índice único é só pela chave (global), o INSERT colide e a v23/v24 só
 *       devolve pedido ao dono — nenhum pedido nasce; chave nova e NULL
 *       continuam recusadas.
 *   (h) CORRIDA com 2 conexões e COMMIT real (revisão Opus, 08/10/2026): A cria
 *       o pedido com cupom e chave K sem commitar, a lojista desliga, a
 *       retentativa gêmea B (mesma K) espera a trava do cupom, A commita — B
 *       tem de receber o pedido de A (curto-circuito do gatilho), 1 pedido só.
 *   (i) MUTANTE da corrida: sem o curto-circuito, B é recusada (o defeito).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cupons-desligados-viva.cjs
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
const NOME = "20261203000000_cupons_desligados_nao_dao_desconto.sql";
const SQL_MIGRATION = fs.readFileSync(path.join(PASTA, NOME), "utf8");
const SQL_ROLLBACK = fs.readFileSync(
  path.join(PASTA, `rollback-manual-${NOME}`),
  "utf8",
);
// A 20261208000000 reescreve a validate por cima da 203. As provas (a) a (d) rodam
// com ela no ar (a 203 segue valendo por baixo); as do rollback e da reaplicacao da
// 203 (e em diante) precisam do estado da 203, entao a 08 e desfeita ANTES, pelo
// rollback dela (que devolve o corpo da 203 byte a byte; provado na viva dela).
const NOME_08 = "20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql";
const SQL_ROLLBACK_08 = fs.readFileSync(
  path.join(PASTA, `rollback-manual-${NOME_08}`),
  "utf8",
);
const BASELINE = fs.readFileSync(
  path.join(PASTA, "20260806000000_baseline_do_schema_vivo.sql"),
  "utf8",
);

const MENSAGEM = "Os cupons estão desativados nesta loja.";
const OID_VALIDATE = "public.validate_coupon_secure_v2(text, numeric)";
const U_COMPRADOR = "99111111-1111-4111-8111-111111111111";

/** O corpo de validate_coupon_secure_v2 que o baseline deixou (o "vivo" de antes). */
function corpoDoBaseline() {
  const ini = BASELINE.indexOf(
    "CREATE FUNCTION public.validate_coupon_secure_v2(",
  );
  const apos = BASELINE.indexOf("AS $$", ini) + "AS $$".length;
  return BASELINE.slice(apos, BASELINE.indexOf("$$;", apos));
}

const sha256 = (s) =>
  crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

async function prosrcDe(c, oid) {
  const r = await c.query(
    "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
    [oid],
  );
  return r.rows[0]?.prosrc ?? null;
}

/** Roda uma consulta num savepoint: devolve {ok, r} ou {ok:false, e} sem abortar a transação. */
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

/**
 * Prepara um cenário NOVO (dentro da transação da prova): loja com a chave no
 * estado pedido, comprador, produto com estoque 50 e cupom fixo de R$ 10.
 * `chave`: true | false | null | "ausente" (sem a linha id=1 de store_config).
 */
async function cenario(c, chave) {
  const id = crypto.randomUUID();
  const produto = crypto.randomUUID();
  const codigo = `PROVA${id.slice(0, 8).toUpperCase()}`;
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [
    U_COMPRADOR,
  ]);
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'comprador@cupons203.teste', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_COMPRADOR],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Comprador 203', 'customer')
     ON CONFLICT (id) DO NOTHING`,
    [U_COMPRADOR],
  );
  if (chave === "ausente") {
    await c.query("DELETE FROM public.store_config WHERE id = 1");
  } else {
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
  }
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
     VALUES ($1, 'Produto 203', 100, 50, true, 40, false)`,
    [produto],
  );
  const cupom = (
    await c.query(
      `INSERT INTO public.coupons (code, type, value, active, usage_count)
       VALUES ($1, 'fixed', 10, true, 0) RETURNING id`,
      [codigo],
    )
  ).rows[0].id;
  return { produto, codigo, cupom };
}

/** Define a chave no meio do cenário (a lojista liga/desliga). */
async function virarChave(c, valor) {
  await c.query(
    "UPDATE public.store_config SET enable_coupons = $1 WHERE id = 1",
    [valor],
  );
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

async function medir(c, cen) {
  return (
    await c.query(
      `SELECT (SELECT estoque FROM public.produtos WHERE id = $1)::int AS estoque,
              (SELECT usage_count FROM public.coupons WHERE id = $2)::int AS usos,
              (SELECT count(*) FROM public.marketplace_orders WHERE user_id = $3)::int AS pedidos`,
      [cen.produto, cen.cupom, U_COMPRADOR],
    )
  ).rows[0];
}

const RPCS = ["create_marketplace_order_v24", "create_marketplace_order_v23"];

async function validar(c, codigo, subtotal = 100) {
  return (
    await c.query(
      "SELECT public.validate_coupon_secure_v2($1, $2::numeric) AS r",
      [codigo, subtotal],
    )
  ).rows[0].r;
}

/** (a) chave ligada/NULL/ausente: o cupom aplica como sempre. */
async function casosLigados(c, chave) {
  const rotulo = `chave=${chave}`;
  const cen = await cenario(c, chave);
  const v = await validar(c, cen.codigo);
  assert.equal(v.is_valid, true, `${rotulo}: validação tem de aceitar`);
  assert.equal(Number(v.discount_value), 10, `${rotulo}: desconto 10`);
  if (chave === "ausente") {
    // Sem a linha id=1 as RPCs recusam por OUTRO motivo (forma de pagamento
    // — `forma_de_pagamento_aceita` devolve false sem linha) e nunca chegam ao
    // INSERT: o que se prova aqui é o GATILHO, com INSERT direto.
    const direto = await tentar(
      c,
      `INSERT INTO public.marketplace_orders
         (user_id, customer_name, customer_data, total, subtotal, status, payment_method, coupon_id)
       VALUES ($1, 'Direto', '{}'::jsonb, 90, 100, 'pending', 'cash', $2) RETURNING id`,
      [U_COMPRADOR, cen.cupom],
    );
    assert.ok(
      direto.ok,
      `${rotulo}: linha ausente = ligado, o INSERT com cupom passa: ${direto.e?.message}`,
    );
    return;
  }
  for (const rpc of RPCS) {
    const antes = await medir(c, cen);
    const [sql, par] = chamar(rpc, cen, {
      cupom: cen.codigo,
      total: 90,
      chave: crypto.randomUUID(),
    });
    const r = await tentar(c, sql, par);
    assert.ok(
      r.ok,
      `${rotulo} ${rpc}: devia criar o pedido, recusou: ${r.e?.message}`,
    );
    const depois = await medir(c, cen);
    assert.equal(
      depois.pedidos,
      antes.pedidos + 1,
      `${rotulo} ${rpc}: 1 pedido`,
    );
    assert.equal(
      depois.usos,
      antes.usos + 1,
      `${rotulo} ${rpc}: +1 uso do cupom`,
    );
    assert.equal(
      depois.estoque,
      antes.estoque - 1,
      `${rotulo} ${rpc}: -1 de estoque`,
    );
    const ped = (
      await c.query(
        "SELECT discount::numeric AS d, coupon_id, total::numeric AS t FROM public.marketplace_orders WHERE id = $1",
        [r.r.rows[0].id],
      )
    ).rows[0];
    assert.equal(Number(ped.d), 10, `${rotulo} ${rpc}: desconto gravado`);
    assert.equal(ped.coupon_id, cen.cupom);
    assert.equal(Number(ped.t), 90);
  }
}

/** (b) chave desligada: validação e criação recusam; nada fica. */
async function casosDesligados(c) {
  const cen = await cenario(c, false);

  // Validação: formato jsonb de sempre, com o motivo; até para código inexistente.
  for (const codigo of [cen.codigo, cen.codigo.toLowerCase(), "NAOEXISTE"]) {
    const v = await validar(c, codigo);
    assert.equal(v.is_valid, false, `validação de ${codigo} tem de recusar`);
    assert.equal(Number(v.discount_value), 0);
    assert.equal(v.error_message, MENSAGEM);
    assert.deepEqual(Object.keys(v).sort(), [
      "discount_value",
      "error_message",
      "is_valid",
    ]);
  }

  for (const rpc of RPCS) {
    const chaveIdemp = crypto.randomUUID();
    const antes = await medir(c, cen);
    // COM chave de idempotência: o INSERT roda dentro do bloco com `WHEN
    // unique_violation`, que não pode engolir a recusa do gatilho.
    for (const chave of [chaveIdemp, null]) {
      const [sql, par] = chamar(rpc, cen, {
        cupom: cen.codigo,
        total: 90,
        chave,
      });
      const r = await tentar(c, sql, par);
      assert.ok(
        !r.ok,
        `${rpc} (chave ${chave ? "sim" : "não"}): devia recusar o cupom`,
      );
      assert.equal(r.e.code, "P0001", `${rpc}: ${r.e.message}`);
      assert.equal(r.e.message, MENSAGEM);
    }
    const depois = await medir(c, cen);
    assert.deepEqual(
      depois,
      antes,
      `${rpc}: a recusa não deixa pedido, uso nem baixa de estoque`,
    );
    const consumida = await c.query(
      "SELECT 1 FROM public.marketplace_orders WHERE idempotency_key = $1",
      [chaveIdemp],
    );
    assert.equal(
      consumida.rowCount,
      0,
      `${rpc}: a chave de idempotência não foi consumida`,
    );
  }

  // Porta única: INSERT direto com coupon_id também é recusado.
  const direto = await tentar(
    c,
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, payment_method, coupon_id)
     VALUES ($1, 'Direto', '{}'::jsonb, 90, 100, 'pending', 'cash', $2)`,
    [
      U_COMPRADOR,
      (
        await c.query("SELECT id FROM public.coupons WHERE code = $1", [
          cen.codigo,
        ])
      ).rows[0].id,
    ],
  );
  assert.ok(!direto.ok, "INSERT direto com coupon_id tinha de ser recusado");
  assert.equal(direto.e.code, "P0001");
  assert.equal(direto.e.message, MENSAGEM);
  return cen;
}

/** (c) pedido sem cupom nasce com a chave desligada. */
async function casosSemCupom(c) {
  const cen = await cenario(c, false);
  for (const rpc of RPCS) {
    for (const cupom of [null, ""]) {
      const antes = await medir(c, cen);
      const [sql, par] = chamar(rpc, cen, {
        cupom,
        total: 100,
        chave: crypto.randomUUID(),
      });
      const r = await tentar(c, sql, par);
      assert.ok(
        r.ok,
        `${rpc} sem cupom (${JSON.stringify(cupom)}): devia criar, recusou: ${r.e?.message}`,
      );
      const depois = await medir(c, cen);
      assert.equal(depois.pedidos, antes.pedidos + 1);
      assert.equal(depois.usos, antes.usos, "sem cupom não mexe em uso");
      assert.equal(depois.estoque, antes.estoque - 1);
    }
  }
}

/** (d) o retry de um pedido criado ANTES de desligar devolve o mesmo pedido. */
async function casoIdempotencia(c) {
  const cen = await cenario(c, true);
  for (const rpc of RPCS) {
    const chave = crypto.randomUUID();
    const [sql, par] = chamar(rpc, cen, {
      cupom: cen.codigo,
      total: 90,
      chave,
    });
    const a = await tentar(c, sql, par);
    assert.ok(a.ok, `${rpc}: 1ª chamada: ${a.e?.message}`);
    await virarChave(c, false);
    const antes = await medir(c, cen);
    const b = await tentar(c, sql, par);
    assert.ok(
      b.ok,
      `${rpc}: o retry com a chave desligada devolve o pedido, recusou: ${b.e?.message}`,
    );
    assert.equal(b.r.rows[0].id, a.r.rows[0].id, `${rpc}: o MESMO pedido`);
    assert.deepEqual(
      await medir(c, cen),
      antes,
      `${rpc}: o retry não cria nem gasta nada`,
    );
    await virarChave(c, true);
  }
  // E a chave não consumida: recusado desligado, religada a MESMA chamada nasce.
  await virarChave(c, false);
  const chave = crypto.randomUUID();
  const [sql, par] = chamar("create_marketplace_order_v24", cen, {
    cupom: cen.codigo,
    total: 90,
    chave,
  });
  const recusado = await tentar(c, sql, par);
  assert.ok(!recusado.ok && recusado.e.message === MENSAGEM);
  await virarChave(c, true);
  const nasce = await tentar(c, sql, par);
  assert.ok(nasce.ok, `religada, a mesma chamada nasce: ${nasce.e?.message}`);
}

/** (f) validação desligada — isolada para o mutante da validação. */
async function casoValidacaoDesligada(c) {
  const cen = await cenario(c, false);
  const v = await validar(c, cen.codigo);
  assert.equal(v.is_valid, false);
  assert.equal(v.error_message, MENSAGEM);
}

/** Espera que o `caso` FALHE (o mutante tem de ser pego). */
async function exigirVermelho(c, rotulo, caso) {
  await c.query("SAVEPOINT mutante");
  let vermelho = false;
  try {
    await caso();
  } catch (e) {
    vermelho = true;
    console.log(
      `    mutante "${rotulo}" MORTO: ${String(e.message).split("\n")[0].slice(0, 110)}`,
    );
  }
  await c.query("ROLLBACK TO SAVEPOINT mutante");
  await c.query("RELEASE SAVEPOINT mutante");
  assert.ok(vermelho, `mutante "${rotulo}" SOBREVIVEU — a prova não o pegou`);
}

async function numaTransacao(c, fn) {
  await c.query("BEGIN");
  try {
    await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

async function acls(c) {
  const fn = async (oid) =>
    (
      await c.query(
        "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
        [oid],
      )
    ).rows[0]?.a ?? null;
  const rel = async (nome) =>
    (
      await c.query(
        "SELECT relacl::text AS a FROM pg_class WHERE oid = $1::regclass",
        [nome],
      )
    ).rows[0].a;
  return {
    validate: await fn(OID_VALIDATE),
    v23: await fn(
      "public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)",
    ),
    v24: await fn(
      "public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)",
    ),
    pedidos: await rel("public.marketplace_orders"),
    loja: await rel("public.store_config"),
    cupons: await rel("public.coupons"),
  };
}

const PROVAS = [];

PROVAS.push({
  nome: "(0) a migration 203 está no ar: gatilho BEFORE INSERT ativo na tabela dos pedidos e validação com a checagem",
  corpo: async (c) => {
    const g = await c.query(
      `SELECT tgenabled, tgtype FROM pg_trigger
        WHERE tgrelid = 'public.marketplace_orders'::regclass
          AND tgname = 'tr_pedido_com_cupom_exige_a_chave_ligada'`,
    );
    assert.equal(g.rowCount, 1);
    assert.equal(g.rows[0].tgenabled, "O");
    assert.equal(g.rows[0].tgtype & 1, 1, "FOR EACH ROW");
    assert.equal(g.rows[0].tgtype & 2, 2, "BEFORE");
    assert.equal(g.rows[0].tgtype & 4, 4, "INSERT");
    assert.match(await prosrcDe(c, OID_VALIDATE), /enable_coupons IS FALSE/);
  },
});

PROVAS.push({
  nome: "(a) REGRESSÃO: chave LIGADA, NULL ou linha ausente — o cupom aplica como antes (validação, v24 e v23)",
  corpo: async (c) => {
    for (const chave of [true, null, "ausente"]) {
      await numaTransacao(c, () => casosLigados(c, chave));
    }
  },
});

PROVAS.push({
  nome: "(b) chave DESLIGADA: validação recusa com o motivo; v24 e v23 recusam (P0001, com e sem chave de idempotência) sem pedido, sem uso, sem baixa de estoque; INSERT direto também",
  corpo: async (c) => {
    await numaTransacao(c, () => casosDesligados(c));
  },
});

PROVAS.push({
  nome: "(c) pedido SEM cupom (NULL e '') continua nascendo com a chave desligada",
  corpo: async (c) => {
    await numaTransacao(c, () => casosSemCupom(c));
  },
});

PROVAS.push({
  nome: "(d) idempotência: o retry de um pedido com cupom criado ANTES de desligar devolve o mesmo pedido; recusa não consome a chave",
  corpo: async (c) => {
    await numaTransacao(c, () => casoIdempotencia(c));
  },
});

PROVAS.push({
  nome: "(d2) a 20261208000000, se estiver no ar, é desfeita pelo rollback dela e a validação volta ao corpo da 203 (base das provas seguintes)",
  corpo: async (c) => {
    const noAr = async () =>
      (
        await c.query(
          "SELECT to_regprocedure('public.cupons_do_checkout(numeric)') IS NOT NULL AS e",
        )
      ).rows[0].e;
    if (await noAr()) {
      await c.query(SQL_ROLLBACK_08);
      assert.equal(await noAr(), false, "o rollback da 08 tirou a função nova");
    }
    assert.ok(
      [
        "489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3",
        "4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279",
      ].includes(sha256(await prosrcDe(c, OID_VALIDATE))),
      "a validação voltou ao corpo da 20261203 (LF ou CRLF)",
    );
  },
});

PROVAS.push({
  nome: "(e) ACL idêntica antes/depois; rollback devolve o corpo do baseline byte a byte e tira o gatilho; reaplicar é idempotente; corpo divergente recusa; CRLF é aceito",
  corpo: async (c) => {
    await numaTransacao(c, async () => {
      const novo = await prosrcDe(c, OID_VALIDATE);
      const aclNovo = await acls(c);
      const baseline = corpoDoBaseline();

      // Reaplicar sobre o estado novo: idempotente, nada muda.
      await c.query(SQL_MIGRATION);
      await c.query(SQL_MIGRATION);
      assert.equal(await prosrcDe(c, OID_VALIDATE), novo);
      assert.deepEqual(await acls(c), aclNovo);

      // Rollback: corpo antigo BYTE A BYTE, gatilho e função do gatilho fora.
      await c.query(SQL_ROLLBACK);
      assert.equal(
        await prosrcDe(c, OID_VALIDATE),
        baseline,
        "rollback = corpo do baseline byte a byte",
      );
      assert.equal(sha256(await prosrcDe(c, OID_VALIDATE)), sha256(baseline));
      assert.equal(
        (
          await c.query(
            `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tr_pedido_com_cupom_exige_a_chave_ligada'`,
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await c.query(
            `SELECT to_regprocedure('public.pedido_com_cupom_exige_a_chave_ligada()') IS NULL AS some`,
          )
        ).rows[0].some,
        true,
      );
      assert.deepEqual(await acls(c), aclNovo, "o rollback não mexe em grant");
      // ... e a falha VOLTA: chave desligada + cupom válido = desconto entra.
      await c.query("SAVEPOINT volta");
      const cen = await cenario(c, false);
      const v = await validar(c, cen.codigo);
      assert.equal(
        v.is_valid,
        true,
        "sem a 203 a validação aceita o cupom com a chave desligada",
      );
      const [sql, par] = chamar("create_marketplace_order_v24", cen, {
        cupom: cen.codigo,
        total: 90,
        chave: null,
      });
      const r = await tentar(c, sql, par);
      assert.ok(
        r.ok,
        "sem a 203 o pedido com cupom nasce com a chave desligada (o defeito)",
      );
      await c.query("ROLLBACK TO SAVEPOINT volta");
      // Rollback repetido: idempotente.
      await c.query(SQL_ROLLBACK);

      // Reaplica: volta ao estado novo, mesmo corpo, mesma ACL.
      await c.query(SQL_MIGRATION);
      assert.equal(await prosrcDe(c, OID_VALIDATE), novo);
      assert.deepEqual(await acls(c), aclNovo);

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
        await prosrcDe(c, OID_VALIDATE),
        novo,
        "a divergência de prova não vazou",
      );

      // O corpo NOVO em CRLF (checkout do Windows) também é aceito.
      await c.query("SAVEPOINT crlf");
      await c.query(
        `CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
         RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $crlf$${novo.replace(/\n/g, "\r\n")}$crlf$`,
      );
      await c.query(SQL_MIGRATION);
      await c.query("ROLLBACK TO SAVEPOINT crlf");
    });
  },
});

PROVAS.push({
  nome: "(f) MUTANTES: sem o gatilho (b) fica vermelha; gatilho com IS NOT TRUE deixa NULL/ausente vermelhos; validação sem a checagem fica vermelha",
  corpo: async (c) => {
    await numaTransacao(c, async () => {
      // M1: gatilho removido.
      await exigirVermelho(c, "sem o gatilho", async () => {
        await c.query(
          "DROP TRIGGER tr_pedido_com_cupom_exige_a_chave_ligada ON public.marketplace_orders",
        );
        await casosDesligados(c);
      });

      // M2: IS NOT TRUE no gatilho — recusaria NULL e linha ausente.
      const trocarGatilho = (predicado) =>
        c.query(`CREATE OR REPLACE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada()
          RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $m$
          BEGIN
            IF NEW.coupon_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM public.store_config WHERE id = 1 AND ${predicado}) THEN
              RAISE EXCEPTION '${MENSAGEM}';
            END IF;
            RETURN NEW;
          END; $m$`);
      await exigirVermelho(c, "IS NOT TRUE (NULL)", async () => {
        await trocarGatilho("enable_coupons IS NOT TRUE");
        await casosLigados(c, null);
      });
      // Linha ausente: com `NOT EXISTS (... IS TRUE)` o gatilho recusaria sem linha.
      await exigirVermelho(c, "NOT COALESCE (linha ausente)", async () => {
        await c.query(`CREATE OR REPLACE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada()
          RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $m$
          BEGIN
            IF NEW.coupon_id IS NOT NULL
               AND NOT COALESCE((SELECT enable_coupons FROM public.store_config WHERE id = 1), false) THEN
              RAISE EXCEPTION '${MENSAGEM}';
            END IF;
            RETURN NEW;
          END; $m$`);
        await casosLigados(c, "ausente");
      });

      // M3: validação sem a checagem (o corpo do baseline).
      await exigirVermelho(c, "validação sem a checagem", async () => {
        await c.query(`CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
          RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
          AS $$${corpoDoBaseline()}$$`);
        await casoValidacaoDesligada(c);
      });

      // M4: curto-circuito SEM checar que o pedido existe (basta a chave vir
      // preenchida) — qualquer chave NOVA pularia a recusa: o pedido com cupom
      // nasceria com a chave desligada. A prova (b) usa chave nova.
      await exigirVermelho(
        c,
        "curto-circuito só por chave preenchida",
        async () => {
          await c.query(`CREATE OR REPLACE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada()
          RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $m$
          BEGIN
            IF NEW.coupon_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM public.store_config WHERE id = 1 AND enable_coupons IS FALSE) THEN
              IF NEW.idempotency_key IS NOT NULL THEN RETURN NEW; END IF;
              RAISE EXCEPTION '${MENSAGEM}';
            END IF;
            RETURN NEW;
          END; $m$`);
          await casosDesligados(c);
        },
      );

      // Controle dos controles: restaurado, tudo isso passa de novo.
      await c.query("SAVEPOINT controle");
      await casosDesligados(c);
      await casosLigados(c, true);
      await casoValidacaoDesligada(c);
      await c.query("ROLLBACK TO SAVEPOINT controle");
    });
  },
});

const U_OUTRO = "99222222-2222-4222-8222-222222222222";
const MSG_CHAVE_SEM_DONO =
  "Não foi possível criar o pedido. Atualize a página e tente de novo.";

/**
 * Chave de compra de OUTRO cliente + chave de cupons desligada = nenhum pedido
 * nasce. O índice único é só pela chave (global): o INSERT colide, e o
 * tratamento de unique_violation da v23/v24 só devolve pedido do próprio dono.
 */
async function casoChaveDeOutroCliente(c) {
  const cen = await cenario(c, true);
  const K = crypto.randomUUID();
  const [sqlA, parA] = chamar("create_marketplace_order_v24", cen, {
    cupom: cen.codigo,
    total: 90,
    chave: K,
  });
  const a = await tentar(c, sqlA, parA);
  assert.ok(a.ok, `pedido do dono com a chave ligada: ${a.e?.message}`);
  await virarChave(c, false);

  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'outro@cupons203.teste', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_OUTRO],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Outro 203', 'customer')
     ON CONFLICT (id) DO NOTHING`,
    [U_OUTRO],
  );
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [U_OUTRO]);
  const antes = await medir(c, cen);
  for (const rpc of RPCS) {
    const [sql, par] = chamar(rpc, cen, {
      cupom: cen.codigo,
      total: 90,
      chave: K,
    });
    const r = await tentar(c, sql, par);
    assert.ok(!r.ok, `${rpc}: a chave de outro cliente não pode criar pedido`);
    assert.equal(r.e.code, "P0001");
    assert.equal(r.e.message, MSG_CHAVE_SEM_DONO, `${rpc}: ${r.e.message}`);
  }
  // INSERT direto com a chave de outro cliente: o índice único recusa.
  const direto = await tentar(
    c,
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, payment_method, coupon_id, idempotency_key)
     VALUES ($1, 'Direto', '{}'::jsonb, 90, 100, 'pending', 'cash', $2, $3)`,
    [U_OUTRO, cen.cupom, K],
  );
  assert.ok(!direto.ok, "INSERT direto com a chave de outro cliente nasceu");
  assert.equal(direto.e.code, "23505");
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [
    U_COMPRADOR,
  ]);
  const dono = await c.query(
    "SELECT user_id FROM public.marketplace_orders WHERE idempotency_key = $1",
    [K],
  );
  assert.equal(dono.rowCount, 1, "continua 1 pedido só com a chave");
  assert.equal(dono.rows[0].user_id, U_COMPRADOR);
  const depois = await medir(c, cen);
  assert.deepEqual(depois, antes, "nada mudou: pedido, uso do cupom, estoque");
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

/**
 * A CORRIDA da revisão Opus, com duas conexões reais e COMMIT de verdade:
 * A cria o pedido com cupom e chave K e ainda não commitou; a lojista desliga
 * a chave; B (retentativa gêmea, mesma K) espera a trava do cupom; A commita.
 * Devolve o que B recebeu e o que ficou no banco.
 */
async function corridaGemea(url) {
  const s = new Client({ connectionString: url });
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await s.connect();
  await a.connect();
  await b.connect();
  try {
    const cen = await cenario(s, true);
    const K = crypto.randomUUID();
    const [sql, par] = chamar("create_marketplace_order_v24", cen, {
      cupom: cen.codigo,
      total: 90,
      chave: K,
    });
    for (const x of [a, b]) {
      await x.query("SELECT set_config('app.rpc.user_id', $1, false)", [
        U_COMPRADOR,
      ]);
    }
    await a.query("BEGIN");
    const ra = await a.query(sql, par);
    await virarChave(s, false);
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
    return { idA: ra.rows[0].id, rb, n, usos: m.usos, estoque: m.estoque };
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
  nome: "(g) chave de compra de OUTRO cliente com a chave de cupons desligada: nenhum pedido nasce (o índice é global e a v23/v24 só devolve ao dono); sem chave (NULL) e chave nova a recusa vale",
  corpo: async (c) => {
    await numaTransacao(c, async () => {
      await casoChaveDeOutroCliente(c);
      // NULL e chave nova continuam recusados (já em (b); aqui explícito).
      await casosDesligados(c);
    });
  },
});

PROVAS.push({
  nome: "(h) CORRIDA com 2 conexões: A cria o pedido com cupom, a lojista desliga, a retentativa gêmea B (mesma chave) devolve o pedido de A — 1 pedido só",
  corpo: async (_c, url) => {
    await exigirCorridaCerta(url);
  },
});

PROVAS.push({
  nome: "(i) MUTANTES da corrida: sem o curto-circuito (h) fica vermelha (B é recusada e o cliente giraria a chave); depois de restaurar, passa de novo",
  corpo: async (c, url) => {
    // DDL COMMITADA (a corrida usa 3 conexões); o `finally` reaplica a migration.
    try {
      await c.query(`CREATE OR REPLACE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada()
        RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $m$
        BEGIN
          IF NEW.coupon_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.store_config WHERE id = 1 AND enable_coupons IS FALSE) THEN
            RAISE EXCEPTION '${MENSAGEM}';
          END IF;
          RETURN NEW;
        END; $m$`);
      const r = await corridaGemea(url);
      assert.ok(
        !r.rb.ok && r.rb.message === MENSAGEM,
        `sem o curto-circuito B tinha de ser recusada com a frase dos cupons: ${JSON.stringify(r.rb)}`,
      );
      console.log(
        `    mutante "sem o curto-circuito" MORTO: B recusada (${r.rb.code}: ${r.rb.message}); pedidos com a chave: ${r.n}`,
      );
    } finally {
      await c.query(SQL_MIGRATION);
    }
    await exigirCorridaCerta(url);
  },
});

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
        anexarAoSummary(
          "Prova viva dos cupons desligados (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "A regra 'cupons desligados não dão desconto' foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[cupons-203] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva dos cupons desligados (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
