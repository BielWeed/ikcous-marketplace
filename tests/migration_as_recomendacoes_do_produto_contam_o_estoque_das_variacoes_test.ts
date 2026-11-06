import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261399800000_as_recomendacoes_do_produto_contam_o_estoque_das_variacoes.sql";
const nome394 =
  "20261394100000_a_lista_de_recomendacoes_do_produto_tem_teto.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$function$";
const FN = "get_product_recommendations";
const definicao = (sql: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`);
  if (ini < 0) return "";
  const ab = sql.indexOf(DELIM, ini);
  const fim = sql.indexOf(DELIM, ab + DELIM.length);
  return sql.slice(ini, fim + DELIM.length);
};
const corpo = (sql: string) => {
  const d = definicao(sql);
  const ab = d.indexOf(DELIM);
  return d.slice(ab + DELIM.length, d.length - DELIM.length);
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// O corpo vigente (o da 20261394100000) e o que esta migration deixa.
const H_ANTES = "5e5bbe7bc7f12738a9082232ee6cfee6";
const H_DEPOIS = "9b9fa184eb3984e8afd3ec0f80a086e7";
// O corpo da 20261160000000, que esta migration RECUSA (a 20261394100000 vem antes).
const H_160 = "3de5b27cc17c31301249861b7921a6fe";
const FILTRO_VELHO = "AND p.estoque > 0";
const LINHA_VELHA = `      ${FILTRO_VELHO}\n`;
const FILTRO_NOVO =
  "AND CASE WHEN EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.active) THEN (SELECT COALESCE(SUM(v.stock_increment),0) FROM public.product_variants v WHERE v.product_id = p.id AND v.active) ELSE p.estoque END > 0";
const LINHA_NOVA = `      ${FILTRO_NOVO}\n`;
const TETO = "LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50)";

const anterior = ler(`supabase/migrations/${nome394}`);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("399800: o corpo anterior e' o da 20261394100000; esta migration troca UMA linha (o filtro do estoque, com 3 linhas de comentario); o rollback devolve o corpo byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  assert.equal(md5(corpo(sql)), H_DEPOIS);
  assert.equal(md5(corpo(rb)), H_ANTES);
  assert.equal(corpo(rb), corpo(anterior));
  assert.equal(definicao(rb), definicao(anterior));
  // O cabecalho (assinatura, SECURITY DEFINER, search_path, retorno) e' o mesmo.
  assert.equal(
    definicao(sql).split(DELIM)[0],
    definicao(anterior).split(DELIM)[0],
  );
  // O filtro antigo existe uma vez no corpo anterior e nenhuma no novo; o novo existe uma vez.
  assert.equal(corpo(anterior).split(LINHA_VELHA).length - 1, 1);
  assert.equal(corpo(sql).includes(FILTRO_VELHO), false);
  assert.equal(corpo(sql).split(LINHA_NOVA).length - 1, 1);
  const c = corpo(sql);
  const i = c.indexOf(LINHA_NOVA);
  const comentario = c.slice(
    c.lastIndexOf("\n      -- 20261399800000:", i) + 1,
    i,
  );
  assert.equal(comentario.split("\n").filter(Boolean).length, 3);
  // Tira o comentario e volta o filtro antigo: sobra o corpo anterior, byte a byte.
  assert.equal(
    c.replace(comentario + LINHA_NOVA, LINHA_VELHA),
    corpo(anterior),
  );
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
});

Deno.test("399800: a regra da vitrine — variacao ATIVA do proprio produto manda, senao a coluna; o resto do corpo (teto, custo e fornecedor NULOS, filtro de ativo, ordem) fica", () => {
  const c = corpo(sql);
  // Com variacao ativa a soma das ativas (NULL vale 0), senao a coluna; as tres subconsultas olham o produto da linha.
  assert.equal(c.split("v.product_id = p.id AND v.active").length - 1, 2);
  assert.equal(c.split("product_variants").length - 1, 2);
  assert.equal(c.split("COALESCE(SUM(v.stock_increment),0)").length - 1, 1);
  assert.equal(c.split("ELSE p.estoque END > 0").length - 1, 1);
  assert.ok(c.includes(`LIMIT ${TETO};`));
  assert.ok(definicao(sql).includes("p_limit integer DEFAULT 4"));
  assert.ok(c.includes("AND p.ativo = true"));
  assert.ok(c.includes("p.data_cadastro DESC"));
  assert.ok(
    c.includes("NULL::numeric(10,2),  -- custo: nunca sai desta funcao"),
  );
  assert.ok(
    c.includes(
      "NULL::uuid,           -- fornecedor_id: nunca sai desta funcao",
    ),
  );
  // A coluna estoque que a funcao devolve segue sendo a crua (o contrato SETOF produtos nao muda).
  assert.ok(c.includes("        p.estoque,\n"));
});

Deno.test("399800: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes, dono, colunas de product_variants, fumaca e fotografia dos atributos amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
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
      /\b(?:BEGIN;|COMMIT|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(
      texto.includes("p.proname = 'get_product_recommendations') <> 1"),
    );
    assert.ok(texto.includes("AND p.prosecdef"));
    assert.ok(texto.includes("AND p.provolatile = 'v'"));
    assert.ok(texto.includes("AND p.proretset"));
    assert.ok(
      texto.includes("AND p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    assert.ok(
      texto.includes("has_function_privilege('anon', v_oid, 'EXECUTE')"),
    );
    assert.ok(
      texto.includes(
        "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
      ),
    );
    assert.ok(
      texto.includes(
        "has_function_privilege('service_role', v_oid, 'EXECUTE')",
      ),
    );
  }
  assert.ok(sql.includes(H_ANTES) && sql.includes(H_DEPOIS));
  // O pre-voo aceita o corpo vigente OU o desta migration (reaplicar e' no-op) e RECUSA o da 20261160; o rollback so aceita o desta.
  assert.ok(sql.includes(`v_hash NOT IN (\n       '${H_ANTES}'`));
  assert.ok(sql.includes(`'${H_DEPOIS}'  -- corpo que ESTA migration deixa`));
  assert.equal(sql.includes(H_160), false);
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${H_DEPOIS}' THEN`));
  assert.ok(
    sql.includes("current_setting('ikcous.recs3998_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.recs3998_rb_atributos')::jsonb"),
  );
  // O dono da funcao tem de ser o das duas tabelas que o corpo le com os privilegios dele.
  assert.ok(sql.includes("to_regclass('public.produtos')"));
  assert.ok(sql.includes("to_regclass('public.product_variants')"));
  assert.ok(sql.includes("v_dono IS DISTINCT FROM"));
  // Colunas que o corpo novo cita: plpgsql so acusa a ausente na primeira chamada.
  for (const col of [
    "a.attname = 'product_id' AND a.atttypid = 'uuid'::regtype",
    "a.attname = 'active' AND a.atttypid = 'boolean'::regtype",
    "a.attname = 'stock_increment' AND a.atttypid = 'integer'::regtype",
  ])
    assert.ok(sql.includes(col), col);
  // Pos-voo: o filtro novo uma vez, o antigo nenhuma, o teto uma vez, e a fumaca compila o corpo contra product_variants.
  assert.ok(sql.includes("v_marca text := 'ELSE p.estoque END > 0';"));
  assert.ok(sql.includes("v_filtro_velho text := 'AND p.estoque > 0';"));
  assert.ok(
    sql.includes("o filtro antigo sobre a coluna crua ainda está no corpo"),
  );
  assert.ok(
    sql.includes(
      "PERFORM count(*) FROM public.get_product_recommendations('00000000-0000-0000-0000-000000000000'::uuid, 1);",
    ),
  );
  assert.ok(!sql.includes("\r"));
  assert.ok(!rb.includes("\r"));
  for (const arquivo of [nome, `rollback-manual-${nome}`]) {
    const bruto = Deno.readTextFileSync(
      new URL(`../supabase/migrations/${arquivo}`, import.meta.url),
    );
    assert.ok(!bruto.includes("\r"), `${arquivo} em disco tem CR`);
  }
});

Deno.test("399800: e' a ULTIMA redefinicao de get_product_recommendations da arvore (depois da 20261394100000); db-apply exige as guardas", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine get_product_recommendations depois da 399800",
  );
  assert.equal(fontes.at(-2), nome394);
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagens = VERIFICACOES[nome];
  assert.equal(checagens?.length, 1);
  assert.equal(checagens[0].funcao, FN);
  assert.equal(
    avaliarChecagem(corpo(sql), checagens[0]).situacao,
    "verificada",
  );
  // Com o filtro antigo (o corpo anterior) a verificacao falha; cada marcador tira a verificacao do ar quando some.
  assert.equal(
    avaliarChecagem(corpo(anterior), checagens[0]).situacao,
    "falhou",
  );
  for (const m of checagens[0].esperado as Array<{ texto: string }>)
    assert.equal(
      avaliarChecagem(corpo(sql).replace(m.texto, "XX"), checagens[0]).situacao,
      "falhou",
      `o marcador "${m.texto.slice(0, 40)}" nao pega a regressao`,
    );
  // A verificacao da 107 segue de pe com o corpo novo (o teto continua la): nada do que ela cobra foi tirado.
  // eslint-disable-next-line security/detect-object-injection -- Nome literal da migration anterior, nunca entrada externa.
  const da107 = VERIFICACOES[nome394];
  assert.equal(
    avaliarChecagem(corpo(sql), da107[0]).situacao,
    "verificada",
    "o corpo novo perdeu algo que a verificacao da 20261394100000 cobra",
  );
});

Deno.test("399800: a 9a, a 107a e a 124a/124b aceitam o corpo certo; as consultas 124a/124b sao so de catalogo, quatro linhas fechadas, e estao registradas", async () => {
  const nove = ler(
    "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
  );
  // O corpo FINAL da 9a e' o desta migration; o da 20261394100000 e o da 20261160 ainda no ar aparecem como ele.
  assert.ok(nove.includes(`('${FN}', '${H_DEPOIS}')`));
  assert.ok(!nove.includes(`('${FN}', '${H_ANTES}')`));
  assert.ok(
    nove.includes(
      `(c.h = '${H_160}' OR c.h = '${H_ANTES}')\n              THEN '${H_DEPOIS}'`,
    ),
  );
  // A 107a aceita o corpo desta como sucessor do da 20261394100000 e normaliza ao esperado historico.
  const a107 = ler(
    "scripts/publicacao/consultas/107a-conferir-a-lista-de-recomendacoes-do-produto-tem-teto-aplicado.sql",
  );
  assert.ok(a107.includes(`h IN ('${H_ANTES}', '${H_DEPOIS}')`));
  assert.ok(a107.includes(`THEN '${H_ANTES}' ELSE h END`));
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A =
    "124a-conferir-as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-aplicado";
  const B =
    "124b-antes-as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-base-vigente";
  for (const [nomeConsulta, hash] of [
    [A, H_DEPOIS],
    [B, H_ANTES],
  ]) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hash}'`));
    // So catalogo: nenhuma tabela de produto e' lida e a RPC nao e' chamada.
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:marketplace_|produtos|product_variants|profiles|coupons|store_config)|public\.get_product_recommendations\(\s*[^u]/,
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
    p.versoes.includes("20261399800000"),
  );
  assert.equal(entrada.consulta, A);
  assert.equal(entrada.ausenciaConfirmadaPor, B);
  assert.deepEqual(entrada.versoes, ["20261399800000"]);
  assert.ok(/^[\x20-\x7e]*$/.test(String(entrada._comentario)));
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assert.equal(
      Object.entries(entrada).find(([chave]) => chave === campo)?.[1],
      undefined,
      campo,
    );
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-viva.cjs",
    ),
  );
  // A prova da 107 reaplica a 20261394100000 sobre a arvore migrada: desfaz esta ANTES, pelo helper (hash do corpo novo e rollback desta migration).
  const posterior = ler(
    "tests/banco/as-recomendacoes-do-produto-posterior.cjs",
  );
  assert.ok(posterior.includes(`'${H_DEPOIS}'`));
  assert.ok(posterior.includes(nome));
  assert.ok(posterior.includes("`rollback-manual-${"));
  assert.ok(
    ler(
      "tests/banco/a-lista-de-recomendacoes-do-produto-tem-teto-viva.cjs",
    ).includes("as-recomendacoes-do-produto-posterior.cjs"),
  );
});
