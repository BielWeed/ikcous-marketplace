// @ts-nocheck
// OS CUPONS DESLIGADOS NAO DAO DESCONTO — prova offline do par
// 20261203000000 + rollback (dinheiro, issue #645, 08/10/2026). A prova VIVA
// (gatilho, validação, v23/v24, mutantes, ACL, rollback aplicado) mora em
// tests/banco/cupons-desligados-viva.cjs; aqui fica o que se prova só lendo o
// texto, e que o CI sem banco também cobra.
//
// Cada asserção está amarrada a um risco: migration com BEGIN/COMMIT grava
// metade em produção; hash do preflight que não é o sha256 real do corpo
// recusa a migration num banco CORRETO (ou aceita um corpo errado); rollback
// que não bate byte a byte com o baseline deixa o defeito preso depois de
// "revertido"; corpo novo que difere do vivo em mais do que o bloco prometido
// ressuscita ou apaga regra de dinheiro sem ninguém ter pedido; `IS NOT TRUE`
// no lugar de `IS FALSE` recusa cupom em loja com a chave NULL/sem linha; e
// uma redefinição de create_marketplace_order_v23/v24 aqui quebraria o
// preflight por hash de outras migrations (20261174, 20261182).
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const PASTA = `${DIR}../supabase/migrations`;
const NOME = "20261203000000_cupons_desligados_nao_dao_desconto.sql";

const ler = (n) =>
  Deno.readTextFileSync(`${PASTA}/${n}`).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const baseline = ler("20260806000000_baseline_do_schema_vivo.sql");

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const crlf = (s) => s.replace(/\n/g, "\r\n");
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

// O corpo de validate_coupon_secure_v2 entre `AS $$` e `$$;`.
function corpoDe(texto, aPartirDe) {
  const ini = texto.indexOf(aPartirDe);
  assert(ini >= 0, `não achei ${aPartirDe}`);
  const apos = texto.indexOf("AS $$", ini) + "AS $$".length;
  return texto.slice(apos, texto.indexOf("$$;", apos));
}
const corpoBaseline = corpoDe(
  baseline,
  "CREATE FUNCTION public.validate_coupon_secure_v2(",
);
const corpoNovo = corpoDe(
  migration,
  "CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(",
);
const corpoDoRollback = corpoDe(
  rollback,
  "CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(",
);

Deno.test("203: sem BEGIN/COMMIT de nível superior (migration e rollback)", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("203: o rollback devolve o corpo do baseline BYTE A BYTE", () => {
  assertEquals(corpoDoRollback, corpoBaseline);
});

Deno.test("203: o corpo novo é o do baseline + SÓ o bloco da chave desligada", () => {
  const bloco = corpoNovo.indexOf("    -- CUPONS DESLIGADOS");
  const fim = corpoNovo.indexOf("    -- Fix: Standardize");
  assert(bloco > 0 && fim > bloco);
  assertEquals(corpoNovo.slice(0, bloco) + corpoNovo.slice(fim), corpoBaseline);
});

Deno.test("203: os hashes do preflight/pós-voo são o sha256 real dos corpos (LF e CRLF)", () => {
  for (const [rotulo, texto] of [
    ["antigo LF", corpoBaseline],
    ["antigo CRLF", crlf(corpoBaseline)],
    ["novo LF", corpoNovo],
    ["novo CRLF", crlf(corpoNovo)],
  ]) {
    const h = sha256(texto);
    assertStringIncludes(migration, `'${h}'`, `migration sem o hash ${rotulo}`);
    assertStringIncludes(rollback, `'${h}'`, `rollback sem o hash ${rotulo}`);
  }
});

Deno.test("203: só IS FALSE recusa — nunca IS NOT TRUE nem NOT COALESCE(..., false)", () => {
  for (const [rotulo, texto] of [
    ["migration", semComentarios(migration)],
    ["corpo novo", semComentarios(corpoNovo)],
  ]) {
    assert(!/IS NOT TRUE/i.test(texto), `${rotulo}: IS NOT TRUE`);
    assert(!/NOT\s+COALESCE/i.test(texto), `${rotulo}: NOT COALESCE`);
    assert(/enable_coupons IS FALSE/.test(texto), `${rotulo}: sem IS FALSE`);
  }
});

Deno.test("203: a recusa é a frase que o front reconhece, no formato jsonb de sempre", () => {
  assertStringIncludes(corpoNovo, "'Os cupons estão desativados nesta loja.'");
  assertStringIncludes(corpoNovo, "'is_valid', FALSE");
  assertStringIncludes(corpoNovo, "'discount_value', 0");
  assertStringIncludes(corpoNovo, "'error_message'");
  assertStringIncludes(
    semComentarios(migration),
    "RAISE EXCEPTION 'Os cupons estão desativados nesta loja.';",
  );
});

Deno.test("203: o gatilho é BEFORE INSERT só com cupom, DEFINER com search_path fixo, sem EXECUTE para o público", () => {
  const m = semComentarios(migration);
  assert(
    /CREATE OR REPLACE TRIGGER tr_pedido_com_cupom_exige_a_chave_ligada\s+BEFORE INSERT ON public\.marketplace_orders\s+FOR EACH ROW\s+WHEN \(NEW\.coupon_id IS NOT NULL\)/.test(
      m,
    ),
  );
  assertStringIncludes(m, "SECURITY DEFINER\nSET search_path = public");
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.pedido_com_cupom_exige_a_chave_ligada() FROM PUBLIC, anon, authenticated;",
  );
});

Deno.test("203: aditiva e sem tocar create_marketplace_order_v23/v24 nem grants", () => {
  const m = semComentarios(migration);
  assert(!/create_marketplace_order_v2[34]/.test(m), "redefine v23/v24");
  assert(
    !/\bDROP\s+(TABLE|COLUMN|TRIGGER|FUNCTION|VIEW|INDEX|POLICY|SCHEMA)\b/i.test(
      m,
    ),
    "migration tem DROP",
  );
  assert(!/\bGRANT\b/i.test(m), "migration mexe em GRANT");
  assert(
    !/\bUPDATE\b|\bDELETE\b|\bINSERT\s+INTO\b/i.test(m),
    "migration escreve dado",
  );
  const r = semComentarios(rollback);
  assert(!/\bGRANT\b|\bREVOKE\b/i.test(r), "rollback mexe em grant");
});
