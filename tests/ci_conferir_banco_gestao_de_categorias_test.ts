// Migration 20261237000000 (a lojista renomeia e apaga categoria sem deixar produto orfao: renomear_categoria,
// apagar_categoria_vazia, categorias_com_uso e as oito auxiliares categoria__*).
// A 35a e' a consulta do lote (DEPOIS: o corpo de cada porta por md5, atributos, EXECUTE, as oito auxiliares fechadas, o
// gatilho do produto ligado); a 35b a de ausencia (ANTES: as onze funcoes ausentes, as dependencias de pe). As duas sao
// de ROL FECHADO (8 e 6 linhas) e so leem o catalogo. Estes testes medem o texto dos .sql contra os ARQUIVOS desta
// arvore, no mesmo desenho de tests/ci_conferir_banco_sino_da_retirada_test.ts; a decisao de cada consulta num Postgres
// real fica com tests/banco/categorias-gestao-portao-viva.cjs.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const WORKFLOW = `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`;
const CONSULTAS_DIR = `${RAIZ}/scripts/publicacao/consultas`;
const MIGRATIONS_DIR = `${RAIZ}/supabase/migrations`;
const SCRIPT = "../scripts/publicacao/conferir-banco.cjs";

/** O SQL sem comentarios de linha (o cabecalho EXPLICA o que a consulta nao faz). */
function sqlSemComentarios(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}
/** Texto do SQL sem comentario e sem o conteudo dos literais (sobra so a estrutura). */
const semLiterais = (sql: string) =>
  sqlSemComentarios(sql).replace(/'(?:[^']|'')*'/g, "''");

const NOME_35A = "35a-conferir-gestao-de-categorias-aplicado";
const NOME_35B = "35b-antes-gestao-de-categorias-funcoes-ausentes";
const ARQ_237 =
  "20261237000000_a_lojista_renomeia_e_apaga_categoria_sem_deixar_produto_orfao.sql";
const MIGRACAO_237 = `${MIGRATIONS_DIR}/${ARQ_237}`;
const ROLLBACK_237 = `${MIGRATIONS_DIR}/rollback-manual-${ARQ_237}`;

for (const [nome, linhasDoRol] of [
  [NOME_35A, 8],
  [NOME_35B, 6],
] as Array<[string, number]>) {
  Deno.test(`${nome} — no menu, UM statement so leitura (WITH), rol fechado de ${linhasDoRol} itens, so catalogo e nenhuma linha de dado e lida`, async () => {
    const { contarStatements, ROL_FECHADO_POR_CONSULTA } = require(SCRIPT);
    const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${nome}.sql`);
    const limpo = sqlSemComentarios(sql);
    const estrutura = semLiterais(sql);
    const yaml = await Deno.readTextFile(WORKFLOW);
    assertStringIncludes(yaml, `- ${nome}\n`);
    assertEquals(contarStatements(sql), 1, "exatamente 1 statement");
    assert(/^\s*WITH\b/i.test(limpo), "comeca por WITH");
    assert(
      !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT|LOCK)\b/i.test(
        estrutura,
      ),
      "palavra de escrita fora de comentario/literal",
    );
    assert(
      !/\b(EXECUTE|query_to_xml\w*|dblink\w*|format|pg_read_file|lo_import)\b/i.test(
        estrutura,
      ),
      "SQL dinamico (ou leitura de arquivo)",
    );
    assert(
      /SELECT item, esperado, vivo, COALESCE\(vivo = esperado, false\) AS ok\s+FROM itens\s+ORDER BY ok, item;/.test(
        limpo,
      ),
      "saida item/esperado/vivo/ok com as reprovadas primeiro",
    );
    const alvos = [
      ...estrutura.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi),
    ].map((m) => m[1].toLowerCase());
    assert(alvos.length > 0);
    const permitidos = new Set([
      "pg_proc",
      "pg_namespace",
      "pg_language",
      "pg_trigger",
      "pg_attribute",
      "aclexplode",
      // as CTEs das duas consultas
      "portas",
      "aux",
      "presentes",
      "colunas",
      "itens",
    ]);
    for (const alvo of alvos)
      assert(
        permitidos.has(alvo),
        `le de "${alvo}", que nao e catalogo nem CTE`,
      );
    assert(
      !/\b(?:FROM|JOIN)\s+(?:public\.|auth\.)?(?:categorias|produtos|banners|politica_devolucao|profiles|users)\b/i.test(
        estrutura,
      ),
      "a consulta leu uma tabela de dados",
    );
    // eslint-disable-next-line security/detect-object-injection -- `nome` vem do array literal de duas consultas deste teste.
    const rol = ROL_FECHADO_POR_CONSULTA[nome];
    assertEquals(rol.length, linhasDoRol);
    assertEquals(new Set(rol).size, rol.length);
    for (const item of rol)
      assertStringIncludes(limpo, `'${item}'`, `item "${item}" fora do .sql`);
    assertEquals(
      [...limpo.matchAll(/SELECT '([^']+)',/g)].length,
      rol.length,
      "o .sql tem mais (ou menos) linhas que o rol",
    );
  });
}

Deno.test("35a/35b — o md5 da 35a e' o do corpo NOVO de cada porta que o arquivo da migration carrega, o mesmo que a migration nao cita fora das portas; a 35b nao cita nenhum corpo e mede as onze funcoes pelo nome", async () => {
  const { createHash } = require("node:crypto");
  const md5 = (s: string) =>
    createHash("md5").update(s.replace(/\r/g, "")).digest("hex");
  const corpoDe = (sql: string, fn: string) => {
    const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    assert(ini >= 0, `${fn} nao esta no arquivo`);
    const i = sql.indexOf("AS $$", ini) + "AS $$".length;
    return sql.slice(i, sql.indexOf("$$;", i));
  };
  const mig = await Deno.readTextFile(MIGRACAO_237);
  const rb = await Deno.readTextFile(ROLLBACK_237);
  const a = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_35A}.sql`);
  const b = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_35B}.sql`);
  const hashes = [
    "renomear_categoria",
    "apagar_categoria_vazia",
    "categorias_com_uso",
  ].map((fn) => md5(corpoDe(mig, fn)));
  assertEquals(new Set(hashes).size, 3, "os tres corpos sao diferentes");
  for (const h of hashes) {
    assertStringIncludes(a, `'${h}'`, `35a: md5 ${h}`);
    assert(!b.includes(h), "35b nao cita corpo novo");
  }
  assertStringIncludes(
    a,
    "md5(replace(p.prosrc, chr(13), ''))",
    "35a: o md5 e do corpo sem \\r",
  );
  assertStringIncludes(
    a,
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
  );
  assertStringIncludes(
    a,
    "'PUBLIC=nao anon=nao authenticated=sim service_role=sim'",
  );
  assertStringIncludes(a, "t.tgname = 'set_ultima_atualizacao'");
  assertStringIncludes(b, "t.tgname = 'set_ultima_atualizacao'");
  // as onze funcoes: as tres portas e as oito auxiliares, pelo nome, nas duas consultas e no arquivo da migration e do rollback
  const portas = [
    "renomear_categoria",
    "apagar_categoria_vazia",
    "categorias_com_uso",
  ];
  const auxiliares = [
    "categoria__chave",
    "categoria__slug",
    "categoria__url_codifica",
    "categoria__url_decodifica",
    "categoria__partes_do_link",
    "categoria__nome_do_link",
    "categoria__mesma",
    "categoria__usos",
  ];
  for (const fn of auxiliares) {
    assertStringIncludes(a, `'${fn}'`, `35a: auxiliar ${fn}`);
    assertStringIncludes(mig, `CREATE OR REPLACE FUNCTION public.${fn}(`);
    assertStringIncludes(rb, `public.${fn}(`);
  }
  for (const fn of portas) {
    assertStringIncludes(b, `'${fn}'`, `35b: porta ${fn}`);
    assertStringIncludes(rb, `public.${fn}(`);
  }
  assertStringIncludes(b, "categoria\\_\\_%");
  const rbCompacto = sqlSemComentarios(rb).replace(/\s+/g, " ").toLowerCase();
  assert(
    !rbCompacto.includes("create function") &&
      !rbCompacto.includes("create or replace function"),
    "o rollback so apaga: nao cria funcao",
  );
});

Deno.test("35a/35b — o rpc-ci.yml roda as duas provas vivas do lote (comportamento e portao) no job bloqueante, depois de aplica, e e' disparado pelas duas consultas", async () => {
  const yaml = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  const inicioBloqueante = yaml.indexOf("\n  contrato-dinheiro:");
  const inicioInformacional = yaml.indexOf("\n  provas-informacionais:");
  assert(inicioBloqueante > 0 && inicioInformacional > inicioBloqueante);
  const bloqueante = yaml.slice(inicioBloqueante, inicioInformacional);
  assert(!/^\s*continue-on-error:/m.test(bloqueante));
  const linhas = bloqueante.split("\n");
  for (const [prova, titulo] of [
    [
      "categorias-gestao-viva",
      "      - name: Prova viva da gestao de categorias sem produto orfao (migration 20261237)",
    ],
    [
      "categorias-gestao-portao-viva",
      "      - name: Prova viva do portao da gestao de categorias (consultas 35a e 35b)",
    ],
  ]) {
    const k = linhas.indexOf(
      `        run: node tests/banco/rodar-isolado.cjs tests/banco/${prova}.cjs`,
    );
    assert(k >= 2, `o passo de ${prova} nao esta no job bloqueante`);
    assertEquals(
      linhas[k - 1],
      "        if: ${{ !cancelled() && steps.aplica.outcome == 'success' }}",
    );
    assertEquals(linhas[k - 2], titulo);
    assert(
      bloqueante.indexOf(`tests/banco/${prova}.cjs`) >
        bloqueante.indexOf("id: aplica"),
    );
    assert(!yaml.slice(inicioInformacional).includes(`${prova}.cjs`));
    assertEquals(bloqueante.split(`tests/banco/${prova}.cjs`).length - 1, 1);
    assert(
      (await Deno.stat(`${RAIZ}/tests/banco/${prova}.cjs`)).isFile,
      `tests/banco/${prova}.cjs nao existe`,
    );
  }
  for (const gatilho of ["pull_request:", "push:"]) {
    const ini = yaml.indexOf(`\n  ${gatilho}`);
    assert(ini > 0, `nao achei o gatilho ${gatilho}`);
    const bloco = yaml.slice(ini, yaml.indexOf("\n  workflow_dispatch:"));
    const caminhos =
      gatilho === "pull_request:"
        ? bloco.slice(0, bloco.indexOf("\n  push:"))
        : bloco;
    for (const arquivo of [
      `scripts/publicacao/consultas/${NOME_35A}.sql`,
      `scripts/publicacao/consultas/${NOME_35B}.sql`,
      "scripts/frota/canais-de-backend.json",
      "supabase/migrations/**",
    ])
      assertStringIncludes(
        caminhos,
        `- "${arquivo}"`,
        `${gatilho} sem o caminho ${arquivo}`,
      );
  }
});
