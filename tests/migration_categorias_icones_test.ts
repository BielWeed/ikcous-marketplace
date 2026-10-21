import { createRequire } from "node:module";
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
const nome = "20261300000000_as_categorias_ganham_icone.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const dir = "supabase/migrations/";
const existe = () => {
  let presente = false;
  try {
    presente = Deno.statSync(
      new URL(`../${dir}${nome}`, import.meta.url),
    ).isFile;
  } catch {
    /* ainda não entregue */
  }
  assert(presente, "A migration de ícones ainda não foi entregue");
};

Deno.test("300: migration aditiva, chaves iguais às do código e sem mudar ACL ou políticas", () => {
  existe();
  const sql = ler(dir + nome);
  assertStringIncludes(sql, "ADD COLUMN IF NOT EXISTS icone text");
  const chaves = [
    ...ler("src/lib/icones-de-categoria.tsx").matchAll(/^ {2}(\w+): \[/gm),
  ]
    .map((m) => m[1])
    .sort();
  const trecho = sql
    .split("ADD CONSTRAINT categorias_icone_check")[1]
    .split("END")[0];
  const persistidas = [...trecho.matchAll(/'([a-z]+)'/g)]
    .map((m) => m[1])
    .sort();
  assertEquals(persistidas, chaves);
  assertEquals(chaves.length, 14);
  assertEquals(
    /\b(GRANT|REVOKE|POLICY|UPDATE|DELETE|INSERT)\b/i.test(
      removerRuido(sql).split("ALTER TABLE public.categorias ADD COLUMN")[1],
    ),
    false,
  );
});

Deno.test("300: rollback conserva coluna/dados e só remove a CHECK conhecida, com pré-voo", () => {
  existe();
  const sql = ler(dir + nome);
  const rollback = ler(`${dir}rollback-manual-${nome}`);
  assertStringIncludes(sql, `rollback-manual-${nome}`);
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(rollback, "DROP CONSTRAINT categorias_icone_check");
  assertEquals(
    /DROP\s+COLUMN|\bUPDATE\b|\bDELETE\b|\bGRANT\b|\bREVOKE\b/i.test(
      removerRuido(rollback),
    ),
    false,
  );
  for (const texto of [sql, rollback])
    assertEquals(detectarTransacaoExplicita(removerRuido(texto)).achados, []);
  assertEquals(
    avaliarFase0({
      sqlMigration: sql,
      sqlRollback: rollback,
      temRollback: true,
    }).recusado,
    false,
  );
});

Deno.test("300: registros de publicação completos e róis recusam linhas faltando", async () => {
  existe();
  const {
    ROL_FECHADO_POR_CONSULTA: rois,
    estruturaDoRolFechado,
    contarStatements,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const a = "61a-conferir-icones-das-categorias-aplicado";
  const b = "61b-antes-icones-das-categorias";
  const lote = canais.provasDeObjetos.filter((p: { versoes?: string[] }) =>
    p.versoes?.includes("20261300000000"),
  );
  assertEquals(lote.length, 1);
  assertEquals(lote[0].consulta, a);
  assertEquals(lote[0].ausenciaConfirmadaPor, b);
  for (const consulta of [a, b]) {
    const caminho = `scripts/publicacao/consultas/${consulta}.sql`;
    const sql = ler(caminho);
    const rol = rois[consulta];
    assertEquals(contarStatements(sql), 1);
    assert(rol?.length >= 4, consulta);
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    assertStringIncludes(
      ler(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}\n`,
    );
    assertEquals(
      ler(".github/workflows/rpc-ci.yml").split(`"${caminho}"`).length - 1,
      2,
    );
    const itens = [...sql.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    assertEquals([...rol].sort(), itens.sort());
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assertEquals(estruturaDoRolFechado(linhas, rol), null);
    assert(estruturaDoRolFechado(linhas.slice(1), rol) !== null);
  }
  assertStringIncludes(
    ler(".github/workflows/rpc-ci.yml"),
    "rodar-isolado.cjs tests/banco/categorias-icones-viva.cjs",
  );
});
