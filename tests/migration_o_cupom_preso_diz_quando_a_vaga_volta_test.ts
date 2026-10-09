// @ts-nocheck
// O CUPOM PRESO DIZ QUANDO A VAGA VOLTA — prova offline do par 20261205000000 +
// rollback (cupom + dado de cliente, 09/10/2026). A prova VIVA (tabela de casos
// com pedidos pelos caminhos reais, só o dono, mesma resposta byte a byte,
// pré-voo/pós-voo/rollback aplicados, mutantes) mora em
// tests/banco/cupom-preso-viva.cjs; aqui fica o que se prova só lendo o texto, e
// que o CI sem banco também cobra.
//
// Cada asserção está amarrada a um risco: migration com BEGIN/COMMIT grava metade
// em produção; hash do pré-voo/pós-voo/rollback que não é o real do corpo recusa a
// migration num banco CORRETO (ou aceita um corpo errado); hash da varredura que
// não é o do corpo da 20260970 deixa o auxiliar espelhar o que não existe; GRANT
// para anon/PUBLIC/service_role abre a RPC (ou o auxiliar) a quem não devia; RPC que
// responde diferente para "não existe" e "não é seu" vira sonda de código de cupom;
// subtrair antes do GREATEST quebra com '-infinity' no PG17 (e difere no PG15);
// escrita fora das funções faz a migration mexer em dado ao aplicar.
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
const NOME = "20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql";
const NOME_970 = "20260970000000_cancelamento_respeita_o_envio.sql";
const NOME_203 = "20261203000000_cupons_desligados_nao_dao_desconto.sql";

const ler = (n) =>
  Deno.readTextFileSync(`${PASTA}/${n}`).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const crlf = (s) => s.replace(/\n/g, "\r\n");
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

// O corpo de uma função dentro de uma migration, entre `AS $tag$` e `$tag$`.
function corpoDe(texto, cabecalho, tag) {
  const ini = texto.indexOf(cabecalho);
  assert(ini >= 0, `nao achei ${cabecalho}`);
  const abre = texto.indexOf(`AS ${tag}`, ini) + `AS ${tag}`.length;
  const fecha = texto.indexOf(`${tag};`, abre);
  return texto.slice(abre, fecha);
}

const CAB_AUX = "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(";
const CAB_RPC = "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(";
const corpoAux = corpoDe(migration, CAB_AUX, "$function$");
const corpoRpc = corpoDe(migration, CAB_RPC, "$function$");
const corpoVarredura = corpoDe(
  ler(NOME_970),
  "CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()",
  "$devolver_cupons_mortos$",
);

const HASHES = {
  aux: [sha256(corpoAux), sha256(crlf(corpoAux))],
  rpc: [sha256(corpoRpc), sha256(crlf(corpoRpc))],
  varredura: [sha256(corpoVarredura), sha256(crlf(corpoVarredura))],
};

const literais64 = (texto) =>
  [...texto.matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]);
const ini = (marca) => migration.indexOf(marca);

const iniAux = migration.indexOf(CAB_AUX);
const iniRpc = migration.indexOf(CAB_RPC);
const fimRpc =
  migration.indexOf("$function$;", migration.indexOf("AS $function$", iniRpc)) +
  "$function$;".length;
const foraDosCorpos = (() => {
  // tira só os dois corpos (entre AS $function$ e $function$;)
  let t = migration;
  for (const c of [corpoAux, corpoRpc]) t = t.replace(c, "");
  return t;
})();

Deno.test("205: sem BEGIN/COMMIT de nivel superior (migration e rollback)", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("205: os hashes do pre-voo e do pos-voo sao o sha256 real dos corpos (LF e CRLF) e da varredura da 20260970", () => {
  const pre = migration.slice(
    ini("DO $preflight_20261205$"),
    ini("$preflight_20261205$;"),
  );
  const pos = migration.slice(
    ini("DO $posvoo_20261205$"),
    ini("$posvoo_20261205$;"),
  );
  // pre-voo: varredura (2) + auxiliar (2) + RPC (2), nessa ordem
  assertEquals(literais64(semComentarios(pre)), [
    ...HASHES.varredura,
    ...HASHES.aux,
    ...HASHES.rpc,
  ]);
  // pos-voo: auxiliar, RPC, varredura
  assertEquals(literais64(semComentarios(pos)), [
    ...HASHES.aux,
    ...HASHES.rpc,
    ...HASHES.varredura,
  ]);
});

Deno.test("205: os hashes do rollback sao os mesmos (auxiliar, RPC, varredura 20260970) e so eles", () => {
  assertEquals(literais64(semComentarios(rollback)), [
    ...HASHES.aux,
    ...HASHES.rpc,
    ...HASHES.varredura,
  ]);
});

Deno.test("205: o hash da varredura e o do corpo VIVO — a ULTIMA migration que a define e a 20260970", () => {
  const arquivos = [...Deno.readDirSync(PASTA)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("rollback-"))
    .filter((n) => n < NOME)
    .sort();
  const definem = arquivos.filter((n) =>
    ler(n).includes(
      "CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()",
    ),
  );
  assertEquals(definem.at(-1), NOME_970);
});

Deno.test("205: so cria as duas funcoes novas — nenhuma funcao existente e redefinida", () => {
  const criadas = [
    ...semComentarios(migration).matchAll(
      /CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)\(/g,
    ),
  ].map((m) => m[1]);
  assertEquals(criadas, [
    "public.cupom__vaga_volta_em",
    "public.vaga_do_cupom_presa",
  ]);
  // nem a validacao nem o criar-pedido nem a devolucao aparecem fora de comentario
  const codigo = semComentarios(migration);
  for (const nome of [
    "validate_coupon_secure_v2",
    "create_marketplace_order_v2",
    "devolver_uso_cupom(",
  ]) {
    // o unico uso permitido e' a checagem do pre-voo, nunca CREATE/REPLACE
    assert(!codigo.toLowerCase().includes(`function public.${nome}`), nome);
  }
});

Deno.test("205: o auxiliar e SQL STABLE com search_path fixo, parametros simples, sem EXECUTE para ninguem", () => {
  const cab = migration.slice(
    iniAux,
    migration.indexOf("AS $function$", iniAux),
  );
  assert(
    /RETURNS timestamptz\n LANGUAGE sql\n STABLE\n SET search_path = public\n$/.test(
      cab.slice(cab.indexOf(" RETURNS")),
    ),
  );
  // parametros simples: nenhum recebe a linha da tabela
  assert(
    !/marketplace_orders/.test(cab),
    "o auxiliar recebe a linha da tabela",
  );
  assertEquals(
    [
      ...cab.matchAll(/^\s+(p_\w+) (uuid|text|boolean|timestamptz|integer)/gm),
    ].map((m) => m[2]),
    [
      "uuid",
      "text",
      "text",
      "boolean",
      "timestamptz",
      "boolean",
      "timestamptz",
      "text",
      "integer",
    ],
  );
  const m = semComentarios(foraDosCorpos);
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(!/GRANT[^;]*cupom__vaga_volta_em/.test(m), "GRANT no auxiliar");
  // a assinatura da migration 1206 nao pode mudar: os 9 parametros declaram gateway e tentativas
  assertStringIncludes(cab, "p_gateway_payment_id text");
  assertStringIncludes(cab, "p_tentativas integer");
});

Deno.test("205: o auxiliar espelha o WHERE da varredura 20260970 (mesmas condicoes, mesma espera de 24 h)", () => {
  const v = semComentarios(corpoVarredura);
  const a = semComentarios(corpoAux);
  for (const [varredura, auxiliar] of [
    ["coupon_id IS NOT NULL", "p_coupon_id IS NULL"],
    ["status = 'cancelled'", "p_status IS DISTINCT FROM 'cancelled'"],
    [
      "payment_status IS DISTINCT FROM 'pago'\n",
      "('pago', 'pago_apos_expirar')",
    ],
    [
      "payment_status IS DISTINCT FROM 'pago_apos_expirar'",
      "('pago', 'pago_apos_expirar')",
    ],
    [
      "coupon_usage_returned = FALSE",
      "p_coupon_usage_returned IS DISTINCT FROM false",
    ],
    [
      "(cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL)",
      "(p_cancelled_after_shipping = false OR p_returned_to_seller_at IS NOT NULL) IS NOT TRUE",
    ],
    [
      "expires_at IS NULL OR expires_at < now() - interval '24 hours'",
      "ELSE p_expires_at + interval '24 hours'",
    ],
  ]) {
    assertStringIncludes(v, varredura);
    assertStringIncludes(a, auxiliar);
  }
});

Deno.test("205: a RPC e SECURITY DEFINER com search_path fixo, EXECUTE so do authenticated, REVOKE nomeando PUBLIC e anon", () => {
  const cab = migration.slice(
    iniRpc,
    migration.indexOf("AS $function$", iniRpc),
  );
  assert(
    /RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path = public\n$/.test(
      cab.slice(cab.indexOf(" RETURNS")),
    ),
  );
  const m = semComentarios(foraDosCorpos);
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.vaga_do_cupom_presa(text) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    m,
    "GRANT EXECUTE ON FUNCTION public.vaga_do_cupom_presa(text) TO authenticated;",
  );
  const grants = [...m.matchAll(/\bGRANT\b[^;]*;/g)].map((x) => x[0]);
  assertEquals(grants.length, 1);
  assert(!/\b(anon|PUBLIC|service_role)\b/.test(grants[0]));
  assert(
    m.indexOf("REVOKE ALL ON FUNCTION public.vaga_do_cupom_presa") <
      m.indexOf("GRANT EXECUTE ON FUNCTION"),
  );
});

Deno.test("205: a RPC nao vira sonda — dono e auth.uid() da sessao, nenhum RAISE, so le, mesmo UPPER da validacao", () => {
  const c = semComentarios(corpoRpc);
  assertStringIncludes(c, "o.user_id = (SELECT auth.uid())");
  assert(
    !/RAISE/i.test(c),
    "a RPC responde igual para tudo: nenhum RAISE com texto proprio",
  );
  assert(
    !/\b(INSERT|UPDATE|DELETE)\b/i.test(c.replace(/\bFOR UPDATE\b/g, "")),
    "a RPC escreve",
  );
  assert(
    !/p_user|p_usuario|p_owner/i.test(c),
    "o dono nao pode vir por parametro",
  );
  // o MESMO casamento de codigo da validacao do checkout (20261203): UPPER nos dois lados, so cupom ativo
  assertStringIncludes(
    ler(NOME_203),
    "WHERE UPPER(code) = UPPER(p_code) AND active = true",
  );
  assertStringIncludes(c, "UPPER(c.code) = UPPER(p_code) AND c.active = true");
  // as duas respostas tem as mesmas chaves
  assertStringIncludes(
    c,
    "jsonb_build_object('presa', false, 'volta_em_minutos', NULL)",
  );
  assertStringIncludes(
    c,
    "jsonb_build_object('presa', true, 'volta_em_minutos', v_minutos)",
  );
});

Deno.test("205: a RPC aplica GREATEST ANTES de subtrair, arredonda para cima e soma os 15 min do ciclo", () => {
  const c = semComentarios(corpoRpc);
  assert(c.indexOf("GREATEST(v_volta, now())") > 0);
  assert(c.indexOf("GREATEST(v_volta, now())") < c.indexOf("v_volta - now()"));
  assertStringIncludes(
    c,
    "ceil(extract(epoch FROM (v_volta - now())) / 60.0)::integer + 15",
  );
  // nenhuma subtracao com a hora antes do GREATEST
  assertEquals(c.split("v_volta - now()").length - 1, 1);
});

Deno.test("205: aditiva — fora dos corpos a migration nao escreve dado, nao apaga nada e nao mexe em tabela", () => {
  const m = semComentarios(foraDosCorpos);
  assert(
    !/\bDROP\s+(TABLE|COLUMN|TRIGGER|FUNCTION|VIEW|INDEX|POLICY|SCHEMA)\b/i.test(
      m,
    ),
    "migration tem DROP",
  );
  assert(
    !/\bALTER\s+(TABLE|POLICY|FUNCTION)\b/i.test(m),
    "migration altera tabela/politica/funcao",
  );
  assert(!/\bDELETE\b|\bTRUNCATE\b/i.test(m), "migration apaga dado");
  assert(
    !/\bINSERT\s+INTO\b|\bUPDATE\s+public\b/i.test(m),
    "migration escreve dado",
  );
  // pre-voo antes de criar, pos-voo depois de criar
  assert(ini("$preflight_20261205$") < iniAux);
  assert(fimRpc < ini("DO $posvoo_20261205$"));
});

Deno.test("205: o rollback so derruba as duas funcoes (RPC antes do auxiliar), com as 3 guardas antes do DROP, sem CASCADE", () => {
  const r = semComentarios(rollback);
  const drops = [...r.matchAll(/\bDROP\b[^;]*;/gi)].map((m) => m[0]);
  assertEquals(drops, [
    "DROP FUNCTION IF EXISTS public.vaga_do_cupom_presa(text);",
    "DROP FUNCTION IF EXISTS public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer);",
  ]);
  assert(!/CASCADE/i.test(r), "rollback com CASCADE");
  assert(!/\bGRANT\b|\bREVOKE\b|\bUPDATE\b|\bDELETE\b|\bINSERT\b/i.test(r));
  assertEquals([...r.matchAll(/RAISE EXCEPTION/g)].length, 3);
  assert(r.lastIndexOf("RAISE EXCEPTION") < r.indexOf("DROP FUNCTION"));
  // a recusa por varredura diferente cita a 1206 (quem depende do auxiliar)
  assertStringIncludes(
    r,
    "a varredura devolver_cupons_de_pedidos_mortos (hash %) nao e a da 20260970000000",
  );
});

Deno.test("205: as mensagens do pre-voo nomeiam o que falta (as provas vivas e os mutantes dependem delas)", () => {
  const pre = migration.slice(
    ini("DO $preflight_20261205$"),
    ini("$preflight_20261205$;"),
  );
  for (const frase of [
    "PREFLIGHT_20261205: esperava exatamente uma versao de devolver_cupons_de_pedidos_mortos()",
    "PREFLIGHT_20261205: corpo vivo de devolver_cupons_de_pedidos_mortos()",
    "PREFLIGHT_20261205: falta a funcao %",
    "PREFLIGHT_20261205: falta a tabela %",
    "PREFLIGHT_20261205: falta a coluna public.%.%",
    "PREFLIGHT_20261205: public.cupom__vaga_volta_em ja existe com outro corpo",
    "PREFLIGHT_20261205: public.vaga_do_cupom_presa ja existe com outro corpo",
  ]) {
    assertEquals(pre.split(`RAISE EXCEPTION '${frase}`).length - 1, 1, frase);
  }
  // as colunas que o auxiliar e a RPC leem estao todas no pre-voo
  for (const col of [
    "coupon_id",
    "status",
    "payment_status",
    "coupon_usage_returned",
    "expires_at",
    "cancelled_after_shipping",
    "returned_to_seller_at",
    "gateway_payment_id",
    "tentativas_de_pagamento",
    "user_id",
  ]) {
    assertStringIncludes(pre, `('marketplace_orders', '${col}')`);
  }
  for (const col of ["id", "code", "active"])
    assertStringIncludes(pre, `('coupons', '${col}')`);
});
