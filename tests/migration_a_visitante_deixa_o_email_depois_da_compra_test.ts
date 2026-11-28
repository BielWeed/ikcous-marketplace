// @ts-nocheck
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), entao nao ha ReDoS possivel; mesma razao dos outros testes migration_*. */
// A VISITANTE DEIXA O E-MAIL DEPOIS DA COMPRA — leitura do TEXTO da 20261656000000 e do rollback dela.
// O COMPORTAMENTO (as quatro condicoes, a trava da linha com duas conexoes, o teto que vale com o pedido pago, os mutantes, reaplicar,
// pre-voo, rollback e as consultas 212a/212b) e' provado no Postgres efemero por tests/banco/a-visitante-deixa-o-email-viva.cjs; aqui
// ficam as ancoras que se leem do arquivo, sem banco:
//   - a migration e' ADITIVA, SEM transacao propria, e so escreve dado DENTRO das duas funcoes novas;
//   - cada condicao da porta esta no corpo, e a linha do pedido e' trancada antes de decidir;
//   - a reserva da visitante usa os MESMOS contadores e tetos da reivindicar_email_de_confirmacao, SEM a passagem do pedido pago;
//   - as permissoes: a porta para anon e authenticated, a reserva so para o service_role;
//   - o formato de e-mail do banco e' o MESMO que a tela confere antes de chamar;
//   - o rollback tira SO as duas funcoes, nao apaga nenhuma linha, e passa a Fase 0.
import { createHash } from "node:crypto";
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

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const NOME = "20261656000000_a_visitante_deixa_o_email_depois_da_compra.sql";
const NOME_1217 =
  "20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const lerTexto = (rel: string) =>
  Deno.readTextFileSync(`${RAIZ}/${rel}`).replace(/\r/g, "");
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const m1217 = lerMig(NOME_1217);
const semComentario = (s: string) => s.replace(/--.*$/gm, "");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const corpo = (sql: string, assinatura: string, tag: string) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${assinatura}`);
  assert(i >= 0, `funcao ausente: ${assinatura}`);
  assertEquals(
    sql.indexOf(`CREATE OR REPLACE FUNCTION public.${assinatura}`, i + 1),
    -1,
    `funcao repetida: ${assinatura}`,
  );
  const a = sql.indexOf(`AS ${tag}`, i) + `AS ${tag}`.length;
  return sql.slice(a, sql.indexOf(tag, a));
};
const INFORMAR = corpo(
  migration,
  "informar_email_da_visitante(p_order_id uuid, p_email text)",
  "$informar$",
);
const REIVINDICAR = corpo(
  migration,
  "reivindicar_comprovante_da_visitante(p_order_id uuid)",
  "$reivindicar_visitante$",
);
const REIVINDICAR_1217 = corpo(
  m1217,
  "reivindicar_email_de_confirmacao(\n    p_order_id uuid\n)",
  "$$",
);
const H_INF = md5(INFORMAR);
const H_REI = md5(REIVINDICAR);

Deno.test("20261656: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s, recarrega o schema e passa a Fase 0", () => {
  for (const [rotulo, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${rotulo}: ${t.achados.join("/")}`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
    assert(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"), rotulo);
  }
  for (const arq of [NOME, `rollback-manual-${NOME}`])
    assert(
      !Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).includes(
        "\r",
      ),
      `${arq}: LF`,
    );
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("20261656: ADITIVA — nenhum DROP, ALTER, CREATE TABLE, DELETE nem TRUNCATE; a unica escrita de dado mora DENTRO das duas funcoes", () => {
  const sql = semComentario(migration);
  for (const proibido of [
    /\bDROP\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bCREATE\s+TABLE\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bINSERT\s+INTO\b/i,
  ])
    assert(!proibido.test(sql), `a migration tem ${proibido}`);
  // Fora dos dois corpos, nenhum UPDATE.
  const fora = sql
    .replace(semComentario(INFORMAR), "")
    .replace(semComentario(REIVINDICAR), "");
  assert(fora.length < sql.length - 2000, "os dois corpos sairam do texto");
  // Sem os textos entre aspas (o COMMENT ON FUNCTION cita a trava "FOR UPDATE").
  const foraSemTexto = fora.replace(/'(?:[^']|'')*'/g, "''");
  assert(!/\bUPDATE\b/i.test(foraSemTexto), "UPDATE fora das funcoes");
  // As duas sao NOVAS: nenhuma outra funcao e' (re)definida.
  assertEquals(
    [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(
      (m) => m[1],
    ),
    ["informar_email_da_visitante", "reivindicar_comprovante_da_visitante"],
  );
});

Deno.test("20261656: a porta da visitante — formato antes de ler o pedido, linha trancada, visitante, sem e-mail, 15 minutos, grava so o e-mail", () => {
  const c = semComentario(INFORMAR);
  const iFormato = c.indexOf(
    "RETURN jsonb_build_object('ok', false, 'motivo', 'email_invalido');",
  );
  const iTrava = c.indexOf("FOR UPDATE;");
  const iVisitante = c.indexOf("OR v_pedido.user_id IS NOT NULL");
  const iJaTem = c.indexOf("IF v_pedido.email <> '' THEN");
  const iPrazo = c.indexOf("IF v_pedido.created_at <= now() - v_janela THEN");
  const iGrava = c.indexOf("UPDATE public.marketplace_orders");
  for (const [nome, i] of Object.entries({
    iFormato,
    iTrava,
    iVisitante,
    iJaTem,
    iPrazo,
    iGrava,
  }))
    assert(i > 0, `${nome} ausente`);
  assert(
    iFormato < iTrava &&
      iTrava < iVisitante &&
      iVisitante < iJaTem &&
      iJaTem < iPrazo &&
      iPrazo < iGrava,
    "a ordem: formato, trava, visitante, ja tem e-mail, prazo, grava",
  );
  assertEquals(c.split("FOR UPDATE;").length - 1, 1, "uma trava so");
  assertStringIncludes(
    c,
    "v_janela CONSTANT interval := interval '15 minutes';",
  );
  assertStringIncludes(c, "length(v_email) > 254");
  assertStringIncludes(c, "OR v_pedido.canal IS DISTINCT FROM 'online'");
  assertStringIncludes(
    c,
    "OR v_pedido.payment_method IS NOT DISTINCT FROM 'online'",
  );
  assertStringIncludes(c, "OR v_pedido.forma IS DISTINCT FROM 'object' THEN");
  // Sem sobrescrever: o MESMO e-mail e' ok sem escrever; outro e' recusado.
  assertStringIncludes(
    c,
    "IF lower(v_pedido.email) = lower(v_email) THEN\n      RETURN jsonb_build_object('ok', true, 'motivo', 'ja_gravado');",
  );
  // A escrita: uma so, so acrescenta a chave email e so no pedido pedido.
  assertEquals(c.split("UPDATE ").length - 1, 1, "um UPDATE so");
  assertStringIncludes(
    c,
    "UPDATE public.marketplace_orders\n     SET customer_data = customer_data || jsonb_build_object('email', v_email)\n   WHERE id = p_order_id;",
  );
  // Nunca toca o que a cobranca, a reserva do comprovante ou o pedido usam.
  for (const coluna of [
    "confirmation_email_sent_at",
    "payment_status",
    "status",
    "total",
    "user_id =",
  ])
    assert(!c.includes(`SET ${coluna}`), `a porta mexe em ${coluna}`);
});

Deno.test("20261656: a reserva da visitante usa os MESMOS contadores e tetos da reivindicar_email_de_confirmacao, SEM a passagem do pedido pago", () => {
  const nova = semComentario(REIVINDICAR);
  const antiga = semComentario(REIVINDICAR_1217);
  // Os numeros: os mesmos da 1217.
  for (const constante of [
    "v_teto_por_destinatario CONSTANT integer := 10;",
    "v_teto_do_comprovante_na_loja CONSTANT integer := 40;",
  ]) {
    assertStringIncludes(nova, constante);
    assertStringIncludes(antiga, constante);
  }
  // Os contadores: as mesmas chaves.
  for (const chave of [
    "'destinatario:' || public.chave_do_destinatario(",
    "'comprovante:loja'",
  ]) {
    assertStringIncludes(nova, chave);
    assertStringIncludes(antiga, chave);
  }
  // A 1217 deixa o pago passar (teto nulo); esta, nunca.
  assertStringIncludes(
    antiga,
    "CASE WHEN v_pago THEN NULL ELSE v_teto_por_destinatario END",
  );
  assert(
    !/\bpago\b|payment_status|CASE\s+WHEN/i.test(nova),
    "a reserva da visitante olha o pagamento",
  );
  assertStringIncludes(nova, "v_teto_por_destinatario\n    ) THEN");
  assertStringIncludes(
    nova,
    "public.reservar_vaga_de_email('comprovante:loja', v_teto_do_comprovante_na_loja)",
  );
  // So pedido de visitante, nao avisado, linha trancada; falha do contador sobe (sem WHEN OTHERS).
  assertStringIncludes(nova, "AND o.user_id IS NULL");
  assertStringIncludes(nova, "AND o.canal = 'online'");
  assertStringIncludes(
    nova,
    "AND o.confirmation_email_sent_at IS NULL\n     FOR UPDATE;",
  );
  assert(
    !/WHEN\s+OTHERS/i.test(nova),
    "a falha do contador nao pode virar 'segue'",
  );
  assertStringIncludes(nova, "WHEN SQLSTATE 'IKE01' THEN");
  // A marca: uma vez, so se ainda nao havia.
  assertStringIncludes(
    nova,
    "SET confirmation_email_sent_at = now()\n   WHERE id = p_order_id\n     AND confirmation_email_sent_at IS NULL",
  );
});

Deno.test("20261656: SECURITY DEFINER com search_path fixo, a porta para anon e authenticated, a reserva so para o service_role, e o pos-voo confere", () => {
  const cabecalho = (assinatura: string) => {
    const i = migration.indexOf(
      `CREATE OR REPLACE FUNCTION public.${assinatura}`,
    );
    return migration.slice(i, migration.indexOf("AS $", i));
  };
  for (const a of [
    "informar_email_da_visitante(p_order_id uuid, p_email text)",
    "reivindicar_comprovante_da_visitante(p_order_id uuid)",
  ]) {
    const c = cabecalho(a);
    assertStringIncludes(c, "SECURITY DEFINER");
    assertStringIncludes(c, "SET search_path TO 'public'");
    assertStringIncludes(c, "VOLATILE");
  }
  assertStringIncludes(
    migration,
    "REVOKE ALL ON FUNCTION public.informar_email_da_visitante(uuid, text) FROM PUBLIC, anon, authenticated, service_role;\nGRANT EXECUTE ON FUNCTION public.informar_email_da_visitante(uuid, text) TO anon, authenticated;\n",
  );
  assertStringIncludes(
    migration,
    "REVOKE ALL ON FUNCTION public.reivindicar_comprovante_da_visitante(uuid) FROM PUBLIC, anon, authenticated, service_role;\nGRANT EXECUTE ON FUNCTION public.reivindicar_comprovante_da_visitante(uuid) TO service_role;\n",
  );
  assertEquals(
    migration.split("GRANT EXECUTE").length - 1,
    2,
    "nenhum outro GRANT",
  );
  // pre-voo (reaplicacao) e pos-voo citam o md5 de cada corpo.
  for (const h of [H_INF, H_REI])
    assertEquals(migration.split(`'${h}'`).length - 1, 2, h);
  // O pre-voo exige o teto da 1217 com os corpos dela (os md5 que a propria 1217 grava como "desta").
  for (const h of [
    "373815e668edf9480d2dce94fb59d467",
    "b5a9a0f8bb405c082cdb8cb7ee662d1e",
  ]) {
    assertStringIncludes(migration, `'${h}'`);
    assertStringIncludes(m1217, `'${h}'`);
  }
});

Deno.test("20261656: o formato de e-mail do banco e' o MESMO que a tela confere antes de chamar", () => {
  const doBanco = /v_email !~ '([^']+)'/.exec(INFORMAR);
  assert(doBanco, "o formato do banco");
  const front = lerTexto("src/lib/comprovante-da-visitante.ts");
  // A declaracao pode trazer um comentario de lint entre o `=` e o literal.
  const daTela =
    /const FORMATO_DO_EMAIL =(?:\s*\/\/[^\n]*)?\s*\/(\^[^\n]+\$)\/;/.exec(
      front,
    );
  assert(daTela, "o formato da tela");
  assertEquals(daTela[1], doBanco[1]);
  assertStringIncludes(front, "const MAXIMO_DO_EMAIL = 254;");
});

Deno.test("20261656: o rollback tira SO as duas funcoes, nao apaga nenhuma linha e confere o corpo antes", () => {
  const sql = semComentario(rollback);
  assertEquals(
    [...sql.matchAll(/DROP FUNCTION IF EXISTS ([^;]+);/g)].map((m) => m[1]),
    [
      "public.informar_email_da_visitante(uuid, text)",
      "public.reivindicar_comprovante_da_visitante(uuid)",
    ],
  );
  for (const proibido of [
    /\bDELETE\b/i,
    /\bUPDATE\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bALTER\b/i,
    /\bINSERT\b/i,
  ])
    assert(!proibido.test(sql), `o rollback tem ${proibido}`);
  for (const h of [H_INF, H_REI]) assertStringIncludes(rollback, `'${h}'`);
  assert(
    sql.indexOf("DO $preflight_rollback_20261656000000$") <
      sql.indexOf("DROP FUNCTION"),
    "o pre-voo vem antes do DROP",
  );
});

Deno.test("20261656: ligada na release — db-apply, rpc-ci e a prova viva existem", () => {
  const dbApply = lerTexto("scripts/db-apply.cjs");
  assertStringIncludes(dbApply, `"${NOME}": [`);
  for (const marcador of [
    "OR v_pedido.user_id IS NOT NULL",
    "IF v_pedido.created_at <= now() - v_janela THEN",
    "AND o.user_id IS NULL",
  ]) {
    assertStringIncludes(dbApply, marcador);
    assert(migration.includes(marcador), marcador);
  }
  assertStringIncludes(
    lerTexto(".github/workflows/rpc-ci.yml"),
    "run: node tests/banco/rodar-isolado.cjs tests/banco/a-visitante-deixa-o-email-viva.cjs",
  );
  const viva = lerTexto("tests/banco/a-visitante-deixa-o-email-viva.cjs");
  assertStringIncludes(viva, `const ARQ = "${NOME}";`);
  assertStringIncludes(viva, `const H_INF = "${H_INF}";`);
  assertStringIncludes(viva, `const H_REI = "${H_REI}";`);
});
