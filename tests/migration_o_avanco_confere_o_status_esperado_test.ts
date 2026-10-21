import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
const nome = "20261345000000_o_avanco_confere_o_status_esperado.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
Deno.test("345: par aditivo, corpo identificado, ACL so authenticated e rollback fechado", () => {
  const sql = ler(`supabase/migrations/${nome}`);
  const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
  const corpo = sql.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1];
  assert.ok(corpo);
  assert.equal(
    createHash("md5").update(corpo).digest("hex"),
    "fa38bcea0cc69ffff200d8e2c81bd0d3",
  );
  assert.ok(sql.includes("FROM PUBLIC, anon, authenticated, service_role;"));
  assert.ok(sql.includes("TO authenticated;"));
  assert.ok(
    rb.includes(
      "DROP FUNCTION public.avancar_status_do_pedido(uuid,text,text,text);",
    ),
  );
  assert.ok(rb.includes("fa38bcea0cc69ffff200d8e2c81bd0d3"));
  assert.ok(rb.includes("Voltar o FRONT ANTES"));
  assert.equal(
    avaliarFase0({ sqlMigration: sql, sqlRollback: rb, temRollback: true })
      .recusado,
    false,
  );
  for (const texto of [sql, rb])
    assert.ok(texto.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
  assert.ok(
    ler("src/types/database.types.ts").includes("avancar_status_do_pedido:"),
  );
  assert.ok(ler("tests/banco/admin-atual-viva.cjs").includes(nome));
  const lista = JSON.parse(
    ler("tests/banco/portas-do-visitante-permitidas.json"),
  );
  const porta = lista.funcoes.find((f: { funcao: string }) =>
    f.funcao.startsWith("public.avancar_status_do_pedido("),
  );
  assert.deepEqual(porta.executa, ["authenticated"]);
});
Deno.test("345: publicacao e prova viva registradas, respostas parciais recusadas", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
    contarStatements,
    estruturaDoRolFechado,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const entradas = canais.provasDeObjetos.filter((p: { versoes?: string[] }) =>
    p.versoes?.includes("20261345000000"),
  );
  assert.equal(entradas.length, 1);
  const [entrada] = entradas;
  for (const consulta of [entrada.consulta, entrada.ausenciaConfirmadaPor]) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    // eslint-disable-next-line security/detect-object-injection -- chave da configuracao versionada e validada acima.
    const rol = ROL_FECHADO_POR_CONSULTA[consulta];
    assert.equal(contarStatements(sql), 1);
    assert.equal(rol.length, 4);
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    assert.ok(
      ler(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${consulta}\n`,
      ),
    );
    assert.equal(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${consulta}.sql"`,
      ).length - 1,
      2,
    );
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1), rol), null);
  }
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/avanco-status-esperado-viva.cjs",
    ),
  );
});

Deno.test("345: a porta nova confere o status sob a trava antes de chamar a rotina existente", () => {
  const sql = ler(`supabase/migrations/${nome}`);
  assert.ok(
    sql.includes("CREATE OR REPLACE FUNCTION public.avancar_status_do_pedido("),
  );
  const corpo = sql.slice(sql.indexOf("AS $$"));
  assert.ok(
    corpo.indexOf("FOR UPDATE") <
      corpo.indexOf("IS DISTINCT FROM p_status_esperado"),
  );
  assert.ok(
    corpo.indexOf("IS DISTINCT FROM p_status_esperado") <
      corpo.indexOf("RETURN public.pedido__mudar_status("),
  );
  assert.ok(corpo.includes("pedido_status_mudou"));
  assert.ok(
    corpo.includes("auth.uid() IS NULL OR NOT public.is_admin_atual()"),
  );
  assert.ok(
    !sql.includes(
      "CREATE OR REPLACE FUNCTION public.update_order_status_atomic(",
    ),
  );
});
