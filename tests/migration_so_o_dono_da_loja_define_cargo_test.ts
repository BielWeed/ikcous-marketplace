import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// A prova de comportamento usa Postgres efemero (tests/banco/definir-cargo-so-o-dono-viva.cjs); aqui guardamos o contrato dos arquivos.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
const { conferirLista } = require("./banco/sucessoras-da-99.cjs");
const nome = "20261383000000_so_o_dono_da_loja_define_cargo.sql";
const ler = (n: string) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${n}`, import.meta.url),
  ).replace(/\r/g, "");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// O corpo (prosrc) de uma funcao: o texto entre os dois $function$ do CREATE OR REPLACE dela.
function corpo(sql: string, funcao: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${funcao}(`);
  assert(i >= 0, `${funcao} nao esta na migration`);
  const abre = sql.indexOf("$function$", i) + "$function$".length;
  return sql.slice(abre, sql.indexOf("$function$", abre));
}

Deno.test("1383: sem BEGIN/COMMIT, com preflight e posflight, rollback comum e destrutivo", () => {
  const sql = ler(nome);
  const rollback = ler(`rollback-manual-${nome}`);
  const destrutivo = ler(`rollback-manual-destrutivo-${nome}`);
  assertEquals(
    avaliarFase0({
      sqlMigration: sql,
      sqlRollback: rollback,
      temRollback: true,
    }).recusado,
    false,
  );
  assertEquals(
    avaliarFase0({
      sqlMigration: sql,
      sqlRollback: destrutivo,
      temRollback: true,
    }).recusado,
    false,
  );
  for (const s of [sql, rollback, destrutivo]) {
    assert(
      !/^\s*(BEGIN|COMMIT|START TRANSACTION)\s*;/im.test(s),
      "sem BEGIN/COMMIT de nivel superior",
    );
    assertStringIncludes(s, "SET LOCAL lock_timeout");
  }
  assertStringIncludes(sql, "$preflight_20261383000000$");
  assertStringIncludes(sql, "$posflight_20261383000000$");
  assertStringIncludes(sql, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  // O rollback comum NAO apaga dado; so o destrutivo apaga as tabelas, e so com a confirmacao.
  assert(
    !/DROP TABLE/i.test(rollback.replace(/--.*$/gm, "")),
    "o rollback comum nao apaga tabela",
  );
  assertStringIncludes(destrutivo, "app.confirmo_apagar_cargos");
  assertStringIncludes(destrutivo, "DROP TABLE IF EXISTS public.cargo_log;");
  assertStringIncludes(destrutivo, "DROP TABLE IF EXISTS public.dono_da_loja;");
  assert(!/CASCADE/i.test(destrutivo.replace(/--.*$/gm, "")), "sem CASCADE");
});

Deno.test("1383: o md5 declarado nos tres arquivos e' o do corpo real das duas funcoes", () => {
  const sql = ler(nome);
  const rollback = ler(`rollback-manual-${nome}`);
  const hD = md5(corpo(sql, "definir_cargo"));
  const hG = md5(corpo(sql, "papel_so_pelo_definir_cargo"));
  // Pre-voo, pos-voo (migration) e rollback citam os mesmos dois hashes; nenhum token sobrou.
  assert(
    !sql.includes("@@") && !rollback.includes("@@"),
    "token sem preencher",
  );
  assertEquals(
    sql.split(`'${hD}'`).length - 1,
    2,
    "definir_cargo: pre-voo + pos-voo",
  );
  assertEquals(
    sql.split(`'${hG}'`).length - 1,
    2,
    "gatilho: pre-voo + pos-voo",
  );
  assertEquals(rollback.split(`'${hD}'`).length - 1, 1);
  assertEquals(rollback.split(`'${hG}'`).length - 1, 1);
});

Deno.test("1383: nenhum seed do dono; o comando de cadastro esta so em comentario; nenhuma funcao dos 42 da 99 e' redefinida", () => {
  const sql = ler(nome);
  const semComentario = sql.replace(/--.*$/gm, "");
  assert(
    !/INSERT\s+INTO\s+public\.dono_da_loja/i.test(semComentario),
    "a migration nao pode cadastrar o dono por conta propria",
  );
  assertStringIncludes(
    sql,
    "INSERT INTO public.dono_da_loja (user_id) VALUES ('<uuid-do-dono-em-auth.users>');",
  );
  assertStringIncludes(
    ler(`rollback-manual-${nome}`),
    "INSERT INTO public.dono_da_loja (user_id) VALUES ('<uuid-do-dono-em-auth.users>');",
  );
  // A lista vigiada de sucessoras da 20261199 segue valida (nenhum dos 42 corpos e' redefinido aqui).
  conferirLista();
  for (const f of [
    "ensure_role_protection",
    "prevent_role_change",
    "handle_profile_role_sync_to_auth",
  ]) {
    // Espacos normalizados e caixa alta: sem montar expressao regular a partir do nome.
    const normalizado = semComentario.replace(/\s+/g, " ").toUpperCase();
    const nomeAlto = f.toUpperCase();
    assert(
      !normalizado.includes(`CREATE FUNCTION PUBLIC.${nomeAlto}(`) &&
        !normalizado.includes(`CREATE OR REPLACE FUNCTION PUBLIC.${nomeAlto}(`),
      `${f} nao pode ser redefinida`,
    );
  }
});

Deno.test("1383: ACL e travas do texto (EXECUTE so authenticated, search_path fixo, gatilho entre os dois de papel)", () => {
  const sql = ler(nome);
  assertStringIncludes(
    sql,
    "REVOKE ALL ON FUNCTION public.definir_cargo(uuid, text) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    sql,
    "GRANT EXECUTE ON FUNCTION public.definir_cargo(uuid, text) TO authenticated;",
  );
  assertStringIncludes(
    sql,
    "REVOKE ALL ON FUNCTION public.papel_so_pelo_definir_cargo() FROM PUBLIC, anon, authenticated, service_role;",
  );
  for (const t of ["dono_da_loja", "cargo_log"]) {
    assertStringIncludes(
      sql,
      `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`,
    );
    assertStringIncludes(
      sql,
      `REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated, service_role;`,
    );
    assertStringIncludes(
      sql,
      `GRANT SELECT ON TABLE public.${t} TO authenticated, service_role;`,
    );
  }
  const definir = corpo(sql, "definir_cargo");
  assert(
    /SECURITY DEFINER\s+SET search_path = pg_catalog, pg_temp\s+AS \$function\$/.test(
      sql.slice(
        sql.indexOf("FUNCTION public.definir_cargo("),
        sql.indexOf("FUNCTION public.definir_cargo(") + 400,
      ),
    ),
    "definir_cargo e' SECURITY DEFINER com search_path fixo",
  );
  // O chamador e' conferido na tabela do banco, nunca no JWT nem em is_admin().
  assertStringIncludes(
    definir,
    "FROM public.dono_da_loja d WHERE d.user_id = v_quem",
  );
  const definirSemComentario = definir.replace(/--.*$/gm, "");
  assert(
    !/is_admin\s*\(/.test(definirSemComentario) &&
      !/request\.jwt/.test(definirSemComentario),
    "definir_cargo nao le o JWT",
  );
  // A ordem alfabetica dos gatilhos BEFORE: tr_ensure_role_protection < nosso < tr_prevent_role_change.
  const nosso = "tr_papel_so_pelo_definir_cargo";
  assert(
    "tr_ensure_role_protection" < nosso &&
      nosso < "tr_perfil_recusa_imagem_grande" &&
      nosso < "tr_prevent_role_change",
  );
  assertStringIncludes(sql, `CREATE OR REPLACE TRIGGER ${nosso}`);
  assertStringIncludes(sql, "BEFORE UPDATE ON public.profiles");
});

const lerRaiz = (p: string) =>
  Deno.readTextFileSync(new URL(`../${p}`, import.meta.url)).replace(/\r/g, "");

Deno.test("1383: consultas 88a/88b (md5 = o do corpo real), rol fechado, canais, aplicador, workflows e prova viva registrados", () => {
  const A = "88a-conferir-so-o-dono-define-cargo-aplicado";
  const B = "88b-antes-so-o-dono-define-cargo-ausente";
  const sql = ler(nome);
  const hD = md5(corpo(sql, "definir_cargo"));
  const hG = md5(corpo(sql, "papel_so_pelo_definir_cargo"));
  const a = lerRaiz(`scripts/publicacao/consultas/${A}.sql`);
  // A consulta 88a confere o MESMO corpo que a migration grava; a 88b confere os hashes das portas e dos tres gatilhos da 1199 que a
  // migration supoe (os mesmos do pre-voo).
  assertEquals(a.split(`'${hD}'`).length - 1, 1);
  assertEquals(a.split(`'${hG}'`).length - 1, 1);
  const b = lerRaiz(`scripts/publicacao/consultas/${B}.sql`);
  for (const h of [
    "519842163e48cc377ac1337ffb9db936",
    "ccb7a56e835b8181795fffb7bee97305",
    "44d677c3fa562318668122aad65fe0df",
    "92ff3224c34e3367cdf892579e8176f0",
    "e63371757c43ef2619dd613af4635ad3",
  ]) {
    assertStringIncludes(b, `'${h}'`);
    assertStringIncludes(sql, `'${h}'`);
  }
  for (const c of [a, b]) {
    // Sem comentarios e sem literais de texto (os rotulos citam "UPDATE" e nomes de tabela sem executar nada).
    const codigo = c.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/.test(codigo),
      "consulta so de leitura",
    );
    assert(
      !/FROM\s+(public\.)?(profiles|dono_da_loja|cargo_log|auth\.users)\b/i.test(
        codigo,
      ),
      "nao le linha de dado",
    );
  }
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const mapa = require("../scripts/db-apply.cjs");
  const roles = new Map<string, string[]>(
    Object.entries(conf.ROL_FECHADO_POR_CONSULTA),
  );
  assertEquals(roles.get(A)?.length, 9);
  assertEquals(roles.get(B)?.length, 8);
  for (const consulta of [A, B]) {
    const rol = roles.get(consulta) ?? [];
    assertEquals(new Set(rol).size, rol.length);
    assertStringIncludes(
      lerRaiz(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}\n`,
    );
    assertEquals(
      lerRaiz(".github/workflows/rpc-ci.yml").split(`consultas/${consulta}.sql`)
        .length - 1,
      2,
      "nas duas listas de paths do rpc-ci",
    );
    assertStringIncludes(
      lerRaiz("scripts/frota/publicar-release.mjs"),
      `"${consulta}"`,
    );
  }
  assertEquals(
    (
      new Map<string, { funcao: string }[]>(
        Object.entries(mapa.VERIFICACOES),
      ).get(nome) ?? []
    ).map((x) => x.funcao),
    ["definir_cargo", "papel_so_pelo_definir_cargo"],
  );
  const canais = JSON.parse(lerRaiz("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter((x: { versoes?: string[] }) =>
    (x.versoes ?? []).includes("20261383000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assertEquals(Object.hasOwn(lotes[0], campo), false, campo);
  assertStringIncludes(
    lerRaiz(".github/workflows/rpc-ci.yml"),
    "run: node tests/banco/rodar-isolado.cjs tests/banco/definir-cargo-so-o-dono-viva.cjs",
  );
  assertStringIncludes(
    lerRaiz("tests/banco/LEIA-ME.md"),
    "definir-cargo-so-o-dono-viva.cjs",
  );
});
