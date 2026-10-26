// @ts-nocheck
// NINGUEM GRAVA EVENTO DE ANALISE PELA API — prova offline do par 20261391100000 + rollback (cacada de 26/10/2026).
// NAO E ADITIVA (REVOKE + DROP POLICY): para no dono antes de aplicar. O COMPORTAMENTO (conta logada recusada com 42501, controle
// com o rollback, servidor grava, admin le, reaplicar, rollback exato do ACL e da politica, pre-voo, consultas 99a/99b) e' provado em
// tests/banco/ninguem-grava-evento-de-analise-pela-api-viva.cjs. Aqui fica o que se prova so lendo o texto: a premissa (ninguem
// do app grava na tabela), o alcance (so INSERT de authenticated e a politica de INSERT; nenhum dado, nenhuma outra permissao) e o
// rollback (recria a politica da 20261112000000 exatamente).
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261391100000_ninguem_grava_evento_de_analise_pela_api.sql";
const A = "99a-conferir-ninguem-grava-evento-de-analise-aplicado";
const B = "99b-antes-ninguem-grava-evento-de-analise-base-vigente";
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");

/** Arquivos de um diretorio, recursivo. */
function arquivos(rel, extensoes) {
  const saida = [];
  const andar = (url, caminho) => {
    for (const e of Deno.readDirSync(url)) {
      const filho = `${caminho}/${e.name}`;
      if (e.isDirectory) andar(new URL(`${e.name}/`, url), filho);
      else if (extensoes.some((x) => e.name.endsWith(x))) saida.push(filho);
    }
  };
  andar(new URL(`${rel}/`, DIR), rel);
  return saida;
}

Deno.test("1391100: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; lock_timeout antes do pre-voo", () => {
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

Deno.test("1391100: a premissa — nenhum gravador no app: src/ e supabase/functions so citam analytics_events em tipos; nenhuma migration cria funcao que grave nela", () => {
  const gravadores = [];
  for (const arq of [
    ...arquivos("src", [".ts", ".tsx"]),
    ...arquivos("supabase/functions", [".ts"]),
  ]) {
    const t = lerRepo(arq);
    if (!t.includes("analytics_events")) continue;
    if (arq.endsWith("database.types.ts")) continue;
    gravadores.push(arq);
  }
  assert.deepEqual(
    gravadores,
    [],
    "algum codigo do app passou a citar analytics_events",
  );
  const funcoesQueGravam = [];
  for (const n of [
    ...Deno.readDirSync(new URL("supabase/migrations/", DIR)),
  ].map((e) => e.name)) {
    if (!n.endsWith(".sql") || n.startsWith("rollback-manual-")) continue;
    const sql = limpo(ler(n));
    if (/insert\s+into\s+(public\.)?"?analytics_events/i.test(sql))
      funcoesQueGravam.push(n);
  }
  assert.deepEqual(
    funcoesQueGravam,
    [],
    "alguma migration grava em analytics_events",
  );
});

Deno.test("1391100: o alcance — SO o INSERT de authenticated e a politica de INSERT; nenhum dado, nenhuma outra permissao, nenhum outro objeto", () => {
  const codigo = limpo(migration);
  assert.equal((codigo.match(/\bREVOKE\b/g) ?? []).length, 1);
  assert.ok(
    codigo.includes(
      "REVOKE INSERT ON public.analytics_events FROM authenticated;",
    ),
  );
  assert.equal((codigo.match(/\bDROP\b/g) ?? []).length, 1);
  assert.ok(
    codigo.includes(
      "DROP POLICY IF EXISTS analytics_events_insert_policy ON public.analytics_events;",
    ),
  );
  assert.doesNotMatch(codigo, /\bGRANT\b/);
  assert.doesNotMatch(
    codigo,
    /\b(DELETE\s+FROM|UPDATE\s+\w|TRUNCATE|ALTER\s+TABLE|CREATE\s+(POLICY|FUNCTION|TABLE))\b/i,
  );
  // a leitura do admin e o servidor ficam (a conferencia exige)
  for (const trecho of [
    "analytics_events_select_policy",
    "has_table_privilege('service_role', 'public.analytics_events', 'INSERT')",
    "has_table_privilege('anon', 'public.analytics_events', 'INSERT')",
    "has_any_column_privilege('authenticated', 'public.analytics_events', 'INSERT')",
  ])
    assert.ok(migration.includes(trecho), trecho);
  // o pre-voo vem antes do REVOKE e recusa funcao que grave na tabela e outra politica de INSERT/ALL
  const iPre = migration.indexOf("DO $preflight_20261391100000$");
  const iRevoke = migration.indexOf("\nREVOKE INSERT");
  assert.ok(
    iPre >= 0 &&
      iPre < iRevoke &&
      iRevoke < migration.indexOf("DO $conferencia_20261391100000$"),
  );
  const pre = migration.slice(iPre, iRevoke);
  for (const trecho of [
    'insert[[:space:]]+into[[:space:]]+(public[.])?"?analytics_events',
    "p.polcmd IN ('a', '*')",
    "'((SELECTauth.uid()ASuid)=user_id)'",
    "B1_BASELINE_DIVERGENT",
  ])
    assert.ok(pre.includes(trecho), trecho);
});

Deno.test("1391100: o cabecalho declara que NAO E ADITIVA e que para no dono; o rollback recria a politica da 20261112000000 exatamente e devolve o GRANT", () => {
  assert.match(migration, /N[ÃA]O ADITIVA/);
  assert.match(migration, /ESTA PARA NELE/);
  const v112 = ler(
    "20261112000000_analytics_events_para_de_aceitar_gravacao_anonima.sql",
  );
  const politica112 =
    "CREATE POLICY analytics_events_insert_policy ON public.analytics_events\n" +
    "  FOR INSERT TO authenticated\n" +
    "  WITH CHECK ((SELECT auth.uid()) = user_id);";
  assert.ok(v112.includes(politica112));
  assert.ok(rollback.includes(politica112));
  assert.ok(
    rollback.includes(
      "GRANT INSERT ON public.analytics_events TO authenticated;",
    ),
  );
  assert.doesNotMatch(
    limpo(rollback),
    /\bTO\s+anon\b/i,
    "o rollback nunca devolve nada ao anon",
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_20261391100000$");
  const iGrant = rollback.indexOf("\nGRANT INSERT");
  assert.ok(
    iPre >= 0 &&
      iPre < iGrant &&
      iGrant < rollback.indexOf("DO $conferencia_rollback_20261391100000$"),
  );
  assert.ok(rollback.slice(iPre, iGrant).includes("B1_BASELINE_DIVERGENT"));
});

Deno.test("1391100: publicacao — lote unico (99a/99b) marcado NAO ADITIVO, rol fechado de 4 linhas, consultas so de catalogo, workflows, release e prova viva; o aplicador nao confere (so REVOKE/DROP POLICY)", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261391100000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261391100000"]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  assert.match(lote[0]._comentario, /NAO E ADITIVA/);
  assert.match(lote[0]._comentario, /PARA NO DONO/);
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const nome of [A, B]) {
    const sql = lerRepo(`scripts/publicacao/consultas/${nome}.sql`);
    assert.doesNotMatch(
      limpo(sql),
      /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      limpo(sql),
      /\bFROM\s+(public\.)?analytics_events\b/i,
      "nao le evento",
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
      "run: node tests/banco/rodar-isolado.cjs tests/banco/ninguem-grava-evento-de-analise-pela-api-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "ninguem-grava-evento-de-analise-pela-api-viva.cjs",
    ),
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  assert.equal(
    Object.hasOwn(VERIFICACOES, NOME),
    false,
    "so REVOKE/DROP POLICY: sai PULADA por desenho no db-apply",
  );
});
