import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261394100000_a_lista_de_recomendacoes_do_produto_tem_teto.sql";
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

const H_ANTES = "3de5b27cc17c31301249861b7921a6fe";
const H_DEPOIS = "5e5bbe7bc7f12738a9082232ee6cfee6";
const LIMITE_ANTIGO = "    LIMIT p_limit;\n";
const TETO = "LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50)";
const LIMITE_NOVO = `    LIMIT ${TETO};\n`;

const anterior = ler(
  "supabase/migrations/20261160000000_o_codigo_de_barras_e_o_canal_nascem_no_banco.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("394100: o corpo anterior e' o da 20261160; esta migration troca UMA linha (o LIMIT, com 3 linhas de comentario); o rollback devolve o corpo byte a byte", () => {
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
  // O LIMIT antigo existe uma vez no corpo anterior e nenhuma no novo; o novo existe uma vez.
  assert.equal(corpo(anterior).split(LIMITE_ANTIGO).length - 1, 1);
  assert.equal(corpo(sql).includes(LIMITE_ANTIGO), false);
  assert.equal(corpo(sql).split(LIMITE_NOVO).length - 1, 1);
  const c = corpo(sql);
  const i = c.indexOf(LIMITE_NOVO);
  const comentario = c.slice(
    c.lastIndexOf("\n    -- 20261394100000:", i) + 1,
    i,
  );
  assert.equal(comentario.split("\n").filter(Boolean).length, 3);
  // Tira o comentario e volta o LIMIT antigo: sobra o corpo anterior, byte a byte.
  assert.equal(
    c.replace(comentario + LIMITE_NOVO, LIMITE_ANTIGO),
    corpo(anterior),
  );
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
});

Deno.test("394100: o teto — 50, piso 1, NULL vale o padrao 4 (o DEFAULT da funcao); o custo e o fornecedor seguem NULOS", () => {
  const c = corpo(sql);
  assert.ok(c.includes(`LIMIT ${TETO};`));
  assert.ok(definicao(sql).includes("p_limit integer DEFAULT 4"));
  // Fora do comentario, o numero 4 do COALESCE e' o mesmo DEFAULT da assinatura.
  assert.ok(
    c.includes("NULL::numeric(10,2),  -- custo: nunca sai desta funcao"),
  );
  assert.ok(
    c.includes(
      "NULL::uuid,           -- fornecedor_id: nunca sai desta funcao",
    ),
  );
});

Deno.test("394100: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
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
  // O pre-voo aceita o corpo vigente OU o desta migration (reaplicar e' no-op); o rollback so aceita o desta.
  assert.ok(sql.includes(`v_hash NOT IN (\n       '${H_ANTES}'`));
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${H_DEPOIS}' THEN`));
  assert.ok(sql.includes("current_setting('ikcous.recs394_atributos')::jsonb"));
  assert.ok(
    rb.includes("current_setting('ikcous.recs394_rb_atributos')::jsonb"),
  );
  assert.ok(sql.includes("o teto do limite não aparece exatamente uma vez"));
  assert.ok(!sql.includes("\r"));
  assert.ok(!rb.includes("\r"));
  const bruto = Deno.readTextFileSync(
    new URL(`../supabase/migrations/${nome}`, import.meta.url),
  );
  assert.ok(!bruto.includes("\r"), "a migration em disco tem CR");
});

Deno.test("394100: a vigente e' a ultima redefinicao de get_product_recommendations da arvore; db-apply exige as guardas", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine get_product_recommendations depois da 394100",
  );
  assert.equal(
    fontes.at(-2),
    "20261160000000_o_codigo_de_barras_e_o_canal_nascem_no_banco.sql",
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagens = VERIFICACOES[nome];
  assert.equal(checagens?.length, 1);
  assert.equal(checagens[0].funcao, FN);
  assert.equal(
    avaliarChecagem(corpo(sql), checagens[0]).situacao,
    "verificada",
  );
  // Sem o teto (o corpo anterior) a verificacao falha; cada marcador tira a verificacao do ar quando some.
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
});

Deno.test("394100: a 9a aceita o corpo novo (e o da 20261160 ainda no ar aparece como ele); as consultas 107a/107b sao so de catalogo, quatro linhas fechadas, e estao registradas", async () => {
  const nove = ler(
    "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
  );
  assert.ok(nove.includes(`('${FN}', '${H_DEPOIS}')`));
  assert.ok(!nove.includes(`('${FN}', '${H_ANTES}')`));
  assert.ok(
    nove.includes(`c.h = '${H_ANTES}'\n              THEN '${H_DEPOIS}'`),
  );
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A =
    "107a-conferir-a-lista-de-recomendacoes-do-produto-tem-teto-aplicado";
  const B =
    "107b-antes-a-lista-de-recomendacoes-do-produto-tem-teto-base-vigente";
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
      /FROM public\.(?:marketplace_|produtos|profiles|coupons|store_config)|public\.get_product_recommendations\(\s*[^u]/,
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
    p.versoes.includes("20261394100000"),
  );
  assert.equal(entrada.consulta, A);
  assert.equal(entrada.ausenciaConfirmadaPor, B);
  assert.deepEqual(entrada.versoes, ["20261394100000"]);
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
      "rodar-isolado.cjs tests/banco/a-lista-de-recomendacoes-do-produto-tem-teto-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-lista-de-recomendacoes-do-produto-tem-teto-viva.cjs",
    ),
  );
});
