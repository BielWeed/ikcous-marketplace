// @ts-nocheck
// A VAGA DO CUPOM DO PIX ANULADO VOLTA EM MINUTOS -- prova offline do par 20261210000000 +
// rollback (cupom + dado de cliente; peca 2 de 2 de "o cupom preso depois de cancelar com o PIX
// gerado volta em minutos"; 09/10/2026). A prova VIVA (tabela de 33 casos em "se e somente se",
// pagamento fantasma, concorrencia em conexoes reais, envelope REPEATABLE READ, pre-voo/pos-voo/
// rollback aplicados, mutantes) mora em tests/banco/cupom-pix-anulado-viva.cjs; aqui fica o que se
// prova so lendo o texto, e que o CI sem banco tambem cobra.
//
// Cada asserção esta amarrada a um risco: migration com BEGIN/COMMIT grava metade em producao;
// hash do pre-voo/pos-voo/rollback que nao e o real do corpo recusa a migration num banco CORRETO
// (ou aceita um corpo errado); pista nova ANTES das guardas "pago/enviado/ja devolvido" devolveria
// a vaga de um pedido que vale; pista que devolve '-infinity' devolve o cupom de um pedido que o
// admin pode reativar; varredura reescrita que muda alem da consulta devolve vaga fora de hora;
// JOIN sem a chave primaria devolveria o cupom em dobro; DROP sem ser da funcao recriada apaga o
// que ninguem recriou; rollback que nao restaura byte a byte deixa o banco num estado que nenhuma
// migration descreve.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const PASTA = `${DIR}../supabase/migrations`;
const NOME =
  "20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql";
const NOME_1205 = "20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql";
const NOME_1206 =
  "20261206000000_a_vaga_do_cupom_nunca_cobrado_volta_em_uma_hora.sql";
const NOME_1209 = "20261209000000_a_foto_da_cobranca_no_cancelamento.sql";

const ler = (n) =>
  Deno.readTextFileSync(`${PASTA}/${n}`).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const t1205 = ler(NOME_1205);
const t1206 = ler(NOME_1206);
const t1209 = ler(NOME_1209);

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const crlf = (s) => s.replace(/\n/g, "\r\n");
const shas = (c) => [sha256(c), sha256(crlf(c))];
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
const semLiterais = (s) => s.replace(/'(?:[^']|'')*'/g, "''");
const literais64 = (t) => [...t.matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]);
const ini = (marca, texto = migration) => {
  const i = texto.indexOf(marca);
  assert(i >= 0, `nao achei ${marca}`);
  return i;
};
const vezes = (texto, trecho) => texto.split(trecho).length - 1;

function corpoDe(texto, cabecalho, tag) {
  const i = ini(cabecalho, texto);
  const abre = texto.indexOf(`AS ${tag}`, i) + `AS ${tag}`.length;
  return texto.slice(abre, texto.indexOf(`${tag};`, abre));
}
function blocoDe(texto, cabecalho, tag) {
  const i = ini(cabecalho, texto);
  const abre = texto.indexOf(`AS ${tag}`, i);
  return texto.slice(i, texto.indexOf(`${tag};`, abre) + `${tag};`.length);
}
function cabecalhoDe(texto, cabecalho, tag) {
  const i = ini(cabecalho, texto);
  return texto.slice(i, texto.indexOf(`AS ${tag}`, i));
}
/** Troca UMA ocorrencia exata (e so uma): o teste nao pode passar por acaso. */
function trocarUma(texto, de, para) {
  assertEquals(vezes(texto, de), 1, `esperava uma ocorrencia de: ${de}`);
  return texto.replace(de, () => para);
}

const CAB_AUX = "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(";
const CAB_RPC = "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(";
const CAB_VAR =
  "CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()";
const TAG_V = "$devolver_cupons_mortos$";
const TAG_F = "$function$";
const A9 =
  "public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)";
const A13 =
  "public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text)";

const aux1206 = corpoDe(t1206, CAB_AUX, TAG_F);
const auxM2 = corpoDe(migration, CAB_AUX, TAG_F);
const rpc1205 = corpoDe(t1205, CAB_RPC, TAG_F);
const rpcM2 = corpoDe(migration, CAB_RPC, TAG_F);
const var1206 = corpoDe(t1206, CAB_VAR, TAG_V);
const varM2 = corpoDe(migration, CAB_VAR, TAG_V);
const foto1209 = corpoDe(
  t1209,
  "CREATE OR REPLACE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar()",
  "$foto_da_cobranca$",
);
const H = {
  foto: shas(foto1209),
  aux1206: shas(aux1206),
  auxM2: shas(auxM2),
  rpc1205: shas(rpc1205),
  rpcM2: shas(rpcM2),
  var1206: shas(var1206),
  varM2: shas(varM2),
};

const ARGS13 = [
  "coupon_id",
  "status",
  "payment_status",
  "coupon_usage_returned",
  "expires_at",
  "cancelled_after_shipping",
  "returned_to_seller_at",
  "gateway_payment_id",
  "tentativas_de_pagamento",
  "foto.gateway_payment_id",
  "foto.tentativas",
  "foto.metodo_online",
  "foto.payment_status",
];
const PARAMS13 = [
  "coupon_id",
  "status",
  "payment_status",
  "coupon_usage_returned",
  "expires_at",
  "cancelled_after_shipping",
  "returned_to_seller_at",
  "gateway_payment_id",
  "tentativas",
  "foto_gateway",
  "foto_tentativas",
  "foto_metodo",
  "foto_payment_status",
];

Deno.test("210: sem BEGIN/COMMIT de nivel superior, tudo em ASCII, e a Fase 0 da prova de rollback nao recusa o par", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
  for (const t of [migration, rollback]) {
    assertEquals(
      [...t].filter((ch) => ch.charCodeAt(0) > 127),
      [],
    );
  }
  const f0 = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(f0.motivos, []);
  assertEquals(f0.recusado, false);
});

Deno.test("210: a versao e unica, o rollback e o irmao, e a M2 vem DEPOIS da foto, da 1206 e da 1205", () => {
  const nomes = [...Deno.readDirSync(PASTA)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("rollback-"));
  assertEquals(
    nomes.filter((n) => n.startsWith("20261210000000")),
    [NOME],
  );
  assert(NOME > NOME_1209 && NOME > NOME_1206 && NOME > NOME_1205);
  for (const n of [NOME_1209, NOME_1206, NOME_1205]) {
    assert(ini(n.slice(0, 14)) >= 0, `a migration cita ${n.slice(0, 14)}`);
  }
});

Deno.test("210: os hashes do pre-voo, do pos-voo e do rollback sao o sha256 real dos corpos (LF e CRLF), nesta ordem", () => {
  const pre = migration.slice(
    ini("DO $preflight_20261210$"),
    ini("$preflight_20261210$;"),
  );
  const pos = migration.slice(
    ini("DO $posvoo_20261210$"),
    ini("$posvoo_20261210$;"),
  );
  assertEquals(literais64(semComentarios(pre)), [
    ...H.foto,
    ...H.var1206,
    ...H.varM2,
    ...H.rpc1205,
    ...H.rpcM2,
    ...H.aux1206,
    ...H.auxM2,
  ]);
  assertEquals(literais64(semComentarios(pos)), [
    ...H.auxM2,
    ...H.rpcM2,
    ...H.varM2,
  ]);
  // rollback: guarda (aux 13 ou aux 9, rpc, varredura) + verificacao (aux 9, rpc 1205, var 1206)
  assertEquals(literais64(semComentarios(rollback)), [
    ...H.auxM2,
    ...H.aux1206,
    ...H.rpcM2,
    ...H.rpc1205,
    ...H.varM2,
    ...H.var1206,
    ...H.aux1206,
    ...H.rpc1205,
    ...H.var1206,
  ]);
});

Deno.test("210: so TRES CREATE e UM unico DROP -- o do auxiliar de 9 parametros, recriado na mesma migration, sem CASCADE (A5)", () => {
  const codigo = semComentarios(migration);
  const criadas = [
    ...codigo.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)\(/g),
  ].map((m) => m[1]);
  assertEquals(criadas, [
    "public.cupom__vaga_volta_em",
    "public.vaga_do_cupom_presa",
    "public.devolver_cupons_de_pedidos_mortos",
  ]);
  // nenhum CREATE sem OR REPLACE (perderia grants) e o DROP e unico, so da funcao recriada
  assert(!/CREATE FUNCTION/.test(codigo));
  const comLiterais = codigo.replace(
    /RAISE EXCEPTION '(?:[^']|'')*'/g,
    "RAISE EXCEPTION ''",
  );
  const drops = [...comLiterais.matchAll(/\bDROP\b[^;]*;/g)].map((m) => m[0]);
  assertEquals(drops, [`DROP FUNCTION IF EXISTS ${A9};`]);
  assert(!/CASCADE/i.test(comLiterais));
  // o cabecalho do DROP diz que a funcao e recriada com o MESMO NOME e 13 parametros na mesma migration
  const comentarioDoDrop = migration.slice(
    ini("-- A UNICA coisa que esta migration apaga"),
    ini(`DROP FUNCTION IF EXISTS ${A9};`),
  );
  assertStringIncludes(comentarioDoDrop, "RECRIADO logo abaixo");
  assertStringIncludes(comentarioDoDrop, "MESMO NOME e 13 parametros");
  assertStringIncludes(comentarioDoDrop, "mesma migration");
  assertStringIncludes(
    migration,
    "DROP da versao de 9\n--       parametros e CREATE com o MESMO NOME e 13 parametros, na MESMA migration",
  );
  // o DROP vem ANTES do CREATE que o substitui, e o pre-voo antes de tudo
  assert(ini("$preflight_20261210$;") < ini("DROP FUNCTION IF EXISTS"));
  assert(ini("DROP FUNCTION IF EXISTS") < ini(CAB_AUX));
});

Deno.test("210: aditiva -- fora dos tres corpos nao ha ALTER, DELETE, TRUNCATE, INSERT nem UPDATE; nenhuma trava de tabela", () => {
  const fora = semLiterais(
    semComentarios(
      migration.replace(auxM2, "").replace(rpcM2, "").replace(varM2, ""),
    ),
  );
  assert(
    !/\bALTER\b|\bDELETE\b|\bTRUNCATE\b|\bINSERT\s+INTO\b|\bUPDATE\b|\bLOCK\b|\bCREATE\s+TABLE\b|\bCREATE\s+TRIGGER\b/i.test(
      fora,
    ),
    "migration destrutiva ou com trava",
  );
  // so os dois SET LOCAL
  assertStringIncludes(fora, "SET LOCAL lock_timeout = '';");
  assertEquals(vezes(migration, "SET LOCAL lock_timeout = '5s';"), 1);
  assertEquals(vezes(migration, "SET LOCAL statement_timeout = '30s';"), 1);
  assert(ini("SET LOCAL lock_timeout") < ini("DO $preflight_20261210$"));
  // ordem: SET LOCAL, pre-voo, DROP, aux, REVOKE, rpc, varredura, pos-voo
  const ordem = [
    "SET LOCAL lock_timeout",
    "DO $preflight_20261210$",
    "DROP FUNCTION IF EXISTS",
    CAB_AUX,
    "REVOKE ALL ON FUNCTION",
    CAB_RPC,
    CAB_VAR,
    "DO $posvoo_20261210$",
  ].map((m) => ini(m));
  assertEquals(
    ordem,
    [...ordem].sort((a, b) => a - b),
  );
});

Deno.test("210: o auxiliar novo tem 13 parametros (os 9 de sempre mais os 4 da foto, nesta ordem) e continua sem EXECUTE para ninguem", () => {
  const cab13 = cabecalhoDe(migration, CAB_AUX, TAG_F);
  const cab9 = cabecalhoDe(t1206, CAB_AUX, TAG_F);
  assertEquals(
    [...cab13.matchAll(/p_(\w+) /g)].map((m) => m[1]),
    PARAMS13,
  );
  // os 9 primeiros parametros e o resto do cabecalho sao os da 1206
  assertEquals(cab13.replace(/,\n\s+p_foto_\w+ \w+/g, ""), cab9);
  assertStringIncludes(cab13, "RETURNS timestamptz");
  assertStringIncludes(cab13, "STABLE");
  assertStringIncludes(cab13, "SET search_path = public");
  const fora = semLiterais(
    semComentarios(
      migration.replace(auxM2, "").replace(rpcM2, "").replace(varM2, ""),
    ),
  );
  assertStringIncludes(
    migration,
    `REVOKE ALL ON FUNCTION ${A13} FROM PUBLIC, anon, authenticated, service_role;`,
  );
  assert(!/\bGRANT\b/.test(fora), "a migration concede EXECUTE");
  // so UM REVOKE: a RPC e a varredura nao tem ACL mexida (CREATE OR REPLACE mantem)
  assertEquals(vezes(fora, "REVOKE ALL ON FUNCTION"), 1);
});

Deno.test("210: o auxiliar novo e o da 1206 MAIS UMA clausula -- a pista do PIX anulado vem DEPOIS de todas as guardas, da pista dos 45 min e do expires_at vazio, e ANTES do ELSE de 24 h; devolve p_expires_at, nunca -infinity (A2)", () => {
  const c = semComentarios(auxM2);
  const v1 = semComentarios(aux1206);
  const pista = [
    "        WHEN p_gateway_payment_id IS NULL",
    "         AND p_tentativas = 1",
    "         AND p_payment_status = 'aguardando'",
    "         AND p_foto_gateway IS NOT NULL",
    "         AND (p_foto_gateway LIKE 'verificando:%') IS NOT TRUE",
    "         AND p_foto_tentativas = 0",
    "         AND p_foto_metodo = 'pix'",
    "         AND p_foto_payment_status = 'aguardando'",
    "        THEN p_expires_at\n",
  ].join("\n");
  assertEquals(vezes(c, pista), 1);
  // tirada a clausula, o resto e' EXATAMENTE o corpo da 1206 (sem os comentarios)
  assertEquals(c.replace(pista, ""), v1);
  const iPista = c.indexOf(pista);
  for (const g of [
    "WHEN p_coupon_id IS NULL",
    "WHEN p_status IS DISTINCT FROM 'cancelled'",
    "WHEN p_payment_status IN ('pago', 'pago_apos_expirar')",
    "WHEN p_coupon_usage_returned IS DISTINCT FROM false",
    "IS NOT TRUE THEN 'infinity'::timestamptz",
    "WHEN p_expires_at IS NULL THEN '-infinity'::timestamptz",
    "WHEN p_gateway_payment_id IS NULL AND p_tentativas = 0 THEN p_expires_at + interval '45 minutes'",
  ]) {
    assert(
      c.indexOf(g) >= 0 && c.indexOf(g) < iPista,
      `a pista do PIX anulado vem depois de: ${g}`,
    );
  }
  assert(iPista < c.indexOf("ELSE p_expires_at + interval '24 hours'"));
  // '-infinity' so aparece UMA vez no codigo (o expires_at vazio, de antes): a pista nova nunca o devolve
  assertEquals(vezes(c, "'-infinity'"), 1);
  assertEquals(vezes(v1, "'-infinity'"), 1);
  // a hora que a pista devolve e' p_expires_at puro, sem somar nem subtrair
  assertStringIncludes(pista, "THEN p_expires_at\n");
  assertEquals(vezes(c, "interval '45 minutes'"), 1);
  assertEquals(vezes(c, "interval '24 hours'"), 1);
});

Deno.test("210: o corpo e o COMMENT do auxiliar explicam o admin que reativa o pedido (A2) e o que sustenta a pista, com o cartao e o webhook (A3)", () => {
  const marcaCom = `COMMENT ON FUNCTION ${A13} IS '`;
  const iCom = ini(marcaCom) + marcaCom.length;
  const comentario = migration.slice(iCom, migration.indexOf("';\n", iCom));
  // A2: o admin reativa; a pista nunca devolve -infinity
  for (const trecho of [
    "update_order_status_atomic(id, 'pending')",
    "Nunca '-infinity'",
    "cupom em dobro",
  ]) {
    assertStringIncludes(auxM2, trecho);
  }
  assertStringIncludes(comentario, "o admin pode reativar o pedido");
  // A3: o `.neq` so vale para PIX; para o cartao seguram a reserva, a reocupacao e a adocao
  for (const trecho of [
    '`.neq("status","cancelled")` so vale para PIX',
    "Para o CARTAO o que segura sao a reserva antes do POST, a",
    "reocupacao e a adocao da criar-pagamento, NAO o `.neq`",
    "webhook adota sem",
    "conferir o status do pedido",
    "NUNCA houve POST de cartao nesse pedido",
    "20261195000000",
    "divergente",
    "liberar_cobranca_do_pedido",
  ]) {
    assertStringIncludes(auxM2, trecho);
  }
  for (const trecho of [
    "liberar_cobranca_do_pedido",
    "criar-pagamento",
    "divergente",
    "o neq so vale para PIX",
    "seguram a reserva antes do POST",
    "adocao de PIX pelo webhook",
    "nunca houve cartao",
  ]) {
    assertStringIncludes(comentario, trecho);
  }
  // o cabecalho da migration repete o mesmo aviso e a pre-condicao de publicacao
  assertStringIncludes(migration, "PRE-CONDICAO DA PUBLICACAO");
  assertStringIncludes(migration, "A pista NAO vale no estado A");
});

Deno.test("210: a varredura nova e a da 1206 INTEIRA, trocando so a consulta do laco (LEFT JOIN pela foto, FOR UPDATE OF o SKIP LOCKED) -- A4", () => {
  const ANTES = [
    "    FOR v_pedido IN",
    "        SELECT id",
    "        FROM public.marketplace_orders",
    "        WHERE coupon_id IS NOT NULL",
    "          AND status = 'cancelled'",
    "          AND coupon_usage_returned = FALSE",
    "          AND public.cupom__vaga_volta_em(",
    "                coupon_id, status, payment_status, coupon_usage_returned, expires_at,",
    "                cancelled_after_shipping, returned_to_seller_at,",
    "                gateway_payment_id, tentativas_de_pagamento) < now()",
    "        FOR UPDATE SKIP LOCKED",
    "    LOOP",
  ].join("\n");
  const DEPOIS = [
    "    FOR v_pedido IN",
    "        SELECT o.id",
    "        FROM public.marketplace_orders o",
    "        LEFT JOIN public.pedido_cobranca_ao_cancelar f ON f.order_id = o.id",
    "        WHERE o.coupon_id IS NOT NULL",
    "          AND o.status = 'cancelled'",
    "          AND o.coupon_usage_returned = FALSE",
    "          AND public.cupom__vaga_volta_em(",
    "                o.coupon_id, o.status, o.payment_status, o.coupon_usage_returned, o.expires_at,",
    "                o.cancelled_after_shipping, o.returned_to_seller_at,",
    "                o.gateway_payment_id, o.tentativas_de_pagamento,",
    "                f.gateway_payment_id, f.tentativas, f.metodo_online, f.payment_status) < now()",
    "        FOR UPDATE OF o SKIP LOCKED",
    "    LOOP",
  ].join("\n");
  const esperado = trocarUma(semComentarios(var1206), ANTES, DEPOIS);
  assertEquals(semComentarios(varM2), esperado);
  // a 1206 inteira, comentarios incluidos, e' o prefixo: so se ACRESCENTA um bloco de comentario
  const i1 = var1206.indexOf("    FOR v_pedido IN");
  const i2 = varM2.indexOf("    FOR v_pedido IN");
  assertEquals(varM2.slice(0, i1), var1206.slice(0, i1));
  const aviso = varM2.slice(i1, i2);
  assert(
    aviso.endsWith("\n") &&
      aviso
        .slice(0, -1)
        .split("\n")
        .every((l) => l.startsWith("    --")),
    "entre o inicio e o FOR so pode haver comentario",
  );
  // FOR UPDATE OF (so o pedido, nunca a foto), com SKIP LOCKED, e a UNICA chamada a devolver_uso_cupom
  const cod = semComentarios(varM2);
  assertEquals(vezes(cod, "FOR UPDATE OF o SKIP LOCKED"), 1);
  assertEquals(vezes(cod, "FOR UPDATE"), 1);
  assertEquals(vezes(cod, "devolver_uso_cupom("), 1);
  assertEquals(vezes(cod, "UPDATE public.marketplace_orders"), 1);
  assert(
    !/UPDATE public\.pedido_cobranca/.test(cod),
    "a varredura escreve na foto",
  );
  // o cabecalho (retorno, SECURITY DEFINER, search_path) e' o da 1206
  assertEquals(
    cabecalhoDe(migration, CAB_VAR, TAG_V),
    cabecalhoDe(t1206, CAB_VAR, TAG_V),
  );
});

Deno.test("210: a RPC nova e a da 1205 INTEIRA, lendo a foto pelo MESMO LEFT JOIN (A4 vale tambem para a tela que promete o prazo)", () => {
  const ANTES = [
    "               o.gateway_payment_id, o.tentativas_de_pagamento))",
    "      INTO v_volta",
    "      FROM public.marketplace_orders o",
    "     WHERE o.user_id = (SELECT auth.uid())",
  ].join("\n");
  const DEPOIS = [
    "               o.gateway_payment_id, o.tentativas_de_pagamento,",
    "               f.gateway_payment_id, f.tentativas, f.metodo_online, f.payment_status))",
    "      INTO v_volta",
    "      FROM public.marketplace_orders o",
    "      LEFT JOIN public.pedido_cobranca_ao_cancelar f ON f.order_id = o.id",
    "     WHERE o.user_id = (SELECT auth.uid())",
  ].join("\n");
  assertEquals(
    semComentarios(rpcM2),
    trocarUma(semComentarios(rpc1205), ANTES, DEPOIS),
  );
  // a RPC so le o que o PROPRIO usuario da sessao tem: o filtro por auth.uid() continua
  assertStringIncludes(rpcM2, "WHERE o.user_id = (SELECT auth.uid())");
  assert(!/FOR UPDATE/.test(semComentarios(rpcM2)), "a RPC e so leitura");
  assertEquals(
    cabecalhoDe(migration, CAB_RPC, TAG_F),
    cabecalhoDe(t1205, CAB_RPC, TAG_F),
  );
});

Deno.test("210: quem chama o auxiliar (varredura e RPC) passa os 13 argumentos NA ORDEM dos parametros", () => {
  const ordemDosArgs = (texto) => {
    const cod = semComentarios(texto);
    const i = cod.indexOf("public.cupom__vaga_volta_em(");
    assert(i >= 0);
    let fundo = 0;
    let j = cod.indexOf("(", i);
    const abre = j;
    for (; j < cod.length; j++) {
      if (cod.charAt(j) === "(") fundo++;
      if (cod.charAt(j) === ")" && --fundo === 0) break;
    }
    return cod
      .slice(abre + 1, j)
      .split(",")
      .map((a) => a.trim())
      .map((a) =>
        a.startsWith("f.") ? `foto.${a.slice(2)}` : a.replace(/^o\./, ""),
      );
  };
  assertEquals(ordemDosArgs(varM2), ARGS13);
  assertEquals(ordemDosArgs(rpcM2), ARGS13);
  // a ordem dos parametros do aux (sem prefixo p_) corresponde 1 a 1 aos argumentos
  assertEquals(PARAMS13.length, ARGS13.length);
  assertEquals(
    [...cabecalhoDe(migration, CAB_AUX, TAG_F).matchAll(/p_(\w+) /g)].length,
    13,
  );
});

Deno.test("210: pre-voo recusa SEM gravar, nomeando o que diverge -- as provas vivas e os mutantes dependem destas mensagens", () => {
  const pre = migration.slice(
    ini("DO $preflight_20261210$"),
    ini("$preflight_20261210$;"),
  );
  for (const frase of [
    "PREFLIGHT_20261210: falta a tabela public.marketplace_orders",
    "PREFLIGHT_20261210: falta a coluna public.marketplace_orders.%",
    "PREFLIGHT_20261210: falta a foto da cobranca (public.pedido_cobranca_ao_cancelar)",
    "PREFLIGHT_20261210: public.pedido_cobranca_ao_cancelar tem outra forma de colunas",
    "PREFLIGHT_20261210: public.pedido_cobranca_ao_cancelar nao tem a chave primaria em order_id",
    "PREFLIGHT_20261210: public.pedido__foto_da_cobranca_ao_cancelar() nao existe",
    "PREFLIGHT_20261210: public.pedido__foto_da_cobranca_ao_cancelar() tem corpo diferente",
    "PREFLIGHT_20261210: o gatilho tr_pedido_foto_da_cobranca_ao_cancelar ausente",
    "PREFLIGHT_20261210: falta a funcao public.devolver_uso_cupom(uuid)",
    "PREFLIGHT_20261210: esperava exatamente uma versao de devolver_cupons_de_pedidos_mortos()",
    "PREFLIGHT_20261210: corpo vivo de devolver_cupons_de_pedidos_mortos()",
    "PREFLIGHT_20261210: esperava exatamente uma versao de vaga_do_cupom_presa(text)",
    "PREFLIGHT_20261210: corpo vivo de vaga_do_cupom_presa",
    "PREFLIGHT_20261210: esperava exatamente uma versao de cupom__vaga_volta_em",
    "PREFLIGHT_20261210: corpo vivo de cupom__vaga_volta_em de 9 parametros",
    "PREFLIGHT_20261210: corpo vivo de cupom__vaga_volta_em de 13 parametros",
    "PREFLIGHT_20261210: a unica cupom__vaga_volta_em que existe",
  ]) {
    assertEquals(vezes(pre, `RAISE EXCEPTION '${frase}`), 1, frase);
  }
  // toda recusa diz que nada foi gravado
  const recusas = [...pre.matchAll(/RAISE EXCEPTION '([^']*)'/g)].map(
    (m) => m[1],
  );
  assertEquals(recusas.length, 17);
  for (const m of recusas) assertStringIncludes(m, "nada foi gravado");
  // as 11 colunas que o auxiliar, a varredura e a RPC leem
  for (const col of [
    "id",
    "user_id",
    "coupon_id",
    "status",
    "payment_status",
    "coupon_usage_returned",
    "expires_at",
    "cancelled_after_shipping",
    "returned_to_seller_at",
    "gateway_payment_id",
    "tentativas_de_pagamento",
  ]) {
    assertStringIncludes(pre, `('${col}')`);
  }
  // a foto: forma das colunas, chave primaria (sem ela o JOIN devolveria o cupom em dobro) e gatilho
  assertStringIncludes(
    pre,
    "order_id:uuid:true:,gateway_payment_id:text:false:,tentativas:integer:true:,metodo_online:text:false:,payment_status:text:false:,cancelado_em:timestamp with time zone:true:now()",
  );
  assertStringIncludes(pre, "c.contype = 'p' AND c.conkey = ARRAY[v_attnum]");
  assertStringIncludes(
    pre,
    "t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'",
  );
  assertStringIncludes(pre, "t.tgenabled = 'O'");
  // exatamente UMA versao de cada funcao
  assertEquals(vezes(pre, "<> 1 THEN"), 3);
  // pos-voo
  const pos = migration.slice(
    ini("DO $posvoo_20261210$"),
    ini("$posvoo_20261210$;"),
  );
  assertEquals(vezes(pos, "RAISE EXCEPTION 'POSVOO_20261210"), 5);
  for (const f of [
    "saiu da migration com o corpo",
    "ficou com % sobrecargas",
    "public.cupom__vaga_volta_em saiu com EXECUTE para PUBLIC, anon, authenticated ou service_role",
    "public.vaga_do_cupom_presa saiu com a permissao diferente da esperada",
    "public.devolver_cupons_de_pedidos_mortos saiu com a permissao diferente da esperada",
  ]) {
    assertEquals(vezes(pos, f), 1, f);
  }
});

Deno.test("210: o rollback devolve os tres corpos da 1206/1205 CARACTERE A CARACTERE, com os comentarios, e recria o auxiliar de 9 parametros com a mesma ACL", () => {
  assertStringIncludes(rollback, blocoDe(t1206, CAB_VAR, TAG_V));
  assertStringIncludes(rollback, blocoDe(t1205, CAB_RPC, TAG_F));
  assertStringIncludes(rollback, blocoDe(t1206, CAB_AUX, TAG_F));
  // os COMMENT dos tres: o da varredura (1206), o da RPC (1205) e o do auxiliar (1206)
  const comentario = (texto, assinatura) => {
    const marca = `COMMENT ON FUNCTION ${assinatura} IS`;
    const i = ini(marca, texto);
    return texto.slice(i, texto.indexOf("';\n", i) + 3);
  };
  assertStringIncludes(
    rollback,
    comentario(t1206, "public.devolver_cupons_de_pedidos_mortos()"),
  );
  assertStringIncludes(
    rollback,
    comentario(t1205, "public.vaga_do_cupom_presa(text)"),
  );
  assertStringIncludes(rollback, comentario(t1206, A9));
  assertStringIncludes(
    rollback,
    `REVOKE ALL ON FUNCTION ${A9} FROM PUBLIC, anon, authenticated, service_role;`,
  );
  // o rollback so apaga o auxiliar de 13, e so uma vez, sem CASCADE
  const cod = semComentarios(rollback);
  assertEquals(
    [...cod.matchAll(/\bDROP\b[^;]*;/g)].map((m) => m[0]),
    [`DROP FUNCTION IF EXISTS ${A13};`],
  );
  assert(
    !/CASCADE|\bGRANT\b|\bTRUNCATE\b|\bDELETE\b|\bINSERT\b|\bLOCK\b/i.test(
      semLiterais(
        semComentarios(
          rollback
            .replace(blocoDe(t1206, CAB_VAR, TAG_V), "")
            .replace(blocoDe(t1205, CAB_RPC, TAG_F), "")
            .replace(blocoDe(t1206, CAB_AUX, TAG_F), ""),
        ),
      ),
    ),
  );
  // nao toca dado: o unico UPDATE e o de dentro do corpo restaurado da varredura (1206)
  const semCorpos = semLiterais(
    semComentarios(
      rollback
        .replace(blocoDe(t1206, CAB_VAR, TAG_V), "")
        .replace(blocoDe(t1205, CAB_RPC, TAG_F), "")
        .replace(blocoDe(t1206, CAB_AUX, TAG_F), ""),
    ),
  );
  assert(!/\bUPDATE\b/i.test(semCorpos), "o rollback escreve em dado");
});

Deno.test("210: o rollback tem a guarda ANTES de restaurar e a verificacao DEPOIS, e recusa pela mensagem que nomeia o corpo", () => {
  const guarda = rollback.slice(
    ini("DO $guarda_rollback_20261210$", rollback),
    ini("$guarda_rollback_20261210$;", rollback),
  );
  const verif = rollback.slice(
    ini("DO $verifica_rollback_20261210$", rollback),
    ini("$verifica_rollback_20261210$;", rollback),
  );
  assertEquals(vezes(guarda, "RAISE EXCEPTION 'ROLLBACK_20261210"), 5);
  assertEquals(vezes(verif, "RAISE EXCEPTION 'ROLLBACK_20261210"), 2);
  for (const m of [...guarda.matchAll(/RAISE EXCEPTION '([^']*)'/g)])
    assertStringIncludes(m[1], "nada foi alterado");
  for (const f of [
    "esperava exatamente uma versao de cupom__vaga_volta_em",
    "corpo vivo de cupom__vaga_volta_em de 13 parametros",
    "corpo vivo de cupom__vaga_volta_em de 9 parametros",
    "corpo vivo de vaga_do_cupom_presa",
    "corpo vivo de devolver_cupons_de_pedidos_mortos()",
  ]) {
    assertEquals(vezes(guarda, f), 1, f);
  }
  assertStringIncludes(verif, "nao voltou ao corpo anterior");
  assertStringIncludes(
    verif,
    "de 13 parametros ainda existe depois do rollback",
  );
  // ordem: SET LOCAL, guarda, varredura, RPC, DROP do aux de 13, aux de 9, verificacao
  const ordem = [
    "SET LOCAL lock_timeout",
    "DO $guarda_rollback_20261210$",
    CAB_VAR,
    CAB_RPC,
    `DROP FUNCTION IF EXISTS ${A13};`,
    CAB_AUX,
    "DO $verifica_rollback_20261210$",
  ].map((m) => ini(m, rollback));
  assertEquals(
    ordem,
    [...ordem].sort((a, b) => a - b),
  );
  assertEquals(vezes(rollback, "SET LOCAL lock_timeout = '5s';"), 1);
  // o cabecalho do rollback diz a ORDEM de desfazer
  assertStringIncludes(
    rollback,
    "20261210000000 (este) -> 20261209000000 -> 20261206000000 -> 20261205000000",
  );
  assertStringIncludes(
    migration,
    "20261210000000 -> 20261209000000 -> 20261206000000 ->\n--    20261205000000",
  );
});

Deno.test("210: a 1206 e a ultima a definir o auxiliar e a varredura antes da M2, a 1205 a RPC, e a M2 e a UNICA que da DROP no auxiliar", () => {
  const arquivos = [...Deno.readDirSync(PASTA)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("rollback-") && n < NOME)
    .sort();
  const textos = new Map(arquivos.map((n) => [n, ler(n)]));
  const definem = (cab) => arquivos.filter((n) => textos.get(n).includes(cab));
  assertEquals(definem(CAB_VAR).at(-1), NOME_1206);
  assertEquals(definem(CAB_AUX).at(-1), NOME_1206);
  assertEquals(definem(CAB_RPC).at(-1), NOME_1205);
  // nenhuma migration POSTERIOR a esta redefine o que ela troca
  const depois = [...Deno.readDirSync(PASTA)]
    .map((e) => e.name)
    .filter(
      (n) => n.endsWith(".sql") && !n.startsWith("rollback-") && n > NOME,
    );
  for (const n of depois)
    for (const cab of [CAB_VAR, CAB_AUX, CAB_RPC])
      assert(!ler(n).includes(cab), `${n} redefine uma funcao desta migration`);
  // so a M2 apaga o auxiliar
  const todas = [...Deno.readDirSync(PASTA)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("rollback-"));
  const dropam = todas.filter((n) =>
    /DROP FUNCTION[^;]*cupom__vaga_volta_em/i.test(semComentarios(ler(n))),
  );
  assertEquals(dropam, [NOME]);
  // a varredura, a RPC e o auxiliar de 9 que a 1206 deixa vivos: a foto (1209) nao os toca
  for (const cab of [CAB_VAR, CAB_AUX, CAB_RPC])
    assert(!t1209.includes(cab), "a 1209 redefine uma funcao da M2");
});

Deno.test("210: o cabecalho conta o defeito e o efeito, o que a pista nunca faz, os dados que ja existem e a ordem de desfazer", () => {
  for (const trecho of [
    "1. O DEFEITO E O EFEITO",
    "3. POR QUE A PISTA E SEGURA",
    "Estado A",
    "4. DADOS QUE JA EXISTEM",
    "Nenhuma linha de nenhuma tabela e lida nem alterada",
    "5. O PRE-VOO",
    "6. TRAVAS, CONCORRENCIA E O ENVELOPE DO WORKFLOW",
    "7. IDEMPOTENCIA E TRANSACAO",
    "Sem BEGIN/COMMIT",
    "ORDEM DE DESFAZER",
    "O RELOGIO NAO E O QUE IMPEDE O CUPOM DE VALER DUAS VEZES",
    "FOR UPDATE OF o SKIP LOCKED",
    "UNICA\n--       chamada a devolver_uso_cupom",
  ]) {
    assertStringIncludes(migration, trecho);
  }
});
