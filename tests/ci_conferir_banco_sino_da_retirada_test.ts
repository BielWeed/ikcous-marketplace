// Migration 20261233000000 (o sino do pedido de retirada fala de retirada: notifica_cliente_de_mudanca_de_status).
// A 34a e' a consulta do lote (DEPOIS: o corpo novo por md5, o texto da retirada e o da entrega no corpo, atributos de
// sempre, a trigger ligada, a ACL de hoje); a 34b a de ausencia (ANTES: o corpo da 20261026000000 sem o texto da
// retirada; atributos, trigger e ACL de hoje). As duas sao de ROL FECHADO (7 e 6 linhas) e so leem o catalogo; a 34m
// e' a medicao de ROL ABERTO (so contagens). Estes testes medem o texto dos .sql contra os ARQUIVOS desta arvore, no
// mesmo desenho dos blocos 19a..31b de tests/ci_conferir_banco_test.ts; a decisao de cada consulta num Postgres real
// fica com tests/banco/o-sino-do-pedido-de-retirada-portao-viva.cjs.
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

const NOME_34A = "34a-conferir-sino-da-retirada-aplicado";
const NOME_34B = "34b-antes-sino-da-retirada-corpo-vigente";
const NOME_34M = "34m-medir-sino-da-retirada";
const MIGRACAO_233 = `${MIGRATIONS_DIR}/20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql`;
const ROLLBACK_233 = `${MIGRATIONS_DIR}/rollback-manual-20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql`;

for (const [nome, linhasDoRol] of [
  [NOME_34A, 7],
  [NOME_34B, 6],
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
      "fn",
      "itens",
    ]);
    for (const alvo of alvos)
      assert(
        permitidos.has(alvo),
        `le de "${alvo}", que nao e catalogo nem CTE`,
      );
    assert(
      !/\b(?:FROM|JOIN)\s+(?:public\.|auth\.)?(?:marketplace_orders|notificacoes|profiles|users|produtos|marketplace_order_items)\b/i.test(
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

Deno.test("34a/34b — o md5 da 34a e' o do corpo NOVO que o arquivo da migration carrega, o da 34b e' o do corpo da 20261026000000 (o mesmo do pre-voo e do rollback); as duas medem a ACL de hoje (aberta por heranca do PUBLIC) e a trigger", async () => {
  const { createHash } = require("node:crypto");
  const md5 = (s: string) =>
    createHash("md5").update(s.replace(/\r/g, "")).digest("hex");
  const corpoDe = (sql: string) => {
    const ini = sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_status(",
    );
    const i = sql.indexOf("AS $$", ini) + "AS $$".length;
    return sql.slice(i, sql.indexOf("$$;", i));
  };
  const mig = await Deno.readTextFile(MIGRACAO_233);
  const rb = await Deno.readTextFile(ROLLBACK_233);
  const viva = await Deno.readTextFile(
    `${MIGRATIONS_DIR}/20261026000000_o_pedido_avisa_o_cliente.sql`,
  );
  const a = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_34A}.sql`);
  const b = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_34B}.sql`);
  const novo = md5(corpoDe(mig));
  const antigo = md5(corpoDe(viva));
  assert(novo !== antigo, "o corpo novo e o antigo sao o mesmo");
  assertEquals(
    md5(corpoDe(rb)),
    antigo,
    "o rollback recria o corpo da 20261026000000",
  );
  assertStringIncludes(a, `'${novo}'`, "34a: md5 do corpo novo");
  assert(!a.includes(antigo), "34a nao cita o corpo antigo");
  assertStringIncludes(b, `'${antigo}'`, "34b: md5 do corpo da 20261026000000");
  assert(!b.includes(novo), "34b nao cita o corpo novo");
  // o pre-voo e a conferencia da migration declaram os mesmos dois hashes; o rollback tambem
  for (const sql of [mig, rb]) {
    assertStringIncludes(sql, `'${novo}'`);
    assertStringIncludes(sql, `'${antigo}'`);
  }
  for (const [nome, sql] of [
    [NOME_34A, a],
    [NOME_34B, b],
  ] as Array<[string, string]>) {
    assertStringIncludes(
      sql,
      "md5(replace(p.prosrc, chr(13), ''))",
      `${nome}: o md5 e do corpo sem \\r`,
    );
    // a ACL e a trigger: as duas medem, com a MESMA ACL de hoje (PUBLIC, anon, authenticated e service_role com EXECUTE)
    assertStringIncludes(
      sql,
      "'PUBLIC=sim anon=sim authenticated=sim service_role=sim'",
    );
    assertStringIncludes(
      sql,
      "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    );
    assertStringIncludes(sql, "t.tgtype = 17");
    assertStringIncludes(sql, "t.tgname = 'tr_pedido_avisa_o_cliente'");
  }
});

Deno.test("34m — medicao de ROL ABERTO: no menu, UM statement so leitura, so contagens (nenhum nome, numero ou id), fora do rol fechado e do portao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA } = require(SCRIPT);
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_34M}.sql`);
  const limpo = sqlSemComentarios(sql);
  const estrutura = semLiterais(sql);
  const yaml = await Deno.readTextFile(WORKFLOW);
  assertStringIncludes(yaml, `- ${NOME_34M}\n`);
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
  );
  // rol ABERTO: sem coluna `ok`, fora do contrato do rol fechado
  assert(!/\bAS ok\b/i.test(limpo));
  assertEquals(Object.keys(ROL_FECHADO_POR_CONSULTA).includes(NOME_34M), false);
  // so agregado: nenhuma coluna de pessoa; o que sai e' `tipo, objeto, detalhe` e nenhum id
  assert(
    !/\b(customer_name|customer_phone|full_name|email)\b/i.test(estrutura),
    "a medicao nao le coluna de pessoa",
  );
  assert(
    !/\b(?:o|m)\.(?:id|user_id)\b[^)]*\bAS\s+detalhe\b/i.test(limpo),
    "a saida nao devolve id",
  );
  // cada contagem que o runbook promete aparece, com zero tambem aparecendo
  for (const objeto of [
    "'quem leu'",
    "'pedidos'",
    "'pedidos de retirada (id store-pickup)'",
    "'pedidos de retirada com conta (recebem sino)'",
    "'pedidos de retirada hoje em shipping (pronto para retirar)'",
    "'pedidos de retirada hoje em delivered (retirado)'",
    "'id store-pickup SEM o endereco da loja (esperado 0)'",
    "'endereco da loja SEM o id store-pickup (esperado 0)'",
    "'avisos do sino de pedido de retirada com o texto da entrega (ficam como estao)'",
  ])
    assertStringIncludes(limpo, objeto);
  // o contrato da retirada e' o mesmo do corpo da funcao
  assertStringIncludes(
    limpo,
    "COALESCE(m.customer_data ->> 'shipping_option_id', '') = 'store-pickup'",
  );
});

Deno.test("34a/34b — o rpc-ci.yml roda as duas provas vivas do lote (comportamento e portao) no job bloqueante, depois de aplica, e e' disparado pelas tres consultas", async () => {
  const yaml = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  const inicioBloqueante = yaml.indexOf("\n  contrato-dinheiro:");
  const inicioInformacional = yaml.indexOf("\n  provas-informacionais:");
  assert(inicioBloqueante > 0 && inicioInformacional > inicioBloqueante);
  const bloqueante = yaml.slice(inicioBloqueante, inicioInformacional);
  assert(!/^\s*continue-on-error:/m.test(bloqueante));
  const linhas = bloqueante.split("\n");
  for (const [prova, titulo] of [
    [
      "o-sino-do-pedido-de-retirada-viva",
      "      - name: Prova viva do sino do pedido de retirada (migration 20261233)",
    ],
    [
      "o-sino-do-pedido-de-retirada-portao-viva",
      "      - name: Prova viva do portao do sino do pedido de retirada (consultas 34a e 34b)",
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
      `scripts/publicacao/consultas/${NOME_34A}.sql`,
      `scripts/publicacao/consultas/${NOME_34B}.sql`,
      `scripts/publicacao/consultas/${NOME_34M}.sql`,
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
