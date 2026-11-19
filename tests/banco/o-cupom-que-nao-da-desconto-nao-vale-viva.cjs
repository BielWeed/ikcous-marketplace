"use strict";

// Prova viva em clone efêmero. Tirar a guarda do desconto zero faz a primeira
// expectativa falhar: a RPC volta a responder válido para 1% de R$ 0,49.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const CLIENTE = "7e7e4058-2000-4000-8000-000000000001";
const OUTRA = "7e7e4058-2000-4000-8000-000000000002";
const PREFIXO = "PROVA4058-";
const HASH_ANTES = "61b90bb7f7c9729abeb94b5596914eb4";
const SEM_DESCONTO = "Este cupom não dá desconto em uma compra deste valor.";

async function semear(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
       ($1, 'cliente@cupom4058.teste', '{}'::jsonb),
       ($2, 'outra@cupom4058.teste', '{}'::jsonb)
     `,
    [CLIENTE, OUTRA],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente Prova', 'customer'), ($2, 'Outra Prova', 'customer')
     ON CONFLICT (id) DO NOTHING`,
    [CLIENTE, OUTRA],
  );
  await c.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true)
     ON CONFLICT (id) DO UPDATE SET enable_coupons = true`,
  );
  await c.query(
    `INSERT INTO public.coupons
       (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active, alcance)
     VALUES
       ($1 || 'UM', 'percentage', 1, 0, 1, 0, NULL, true, 'codigo'),
       ($1 || 'FIXO', 'fixed', 0, 0, 1, 0, NULL, true, 'codigo'),
       ($1 || 'FIXOPOSITIVO', 'fixed', 1, 0, 1, 0, NULL, true, 'codigo'),
       ($1 || 'DEZ', 'percentage', 10, 0, 1, 0, NULL, true, 'codigo'),
       ($1 || 'EXCLUSIVO', 'percentage', 1, 1, 1, 1, now() - interval '1 day', true, 'exclusivo'),
       ($1 || 'EXPIRADO', 'percentage', 1, 1, 1, 1, now() - interval '1 day', true, 'codigo'),
       ($1 || 'LIMITE', 'percentage', 1, 1, 1, 1, NULL, true, 'codigo'),
       ($1 || 'MINIMO', 'percentage', 1, 1, 1, 0, NULL, true, 'codigo')`,
    [PREFIXO],
  );
  await c.query(
    `INSERT INTO public.cupom_clientes (coupon_id, user_id)
     SELECT id, $2 FROM public.coupons WHERE code = $1`,
    [`${PREFIXO}EXCLUSIVO`, OUTRA],
  );
}

async function conferir(c, codigo, subtotal, valido, desconto, motivo = "") {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [CLIENTE]);
  await c.query("SET LOCAL ROLE authenticated");
  const { rows } = await c.query(
    "SELECT public.validate_coupon_secure_v2($1, $2) AS resposta",
    [PREFIXO + codigo, subtotal],
  );
  await c.query("RESET ROLE");
  assert.deepEqual(
    rows[0].resposta,
    { is_valid: valido, discount_value: desconto, error_message: motivo },
    `${codigo} em R$ ${subtotal}`,
  );
}

async function conferirComportamento(c) {
  await conferir(c, "UM", "0.49", false, 0, SEM_DESCONTO);
  await conferir(c, "UM", "0.50", true, 0.01);
  await conferir(c, "FIXO", "0.49", false, 0, SEM_DESCONTO);
  // O valor fixo é positivo antes do teto; é o subtotal zero que zera o desconto.
  await conferir(c, "FIXOPOSITIVO", "0.00", false, 0, SEM_DESCONTO);
  await conferir(c, "DEZ", "29.95", true, 3);
  await conferir(
    c,
    "EXCLUSIVO",
    "0.49",
    false,
    0,
    "Cupom inválido ou expirado.",
  );
  await conferir(c, "EXPIRADO", "0.49", false, 0, "Este cupom expirou.");
  await conferir(
    c,
    "LIMITE",
    "0.49",
    false,
    0,
    "Cupom atingiu o limite de uso.",
  );
  await conferir(
    c,
    "MINIMO",
    "0.49",
    false,
    0,
    "Faltam R$ 0,51 em produtos para usar este cupom (mínimo de R$ 1,00).",
  );
  await c.query(
    "UPDATE public.store_config SET enable_coupons = false WHERE id = 1",
  );
  await conferir(
    c,
    "EXCLUSIVO",
    "0.49",
    false,
    0,
    "Os cupons estão desativados nesta loja.",
  );
  await c.query(
    "UPDATE public.store_config SET enable_coupons = true WHERE id = 1",
  );
}

const HASH_NOVO = "98ccd81ae2e6440dd0c5378910736d0b";
const NOME = "20261405800000_o_cupom_que_nao_da_desconto_nao_vale.sql";
const ler = (nome) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Chamadores fornecem apenas nomes literais de arquivos versionados.
  readFileSync(
    path.join(__dirname, "../../supabase/migrations", nome),
    "utf8",
  ).replace(/\r/g, "");

async function retrato(c) {
  const { rows } = await c.query(
    `SELECT md5(replace(p.prosrc, chr(13), '')) AS hash,
            to_jsonb(p) - 'prosrc' AS atributos, p.prosrc AS corpo
       FROM pg_proc p WHERE p.oid = 'public.validate_coupon_secure_v2(text,numeric)'::regprocedure`,
  );
  return rows[0];
}

async function recusaSemMudar(c, sql) {
  const antes = await retrato(c);
  await c.query("SAVEPOINT recusa");
  try {
    await assert.rejects(c.query(sql), /B1_BASELINE_DIVERGENT/);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa");
    await c.query("RELEASE SAVEPOINT recusa");
  }
  assert.deepEqual(await retrato(c), antes);
}

async function provarIdaEVolta(c) {
  const mig = ler(NOME);
  const rb = ler(`rollback-manual-${NOME}`);
  const base = ler(
    "20261397000000_o_desconto_do_cupom_e_arredondado_ao_centavo.sql",
  );
  const definicao = base.match(
    /^CREATE OR REPLACE FUNCTION public\.validate_coupon_secure_v2\([\s\S]*?^\$\$;/m,
  )?.[0];
  assert.ok(definicao);
  const esperado = definicao.slice(definicao.indexOf("AS $$") + 5, -3);
  const novo = await retrato(c);
  assert.equal(novo.hash, HASH_NOVO);
  await c.query(mig);
  assert.deepEqual(
    await retrato(c),
    novo,
    "reaplicar preserva corpo, atributos e ACL",
  );
  await c.query(rb);
  const anterior = await retrato(c);
  assert.equal(anterior.hash, HASH_ANTES);
  assert.equal(anterior.corpo, esperado, "rollback byte a byte");
  assert.deepEqual(anterior.atributos, novo.atributos);
  await conferir(c, "UM", "0.49", true, 0);
  await recusaSemMudar(c, rb);

  await c.query(mig);
  assert.deepEqual(
    await retrato(c),
    novo,
    "migração por cima da base restaurada",
  );
  await conferir(c, "UM", "0.49", false, 0, SEM_DESCONTO);
  await c.query(
    definicao.replace(
      "AS $$",
      () => "AS $$\n-- Corpo diferente, apenas na prova.",
    ),
  );
  await recusaSemMudar(c, rb);
  await recusaSemMudar(c, mig);
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await semear(c);
    await conferirComportamento(c);
    await provarIdaEVolta(c);
    console.log(
      "OK: desconto zero recusado; centavos, precedência, controle anterior e rollback conferidos.",
    );
  } finally {
    try {
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
