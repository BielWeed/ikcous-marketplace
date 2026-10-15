// Migration 20261238000000 (a cliente pede a exclusao da conta e a correcao do e-mail: a tabela public.pedidos_de_privacidade).
// A 39a e' a consulta do lote (DEPOIS: a tabela inteira e fechada, as politicas, os privilegios, a funcao do gatilho por md5 e o
// gatilho); a 39b a de ausencia (ANTES: nada disso existe, as dependencias existem e o papel `postgres` tem REFERENCES em
// auth.users). As duas sao de ROL FECHADO (19 e 9 linhas) e so leem o catalogo; a 39m e' a medicao de ROL ABERTO (o que o
// `postgres` pode fazer nas tabelas de login que o roteiro manual toca; nunca portao). Estes testes medem o texto dos .sql contra
// os ARQUIVOS desta arvore, no mesmo desenho de tests/ci_conferir_banco_sino_da_retirada_test.ts; a decisao de cada consulta
// num Postgres real fica com tests/banco/pedidos-de-privacidade-portao-viva.cjs.
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

const NOME_39A = "39a-conferir-pedidos-de-privacidade-aplicado";
const NOME_39B = "39b-antes-pedidos-de-privacidade-objetos-ausentes";
const NOME_39M = "39m-medir-privilegios-do-roteiro-de-privacidade";
const ARQUIVO_238 =
  "20261238000000_a_cliente_pede_exclusao_da_conta_e_correcao_do_email.sql";
const MIGRACAO_238 = `${MIGRATIONS_DIR}/${ARQUIVO_238}`;
const ROLLBACK_238 = `${MIGRATIONS_DIR}/rollback-manual-${ARQUIVO_238}`;
const ROTEIRO = `${RAIZ}/docs/runbooks/atender-pedido-de-privacidade.md`;

const PALAVRAS_DE_ESCRITA =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT|LOCK)\b/i;
const SQL_DINAMICO =
  /\b(EXECUTE|query_to_xml\w*|dblink\w*|format|pg_read_file|lo_import)\b/i;
/** O que as consultas do lote podem ler: catalogo, as CTEs delas e funcoes de tabela. */
const PERMITIDOS = new Set([
  "pg_proc",
  "pg_namespace",
  "pg_language",
  "pg_trigger",
  "pg_attribute",
  "pg_attrdef",
  "pg_constraint",
  "pg_class",
  "pg_index",
  "pg_policy",
  "pg_roles",
  "aclexplode",
  "unnest",
  // CTEs da 39a e da 39b
  "tab",
  "col",
  "cons",
  "chk",
  "regras",
  "regras_ok",
  "fk",
  "idx_uq",
  "idx_lista",
  "rel",
  "pol",
  "pol_lista",
  "pol_marcas",
  "priv",
  "priv_tabela",
  "priv_colunas",
  "fn",
  "gat",
  "itens",
  // CTEs da 39m
  "papel",
  "tabelas",
]);

for (const [nome, linhasDoRol] of [
  [NOME_39A, 19],
  [NOME_39B, 9],
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
      !PALAVRAS_DE_ESCRITA.test(estrutura),
      "palavra de escrita fora de comentario/literal",
    );
    assert(
      !SQL_DINAMICO.test(estrutura),
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
    for (const alvo of alvos)
      assert(
        PERMITIDOS.has(alvo),
        `le de "${alvo}", que nao e catalogo nem CTE`,
      );
    // nenhuma tabela de dado: nem a do pedido, nem as de login, nem as do app
    assert(
      !/\b(?:FROM|JOIN)\s+(?:public\.|auth\.)?(?:pedidos_de_privacidade|users|identities|sessions|one_time_tokens|mfa_factors|audit_log_entries|marketplace_orders|profiles|notificacoes)\b/i.test(
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

Deno.test("39a — o md5 e' o do corpo da funcao que o arquivo da migration carrega; a migration e o rollback dizem o mesmo do que a consulta confere", async () => {
  const { createHash } = require("node:crypto");
  const md5 = (s: string) =>
    createHash("md5").update(s.replace(/\r/g, "")).digest("hex");
  const corpoDe = (sql: string) => {
    const ini = sql.indexOf(
      "CREATE FUNCTION public.pedidos_de_privacidade__carimbar(",
    );
    assert(ini >= 0, "a migration nao define a funcao do gatilho");
    const i = sql.indexOf("AS $$", ini) + "AS $$".length;
    return sql.slice(i, sql.indexOf("$$;", i));
  };
  const mig = await Deno.readTextFile(MIGRACAO_238);
  const rb = await Deno.readTextFile(ROLLBACK_238);
  const a = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_39A}.sql`);
  const b = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_39B}.sql`);
  const novo = md5(corpoDe(mig));
  assertStringIncludes(a, `'${novo}'`, "39a: md5 do corpo");
  assert(!b.includes(novo), "39b nao cita o corpo (ela e' a de ausencia)");
  assertStringIncludes(
    a,
    "md5(replace(p.prosrc, chr(13), ''))",
    "o md5 e do corpo sem \\r",
  );
  // os mesmos nomes de objeto nas tres pontas: migration, rollback e consulta
  for (const nome of [
    "public.pedidos_de_privacidade",
    "pedidos_de_privacidade__carimbar",
    "tr_pedidos_de_privacidade_carimbar",
    "uq_pedidos_de_privacidade_um_aberto",
    "idx_pedidos_de_privacidade_situacao_criado",
  ])
    for (const [onde, texto] of [
      ["migration", mig],
      ["39a", a],
    ] as Array<[string, string]>)
      if (nome !== "public.pedidos_de_privacidade")
        assertStringIncludes(texto, nome, `${onde}: ${nome}`);
  for (const nome of [
    "pedidos_de_privacidade_admin_update_policy",
    "pedidos_de_privacidade_dono_insert_policy",
    "pedidos_de_privacidade_dono_ou_admin_select_policy",
    "pedidos_de_privacidade_carimbo_check",
    "pedidos_de_privacidade_email_do_tipo_check",
    "pedidos_de_privacidade_email_formato_check",
    "pedidos_de_privacidade_observacao_check",
    "pedidos_de_privacidade_situacao_check",
    "pedidos_de_privacidade_tipo_check",
  ]) {
    assertStringIncludes(mig, nome, `migration: ${nome}`);
    assertStringIncludes(a, nome, `39a: ${nome}`);
  }
  // o rollback apaga o que a 39a confere (e a 39b exige ausente)
  for (const trecho of [
    "DROP TRIGGER tr_pedidos_de_privacidade_carimbar",
    "DROP FUNCTION public.pedidos_de_privacidade__carimbar()",
    "DROP TABLE public.pedidos_de_privacidade;",
  ])
    assertStringIncludes(rb, trecho);
  // as colunas que a consulta pina sao as da migration (nome e tipo, na ordem)
  const colunas = [
    "id uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    "user_id uuid NOT NULL REFERENCES auth.users (id)",
    "tipo text NOT NULL",
    "email_novo text",
    "situacao text NOT NULL DEFAULT 'aberto'",
    "criado_em timestamptz NOT NULL DEFAULT now()",
    "atendido_em timestamptz",
    "atendido_por uuid",
    "observacao text",
  ];
  let ultimo = -1;
  for (const c of colunas) {
    const i = mig.indexOf(`  ${c}`);
    assert(i > ultimo, `coluna fora de ordem ou ausente na migration: ${c}`);
    ultimo = i;
  }
  // (no .sql o literal vem com as aspas dobradas: `''aberto''::text`)
  assertStringIncludes(
    a,
    "id:uuid:true:gen_random_uuid(),user_id:uuid:true:,tipo:text:true:,email_novo:text:false:,situacao:text:true:''aberto''::text,criado_em:timestamp with time zone:true:now(),atendido_em:timestamp with time zone:false:,atendido_por:uuid:false:,observacao:text:false:",
  );
  // os privilegios da migration sao os que a 39a pina
  for (const grant of [
    "GRANT SELECT ON TABLE public.pedidos_de_privacidade TO authenticated;",
    "GRANT INSERT (user_id, tipo, email_novo) ON TABLE public.pedidos_de_privacidade TO authenticated;",
    "GRANT UPDATE (situacao, observacao) ON TABLE public.pedidos_de_privacidade TO authenticated;",
    "GRANT SELECT, INSERT, UPDATE ON TABLE public.pedidos_de_privacidade TO service_role;",
  ])
    assertStringIncludes(mig, grant);
  assertStringIncludes(
    a,
    "INSERT(email_novo, tipo, user_id) UPDATE(observacao, situacao)",
  );
  assertStringIncludes(a, "'INSERT,SELECT,UPDATE'");
  assertStringIncludes(a, "'PUBLIC=nao anon=nao authenticated=nao'");
  // o service_role NAO tem o EXECUTE da funcao medido (a migration nao o mexe)
  assert(
    !/service_role/.test(
      sqlSemComentarios(a)
        .split("\n")
        .filter((l) =>
          /has_function_privilege|aclexplode\(coalesce\(p\.proacl/.test(l),
        )
        .join("\n"),
    ),
    "a 39a nao deve medir o EXECUTE do service_role",
  );
});

Deno.test("39b — a base de antes: os objetos ausentes e as dependencias do pre-voo, mais o REFERENCES do papel que aplica em auth.users", async () => {
  const b = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_39B}.sql`);
  const mig = await Deno.readTextFile(MIGRACAO_238);
  const limpo = sqlSemComentarios(b);
  // o REFERENCES e' medido pelo papel NOMEADO, por regclass (relacao ausente vira linha, nunca erro), e nunca fica verde sem papel
  assertStringIncludes(
    limpo,
    "has_table_privilege('postgres'::name, to_regclass('auth.users'), 'REFERENCES')",
  );
  assertStringIncludes(
    limpo,
    "WHEN to_regrole('postgres') IS NULL THEN 'papel postgres ausente'",
  );
  // a chave estrangeira que exige o privilegio esta mesmo na migration
  assertStringIncludes(mig, "user_id uuid NOT NULL REFERENCES auth.users (id)");
  // as dependencias sao as MESMAS do pre-voo da migration
  for (const [consulta, preflight] of [
    ["to_regclass('auth.users')", "to_regclass('auth.users') IS NULL"],
    ["to_regprocedure('auth.uid()')", "to_regprocedure('auth.uid()') IS NULL"],
    [
      "to_regprocedure('public.rls_admin_atual()')",
      "to_regprocedure('public.rls_admin_atual()') IS NULL",
    ],
    [
      "to_regclass('public.pedidos_de_privacidade')",
      "to_regclass('public.pedidos_de_privacidade') IS NOT NULL",
    ],
  ])
    for (const [onde, texto, trecho] of [
      ["39b", limpo, consulta],
      ["pre-voo da migration", mig, preflight],
    ] as Array<[string, string, string]>)
      assertStringIncludes(texto, trecho, `${onde}: ${trecho}`);
  // a funcao e o gatilho: o pre-voo olha a funcao SEM argumentos; a consulta e' mais dura (qualquer sobrecarga)
  assertStringIncludes(limpo, "p.proname = 'pedidos_de_privacidade__carimbar'");
  assertStringIncludes(
    limpo,
    "t.tgname = 'tr_pedidos_de_privacidade_carimbar' AND NOT t.tgisinternal",
  );
  // nada que so a depois-do-apply tem pode ser exigido aqui
  assert(
    !/\bmd5\b/i.test(limpo),
    "a 39b nao confere corpo: a funcao nao existe ainda",
  );
});

Deno.test("39m — medicao de ROL ABERTO: no menu, UM statement so leitura, so catalogo (nenhuma linha de nenhuma tabela, nem contagem), fora do rol fechado e do portao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA } = require(SCRIPT);
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_39M}.sql`);
  const limpo = sqlSemComentarios(sql);
  const estrutura = semLiterais(sql);
  const yaml = await Deno.readTextFile(WORKFLOW);
  assertStringIncludes(yaml, `- ${NOME_39M}\n`);
  assertEquals(contarStatements(sql), 1, "exatamente 1 statement");
  assert(/^\s*WITH\b/i.test(limpo), "comeca por WITH");
  assert(
    !PALAVRAS_DE_ESCRITA.test(estrutura),
    "palavra de escrita fora de comentario/literal",
  );
  assert(!SQL_DINAMICO.test(estrutura));
  // rol ABERTO: sem coluna `ok`, fora do contrato do rol fechado
  assert(!/\bAS ok\b/i.test(limpo));
  assertEquals(Object.keys(ROL_FECHADO_POR_CONSULTA).includes(NOME_39M), false);
  // SO catalogo: o unico FROM e' o de pg_roles, as CTEs e a lista fixa; nenhuma tabela do schema auth e' lida
  const alvos = [
    ...estrutura.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi),
  ].map((m) => m[1].toLowerCase());
  for (const alvo of alvos)
    assert(PERMITIDOS.has(alvo), `le de "${alvo}", que nao e catalogo nem CTE`);
  assert(
    !/\b(?:FROM|JOIN)\s+(?:public\.|auth\.)/i.test(estrutura),
    "a medicao leu uma tabela de schema",
  );
  assert(
    !/\bcount\s*\(/i.test(
      estrutura.replace(/\bcount\s*\(\s*\*\s*\)\s*FROM\s+pg_/gi, ""),
    ),
    "a medicao nao conta linha de tabela",
  );
  assert(
    !/\b(email|phone|raw_user_meta_data|ip_address|payload)\b/i.test(estrutura),
    "a medicao nao le coluna de pessoa",
  );
  // o papel medido e' o que aplica (e roda o roteiro no SQL Editor): `postgres`, por nome e por regclass
  assertEquals(sql.split("'postgres'::name").length - 1, 3);
  assertStringIncludes(
    limpo,
    "has_table_privilege('postgres'::name, to_regclass(t.nome), 'UPDATE')",
  );
  assertStringIncludes(
    limpo,
    "has_table_privilege('postgres'::name, to_regclass(t.nome), 'DELETE')",
  );
  assertStringIncludes(
    limpo,
    "has_schema_privilege('postgres'::name, 'auth', 'USAGE')",
  );
});

Deno.test("39m — as tabelas e o que o roteiro faz em cada uma BATEM com o roteiro manual (atender-pedido-de-privacidade.md)", async () => {
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_39M}.sql`);
  const roteiro = await Deno.readTextFile(ROTEIRO);
  const atualiza = new Set(
    [...roteiro.matchAll(/^\s*UPDATE\s+(auth\.\w+)/gm)].map((m) => m[1]),
  );
  const apaga = new Set(
    [...roteiro.matchAll(/^\s*DELETE\s+FROM\s+(auth\.\w+)/gm)].map((m) => m[1]),
  );
  // a `39m` declara, por tabela, o que o roteiro faz (`roteiro=` e' o texto da lista fixa)
  const lista = [
    ...sql.matchAll(/\('(auth\.\w+)',\s*'(UPDATE e DELETE|UPDATE|DELETE)'\)/g),
  ].map((m) => [m[1], m[2]] as [string, string]);
  assertEquals(lista.length, 6, "seis tabelas na lista fixa da 39m");
  const todas = new Set([...atualiza, ...apaga]);
  assertEquals(
    new Set(lista.map(([t]) => t)),
    todas,
    "a 39m mede EXATAMENTE as tabelas auth que o roteiro toca",
  );
  for (const [tabela, faz] of lista) {
    const quer = [
      atualiza.has(tabela) ? "UPDATE" : "",
      apaga.has(tabela) ? "DELETE" : "",
    ]
      .filter(Boolean)
      .join(" e ");
    assertEquals(faz, quer, `${tabela}: o roteiro faz "${quer}"`);
  }
  // o roteiro continua com o dono: o lote nao o executa nem o inclui
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lote = canais.provasDeObjetos.find((p: any) => p.consulta === NOME_39A);
  assert(lote, "o lote 39 nao esta no canais-de-backend.json");
  assertStringIncludes(
    String(lote._comentario).replace(/\s+/g, " "),
    "o roteiro APAGA dado real de login e fica com o DONO",
  );
});

Deno.test("39a/39b — o rpc-ci.yml roda a prova viva do portao do lote no job bloqueante, depois de aplica, e e' disparado pelas tres consultas", async () => {
  const yaml = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  const inicioBloqueante = yaml.indexOf("\n  contrato-dinheiro:");
  const inicioInformacional = yaml.indexOf("\n  provas-informacionais:");
  assert(inicioBloqueante > 0 && inicioInformacional > inicioBloqueante);
  const bloqueante = yaml.slice(inicioBloqueante, inicioInformacional);
  assert(!/^\s*continue-on-error:/m.test(bloqueante));
  const linhas = bloqueante.split("\n");
  for (const [prova, titulo] of [
    [
      "pedidos-de-privacidade-viva",
      "      - name: Prova viva dos pedidos de privacidade da cliente (migration 20261238)",
    ],
    [
      "anonimizar-conta-ensaio-viva",
      "      - name: Ensaio do roteiro de anonimizacao de conta (privacidade)",
    ],
    [
      "pedidos-de-privacidade-portao-viva",
      "      - name: Prova viva do portao dos pedidos de privacidade (consultas 39a e 39b)",
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
      `scripts/publicacao/consultas/${NOME_39A}.sql`,
      `scripts/publicacao/consultas/${NOME_39B}.sql`,
      `scripts/publicacao/consultas/${NOME_39M}.sql`,
      "scripts/frota/canais-de-backend.json",
      "supabase/migrations/**",
      "docs/runbooks/atender-pedido-de-privacidade.md",
    ])
      assertStringIncludes(
        caminhos,
        `- "${arquivo}"`,
        `${gatilho} sem o caminho ${arquivo}`,
      );
  }
});

Deno.test("39a/39b — a entrada de db-apply.cjs para a funcao do gatilho existe (sem ela o apply sai PULADA) e cada marcador aparece UMA vez no corpo da migration", async () => {
  const { VERIFICACOES, conferirMarcador } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[ARQUIVO_238];
  assert(entrada, "a migration nao tem entrada em VERIFICACOES");
  const checagens = Array.isArray(entrada) ? entrada : [entrada];
  assertEquals(checagens.length, 1);
  assertEquals(checagens[0].funcao, "pedidos_de_privacidade__carimbar");
  const mig = (await Deno.readTextFile(MIGRACAO_238)).replace(/\r\n/g, "\n");
  const ini = mig.indexOf(
    "CREATE FUNCTION public.pedidos_de_privacidade__carimbar(",
  );
  const fim = mig.indexOf("$$;", mig.indexOf("AS $$", ini) + 5) + 3;
  const definicao = mig.slice(ini, fim);
  assert(checagens[0].esperado.length >= 8, "marcadores a menos");
  for (const marcador of checagens[0].esperado) {
    const r = conferirMarcador(definicao, marcador);
    assert(
      r.ok,
      `${JSON.stringify(marcador)}: ${r.achou}x (esperado ${r.esperado}x)`,
    );
  }
});
