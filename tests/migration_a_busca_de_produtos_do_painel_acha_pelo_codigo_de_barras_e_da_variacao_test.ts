import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// O COMPORTAMENTO e' provado no Postgres efemero (tests/banco/busca-do-painel-por-codigo-viva.cjs); aqui fica o contrato dos arquivos.
const require = createRequire(import.meta.url);
const nome =
  "20261385000000_a_busca_de_produtos_do_painel_acha_pelo_codigo_de_barras_e_da_variacao.sql";
const nome81 =
  "20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
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

const H_ANTES = "d204becede7d249e0a1871038f854a46";
const ASSINATURA =
  "public.get_admin_products_paged(text,text,text,text,integer,integer)";
const A90 = "90a-conferir-busca-do-painel-por-codigo-aplicado";
const B90 = "90b-antes-busca-do-painel-por-codigo-base-vigente";

const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const anterior = ler(`supabase/migrations/${nome81}`);
const H_NOVO = md5(corpo(sql));

// A UNICA edicao desta migration sobre o corpo da 20261381, aplicada nos dois blocos do filtro (cada um com o seu recuo).
const clausula = (ind: string) =>
  [
    `${ind}unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%') OR`,
    `${ind}-- Codigo de barras: IGUALDADE (um EAN pode ser prefixo de outro), do produto ou de uma variacao ATIVA;`,
    `${ind}-- o SKU da variacao segue o criterio do codigo do produto acima.`,
    `${ind}p.codigo_barras = v_clean_search OR`,
    `${ind}EXISTS (`,
    `${ind}  SELECT 1 FROM public.product_variants vc`,
    `${ind}   WHERE vc.product_id = p.id AND vc.active`,
    `${ind}     AND (vc.codigo_barras = v_clean_search`,
    `${ind}          OR unaccent(vc.sku) ILIKE unaccent('%' || v_clean_search || '%'))`,
    `${ind})`,
    "",
  ].join("\n");
// Ancorada no fim da linha anterior: o recuo de 10 espacos e' sufixo do de 14.
const antigaLinha = (ind: string) =>
  `\n${ind}unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%')\n`;

Deno.test("385: o corpo anterior e' o da 381 (md5 fixo) e esta migration so amplia o filtro de busca, nos DOIS blocos, com o mesmo texto", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  // O rollback e' a definicao da 381, byte a byte.
  assert.equal(definicao(rb), definicao(anterior));
  assert.equal(md5(corpo(rb)), H_ANTES);
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  // Reconstroi a migration a partir da 381: troca a linha do codigo pelas novas, em cada recuo. Sobra o texto da 385 inteiro.
  let esperado = definicao(anterior);
  let trocas = 0;
  for (const ind of [" ".repeat(10), " ".repeat(14)]) {
    assert.equal(
      esperado.split(antigaLinha(ind)).length - 1,
      1,
      `a 381 devia ter a linha do codigo uma vez com ${ind.length} espacos`,
    );
    esperado = esperado.replace(antigaLinha(ind), `\n${clausula(ind)}`);
    trocas += 1;
  }
  assert.equal(trocas, 2);
  assert.equal(definicao(sql), esperado);
  // O mesmo texto nos dois blocos (total_count e pagina), senao a paginacao erra.
  const blocos = [
    ...definicao(sql).matchAll(
      /unaccent\(p\.codigo\) ILIKE[\s\S]*?\n( *)\)\n( *)\)/g,
    ),
  ].map((m) =>
    m[0]
      .split("\n")
      .map((l) => l.trim())
      .join("\n"),
  );
  assert.equal(blocos.length, 2);
  assert.equal(blocos[0], blocos[1]);
  const c = corpo(sql);
  // Igualdade para o codigo de barras (produto e variacao), nunca ILIKE; SKU como o codigo do produto; so variacao ativa.
  assert.equal(c.split("p.codigo_barras = v_clean_search OR").length - 1, 2);
  assert.equal(c.split("vc.codigo_barras = v_clean_search").length - 1, 2);
  assert.equal(c.split("AND vc.active").length - 1, 2);
  assert.equal(
    c.split("unaccent(vc.sku) ILIKE unaccent('%' || v_clean_search || '%')")
      .length - 1,
    2,
  );
  assert.doesNotMatch(c, /codigo_barras\s+(?:I?LIKE)/i);
  // O gate de admin e o resto ficam: a unica porta e' is_admin_atual() (a da 381), no topo.
  assert.ok(c.includes("IF NOT public.is_admin_atual() THEN"));
  assert.ok(!c.includes("public.is_admin()"));
  assert.ok(c.indexOf("is_admin_atual") < c.indexOf("v_clean_search :="));
});

Deno.test("385: sem BEGIN/COMMIT, pre-voo antes do CREATE (corpo, atributos, dono, ACL, colunas), hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado", () => {
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
        "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.busca385_atributos')::jsonb",
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
  // O apply aceita o corpo da 381 OU o proprio (reaplicar e' inofensivo); o rollback so aceita o desta.
  assert.ok(
    sql.includes(
      "v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    ),
  );
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  // O apply exige as colunas que o filtro novo le (plpgsql nao valida coluna ao criar a funcao).
  for (const parte of [
    "a.attrelid = to_regclass('public.produtos') AND a.attname = 'codigo_barras'",
    "a.attrelid = to_regclass('public.product_variants') AND a.attname = 'codigo_barras'",
    "a.attname = 'sku'",
    "a.attname = 'active'",
    "a.attname = 'product_id'",
    ") <> 5 THEN",
  ])
    assert.ok(sql.includes(parte), `pre-voo sem: ${parte}`);
  // O cabecalho da funcao (atributos) e' o da 381.
  assert.equal(
    definicao(sql).split("AS $function$")[0],
    definicao(anterior).split("AS $function$")[0],
  );
});

Deno.test("385: a vigente e' a ultima redefinicao de get_admin_products_paged da arvore; db-apply exige as guardas dos dois blocos", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine get_admin_products_paged depois da 385",
  );
  assert.equal(fontes.at(-2), nome81);
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[nome];
  assert.equal(checagem?.funcao, "get_admin_products_paged");
  assert.equal(avaliarChecagem(corpo(sql), checagem).situacao, "verificada");
  // O corpo da 381 (sem o filtro novo) NAO passa; e tirar qualquer marcador de UM bloco so (a contagem e' 2) tambem reprova.
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

Deno.test("385: 17a e 86a aceitam o corpo EXATO desta (e so ele); a 17b e a 86b nunca; 90a/90b sao so de catalogo, quatro linhas fechadas, e estao registradas", async () => {
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
  assert.equal(a86.split(`'${H_NOVO}'`).length - 1, 1);
  assert.ok(a86.includes(`a.assinatura='${ASSINATURA}'`));
  assert.ok(a86.includes(H_ANTES), "86a segue aceitando o corpo da 381");
  assert.ok(!b86.includes(H_NOVO));

  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, string]> = [
    [A90, H_NOVO],
    [B90, H_ANTES],
  ];
  for (const [nomeConsulta, hash] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hash}'`));
    assert.ok(!consulta.includes(hash === H_NOVO ? H_ANTES : H_NOVO));
    // So catalogo: nenhuma tabela de negocio, nenhuma chamada da funcao.
    assert.doesNotMatch(
      consulta.replace(/--[^\n]*/g, ""),
      /FROM public\.(?:produtos|product_variants|marketplace_)|get_admin_products_paged\(\s*['$]/,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 4);
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
    p.versoes.includes("20261385000000"),
  );
  assert.equal(entrada.consulta, A90);
  assert.equal(entrada.ausenciaConfirmadaPor, B90);
  assert.equal(entrada.backfillLedger, undefined);
  assert.equal(entrada.nuncaAplicar, undefined);
});

Deno.test("385: a prova viva roda no rpc-ci (job bloqueante), e as provas que desfazem a 381 desfazem esta ANTES", () => {
  const rpc = ler(".github/workflows/rpc-ci.yml");
  assert.equal(
    rpc.split(
      "node tests/banco/rodar-isolado.cjs tests/banco/busca-do-painel-por-codigo-viva.cjs",
    ).length - 1,
    1,
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "busca-do-painel-por-codigo-viva.cjs",
    ),
  );
  const {
    BUSCA_DO_PAINEL,
  } = require("./banco/busca-do-painel-por-codigo-posterior.cjs");
  assert.equal(BUSCA_DO_PAINEL.nome, nome);
  assert.ok(BUSCA_DO_PAINEL.noAr.includes(H_NOVO));
  // O modulo da 381 chama o desta ANTES de qualquer rollback (os seis chamadores herdam a ordem)...
  const posterior81 = ler("tests/banco/ex-admin-resto-do-painel-posterior.cjs");
  const iBusca = posterior81.indexOf("desfazerBuscaDoPainelNaTransacao");
  assert.ok(iBusca > 0);
  assert.ok(iBusca < posterior81.indexOf("rollback-manual-"));
  // ...e as provas que desfazem a 381 por lista propria (a 97) chamam o desta antes de percorrer a lista.
  for (const arq of [
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/pagamentos-rpc-viva.cjs",
    "tests/banco/admin-atual-endurecimento-viva.cjs",
  ])
    assert.ok(
      ler(arq).includes("busca-do-painel-por-codigo-posterior.cjs"),
      `${arq} nao desfaz a 385 antes da 381`,
    );
});
