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
const nome = "20261351000000_a_categoria_ganha_a_forma_do_icone.sql";
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
  assert(presente, "A migration da forma do ícone ainda não foi entregue");
};

Deno.test("351: migration aditiva, só path SVG até 400 caracteres e sem mudar ACL ou políticas", () => {
  existe();
  const sql = ler(dir + nome);
  assertStringIncludes(sql, "ADD COLUMN IF NOT EXISTS icone_forma text");
  assert(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
  const trecho = sql.split("ADD CONSTRAINT categorias_icone_forma_check")[1];
  assertStringIncludes(trecho, "char_length(icone_forma) <= 400");
  assertStringIncludes(
    trecho,
    "icone_forma ~ '^[Mm][MmLlHhVvCcSsQqTtAaZz0-9 .,-]*$'",
  );
  // Sem dependência entre colunas: a CHECK nova só fala de icone_forma.
  assertEquals(/\bicone\b/.test(trecho.split("END")[0]), false);
  // Alfabeto fechado: nada que sirva à injeção (< > aspas & ; : ( ) # %) dentro da classe.
  const classe = trecho.match(/\^\[Mm\]\[([^\]]+)\]\*\$/)?.[1] ?? "";
  assertEquals(classe, "MmLlHhVvCcSsQqTtAaZz0-9 .,-");
  assertEquals(/[<>"'&;:()#%+\\]/.test(classe), false);
  // A parte da migration que altera a tabela não toca grant, policy nem dado.
  assertEquals(
    /\b(GRANT|REVOKE|POLICY|UPDATE|DELETE|INSERT)\b/i.test(
      removerRuido(sql).split("ALTER TABLE public.categorias ADD COLUMN")[1],
    ),
    false,
  );
  // Só a coluna nova: nenhuma outra coluna é criada, apagada ou reescrita.
  assertEquals(sql.match(/ADD COLUMN/g)?.length, 1);
  assertEquals(/DROP\s+COLUMN|ALTER\s+COLUMN/i.test(removerRuido(sql)), false);
});

Deno.test("351: rollback apaga só a coluna e a CHECK que a migration criou, com pré-voo", () => {
  existe();
  const sql = ler(dir + nome);
  const rollback = ler(`${dir}rollback-manual-${nome}`);
  assertStringIncludes(sql, `rollback-manual-${nome}`);
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(
    rollback,
    "DROP CONSTRAINT categorias_icone_forma_check",
  );
  assertStringIncludes(rollback, "DROP COLUMN icone_forma");
  const corpo = removerRuido(rollback);
  assertEquals(
    /\bUPDATE\b|\bDELETE\b|\bGRANT\b|\bREVOKE\b/i.test(corpo),
    false,
  );
  // Nada além da coluna nova: categorias.icone e a CHECK das 14 chaves ficam.
  assertEquals(corpo.match(/DROP\s+COLUMN/gi)?.length, 1);
  assertEquals(/categorias_icone_check/.test(corpo), false);
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

Deno.test("351: registros de publicação completos e róis recusam linhas faltando", async () => {
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
  const a = "63a-conferir-forma-do-icone-aplicado";
  const b = "63b-antes-forma-do-icone-ausente";
  const lote = canais.provasDeObjetos.filter((p: { versoes?: string[] }) =>
    p.versoes?.includes("20261351000000"),
  );
  assertEquals(lote.length, 1);
  assertEquals(lote[0].consulta, a);
  assertEquals(lote[0].ausenciaConfirmadaPor, b);
  for (const consulta of [a, b]) {
    const caminho = `scripts/publicacao/consultas/${consulta}.sql`;
    const sql = ler(caminho);
    // eslint-disable-next-line security/detect-object-injection -- chave de uma lista fixa do próprio teste
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
    "rodar-isolado.cjs tests/banco/forma-do-icone-viva.cjs",
  );
});
