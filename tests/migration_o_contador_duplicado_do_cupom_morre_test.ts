// @ts-nocheck
// O CONTADOR DUPLICADO DO CUPOM MORRE -- prova offline do par 20261207000000 + rollback
// (cupom; politica P4 do dono; 09/10/2026). A prova VIVA (recusas sem gravar, corrida,
// lock_timeout, fotografia do banco antes e depois, rollback identico ao baseline,
// mutantes) mora em tests/banco/contador-duplicado-viva.cjs; aqui fica o que se prova so
// lendo o texto, e que o CI sem banco tambem cobra.
//
// Cada asserção esta amarrada a um risco: migration com BEGIN/COMMIT grava metade em
// producao; pre-voo depois do DROP, ou sem a trava da tabela, deixa uma gravacao entrar
// entre a contagem e o apagar; DROP com CASCADE leva embora o dependente que o pre-voo
// nao viu; `COALESCE(used_count, 0)` trata NULL como 0 e o rollback devolveria 0 onde era
// NULL; exclusao de TODO pg_attrdef esconde a coluna gerada que cita used_count; rollback
// com forma diferente da do baseline nao reproduz o estado anterior.
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

const DIR = fromFileUrl(new URL(".", import.meta.url));
const PASTA = `${DIR}../supabase/migrations`;
const NOME = "20261207000000_o_contador_duplicado_do_cupom_morre.sql";
const ler = (n) =>
  Deno.readTextFileSync(`${PASTA}/${n}`).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const baseline = ler("20260806000000_baseline_do_schema_vivo.sql");

const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
const semLiterais = (s) => s.replace(/'(?:[^']|'')*'/g, "''");
const codigo = (s) => semLiterais(semComentarios(s));
const ini = (t, s = migration) => {
  const i = s.indexOf(t);
  assert(i >= 0, `nao achei ${t}`);
  return i;
};

Deno.test("207: sem BEGIN/COMMIT de nivel superior e tudo em ASCII (migration e rollback)", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
  for (const t of [migration, rollback])
    assert(
      [...t].every((ch) => ch.charCodeAt(0) < 128),
      "caractere fora de ASCII",
    );
});

Deno.test("207: nome da versao: e a mais nova da pasta, o rollback e o irmao, e nenhuma outra migration usa a versao", () => {
  const nomes = [...Deno.readDirSync(PASTA)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("rollback-"));
  assertEquals(
    nomes.filter((n) => n.startsWith("20261207000000")),
    [NOME],
  );
  assertEquals(
    nomes.filter((n) => n > NOME),
    [],
  );
  assert(
    [...Deno.readDirSync(PASTA)].some(
      (e) => e.name === `rollback-manual-${NOME}`,
    ),
  );
});

Deno.test("207: a ordem e trava de tempo -> trava da tabela -> pre-voo -> UM DROP -> pos-voo, e o pre-voo trava ANTES de ler", () => {
  const c = semComentarios(migration);
  const ordem = [
    "SET LOCAL lock_timeout",
    "SET LOCAL statement_timeout",
    "DO $preflight_20261207$",
    "LOCK TABLE public.coupons IN ACCESS EXCLUSIVE MODE",
    "ALTER TABLE public.coupons DROP COLUMN IF EXISTS used_count",
    "DO $posvoo_20261207$",
  ].map((t) => c.indexOf(t));
  assert(
    ordem.every((i) => i >= 0),
    JSON.stringify(ordem),
  );
  assertEquals(
    [...ordem].sort((a, b) => a - b),
    ordem,
  );
  // a trava vem antes de QUALQUER leitura de used_count/usage_count dentro do pre-voo
  const pre = c.slice(c.indexOf("DO $preflight_20261207$"));
  const iLock = pre.indexOf("LOCK TABLE");
  assert(iLock > 0);
  for (const leitura of [
    "FROM pg_attribute",
    "FROM pg_depend",
    "FROM pg_proc",
    "count(*) FROM public.coupons",
  ])
    assert(pre.indexOf(leitura) > iLock, `${leitura} antes da trava`);
  assertEquals(c.match(/\bLOCK TABLE\b/g).length, 1);
});

Deno.test("207: a trava e ACCESS EXCLUSIVE no inicio do pre-voo (SHARE ROW EXCLUSIVE dava deadlock com o pedido que ja segura a linha do cupom)", () => {
  const c = semComentarios(migration);
  assertEquals(
    c.match(/LOCK TABLE public\.coupons IN ([A-Z ]+) MODE;/)[1],
    "ACCESS EXCLUSIVE",
  );
  assert(
    !/SHARE ROW EXCLUSIVE/.test(c),
    "a trava mais fraca reabre o deadlock",
  );
  // o LOCK e o primeiro comando do pre-voo depois de ver se a tabela existe
  const pre = c.slice(c.indexOf("DO $preflight_20261207$"));
  assert(
    pre.indexOf("LOCK TABLE") < pre.indexOf("pg_attribute"),
    "o LOCK vem antes de qualquer leitura",
  );
  for (const frase of [
    "deadlock",
    "create_marketplace_order_v23/v24",
    "ACCESS EXCLUSIVE",
    "55P03",
  ])
    assertStringIncludes(migration, frase);
});

Deno.test("207: o FOR SHARE vem DEPOIS da trava e ANTES da contagem (envelope REPEATABLE READ: a foto e anterior ao LOCK)", () => {
  const c = semComentarios(migration);
  const pre = c.slice(c.indexOf("DO $preflight_20261207$"));
  assertEquals(c.match(/FOR SHARE/g).length, 1);
  const iLock = pre.indexOf("LOCK TABLE");
  const iShare = pre.indexOf("PERFORM 1 FROM public.coupons FOR SHARE;");
  const iConta = pre.indexOf("used_count IS DISTINCT FROM 0");
  assert(
    iLock > 0 && iShare > iLock && iConta > iShare,
    `${iLock} ${iShare} ${iConta}`,
  );
  // e a verdade esta escrita no cabecalho: a trava vale do LOCK em diante; o resto e risco residual aceito
  for (const frase of [
    "40001",
    "REPEATABLE READ",
    "RISCO RESIDUAL ACEITO",
    "INSERT",
  ])
    assertStringIncludes(migration, frase);
});

Deno.test("207: (e) varre as funcoes de TODOS os schemas (so ficam de fora pg_catalog, information_schema e pg_toast), nunca so public", () => {
  const c = semComentarios(migration).replace(/\s+/g, " ");
  assertStringIncludes(
    c,
    "WHERE s.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND strpos(lower(p.prosrc), 'used_count') > 0",
  );
  assert(
    !/s\.nspname\s*=\s*'public'/.test(c),
    "o filtro so de public deixa passar funcao de outro schema",
  );
});

Deno.test("207: so apaga a coluna used_count -- sem CASCADE, sem outro DROP, sem escrita em dado", () => {
  const c = codigo(migration);
  assertEquals(c.match(/\bDROP\b/gi).length, 1);
  assertEquals(c.match(/\bALTER\b/gi).length, 1);
  assert(
    !/CASCADE/i.test(c),
    "CASCADE levaria o dependente que o pre-voo nao viu",
  );
  assert(
    !/\b(DELETE|TRUNCATE|UPDATE|INSERT|GRANT|REVOKE|CREATE)\b/i.test(c),
    "a migration so le e apaga a coluna",
  );
  assertStringIncludes(
    c,
    "ALTER TABLE public.coupons DROP COLUMN IF EXISTS used_count;",
  );
});

Deno.test("207: o pre-voo recusa por cada condicao, com o NOME do motivo e dizendo que nada foi apagado", () => {
  const pre = migration.slice(
    ini("DO $preflight_20261207$"),
    ini("$preflight_20261207$;"),
  );
  for (const frase of [
    "PREFLIGHT_20261207: falta a tabela public.coupons",
    "PREFLIGHT_20261207: public.coupons.usage_count nao existe",
    "PREFLIGHT_20261207: public.coupons.used_count nao tem a forma do baseline",
    "PREFLIGHT_20261207: public.coupons.used_count tem permissao propria por coluna (attacl)",
    "PREFLIGHT_20261207: public.coupons.used_count tem comentario proprio (pg_description)",
    "PREFLIGHT_20261207: a seguranca por linha vale para este papel",
    "PREFLIGHT_20261207: % objeto(s) dependem de public.coupons.used_count",
    "PREFLIGHT_20261207: % funcao(oes) citam used_count",
    "PREFLIGHT_20261207: used_count tem % linha(s) diferente(s) de 0 (NULL conta)",
  ])
    assertEquals(pre.split(`RAISE EXCEPTION '${frase}`).length - 1, 1, frase);
  assertEquals(
    migration.split("RAISE EXCEPTION 'POSVOO_20261207").length - 1,
    2,
  );
  // toda recusa de dado diz "nada foi apagado" (menos a de tabela ausente, que nao tem o que apagar)
  const raises = [...pre.matchAll(/RAISE EXCEPTION '([^']*)'/g)].map(
    (m) => m[1],
  );
  for (const r of raises.filter((x) => !x.includes("falta a tabela")))
    assertStringIncludes(r, "nada foi apagado");
});

Deno.test("207: (d) so o DEFAULT da PROPRIA coluna fica de fora (pg_attrdef com a mesma coluna); nunca todo pg_attrdef", () => {
  const c = semComentarios(migration);
  assert(
    !/classid\s*<>\s*'pg_attrdef'/.test(c),
    "excluir todo pg_attrdef esconde a coluna gerada que cita used_count",
  );
  const bloco = c.slice(c.indexOf("FROM pg_depend d"), c.indexOf("IF v_n > 0"));
  for (const t of [
    "d.refclassid = 'pg_class'::regclass",
    "d.refobjid = 'public.coupons'::regclass",
    "d.refobjsubid = v_attnum",
    "NOT (",
    "d.classid = 'pg_attrdef'::regclass",
    "ad.oid = d.objid",
    "ad.adrelid = d.refobjid",
    "ad.adnum = d.refobjsubid",
  ])
    assertStringIncludes(bloco.replace(/\s+/g, " "), t.replace(/\s+/g, " "));
});

Deno.test("207: (f) NULL RECUSA (IS DISTINCT FROM 0), nao COALESCE; e (b) exige a forma do baseline", () => {
  const c = semComentarios(migration);
  assertStringIncludes(c, "used_count IS DISTINCT FROM 0");
  assert(!/COALESCE\s*\(\s*used_count/i.test(c), "COALESCE trata NULL como 0");
  // (b): integer, aceita NULL, DEFAULT 0, nem gerada nem identidade
  for (const t of [
    "a.atttypid = 'integer'::regtype",
    "NOT a.attnotnull",
    "a.attgenerated = ''",
    "a.attidentity = ''",
    "pg_get_expr(ad.adbin, ad.adrelid) IS NOT DISTINCT FROM '0'",
  ])
    assertStringIncludes(c.replace(/\s+/g, " "), t);
  // (c): a seguranca por linha
  assertStringIncludes(c, "row_security_active('public.coupons')");
});

Deno.test("207: a forma do baseline que o pre-voo e o rollback aceitam e a que o baseline define (integer DEFAULT 0, sem NOT NULL)", () => {
  const i = baseline.indexOf("CREATE TABLE public.coupons (");
  const tabela = baseline.slice(i, baseline.indexOf(");", i));
  assertEquals(
    [...tabela.matchAll(/^\s*used_count (.*?),?$/gm)].map((m) => m[1]),
    ["integer DEFAULT 0"],
  );
  assertStringIncludes(
    rollback,
    "ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS used_count integer DEFAULT 0;",
  );
});

Deno.test("207: o rollback so recria a coluna (sem DROP, sem dado), confere a forma depois e tem a trava de tempo", () => {
  const c = semComentarios(rollback);
  const k = codigo(rollback);
  assert(
    !/\bDROP\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b|\bTRUNCATE\b|CASCADE/i.test(k),
  );
  assertEquals(k.match(/\bALTER\b/gi).length, 1);
  assert(c.indexOf("SET LOCAL lock_timeout") < c.indexOf("ALTER TABLE"));
  assert(c.indexOf("ALTER TABLE") < c.indexOf("RAISE EXCEPTION"));
  assertEquals(
    rollback.split(
      "RAISE EXCEPTION 'ROLLBACK_20261207: public.coupons.used_count existe mas nao tem a forma",
    ).length - 1,
    1,
  );
  for (const t of [
    "a.atttypid = 'integer'::regtype",
    "NOT a.attnotnull",
    "a.attgenerated = ''",
    "a.attidentity = ''",
    "pg_get_expr(ad.adbin, ad.adrelid) IS NOT DISTINCT FROM '0'",
  ])
    assertStringIncludes(c.replace(/\s+/g, " "), t);
});

Deno.test("207: ninguem na arvore de producao cita used_count alem de comentario (src, functions, scripts, workflows)", async () => {
  const RAIZ = `${DIR}..`;
  const achados: string[] = [];
  async function varrer(dir: string) {
    for await (const e of Deno.readDir(dir)) {
      const caminho = `${dir}/${e.name}`;
      if (e.isDirectory) {
        if (["node_modules", ".git", "dist", "coverage"].includes(e.name))
          continue;
        await varrer(caminho);
      } else if (/\.(ts|tsx|js|jsx|cjs|mjs|json|yml|yaml|sql)$/.test(e.name)) {
        // as migrations, as consultas de medicao (13a/14a/14b) e o rol delas em conferir-banco.cjs citam por obrigacao
        if (
          caminho.includes("/supabase/migrations/") ||
          caminho.includes("/scripts/publicacao/consultas/") ||
          caminho.endsWith("/scripts/publicacao/conferir-banco.cjs") ||
          caminho.includes("/tests/") ||
          caminho.includes("/docs/")
        )
          continue;
        const texto = await Deno.readTextFile(caminho);
        const codigoSemComentario = texto
          .split("\n")
          .filter((l) => !/^\s*(\/\/|\*|\/\*|#|--)/.test(l))
          .join("\n");
        if (codigoSemComentario.includes("used_count")) achados.push(caminho);
      }
    }
  }
  for (const sub of ["src", "supabase/functions", "scripts", ".github"])
    await varrer(`${RAIZ}/${sub}`);
  // os tipos gerados (src/types/database.types.ts) so deixam de citar quando a coluna sai do banco
  assertEquals(achados, []);
});
