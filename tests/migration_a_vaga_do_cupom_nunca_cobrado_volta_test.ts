// @ts-nocheck
// A VAGA DO CUPOM DE PEDIDO NUNCA COBRADO VOLTA EM 1 H — prova offline do par
// 20261206000000 + rollback (cupom + dado de cliente, 09/10/2026). A prova VIVA
// (tabela de casos nas fronteiras, cenario do pagamento fantasma, duas varreduras
// em conexoes reais, pre-voo/pos-voo/rollback aplicados byte a byte, mutantes) mora em
// tests/banco/cupom-preso-viva.cjs; aqui fica o que se prova so lendo o texto, e
// que o CI sem banco tambem cobra.
//
// Cada asserção esta amarrada a um risco: migration com BEGIN/COMMIT grava metade em
// producao; hash do pre-voo/pos-voo/rollback que nao e o real do corpo recusa a
// migration num banco CORRETO (ou aceita um corpo errado); varredura reescrita que
// nao e a da 20260970 exceto o predicado devolve vaga de cupom fora de hora; pista
// rapida ANTES das guardas "pago/enviado/ja devolvido" devolveria a vaga de um pedido
// que vale; rollback que nao restaura byte a byte deixa o banco num estado que
// nenhuma migration descreve.
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
const NOME =
  "20261206000000_a_vaga_do_cupom_nunca_cobrado_volta_em_uma_hora.sql";
const NOME_M1 = "20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql";
const NOME_970 = "20260970000000_cancelamento_respeita_o_envio.sql";

const ler = (n) =>
  Deno.readTextFileSync(`${PASTA}/${n}`).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const m1 = ler(NOME_M1);
const f970 = ler(NOME_970);

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const crlf = (s) => s.replace(/\n/g, "\r\n");
const shas = (c) => [sha256(c), sha256(crlf(c))];
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
const semLiterais = (s) => s.replace(/'[^']*'/g, "''");
const literais64 = (t) => [...t.matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]);

function corpoDe(texto, cabecalho, tag) {
  const ini = texto.indexOf(cabecalho);
  assert(ini >= 0, `nao achei ${cabecalho}`);
  const abre = texto.indexOf(`AS ${tag}`, ini) + `AS ${tag}`.length;
  return texto.slice(abre, texto.indexOf(`${tag};`, abre));
}
function blocoDe(texto, cabecalho, tag) {
  const ini = texto.indexOf(cabecalho);
  assert(ini >= 0, `nao achei ${cabecalho}`);
  const abre = texto.indexOf(`AS ${tag}`, ini);
  return texto.slice(ini, texto.indexOf(`${tag};`, abre) + `${tag};`.length);
}

const CAB_AUX = "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(";
const CAB_VAR =
  "CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()";
const TAG_V = "$devolver_cupons_mortos$";

const auxV1 = corpoDe(m1, CAB_AUX, "$function$");
const auxV2 = corpoDe(migration, CAB_AUX, "$function$");
const var970 = corpoDe(f970, CAB_VAR, TAG_V);
const varV2 = corpoDe(migration, CAB_VAR, TAG_V);
const H = {
  auxV1: shas(auxV1),
  auxV2: shas(auxV2),
  var970: shas(var970),
  varV2: shas(varV2),
};
const ini = (marca) => migration.indexOf(marca);

Deno.test("206: sem BEGIN/COMMIT de nivel superior e tudo em ASCII (migration e rollback)", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
  for (const t of [migration, rollback]) {
    assertEquals(
      [...t].filter((ch) => ch.charCodeAt(0) > 127),
      [],
    );
  }
});

Deno.test("206: os hashes do pre-voo, do pos-voo e do rollback sao o sha256 real dos corpos (LF e CRLF), nesta ordem", () => {
  const pre = migration.slice(
    ini("DO $preflight_20261206$"),
    ini("$preflight_20261206$;"),
  );
  const pos = migration.slice(
    ini("DO $posvoo_20261206$"),
    ini("$posvoo_20261206$;"),
  );
  assertEquals(literais64(semComentarios(pre)), [
    ...H.var970,
    ...H.varV2,
    ...H.auxV1,
    ...H.auxV2,
  ]);
  assertEquals(literais64(semComentarios(pos)), [...H.auxV2, ...H.varV2]);
  // rollback: guarda (auxiliar v2 ou v1, varredura v2 ou 970) + verificacao (v1 e 970)
  assertEquals(literais64(semComentarios(rollback)), [
    ...H.auxV2,
    ...H.auxV1,
    ...H.varV2,
    ...H.var970,
    ...H.auxV1,
    ...H.var970,
  ]);
});

Deno.test("206: so troca as duas funcoes (auxiliar e varredura) e nenhuma outra; a RPC da 20261205 nao e tocada", () => {
  const criadas = [
    ...semComentarios(migration).matchAll(
      /CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)\(/g,
    ),
  ].map((m) => m[1]);
  assertEquals(criadas, [
    "public.cupom__vaga_volta_em",
    "public.devolver_cupons_de_pedidos_mortos",
  ]);
  const codigo = semComentarios(migration);
  for (const nome of [
    "validate_coupon_secure_v2",
    "create_marketplace_order_v2",
    "FUNCTION public.devolver_uso_cupom",
    "FUNCTION public.vaga_do_cupom_presa",
  ]) {
    assert(!codigo.includes(nome), `a migration toca ${nome}`);
  }
});

Deno.test("206: o auxiliar v2 tem a MESMA assinatura do v1 (CREATE OR REPLACE nao muda parametros) e continua sem EXECUTE para ninguem", () => {
  const cabV1 = m1.slice(
    m1.indexOf(CAB_AUX),
    m1.indexOf("AS $function$", m1.indexOf(CAB_AUX)),
  );
  const cabV2 = migration.slice(
    ini(CAB_AUX),
    migration.indexOf("AS $function$", ini(CAB_AUX)),
  );
  assertEquals(cabV2, cabV1);
  const fora = semLiterais(
    semComentarios(migration.replace(auxV2, "").replace(varV2, "")),
  );
  assertStringIncludes(
    fora,
    "REVOKE ALL ON FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(!/\bGRANT\b/.test(fora), "a migration concede EXECUTE");
});

Deno.test("206: o auxiliar v2 e o v1 mais UMA clausula — a pista rapida vem DEPOIS de todas as guardas e do expires_at vazio, e antes do ELSE de 24 h", () => {
  const c = semComentarios(auxV2);
  const v1 = semComentarios(auxV1);
  const pista =
    "        WHEN p_gateway_payment_id IS NULL AND p_tentativas = 0 THEN p_expires_at + interval '45 minutes'\n";
  assertEquals(c.split(pista).length - 1, 1);
  // tirada a clausula, o resto e' EXATAMENTE o corpo da 20261205
  assertEquals(c.replace(pista, ""), v1);
  const iPista = c.indexOf(pista);
  for (const g of [
    "WHEN p_coupon_id IS NULL",
    "WHEN p_status IS DISTINCT FROM 'cancelled'",
    "WHEN p_payment_status IN ('pago', 'pago_apos_expirar')",
    "WHEN p_coupon_usage_returned IS DISTINCT FROM false",
    "IS NOT TRUE THEN 'infinity'::timestamptz",
    "WHEN p_expires_at IS NULL THEN '-infinity'::timestamptz",
  ]) {
    assert(
      c.indexOf(g) >= 0 && c.indexOf(g) < iPista,
      `a pista rapida vem antes de: ${g}`,
    );
  }
  assert(iPista < c.indexOf("ELSE p_expires_at + interval '24 hours'"));
  assertEquals(migration.split("interval '45 minutes'").length - 1, 1);
});

Deno.test("206: o corpo do auxiliar e o COMMENT citam as 3 dependencias da pista rapida e a ressalva do webhook", () => {
  const comentario =
    /COMMENT ON FUNCTION public\.cupom__vaga_volta_em\([^)]*\) IS '([^']*)';/.exec(
      migration,
    )[1];
  for (const trecho of [
    "liberar_cobranca_do_pedido",
    "criar-pagamento",
    "webhook-mercadopago",
    "divergente",
    "20261195000000",
  ]) {
    assertStringIncludes(auxV2, trecho);
  }
  assertStringIncludes(auxV2, "nao e o relogio");
  assertStringIncludes(
    auxV2,
    "Se um dia surgir adocao de PIX pelo webhook, esta pista rapida precisa ser",
  );
  for (const trecho of [
    "liberar_cobranca_do_pedido",
    "criar-pagamento",
    "divergente",
    "adocao de PIX pelo webhook",
  ]) {
    assertStringIncludes(comentario, trecho);
  }
});

Deno.test("206: a varredura v2 e a da 20260970 INTEIRA, trocando so o WHERE (e um aviso em comentario)", () => {
  const F =
    "    FOR v_pedido IN\n        SELECT id\n        FROM public.marketplace_orders\n";
  const L = "        FOR UPDATE SKIP LOCKED\n    LOOP";
  const i1 = var970.indexOf(F);
  const iS = var970.indexOf(L);
  assert(i1 > 0 && iS > i1);
  const P = var970.slice(0, i1);
  const W1 = var970.slice(i1 + F.length, iS);
  const S = var970.slice(iS);
  // o WHERE antigo e' exatamente o que o auxiliar espelha
  assertStringIncludes(W1, "coupon_id IS NOT NULL");
  // v2 = P + AVISO (so comentario) + F + W2 + S
  assert(varV2.startsWith(P), "o inicio da varredura mudou alem do aviso");
  assert(varV2.endsWith(F + varV2.slice(varV2.indexOf(F) + F.length)));
  const iF2 = varV2.indexOf(F);
  const aviso = varV2.slice(P.length, iF2);
  assert(
    aviso.endsWith("\n") &&
      aviso
        .slice(0, -1)
        .split("\n")
        .every((l) => l.startsWith("    --")),
    "entre o inicio e o FOR so pode haver comentario",
  );
  assert(
    varV2.endsWith(S),
    "o fim da varredura (trava, devolucao, marca, retorno) mudou",
  );
  const W2 = varV2.slice(iF2 + F.length, varV2.length - S.length);
  assertEquals(
    W2,
    `        WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND coupon_usage_returned = FALSE
          AND public.cupom__vaga_volta_em(
                coupon_id, status, payment_status, coupon_usage_returned, expires_at,
                cancelled_after_shipping, returned_to_seller_at,
                gateway_payment_id, tentativas_de_pagamento) < now()
`,
  );
  // a UNICA chamada a devolver_uso_cupom, na varredura inteira
  assertEquals(
    semComentarios(varV2).split("devolver_uso_cupom(").length - 1,
    1,
  );
  // o auxiliar e' chamado com os 9 argumentos NA ORDEM dos parametros do auxiliar
  const params = [
    ...m1
      .slice(
        m1.indexOf(CAB_AUX),
        m1.indexOf("AS $function$", m1.indexOf(CAB_AUX)),
      )
      .matchAll(/p_(\w+) /g),
  ].map((m) => m[1]);
  assertEquals(params, [
    "coupon_id",
    "status",
    "payment_status",
    "coupon_usage_returned",
    "expires_at",
    "cancelled_after_shipping",
    "returned_to_seller_at",
    "gateway_payment_id",
    "tentativas",
  ]);
});

Deno.test("206: o cabecalho da varredura (retorno, SECURITY DEFINER, search_path) e' o da 20260970 e o rollback a restaura de forma identica", () => {
  const cabF970 = f970.slice(
    f970.indexOf(CAB_VAR),
    f970.indexOf(`AS ${TAG_V}`, f970.indexOf(CAB_VAR)),
  );
  const cabM2 = migration.slice(
    ini(CAB_VAR),
    migration.indexOf(`AS ${TAG_V}`, ini(CAB_VAR)),
  );
  assertEquals(cabM2, cabF970);
  // o rollback traz o auxiliar da M1 e a varredura da 970 CARACTERE A CARACTERE
  assertStringIncludes(rollback, blocoDe(m1, CAB_AUX, "$function$"));
  assertStringIncludes(rollback, blocoDe(f970, CAB_VAR, TAG_V));
  // e o comentario da 20260901 (acento escrito como ó) e o da M1
  assertStringIncludes(
    rollback,
    "E'Unico lugar onde a vaga de um cupom volta depois que um pedido que o usou e desfeito. S\\u00f3 age sobre pedido definitivamente morto -- PIX que ja nao pode mais ser pago, pelo mesmo criterio de pagamentos_a_reconciliar (expires_at + 24h) -- e nunca deduz \"ja devolvido\" do estado: le e grava o fato na coluna coupon_usage_returned. Agendada via pg_cron a cada 15 minutos, ver abaixo.'",
  );
  const comM1 =
    /COMMENT ON FUNCTION public\.cupom__vaga_volta_em\([^)]*\) IS '([^']*)';/.exec(
      m1,
    )[1];
  assertStringIncludes(rollback, `IS '${comM1}';`);
  // a 20260970 continua sendo a ULTIMA que define a varredura antes desta
  const arquivos = [...Deno.readDirSync(PASTA)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("rollback-") && n < NOME)
    .sort();
  const definem = arquivos.filter((n) => ler(n).includes(CAB_VAR));
  assertEquals(definem.at(-1), NOME_970);
});

Deno.test("206: o rollback so restaura (CREATE OR REPLACE), sem DROP, sem GRANT, sem tocar dado, com as duas guardas antes e a verificacao depois", () => {
  // so o codigo: sem comentarios, sem literais e sem os dois corpos restaurados (que escrevem em pedido)
  const r = semLiterais(
    semComentarios(rollback.replace(auxV1, "").replace(var970, "")),
  );
  assert(
    !/\bDROP\b|CASCADE|\bGRANT\b|\bREVOKE\b|\bUPDATE\b|\bDELETE\b|\bINSERT\b|\bTRUNCATE\b/i.test(
      r,
    ),
  );
  assertEquals([...r.matchAll(/RAISE EXCEPTION/g)].length, 3);
  assert(r.indexOf("guarda_rollback_20261206") < r.indexOf(CAB_AUX));
  assert(
    r.lastIndexOf("RAISE EXCEPTION") > r.indexOf(CAB_VAR),
    "falta a verificacao depois de restaurar",
  );
  assertStringIncludes(
    rollback,
    "a varredura devolver_cupons_de_pedidos_mortos (hash %) nao e a da 20261206000000",
  );
  assertStringIncludes(
    rollback,
    "corpo vivo de cupom__vaga_volta_em (hash %) nao e o da 20261206000000",
  );
});

Deno.test("206: aditiva e com pre-voo antes das funcoes e pos-voo depois — fora dos corpos nao ha DROP, ALTER, DELETE nem escrita", () => {
  const fora = semLiterais(
    semComentarios(migration.replace(auxV2, "").replace(varV2, "")),
  );
  assert(
    !/\bDROP\b|\bALTER\b|\bDELETE\b|\bTRUNCATE\b|\bINSERT\s+INTO\b|\bUPDATE\s+public\b/i.test(
      fora,
    ),
    "migration destrutiva",
  );
  assert(ini("$preflight_20261206$;") < ini(CAB_AUX));
  assert(ini(CAB_AUX) < ini(CAB_VAR));
  assert(ini(CAB_VAR) < ini("DO $posvoo_20261206$"));
  assert(NOME > NOME_M1, "a 20261206 vem DEPOIS da 20261205");
});

Deno.test("206: as mensagens do pre-voo, do pos-voo e do rollback nomeiam o que diverge (as provas vivas e os mutantes dependem delas)", () => {
  const pre = migration.slice(
    ini("DO $preflight_20261206$"),
    ini("$preflight_20261206$;"),
  );
  for (const frase of [
    "PREFLIGHT_20261206: esperava exatamente uma versao de devolver_cupons_de_pedidos_mortos()",
    "PREFLIGHT_20261206: corpo vivo de devolver_cupons_de_pedidos_mortos()",
    "PREFLIGHT_20261206: falta a funcao %",
    "PREFLIGHT_20261206: corpo vivo de cupom__vaga_volta_em",
    "PREFLIGHT_20261206: falta a coluna public.marketplace_orders.%",
  ]) {
    assertEquals(pre.split(`RAISE EXCEPTION '${frase}`).length - 1, 1, frase);
  }
  assertEquals(
    migration.split("RAISE EXCEPTION 'POSVOO_20261206").length - 1,
    1,
  );
  // o pre-voo exige a 20261205 inteira (auxiliar e RPC) e a funcao que a varredura chama
  for (const f of [
    "public.vaga_do_cupom_presa(text)",
    "public.devolver_uso_cupom(uuid)",
  ]) {
    assertStringIncludes(pre, `'${f}'`);
  }
  for (const col of [
    "gateway_payment_id",
    "tentativas_de_pagamento",
    "coupon_usage_returned",
    "expires_at",
    "cancelled_after_shipping",
    "returned_to_seller_at",
    "coupon_id",
    "payment_status",
    "status",
  ]) {
    assertStringIncludes(pre, `('${col}')`);
  }
});
