// @ts-nocheck
// A FOTO DA DEVOLUCAO E A PERGUNTA TEM TETO — prova offline do par 20261391000000 + rollback (cacada de 26/10/2026).
// O COMPORTAMENTO (30 fotos soltas passam e a 31a e recusada; a foto citada por devolucao nao conta; outra conta livre; 500/501
// caracteres; pergunta antiga fica; reaplicar; rollback; pre-voo; consultas 98a/98b) e' provado em
// tests/banco/a-foto-da-devolucao-e-a-pergunta-tem-teto-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: a migration so pode RESTRINGIR (nenhum DROP, nenhum dado reescrito); o teto tem de caber no fluxo legitimo (a tela manda ate
// 6 fotos ANTES da devolucao existir) e o da pergunta tem de ser o da tela; a funcao nova e' SECURITY INVOKER (roda com a RLS de quem
// grava) e nao e' de anon; o CHECK nasce NOT VALID e ninguem roda VALIDATE aqui; o rollback devolve a condicao da 20261175 exata.
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
const NOME = "20261391000000_a_foto_da_devolucao_e_a_pergunta_tem_teto.sql";
const A = "98a-conferir-a-foto-da-devolucao-e-a-pergunta-tem-teto-aplicado";
const B = "98b-antes-a-foto-da-devolucao-e-a-pergunta-tem-teto-base-vigente";
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_FUNCAO = "0becd6ad09d4fad564a6622654cf0bc6";
const TETO = 30;
// pg_get_expr sem espacos e sem "public." — como o pre-voo, a conferencia e as consultas comparam.
const COND_175 =
  "((bucket_id=''devolucoes''::text)AND(split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text))";
const COND_DESTA =
  "((bucket_id=''devolucoes''::text)AND(split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text)AND((SELECTdevolucao__fotos_soltas_da_conta((SELECTauth.uid()ASuid),30)ASdevolucao__fotos_soltas_da_conta)<30))";

function corpoDaFuncao(sql) {
  const marca =
    "CREATE OR REPLACE FUNCTION public.devolucao__fotos_soltas_da_conta(";
  assert.equal(sql.split(marca).length - 1, 1);
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}

Deno.test("1391000: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; lock_timeout antes do pre-voo", () => {
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

Deno.test("1391000: a migration so RESTRINGE — nenhum DROP, nenhum DML, nenhum VALIDATE; o CHECK nasce NOT VALID", () => {
  const codigo = limpo(migration);
  assert.doesNotMatch(codigo, /\bDROP\b/i);
  assert.doesNotMatch(
    codigo,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b(?!\s*(ON|TO)\b)/i,
  );
  assert.doesNotMatch(codigo, /\bVALIDATE\s+CONSTRAINT\b/i);
  assert.doesNotMatch(codigo, /\bCREATE\s+(POLICY|TABLE|TRIGGER|INDEX)\b/i);
  assert.ok(
    migration.includes(
      "ADD CONSTRAINT questions_question_ate_500_caracteres CHECK (char_length(question) <= 500) NOT VALID;",
    ),
  );
  // ALTER POLICY (nome, comando, PERMISSIVE e papel ficam), nunca DROP + CREATE
  assert.equal(
    migration.split(
      "ALTER POLICY devolucoes_cliente_insert_policy ON storage.objects",
    ).length - 1,
    1,
  );
});

Deno.test("1391000: a funcao e' SECURITY INVOKER, STABLE, search_path fixo, md5 conhecido citado no pre-voo, na conferencia, no rollback e na 98a; EXECUTE nunca de anon/PUBLIC", () => {
  const corpo = corpoDaFuncao(migration);
  assert.equal(md5(corpo), H_FUNCAO);
  assert.ok(
    migration.includes(
      "CREATE OR REPLACE FUNCTION public.devolucao__fotos_soltas_da_conta(p_uid uuid, p_teto integer)\n" +
        "RETURNS integer\nLANGUAGE sql STABLE\nSET search_path = public\nAS $$",
    ),
  );
  assert.doesNotMatch(limpo(migration), /SECURITY DEFINER/i);
  // conta SO as soltas da pasta pedida, no bucket da devolucao, ate o teto
  for (const trecho of [
    "WHERE o.bucket_id = 'devolucoes'",
    "AND split_part(o.name, '/', 1) = p_uid::text",
    "AND NOT EXISTS (SELECT 1 FROM public.devolucoes d WHERE o.name = ANY (d.fotos))",
    "LIMIT p_teto",
  ])
    assert.equal(corpo.split(trecho).length - 1, 1, trecho);
  assert.equal(
    migration.split(`'${H_FUNCAO}'`).length - 1,
    2,
    "pre-voo e conferencia",
  );
  assert.ok(rollback.includes(`'${H_FUNCAO}'`));
  assert.ok(
    lerRepo(`scripts/publicacao/consultas/${A}.sql`).includes(`'${H_FUNCAO}'`),
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.devolucao__fotos_soltas_da_conta(uuid, integer) FROM PUBLIC, anon;",
    ),
  );
  assert.ok(
    migration.includes(
      "GRANT EXECUTE ON FUNCTION public.devolucao__fotos_soltas_da_conta(uuid, integer) TO authenticated, service_role;",
    ),
  );
  assert.equal((limpo(migration).match(/\bGRANT\b/g) ?? []).length, 1);
});

Deno.test("1391000: o teto (30 soltas) cabe 5x no fluxo legitimo da tela (6 fotos) e o da pergunta e' o da tela (500); a condicao normalizada e' a mesma em migration, rollback e consultas", () => {
  const devolucao = lerRepo("src/lib/devolucao.ts");
  const m = /export const MAXIMO_DE_FOTOS = (\d+);/.exec(devolucao);
  assert.ok(m, "MAXIMO_DE_FOTOS da tela");
  assert.ok(TETO >= 5 * Number(m[1]), `teto ${TETO} < 5 x ${m[1]}`);
  assert.ok(
    lerRepo("src/components/ui/custom/ProductQA.tsx").includes(
      "maxLength={500}",
    ),
  );
  assert.ok(
    migration.includes(
      `AND (SELECT public.devolucao__fotos_soltas_da_conta((SELECT auth.uid()), ${TETO})) < ${TETO}`,
    ),
  );
  for (const sql of [migration, rollback]) {
    assert.ok(sql.includes(`'${COND_DESTA}'`));
  }
  assert.ok(
    migration.includes(`'${COND_175}'`),
    "o pre-voo aceita a condicao da 175",
  );
  assert.ok(
    rollback.includes(`'${COND_175}'`),
    "a conferencia do rollback exige a da 175",
  );
  const a = lerRepo(`scripts/publicacao/consultas/${A}.sql`);
  const b = lerRepo(`scripts/publicacao/consultas/${B}.sql`);
  assert.ok(a.includes(COND_DESTA) && !a.includes(COND_175));
  assert.ok(b.includes(COND_175) && !b.includes(COND_DESTA));
});

Deno.test("1391000: o rollback devolve a condicao da 20261175000000 como ela a escreveu, tira a funcao e o CHECK, com pre-voo antes de escrever", () => {
  const v175 = ler("20261175000000_a_devolucao_nasce_no_pedido.sql");
  const cond175 =
    "WITH CHECK (bucket_id = 'devolucoes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);";
  assert.ok(v175.includes(cond175));
  assert.ok(
    rollback.includes(
      `ALTER POLICY devolucoes_cliente_insert_policy ON storage.objects\n  ${cond175}`,
    ),
  );
  assert.ok(
    rollback.includes(
      "DROP FUNCTION public.devolucao__fotos_soltas_da_conta(uuid, integer);",
    ),
  );
  assert.ok(
    rollback.includes(
      "ALTER TABLE public.questions DROP CONSTRAINT questions_question_ate_500_caracteres;",
    ),
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_20261391000000$");
  const iEscreve = rollback.indexOf(
    "\nALTER POLICY devolucoes_cliente_insert_policy",
  );
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261391000000$");
  assert.ok(iPre >= 0 && iPre < iEscreve && iEscreve < iConf);
  assert.ok(rollback.slice(iPre, iEscreve).includes("B1_BASELINE_DIVERGENT"));
});

Deno.test("1391000: publicacao — lote unico (98a/98b), rol fechado de 5 linhas, consultas so de catalogo, workflows, release, aplicador e prova viva", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261391000000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261391000000"]);
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
      /\bFROM\s+(storage\.objects|public\.questions|public\.devolucoes)\b/i,
      "nao le dado de cliente",
    );
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(nome);
    assert.equal(rol.length, 5, nome);
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
      "run: node tests/banco/rodar-isolado.cjs tests/banco/a-foto-da-devolucao-e-a-pergunta-tem-teto-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "a-foto-da-devolucao-e-a-pergunta-tem-teto-viva.cjs",
    ),
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = new Map(Object.entries(VERIFICACOES)).get(NOME);
  assert.equal(entrada.funcao, "devolucao__fotos_soltas_da_conta");
  const corpo = corpoDaFuncao(migration);
  for (const { texto, vezes } of entrada.esperado)
    assert.equal(corpo.split(texto).length - 1, vezes, texto);
});
