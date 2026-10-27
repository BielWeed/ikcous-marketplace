// @ts-nocheck
// CADA CONTA TEM NO MAXIMO 10 APARELHOS COM AVISO — prova offline do par 20261396000000 + rollback (cacada de 27/10/2026, achado 2).
// O COMPORTAMENTO (10 passam, a 11a recusa; o re-registro do mesmo aparelho nao conta; conta acima de 10 nao perde nada; admin/servico/
// sessao direta sem limite; duas conexoes reais; mutantes; reaplicar; rollback; pre-voo; consultas 112a/112b) e' provado em
// tests/banco/cada-conta-tem-no-maximo-10-aparelhos-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: a migration so CRIA (nenhum DROP, nenhum dado lido ou escrito); o app grava com UPSERT por endpoint e o gatilho BEFORE INSERT
// dispara antes do conflito, entao o endpoint que ja existe tem de sair ANTES de contar; o limite (10) tem de caber no uso legitimo.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261396000000_cada_conta_tem_no_maximo_10_aparelhos_com_aviso.sql";
const A =
  "112a-conferir-cada-conta-tem-no-maximo-10-aparelhos-com-aviso-aplicado";
const B = "112b-antes-cada-conta-tem-no-maximo-10-aparelhos-com-aviso-ausente";
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_FUNCAO = "a792c5e86b631a8e0f16928a6ab99797";

function corpoDaFuncao(sql) {
  const marca =
    "CREATE OR REPLACE FUNCTION public.push_inscricoes_limite_por_conta(";
  assert.equal(sql.split(marca).length - 1, 1);
  const ini = sql.indexOf(marca);
  const abre = sql.indexOf("AS $function$", ini) + "AS $function$".length;
  return sql.slice(abre, sql.indexOf("$function$;", abre));
}

Deno.test("1396000: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; lock_timeout antes do pre-voo", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
  for (const sql of [migration, rollback]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
    const iLock = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    assert.ok(iLock >= 0 && iLock < sql.indexOf("DO $preflight"));
  }
  for (const n of [NOME, `rollback-manual-${NOME}`])
    assert.ok(!lerBruto(n).includes("\r"), n);
});

Deno.test("1396000: a migration so CRIA — nenhum DROP, nenhum DML, nenhum GRANT; um REVOKE so da funcao nova; nada de ALTER", () => {
  const codigo = limpo(migration);
  assert.doesNotMatch(codigo, /\bDROP\b/i);
  assert.doesNotMatch(
    codigo,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b(?!\s*(ON|TO|OR)\b)/i,
  );
  assert.doesNotMatch(codigo, /\bGRANT\b/i);
  assert.doesNotMatch(codigo, /\bALTER\b/i);
  assert.doesNotMatch(codigo, /\bCREATE\s+(POLICY|TABLE|INDEX)\b/i);
  assert.equal(
    (codigo.match(/\bCREATE OR REPLACE FUNCTION\b/g) ?? []).length,
    1,
  );
  assert.equal(
    (codigo.match(/\bCREATE OR REPLACE TRIGGER\b/g) ?? []).length,
    1,
  );
  const revokes = migration.match(/^REVOKE .*$/gm) ?? [];
  assert.deepEqual(revokes, [
    "REVOKE ALL ON FUNCTION public.push_inscricoes_limite_por_conta() FROM PUBLIC, anon, authenticated, service_role;",
  ]);
  assert.ok(
    migration.includes(
      "CREATE OR REPLACE TRIGGER tr_push_inscricoes_limite_por_conta\nBEFORE INSERT ON public.push_subscriptions\nFOR EACH ROW EXECUTE FUNCTION public.push_inscricoes_limite_por_conta();",
    ),
  );
});

Deno.test("1396000: a funcao e' SECURITY DEFINER com search_path fixo; md5 conhecido citado no pre-voo, na conferencia, no rollback e na 112a", () => {
  const corpo = corpoDaFuncao(migration);
  assert.equal(md5(corpo), H_FUNCAO);
  assert.ok(
    migration.includes(
      "CREATE OR REPLACE FUNCTION public.push_inscricoes_limite_por_conta()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$",
    ),
  );
  assert.equal(
    migration.split(`'${H_FUNCAO}'`).length - 1,
    2,
    "pre-voo e conferencia",
  );
  assert.ok(rollback.includes(`'${H_FUNCAO}'`));
  assert.ok(
    lerRepo(`scripts/publicacao/consultas/${A}.sql`).includes(`'${H_FUNCAO}'`),
  );
});

Deno.test("1396000: a ORDEM do corpo: sessao direta e conta sem dona saem; o endpoint que ja existe sai ANTES de contar; a trava por conta vem antes da contagem; o admin so depois do limite", () => {
  const corpo = corpoDaFuncao(migration);
  const pos = (t) => {
    assert.equal(corpo.split(t).length - 1, 1, `${t} deve aparecer uma vez`);
    return corpo.indexOf(t);
  };
  const direta = pos("= 'none' OR NEW.user_id IS NULL");
  const existente = pos("s.endpoint = NEW.endpoint");
  const trava = pos(
    "pg_advisory_xact_lock(hashtextextended('push_subscriptions_limite:' || NEW.user_id::text, 0))",
  );
  const conta = pos("WHERE s.user_id = NEW.user_id LIMIT v_limite");
  const admin = pos("AND NOT public.rls_admin_atual() THEN");
  const erro = pos(
    "USING ERRCODE = 'P0001', DETAIL = 'push_limite_de_aparelhos'",
  );
  assert.ok(
    direta < existente &&
      existente < trava &&
      trava < conta &&
      conta < admin &&
      admin < erro,
  );
  assert.ok(corpo.includes("v_limite CONSTANT integer := 10;"));
  assert.ok(
    corpo.includes(
      "Esta conta já tem % aparelhos com aviso ligado. Desligue o aviso em um aparelho que você não usa mais e tente de novo.",
    ),
  );
  // conta ate o limite e para (conta com milhares de linhas nao faz o gatilho varrer tudo)
  assert.ok(
    corpo.includes(
      "SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = NEW.user_id LIMIT v_limite",
    ),
  );
});

Deno.test("1396000: o app grava com UPSERT por endpoint (e' por isso que o endpoint existente sai antes de contar) e desliga apagando por endpoint", () => {
  const hook = lerRepo("src/hooks/usePushNotifications.ts");
  assert.ok(
    /\.upsert\([\s\S]{0,400}\{ onConflict: "endpoint" \}/.test(hook),
    "o hook nao grava mais por upsert onConflict endpoint: revise o gatilho (INSERT puro contaria o re-registro)",
  );
  assert.ok(hook.includes(".delete()"));
  assert.ok(hook.includes('.eq("endpoint", subscription.endpoint)'));
});

Deno.test("1396000: o rollback tira so o gatilho e a funcao NOVOS, com pre-voo antes de apagar, e a conferencia final", () => {
  assert.ok(
    rollback.includes(
      "DROP TRIGGER IF EXISTS tr_push_inscricoes_limite_por_conta ON public.push_subscriptions;",
    ),
  );
  assert.ok(
    rollback.includes(
      "DROP FUNCTION IF EXISTS public.push_inscricoes_limite_por_conta();",
    ),
  );
  assert.equal((limpo(rollback).match(/\bDROP\b/g) ?? []).length, 2);
  assert.doesNotMatch(
    limpo(rollback),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER)\b(?!\s*(ON|TO)\b)/i,
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_20261396000000$");
  const iApaga = rollback.indexOf("\nDROP TRIGGER IF EXISTS");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261396000000$");
  assert.ok(iPre >= 0 && iPre < iApaga && iApaga < iConf);
  assert.ok(rollback.slice(iPre, iApaga).includes("B1_BASELINE_DIVERGENT"));
});

Deno.test("1396000: publicacao — lote unico (112a/112b), rol fechado de 4 linhas, consultas so de catalogo, workflows, release, aplicador e prova viva", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261396000000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261396000000"]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(campo in lote[0]), campo);
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const nome of [A, B]) {
    const sql = lerRepo(`scripts/publicacao/consultas/${nome}.sql`);
    assert.doesNotMatch(
      limpo(sql),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      limpo(sql),
      /\bFROM\s+public\.push_subscriptions\b/i,
      "nao le dado de cliente",
    );
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(nome);
    assert.equal(rol.length, 4, nome);
    for (const item of rol) assert.ok(sql.includes(`'${item}'`), item);
    assert.ok(
      lerRepo("scripts/frota/publicar-release.mjs").includes(`"${nome}"`),
    );
    assert.ok(
      lerRepo(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nome}\n`,
      ),
    );
    assert.equal(
      lerRepo(".github/workflows/rpc-ci.yml").split(`consultas/${nome}.sql`)
        .length - 1,
      2,
    );
  }
  assert.ok(
    lerRepo(".github/workflows/rpc-ci.yml").includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/cada-conta-tem-no-maximo-10-aparelhos-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "cada-conta-tem-no-maximo-10-aparelhos-viva.cjs",
    ),
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = new Map(Object.entries(VERIFICACOES)).get(NOME);
  assert.equal(entrada.funcao, "push_inscricoes_limite_por_conta");
  const corpo = corpoDaFuncao(migration);
  for (const { texto, vezes } of entrada.esperado)
    assert.equal(corpo.split(texto).length - 1, vezes, texto);
});
