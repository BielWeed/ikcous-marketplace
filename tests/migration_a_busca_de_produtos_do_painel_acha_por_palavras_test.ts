import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// O COMPORTAMENTO e' provado no Postgres efemero (tests/banco/a-busca-do-painel-acha-por-palavras-viva.cjs); aqui fica o contrato dos arquivos.
const require = createRequire(import.meta.url);
const nome =
  "20261399200000_a_busca_de_produtos_do_painel_acha_por_palavras.sql";
const nome85 =
  "20261385000000_a_busca_de_produtos_do_painel_acha_pelo_codigo_de_barras_e_da_variacao.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const FIM = "$function$;";
const definicao = (sql: string) => {
  const ini = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_products_paged(",
  );
  return ini < 0 ? "" : sql.slice(ini, sql.indexOf(FIM, ini) + FIM.length);
};
const corpo = (sql: string) =>
  definicao(sql).split("AS $function$")[1]?.slice(0, -FIM.length) ?? "";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const H_ANTES = "39db382689def5fac3b263a66f84ede1";
const H_NOVO_FIXO = "346063e900b8b7b63dfbeffe5070eedc";
const ASSINATURA =
  "public.get_admin_products_paged(text,text,text,text,integer,integer)";
const A119 =
  "119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado";
const B119 =
  "119b-antes-a-busca-por-palavras-e-o-estorno-fora-do-vencido-base-vigente";

const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const anterior = ler(`supabase/migrations/${nome85}`);
const H_NOVO = md5(corpo(sql));

// O corpo dividido nas tres partes que NAO sao o filtro de busca: antes do primeiro filtro, entre os dois, e do ORDER BY em diante.
// Cada filtro vai do marcador (a primeira linha dele) ate o fim do bloco (a proxima secao).
function partes(c: string, marca: string) {
  const i1 = c.indexOf(marca);
  const fim1 = c.indexOf("\n\n    -- Fetch paginated data", i1);
  const i2 = c.indexOf(marca, fim1);
  const fim2 = c.indexOf("\n        ORDER BY p.data_cadastro DESC", i2);
  assert.ok(
    i1 > 0 && fim1 > i1 && i2 > fim1 && fim2 > i2,
    "estrutura do corpo",
  );
  assert.equal(c.split(marca).length - 1, 2, "o filtro aparece em 2 blocos");
  return {
    antes: c.slice(0, i1),
    meio: c.slice(fim1, i2),
    depois: c.slice(fim2),
    filtros: [c.slice(i1, fim1), c.slice(i2, fim2)],
  };
}
const semRecuo = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .join("\n");

Deno.test("3992: o corpo anterior e' o da 385 (md5 fixo) e esta migration so troca o filtro de busca (nos DOIS blocos, com o mesmo texto) e calcula os padroes", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  assert.equal(H_NOVO, H_NOVO_FIXO);
  // O rollback e' a definicao da 385, byte a byte.
  assert.equal(definicao(rb), definicao(anterior));
  assert.equal(md5(corpo(rb)), H_ANTES);
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  // O cabecalho (assinatura, atributos) e' o da 385.
  assert.equal(
    definicao(sql).split("AS $function$")[0],
    definicao(anterior).split("AS $function$")[0],
  );
  const velho = partes(corpo(anterior), "v_clean_search = '' OR (");
  const novo = partes(corpo(sql), "cardinality(v_padroes) = 0 OR");
  // As tres partes fora do filtro sao as mesmas, a menos de DUAS adicoes na parte de cima: a variavel e o calculo dos padroes.
  assert.equal(novo.meio, velho.meio);
  assert.equal(novo.depois, velho.depois);
  const adicaoVariavel = "    v_padroes TEXT[];\n";
  assert.equal(novo.antes.split(adicaoVariavel).length - 1, 1);
  const calculo = novo.antes.match(
    /\n {4}-- Palavra por palavra:[\s\S]*?WHERE w\.palavra <> '';\n/,
  );
  assert.ok(calculo, "bloco que calcula v_padroes");
  assert.equal(
    novo.antes.replace(adicaoVariavel, "").replace(calculo[0], ""),
    velho.antes,
  );
  // O mesmo texto do filtro nos dois blocos (total_count e pagina), senao a paginacao erra.
  // (o primeiro bloco fecha o comando com `;`, o segundo continua no ORDER BY)
  assert.equal(
    semRecuo(novo.filtros[0]).replace(/;$/, ""),
    semRecuo(novo.filtros[1]),
  );
  const c = corpo(sql);
  // As palavras: padroes sem acento, % _ e barra escapados; TODAS (NOT EXISTS de uma que falte); texto junto do produto.
  assert.ok(
    c.includes(
      "regexp_split_to_table(COALESCE(v_clean_search, ''), '[[:space:]]+')",
    ),
  );
  assert.ok(c.includes("WHERE w.palavra <> ''"));
  assert.ok(
    c.includes(
      "replace(replace(replace(unaccent(w.palavra), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_')",
    ),
  );
  assert.equal(
    c.split(
      "WHERE NOT EXISTS (SELECT 1 FROM unnest(v_padroes) AS w(padrao) WHERE t.texto NOT ILIKE w.padrao)",
    ).length - 1,
    2,
  );
  assert.equal(
    c.split(
      "unaccent(concat_ws(' ', p.nome, p.codigo, (SELECT string_agg(concat_ws(' ', vt.sku, vt.name, vt.value), ' ') FROM public.product_variants vt WHERE vt.product_id = p.id AND vt.active)))",
    ).length - 1,
    2,
  );
  assert.equal(c.split("OFFSET 0) t").length - 1, 2);
  // Codigo de barras: IGUALDADE do texto inteiro (produto e variacao ATIVA), nunca ILIKE, e fora do texto junto.
  assert.equal(c.split("p.codigo_barras = v_clean_search OR").length - 1, 2);
  assert.equal(
    c.split("vc.active AND vc.codigo_barras = v_clean_search").length - 1,
    2,
  );
  assert.doesNotMatch(c, /codigo_barras\s+(?:I?LIKE)/i);
  assert.doesNotMatch(c, /concat_ws\([^)]*codigo_barras/);
  // O filtro velho (a frase inteira colada) nao sobrou.
  assert.doesNotMatch(
    c,
    /unaccent\(p\.nome\) ILIKE unaccent\('%' \|\| v_clean_search/,
  );
  // O gate de admin e o resto ficam: a unica porta e' is_admin_atual() (a da 381), no topo.
  assert.ok(c.includes("IF NOT public.is_admin_atual() THEN"));
  assert.ok(!c.includes("public.is_admin()"));
  assert.ok(c.indexOf("is_admin_atual") < c.indexOf("v_clean_search :="));
});

Deno.test("3992: sem BEGIN/COMMIT, pre-voo antes do CREATE (corpo, atributos, dono, ACL, colunas), hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado", () => {
  for (const texto of [sql, rb]) {
    assert.ok(texto.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
    assert.equal(
      require("../scripts/db-prove-rollback.cjs").avaliarFase0({
        sqlMigration: texto,
        sqlRollback: rb,
        temRollback: true,
      }).recusado,
      false,
    );
    const externo = texto
      .replace(definicao(texto), "")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      externo,
      /\b(?:BEGIN;|COMMIT|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE (?:TABLE|INDEX|UNIQUE|TRIGGER|POLICY))\b/i,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(
      texto.includes(
        "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.busca3992_atributos')::jsonb",
      ),
    );
    assert.ok(texto.includes(H_ANTES));
    assert.ok(texto.includes(H_NOVO));
    assert.ok(texto.includes(`'${ASSINATURA}'`));
    // Os atributos de sempre: VOLATILE, SECURITY DEFINER, search_path, dono, uma assinatura so, EXECUTE fechado.
    assert.ok(texto.includes("p.provolatile = 'v'"));
    assert.ok(
      texto.includes(
        "p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]",
      ),
    );
    assert.ok(texto.includes("q.proname = 'get_admin_products_paged') = 1"));
    assert.ok(texto.includes("p.proowner = (SELECT proowner FROM pg_proc"));
    assert.ok(
      texto.includes("NOT has_function_privilege('anon', p.oid, 'EXECUTE')"),
    );
    assert.ok(
      texto.includes(
        "has_function_privilege('service_role', p.oid, 'EXECUTE')",
      ),
    );
    assert.ok(texto.includes("a.grantee = 0 AND a.privilege_type = 'EXECUTE'"));
    assert.ok(!texto.includes("\r"));
  }
  // O apply aceita o corpo da 385 OU o proprio (reaplicar e' inofensivo); o rollback so aceita o desta.
  assert.ok(
    sql.includes(
      "v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    ),
  );
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  // O apply exige as colunas que o filtro novo le (plpgsql nao valida coluna ao criar a funcao): 9 colunas, todas do tipo certo.
  for (const parte of [
    "a.attrelid = to_regclass('public.produtos') AND a.attname IN ('nome', 'codigo', 'codigo_barras') AND a.atttypid = 'text'::regtype",
    "a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('name', 'value', 'sku', 'codigo_barras') AND a.atttypid = 'text'::regtype",
    "a.attname = 'active' AND a.atttypid = 'boolean'::regtype",
    "a.attname = 'product_id' AND a.atttypid = 'uuid'::regtype",
    ") <> 9 THEN",
  ])
    assert.ok(sql.includes(parte), `pre-voo sem: ${parte}`);
});

Deno.test("3992: a penultima redefinicao de get_admin_products_paged e' a desta migration (a 20261399980000, o desempate por id, a sucede); db-apply exige as guardas dos dois blocos", () => {
  const fontes = [
    ...Deno.readDirSync(new URL("../supabase/migrations/", import.meta.url)),
  ]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  // A sucessora (as listas do painel desempatam por id) tem o proprio teste:
  // tests/migration_as_listas_do_painel_nao_repetem_nem_escondem_ninguem_entre_as_paginas_test.ts.
  assert.equal(
    fontes.at(-1),
    "20261399980000_as_listas_do_painel_nao_repetem_nem_escondem_ninguem_entre_as_paginas.sql",
    "outra migration redefine get_admin_products_paged depois da 20261399980000",
  );
  assert.equal(
    fontes.at(-2),
    nome,
    "outra migration redefine get_admin_products_paged entre esta e a 20261399980000",
  );
  assert.equal(fontes.at(-3), nome85);
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[nome];
  assert.equal(checagem?.funcao, "get_admin_products_paged");
  assert.equal(avaliarChecagem(corpo(sql), checagem).situacao, "verificada");
  // O corpo da 385 (sem as palavras) NAO passa; e tirar qualquer marcador de UM bloco so (a contagem e' 2) tambem reprova.
  assert.equal(avaliarChecagem(corpo(anterior), checagem).situacao, "falhou");
  for (const marcador of checagem.esperado as { texto: string }[]) {
    assert.equal(
      avaliarChecagem(corpo(sql).replace(marcador.texto, ""), checagem)
        .situacao,
      "falhou",
      `tirar "${marcador.texto}" de um bloco nao reprovou`,
    );
  }
});

Deno.test("3992: as consultas que leem esta funcao aceitam o corpo EXATO desta (LF e CRLF) e o da 385; a 119a/119b estao registradas, com rol fechado", async () => {
  const corpoNovo = corpo(sql);
  const shas = [sha256(corpoNovo), sha256(corpoNovo.replace(/\n/g, "\r\n"))];
  const a17 = ler(
    "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
  );
  const b17 = ler(
    "scripts/publicacao/consultas/17b-antes-estoque-do-painel-corpos-vigentes.sql",
  );
  for (const h of shas) {
    assert.equal(a17.split(`'${h}'`).length - 1, 1, "17a cita o hash uma vez");
    assert.ok(!b17.includes(h), "17b nao aceita a sucessora");
  }
  const a86 = ler(
    "scripts/publicacao/consultas/86a-conferir-ex-admin-no-resto-do-painel-aplicado.sql",
  );
  const b86 = ler(
    "scripts/publicacao/consultas/86b-antes-ex-admin-no-resto-do-painel-base-vigente.sql",
  );
  assert.ok(a86.includes(`'${H_NOVO}'`) && a86.includes(`'${H_ANTES}'`));
  assert.ok(!b86.includes(H_NOVO));
  const a90 = ler(
    "scripts/publicacao/consultas/90a-conferir-busca-do-painel-por-codigo-aplicado.sql",
  );
  assert.ok(a90.includes(`'${H_NOVO}'`) && a90.includes(`'${H_ANTES}'`));

  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  for (const [nomeConsulta, hashDaFuncao] of [
    [A119, H_NOVO],
    [B119, H_ANTES],
  ] as Array<[string, string]>) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hashDaFuncao}'`));
    assert.ok(!consulta.includes(hashDaFuncao === H_NOVO ? H_ANTES : H_NOVO));
    // So catalogo: nenhuma tabela de negocio, nenhuma chamada das funcoes.
    assert.doesNotMatch(
      consulta.replace(/--[^\n]*/g, ""),
      /FROM public\.(?:produtos|product_variants|marketplace_|order_refunds|fin_lancamentos)|(?:get_admin_products_paged|painel_inicio|fin_resumo)\(\s*['$]/,
    );
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.equal(rol.length, 10);
    assert.equal(
      rol.filter((i: string) => i.startsWith("get_admin_products_paged"))
        .length,
      3,
    );
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(nomeConsulta));
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1), rol), null);
    assert.notEqual(estruturaDoRolFechado([...linhas, linhas[0]], rol), null);
    assert.equal(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${nomeConsulta}.sql"`,
      ).length - 1,
      2,
      "nas duas listas de paths do rpc-ci",
    );
    assert.ok(
      ler(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nomeConsulta}\n`,
      ),
    );
  }
  const entrada = JSON.parse(
    ler("scripts/frota/canais-de-backend.json"),
  ).provasDeObjetos.find((p: { versoes: string[] }) =>
    p.versoes.includes("20261399200000"),
  );
  assert.equal(entrada.consulta, A119);
  assert.equal(entrada.ausenciaConfirmadaPor, B119);
  // As duas migrations do lote, na ordem de aplicacao; nada de backfill nem de nuncaAplicar.
  assert.deepEqual(entrada.versoes, ["20261399200000", "20261399300000"]);
  assert.equal(entrada.backfillLedger, undefined);
  assert.equal(entrada.nuncaAplicar, undefined);
});

Deno.test("3992: a prova viva roda no rpc-ci (job bloqueante), esta registrada no LEIA-ME, e as provas que desfazem a 385 desfazem esta ANTES", () => {
  const rpc = ler(".github/workflows/rpc-ci.yml");
  assert.equal(
    rpc.split(
      "node tests/banco/rodar-isolado.cjs tests/banco/a-busca-do-painel-acha-por-palavras-viva.cjs",
    ).length - 1,
    1,
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-busca-do-painel-acha-por-palavras-viva.cjs",
    ),
  );
  const {
    BUSCA_POR_PALAVRAS,
  } = require("./banco/a-busca-do-painel-acha-por-palavras-posterior.cjs");
  assert.equal(BUSCA_POR_PALAVRAS.nome, nome);
  assert.ok(BUSCA_POR_PALAVRAS.noAr.includes(H_NOVO));
  // O modulo da 385 chama o desta ANTES de qualquer rollback (todos os chamadores herdam a ordem).
  const posterior85 = ler(
    "tests/banco/busca-do-painel-por-codigo-posterior.cjs",
  );
  const iPalavras = posterior85.indexOf("desfazerBuscaPorPalavrasNaTransacao");
  assert.ok(iPalavras > 0);
  assert.ok(iPalavras < posterior85.indexOf("rollback-manual-"));
  // A prova viva da 385 desfaz esta antes de medir a 385 isolada.
  const viva85 = ler("tests/banco/busca-do-painel-por-codigo-viva.cjs");
  assert.ok(
    viva85.includes("a-busca-do-painel-acha-por-palavras-posterior.cjs"),
  );
});
