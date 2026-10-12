// @ts-nocheck
// A FOTO DO PERFIL TEM TETO E O PAINEL FECHA AO VISITANTE — prova offline do par 20261218000000 +
// rollback (auditoria de 12/10/2026, lote L2). O COMPORTAMENTO (teto da foto e da capa no INSERT e
// no UPDATE, linha antiga grande que continua editavel, sincronizacao com public_profiles, a contagem
// do push e a view do painel por papel, reaplicar e o rollback no banco) e' provado em
// tests/banco/portas-do-banco-viva.cjs; o portao (22a/22b) em tests/banco/portas-do-banco-portao-viva.cjs.
// Aqui fica o que se prova so lendo o texto, no `npm run test:unit`.
//
// Cada assercao esta amarrada a um risco: transacao propria grava meia mudanca; hash de pre-voo que
// nao e' o md5 real recusa num banco correto; CHECK no lugar do gatilho trava o perfil inteiro de quem
// ja tem imagem grande; gatilho sem comparar com OLD recusa o telefone de quem ja tem imagem grande
// (a RPC regrava as quatro colunas); REVOKE so de PUBLIC deixa o grant proprio do anon; recriar o
// corpo da contagem muda o md5 que outras consultas conferem; REVOKE do authenticated na view para o
// cadastro de produto; rollback que nao devolve o medido deixa a loja num terceiro estado.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261218000000_a_foto_do_perfil_tem_teto_e_o_painel_fecha_ao_visitante.sql";
const lerArquivo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");

/** Texto da funcao num arquivo, do CREATE ate o `$$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert.ok(i >= 0, `${nome} nao encontrada`);
  assert.equal(sql.indexOf(marcador, i + 1), -1, `${nome} aparece 2x`);
  const resto = sql.slice(i + 1);
  return resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
};
/** O que o Postgres grava em prosrc: entre `AS $$` e `$$;`. */
const corpo = (texto) =>
  texto.slice(
    texto.indexOf("AS $$") + "AS $$".length,
    texto.length - "$$;".length,
  );

const migrationsAntes = () =>
  [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();

const gatilho = funcao(migration, "perfil_recusa_imagem_grande");

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
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
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("o pre-voo cita o md5 REAL do corpo vigente da contagem do push (a ultima definicao antes desta)", () => {
  const definem = migrationsAntes().filter((n) =>
    /CREATE OR REPLACE FUNCTION public\.get_segmented_push_count\(/.test(
      semComentarios(ler(n)),
    ),
  );
  assert.equal(
    definem.at(-1),
    "20261199000000_portas_do_painel_exigem_admin_atual.sql",
  );
  const vigente = md5(
    corpo(funcao(ler(definem.at(-1)), "get_segmented_push_count")),
  );
  assert.equal(vigente, "e5f6b76afd6ec75df32f168d9942e209");
  for (const sql of [migration, rollback]) {
    assert.ok(sql.includes(`IS DISTINCT FROM '${vigente}'`), "pre-voo");
    assert.ok(sql.includes("md5(replace(prosrc, E'\\r', ''))"));
    assert.ok(sql.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  }
  // a conferencia final tambem exige o mesmo corpo (o lote nao o recria)
  const conferencia = migration.slice(
    migration.indexOf("DO $conferencia_20261218$"),
  );
  assert.ok(conferencia.includes(`IS DISTINCT FROM '${vigente}'`));
});

Deno.test("o corpo da contagem do push NAO e recriado (so a ACL muda)", () => {
  for (const sql of [migration, rollback]) {
    assert.doesNotMatch(
      semComentarios(sql),
      /(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.get_segmented_push_count/i,
    );
  }
});

Deno.test("o pre-voo e o do rollback citam o md5 REAL do corpo da funcao de gatilho", () => {
  const h = md5(corpo(gatilho));
  assert.ok(migration.includes(`v_hash <> '${h}'`), "pre-voo da migration");
  assert.ok(rollback.includes(`v_hash <> '${h}'`), "pre-voo do rollback");
});

Deno.test("a funcao de gatilho: sem SECURITY DEFINER, search_path fechado, tetos 128 KiB e 512 KiB em bytes", () => {
  const cab = gatilho.slice(0, gatilho.indexOf("AS $$"));
  assert.doesNotMatch(cab, /SECURITY\s+DEFINER/i);
  assert.match(cab, /RETURNS trigger/);
  assert.match(cab, /LANGUAGE plpgsql/);
  assert.match(cab, /SET search_path TO 'pg_catalog', 'public'/);
  const c = corpo(gatilho);
  assert.match(c, /c_teto_foto constant integer := 131072;/);
  assert.match(c, /c_teto_capa constant integer := 524288;/);
  // tamanho em BYTES do texto gravado (length() contaria caracteres)
  assert.doesNotMatch(c, /\blength\(/);
  assert.equal((c.match(/octet_length\(NEW\.avatar_url\)/g) || []).length, 2);
  assert.equal((c.match(/octet_length\(NEW\.cover_url\)/g) || []).length, 2);
  assert.equal((c.match(/USING ERRCODE = '23514'/g) || []).length, 4);
  // nao le tabela nenhuma (nada de public_profiles, nada de SELECT/UPDATE)
  assert.doesNotMatch(c, /\b(SELECT|INSERT|UPDATE|DELETE)\b\s/);
  assert.doesNotMatch(c, /public_profiles/);
});

Deno.test("a funcao de gatilho separa INSERT de UPDATE e, no UPDATE, so confere a coluna que MUDOU", () => {
  const c = corpo(gatilho);
  const iInsert = c.indexOf("IF TG_OP = 'INSERT' THEN");
  const iRetorno = c.indexOf("RETURN NEW;", iInsert);
  assert.ok(iInsert >= 0 && iRetorno > iInsert, "ramo do INSERT com RETURN");
  const ramoInsert = c.slice(iInsert, iRetorno);
  assert.doesNotMatch(ramoInsert, /\bOLD\b/, "OLD e' nulo no INSERT");
  const ramoUpdate = c.slice(iRetorno);
  // o OLD so aparece depois do RETURN do INSERT, e o tamanho so e' medido dentro do IF de mudanca
  assert.match(
    ramoUpdate,
    /IF NEW\.avatar_url IS DISTINCT FROM OLD\.avatar_url THEN\n\s+IF coalesce\(octet_length\(NEW\.avatar_url\), 0\) > c_teto_foto THEN/,
  );
  assert.match(
    ramoUpdate,
    /IF NEW\.cover_url IS DISTINCT FROM OLD\.cover_url THEN\n\s+IF coalesce\(octet_length\(NEW\.cover_url\), 0\) > c_teto_capa THEN/,
  );
  // sem curto-circuito de OR/AND no PL/pgSQL entre a mudanca e o tamanho
  assert.doesNotMatch(c, /DISTINCT FROM OLD\.\w+\s+(AND|OR)\b/);
});

Deno.test("o gatilho e BEFORE INSERT OR UPDATE OF avatar_url, cover_url, por linha, e NADA de CHECK", () => {
  const sql = limpo(migration);
  assert.ok(
    sql.includes(
      "CREATE OR REPLACE TRIGGER tr_perfil_recusa_imagem_grande BEFORE INSERT OR UPDATE OF avatar_url, cover_url ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.perfil_recusa_imagem_grande();",
    ),
  );
  assert.doesNotMatch(sql, /\bADD\s+CONSTRAINT\b|\bCHECK\s*\(/i);
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(sql, /public_profiles/);
});

Deno.test("EXECUTE da funcao de gatilho fechado para PUBLIC, anon e authenticated (REVOKE ALL)", () => {
  const sql = limpo(migration);
  for (const papel of ["PUBLIC", "anon", "authenticated"])
    assert.ok(
      sql.includes(
        `REVOKE ALL ON FUNCTION public.perfil_recusa_imagem_grande() FROM ${papel};`,
      ),
      papel,
    );
  assert.doesNotMatch(
    sql,
    /GRANT [^;]*perfil_recusa_imagem_grande/,
    "ninguem precisa executar a funcao de gatilho",
  );
});

Deno.test("contagem do push: REVOKE ALL de PUBLIC E de anon ANTES do GRANT a authenticated e service_role", () => {
  const sql = limpo(migration);
  const assin = "public.get_segmented_push_count(text, numeric, integer)";
  const pos = (frase) => {
    const i = sql.indexOf(frase);
    assert.ok(i >= 0, frase);
    return i;
  };
  const rPublic = pos(`REVOKE ALL ON FUNCTION ${assin} FROM PUBLIC;`);
  const rAnon = pos(`REVOKE ALL ON FUNCTION ${assin} FROM anon;`);
  const gAuth = pos(`GRANT EXECUTE ON FUNCTION ${assin} TO authenticated;`);
  const gServ = pos(`GRANT EXECUTE ON FUNCTION ${assin} TO service_role;`);
  assert.ok(Math.max(rPublic, rAnon) < Math.min(gAuth, gServ));
  assert.doesNotMatch(sql, /get_segmented_push_count[^;]* TO (PUBLIC|anon)\b/);
});

Deno.test("view do painel: REVOKE ALL de PUBLIC e anon; authenticated intocado; sem security_invoker", () => {
  const sql = limpo(migration);
  assert.ok(
    sql.includes("REVOKE ALL ON TABLE public.vw_produtos_admin FROM anon;"),
  );
  assert.ok(
    sql.includes("REVOKE ALL ON TABLE public.vw_produtos_admin FROM PUBLIC;"),
  );
  assert.doesNotMatch(sql, /vw_produtos_admin[^;]*\bauthenticated\b/);
  assert.doesNotMatch(sql, /security_invoker/i);
  assert.doesNotMatch(sql, /(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?VIEW/i);
});

Deno.test("a conferencia final RECUSA (RAISE EXCEPTION) cada efeito que nao aconteceu", () => {
  const i = migration.indexOf("DO $conferencia_20261218$");
  assert.ok(i > migration.indexOf("REVOKE ALL ON TABLE public.vw_produtos_admin FROM anon;"));
  const c = migration.slice(i);
  for (const trecho of [
    "t.tgenabled = 'O'",
    "replace(pg_get_triggerdef(t.oid), 'public.', '') =",
    "'CREATE TRIGGER tr_perfil_recusa_imagem_grande BEFORE INSERT OR UPDATE OF avatar_url, cover_url ON profiles FOR EACH ROW EXECUTE FUNCTION perfil_recusa_imagem_grande()'",
    "SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(v_gatilho)",
    "has_function_privilege('anon', v_fn, 'EXECUTE')",
    "has_function_privilege('authenticated', v_fn, 'EXECUTE')",
    "has_function_privilege('service_role', v_fn, 'EXECUTE')",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_table_privilege('anon', 'public.vw_produtos_admin', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')",
    "has_any_column_privilege('anon', 'public.vw_produtos_admin', 'SELECT,INSERT,UPDATE,REFERENCES')",
    "has_table_privilege('authenticated', 'public.vw_produtos_admin', 'SELECT')",
    "has_table_privilege('authenticated', 'public.vw_produtos_admin', 'INSERT')",
    "has_table_privilege('authenticated', 'public.vw_produtos_admin', 'UPDATE')",
    "has_table_privilege('authenticated', 'public.vw_produtos_admin', 'DELETE')",
  ])
    assert.ok(c.includes(trecho), trecho);
  assert.ok((c.match(/RAISE EXCEPTION/g) || []).length >= 6);
  for (const sql of [migration, rollback])
    assert.doesNotMatch(
      sql,
      /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i,
      "bloco que so avisa nao recusa",
    );
});

Deno.test("o rollback devolve o estado medido antes: sem gatilho, EXECUTE de PUBLIC e anon, SELECT e REFERENCES de anon", () => {
  const sql = limpo(rollback);
  assert.ok(
    sql.includes(
      "DROP TRIGGER IF EXISTS tr_perfil_recusa_imagem_grande ON public.profiles;",
    ),
  );
  assert.ok(
    sql.includes(
      "DROP FUNCTION IF EXISTS public.perfil_recusa_imagem_grande();",
    ),
  );
  assert.ok(
    sql.indexOf("DROP TRIGGER") < sql.indexOf("DROP FUNCTION"),
    "gatilho antes da funcao",
  );
  const assin = "public.get_segmented_push_count(text, numeric, integer)";
  assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${assin} TO PUBLIC;`));
  assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${assin} TO anon;`));
  // so leitura volta para o anon: a escrita foi tirada pela 20261090000000 e nao volta
  assert.ok(
    sql.includes(
      "GRANT SELECT, REFERENCES ON TABLE public.vw_produtos_admin TO anon;",
    ),
  );
  assert.doesNotMatch(
    sql,
    /GRANT [^;]*(INSERT|UPDATE|DELETE|TRUNCATE|TRIGGER|MAINTAIN|ALL)[^;]*vw_produtos_admin/i,
  );
  assert.doesNotMatch(sql, /\bREVOKE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|VIEW|COLUMN|POLICY)\b/i);
  assert.ok(rollback.includes("DO $conferencia_rollback_20261218$"));
});
