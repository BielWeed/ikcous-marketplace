// @ts-nocheck
// A PERGUNTA NASCE COM A DATA DE AGORA — prova offline do par 20261396100000 + rollback (cacada de 27/10/2026, achado 4).
// O COMPORTAMENTO (a data forjada vira agora, o texto fica, a pergunta nao e' recusada; admin/servico/sessao direta mantem a data;
// mutantes; reaplicar; rollback; pre-voo; consultas 113a/113b) e' provado em tests/banco/a-pergunta-nasce-com-a-data-de-agora-viva.cjs.
// Aqui fica o que se prova so lendo o texto.
//
// Riscos: a migration so CRIA (nenhum DROP, nenhum dado lido ou escrito); o app grava so 3 colunas (nenhuma e' a data), entao trocar a
// data nao muda nada do uso legitimo; o gatilho nao pode RECUSAR (a pergunta tem de entrar).
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
const NOME = "20261396100000_a_pergunta_nasce_com_a_data_de_agora.sql";
const A = "113a-conferir-a-pergunta-nasce-com-a-data-de-agora-aplicado";
const B = "113b-antes-a-pergunta-nasce-com-a-data-de-agora-ausente";
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_FUNCAO = "1cbc49981db4f1d76e4cf1048914c088";

function corpoDaFuncao(sql) {
  const marca =
    "CREATE OR REPLACE FUNCTION public.pergunta_nasce_com_a_data_de_agora(";
  assert.equal(sql.split(marca).length - 1, 1);
  const ini = sql.indexOf(marca);
  const abre = sql.indexOf("AS $function$", ini) + "AS $function$".length;
  return sql.slice(abre, sql.indexOf("$function$;", abre));
}

Deno.test("1396100: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; lock_timeout antes do pre-voo", () => {
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

Deno.test("1396100: a migration so CRIA — nenhum DROP, nenhum DML, nenhum GRANT; um REVOKE so da funcao nova; nada de ALTER", () => {
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
    "REVOKE ALL ON FUNCTION public.pergunta_nasce_com_a_data_de_agora() FROM PUBLIC, anon, authenticated, service_role;",
  ]);
  assert.ok(
    migration.includes(
      "CREATE OR REPLACE TRIGGER tr_pergunta_nasce_com_a_data_de_agora\nBEFORE INSERT ON public.questions\nFOR EACH ROW EXECUTE FUNCTION public.pergunta_nasce_com_a_data_de_agora();",
    ),
  );
});

Deno.test("1396100: a funcao e' SECURITY DEFINER com search_path fixo; md5 conhecido citado no pre-voo, na conferencia, no rollback e na 113a", () => {
  const corpo = corpoDaFuncao(migration);
  assert.equal(md5(corpo), H_FUNCAO);
  assert.ok(
    migration.includes(
      "CREATE OR REPLACE FUNCTION public.pergunta_nasce_com_a_data_de_agora()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$",
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

Deno.test("1396100: o corpo NAO recusa (sem RAISE); troca so a data de quem e' cliente e nao e' administrador; a sessao direta e o admin ficam de fora", () => {
  const corpo = corpoDaFuncao(migration);
  const codigo = removerRuido(corpo);
  assert.doesNotMatch(codigo, /\bRAISE\b/i, "a pergunta tem de entrar");
  assert.equal(
    (codigo.match(/NEW\.created_at\s*:=\s*now\(\)/g) ?? []).length,
    1,
  );
  assert.equal(
    (codigo.match(/NEW\.\w+\s*:=/g) ?? []).length,
    1,
    "so created_at e' trocado",
  );
  const direta = corpo.indexOf("<> 'none'");
  const admin = corpo.indexOf("AND NOT public.rls_admin_atual() THEN");
  const troca = corpo.indexOf("NEW.created_at := now();");
  assert.ok(direta >= 0 && direta < admin && admin < troca);
  assert.ok(corpo.includes("RETURN NEW;"));
});

Deno.test("1396100: o app grava so 3 colunas (nenhuma e' a data) — e' por isso que trocar a data nao muda o uso legitimo", () => {
  const hook = lerRepo("src/hooks/useQuestions.ts");
  assert.ok(
    /\.insert\(\{\s*product_id: question\.productId,\s*user_id: user\.id,\s*question: question\.question,\s*\}\)/.test(
      hook,
    ),
    "addQuestion passou a gravar outras colunas: revise o gatilho",
  );
  assert.doesNotMatch(hook, /created_at\s*:/);
});

Deno.test("1396100: o rollback tira so o gatilho e a funcao NOVOS, com pre-voo antes de apagar, e a conferencia final", () => {
  assert.ok(
    rollback.includes(
      "DROP TRIGGER IF EXISTS tr_pergunta_nasce_com_a_data_de_agora ON public.questions;",
    ),
  );
  assert.ok(
    rollback.includes(
      "DROP FUNCTION IF EXISTS public.pergunta_nasce_com_a_data_de_agora();",
    ),
  );
  assert.equal((limpo(rollback).match(/\bDROP\b/g) ?? []).length, 2);
  assert.doesNotMatch(
    limpo(rollback),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER)\b(?!\s*(ON|TO)\b)/i,
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_20261396100000$");
  const iApaga = rollback.indexOf("\nDROP TRIGGER IF EXISTS");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261396100000$");
  assert.ok(iPre >= 0 && iPre < iApaga && iApaga < iConf);
  assert.ok(rollback.slice(iPre, iApaga).includes("B1_BASELINE_DIVERGENT"));
});

Deno.test("1396100: publicacao — lote unico (113a/113b), rol fechado de 4 linhas, consultas so de catalogo, workflows, release, aplicador e prova viva", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261396100000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261396100000"]);
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
      /\bFROM\s+public\.questions\b/i,
      "nao le pergunta de cliente",
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
      "run: node tests/banco/rodar-isolado.cjs tests/banco/a-pergunta-nasce-com-a-data-de-agora-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "a-pergunta-nasce-com-a-data-de-agora-viva.cjs",
    ),
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = new Map(Object.entries(VERIFICACOES)).get(NOME);
  assert.equal(entrada.funcao, "pergunta_nasce_com_a_data_de_agora");
  const corpo = corpoDaFuncao(migration);
  for (const { texto, vezes } of entrada.esperado)
    assert.equal(corpo.split(texto).length - 1, vezes, texto);
});
