// @ts-nocheck
// A LOJA CLONADA NASCE COM OS MESMOS GRANTS — prova textual do par
// 2026110000200 + rollback-manual (frente grants-da-loja-clonada, 08/09/2026
// — brief da mesa equipe/entregas/20260908-brief-migration-convergencia-de-
// grants-loja-clonada.md).
//
// Por que este teste NÃO usa `avaliarFase0` de `db-prove-rollback.cjs` (o
// padrão de outras migrations desta pasta): aquele instrumento só enxerga
// `CREATE FUNCTION`/`ALTER TABLE` — ele mesmo documenta, no cabeçalho de
// `scripts/db-prove-blindagem-rpcs-orfas.cjs`, que falha fechado
// (INSTRUMENTO_QUEBRADO) para migration de puro REVOKE/DROP. Esta migration
// É puro REVOKE. O que se prende aqui é textual e específico dela: "cada
// linha da tabela função×papel vira EXATAMENTE um REVOKE, e o rollback tem
// o GRANT simétrico" — o exemplo que o próprio brief autorizou.
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "2026110000200_a_loja_clonada_nasce_com_os_mesmos_grants.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

// Só as linhas de CÓDIGO (o cabeçalho é prosa e cita nomes de função à
// vontade — contar ali daria falso positivo/negativo, medido nas migrations
// irmãs deste repositório).
const codigoMigration = migration
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"));
const codigoRollback = rollback
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"));

const RE_REVOKE =
  /^REVOKE EXECUTE ON FUNCTION public\.([a-z0-9_]+\([^)]*\)) FROM ([A-Za-z_, ]+);$/;
const RE_GRANT =
  /^GRANT EXECUTE ON FUNCTION public\.([a-z0-9_]+\([^)]*\)) TO ([A-Za-z_, ]+);$/;

function extrair(linhas, regex) {
  const achados = [];
  for (const linha of linhas) {
    const m = regex.exec(linha.trim());
    if (m) {
      achados.push({
        fn: m[1],
        papeis: m[2].split(",").map((p) => p.trim()),
      });
    }
  }
  return achados;
}

const revokes = extrair(codigoMigration, RE_REVOKE);
const grants = extrair(codigoRollback, RE_GRANT);

Deno.test("a migration tem EXATAMENTE 58 REVOKE (as 58 funções da tabela função×papel medida)", () => {
  assertEquals(revokes.length, 58);
});

Deno.test("nenhuma linha de código da migration é BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op)", () => {
  for (const linha of codigoMigration) {
    assert(
      !/^\s*(BEGIN|COMMIT)\s*;?\s*$/i.test(linha),
      `linha "${linha}" é BEGIN/COMMIT — proibido nesta migration`,
    );
  }
});

Deno.test("a migration nunca usa IF EXISTS no REVOKE (o brief pede falha fechada se a função sumiu)", () => {
  for (const linha of codigoMigration) {
    assert(
      !/REVOKE.*IF EXISTS/i.test(linha),
      `linha "${linha}" tem IF EXISTS — REVOKE tem de falhar se a função não existir`,
    );
  }
});

Deno.test("todo REVOKE só cita PUBLIC/anon/authenticated — nunca service_role nem postgres", () => {
  const papeisPermitidos = new Set(["PUBLIC", "anon", "authenticated"]);
  for (const r of revokes) {
    for (const papel of r.papeis) {
      assert(
        papeisPermitidos.has(papel),
        `${r.fn} revoga de "${papel}" — papel fora dos três permitidos`,
      );
    }
  }
});

Deno.test("as 2 funções que só existem na Savy (dropadas pela 20261091000000) NÃO são tocadas aqui", () => {
  const fnsRevogadas = new Set(revokes.map((r) => r.fn));
  assert(
    !fnsRevogadas.has("get_retention_analytics(integer)"),
    "get_retention_analytics(integer) não deveria estar nesta migration — quem a droga é a 20261091000000",
  );
  assert(
    ![...fnsRevogadas].some((fn) =>
      fn.startsWith("get_sales_analytics(timestamp without time zone"),
    ),
    "get_sales_analytics(timestamp without time zone,...) não deveria estar nesta migration",
  );
});

Deno.test("as 2 funções do estorno (só no principal, ainda não aplicadas na Savy) NÃO são tocadas aqui", () => {
  const fnsRevogadas = new Set(revokes.map((r) => r.fn));
  for (const fn of [
    "solicitar_estorno(uuid,numeric,text)",
    "concluir_estorno(uuid,text,text,text)",
  ]) {
    assert(!fnsRevogadas.has(fn), `${fn} não deveria estar nesta migration`);
  }
});

Deno.test("o rollback-manual é o GRANT simétrico: mesmas 58 funções, mesmos papéis, na mesma ordem", () => {
  assertEquals(
    grants.length,
    revokes.length,
    "o rollback tem que ter um GRANT para cada REVOKE da migration",
  );
  for (let i = 0; i < revokes.length; i += 1) {
    assertEquals(
      grants[i].fn,
      revokes[i].fn,
      `linha ${i}: rollback devolve "${grants[i]?.fn}", migration revoga "${revokes[i].fn}" — fora de ordem ou função errada`,
    );
    assertEquals(
      grants[i].papeis,
      revokes[i].papeis,
      `${revokes[i].fn}: rollback devolve para {${grants[i]?.papeis}}, migration revogou de {${revokes[i].papeis}} — não é simétrico`,
    );
  }
});

Deno.test("nenhuma função se repete na migration (cada função entra em UMA linha, agrupando os papéis)", () => {
  const nomes = revokes.map((r) => r.fn);
  const unicos = new Set(nomes);
  assertEquals(
    nomes.length,
    unicos.size,
    "há função repetida em mais de uma linha REVOKE",
  );
});
