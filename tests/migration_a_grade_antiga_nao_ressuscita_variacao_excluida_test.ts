import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261395100000_a_grade_antiga_nao_ressuscita_variacao_excluida.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$function$";
const FN = "salvar_produto_com_grade";
const V = "20261395100000";
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

const H_ANTES = "09c2a4b5724acbe46fb2c2e758e96c8f";
const H_DEPOIS = "10fc8c0f1e305666b39e5f1f383815e2";

const BLOCO_NOVO =
  "      -- 20261395100000: variacao que alguem excluiu depois que esta tela abriu NAO renasce. Um id que nao existe em lugar nenhum\n" +
  "      -- so chega aqui como reenvio de uma grade antiga (a tela nunca manda id de variacao nova: manda sem id, e o banco sorteia o\n" +
  "      -- proprio). O INSERT abaixo, com esse id, trazia a variacao de volta com o estoque da tela velha. Segue para a proxima.\n" +
  "      CONTINUE;\n";
const inverso = (c: string) => {
  assert.equal(c.split(BLOCO_NOVO).length - 1, 1);
  return c.replace(BLOCO_NOVO, "");
};

const anterior = ler(
  "supabase/migrations/20261352000000_o_produto_e_a_grade_salvam_numa_transacao_so.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("395100: o corpo anterior e' o da 20261352000000; esta migration so acrescenta a troca declarada; o rollback devolve o corpo byte a byte", () => {
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
  // Desfeita a troca (inverso escrito a parte), sobra o corpo anterior, byte a byte.
  assert.equal(inverso(corpo(sql)), corpo(anterior));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
});

Deno.test("395100: a troca declarada esta onde deve e o resto do corpo (portas, dinheiro, estoque, retorno) nao mudou", () => {
  const c = corpo(sql);
  assert.equal(c.split(BLOCO_NOVO).length - 1, 1);
  // O CONTINUE novo fica DENTRO do IF v_id IS NOT NULL, depois da recusa da variacao de outro produto e antes do INSERT.
  const iRecusa = c.indexOf("Variação pertence a outro produto");
  const iNovo = c.indexOf(BLOCO_NOVO);
  const iInsert = c.indexOf("INSERT INTO public.product_variants");
  assert.ok(iRecusa > 0 && iRecusa < iNovo && iNovo < iInsert);
  // O que nao pode mudar: as travas, o formato, a versao conferida e o retorno.
  assert.ok(c.includes("ORDER BY id FOR NO KEY UPDATE"));
  assert.ok(c.includes("USING ERRCODE = 'PRD01'"));
  assert.ok(
    c.includes(
      "'ultima_atualizacao', v_atualizado_em, 'apagadas', to_jsonb(v_apagadas), 'recusadas', to_jsonb(v_recusadas)",
    ),
  );
  assert.equal(
    corpo(sql).split("20261395100000: variacao que alguem excluiu").length - 1,
    1,
  );
});

Deno.test("395100: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
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
    assert.ok(texto.includes("p.proname = 'salvar_produto_com_grade') <> 1"));
    assert.ok(texto.includes("AND p.prosecdef"));
    assert.ok(texto.includes("AND p.provolatile = 'v'"));
    assert.ok(texto.includes("AND p.pronargs = 5"));
    assert.ok(texto.includes("AND p.prokind = 'f'"));
    assert.ok(
      texto.includes("AND p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    // A ACL: authenticated e service_role sim; anon e PUBLIC nao.
    assert.ok(
      texto.includes("has_function_privilege('anon', v_oid, 'EXECUTE')"),
    );
    assert.ok(
      texto.includes(
        "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
      ),
    );
    assert.ok(
      texto.includes(
        "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
      ),
    );
    assert.ok(texto.includes("g.privilege_type = 'EXECUTE' AND g.grantee = 0"));
  }
  assert.ok(sql.includes(H_ANTES) && sql.includes(H_DEPOIS));
  // O pre-voo aceita o corpo vigente OU o desta migration (reaplicar e' no-op); o rollback so aceita o desta.
  assert.ok(sql.includes("v_hash NOT IN (v_vigente, v_desta)"));
  assert.ok(sql.includes(`', '${H_ANTES}', '${H_DEPOIS}')`));
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${H_DEPOIS}' THEN`));
  assert.ok(
    sql.includes("current_setting('ikcous.grade395_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.grade395_rb_atributos')::jsonb"),
  );
  assert.ok(
    sql.includes("a troca desta migration não aparece exatamente uma vez"),
  );
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(!sql.includes("\r"));
  assert.ok(!rb.includes("\r"));
  const bruto = Deno.readTextFileSync(
    new URL(`../supabase/migrations/${nome}`, import.meta.url),
  );
  assert.ok(!bruto.includes("\r"), "a migration em disco tem CR");
});

Deno.test("395100: a vigente e' a ultima redefinicao de salvar_produto_com_grade da arvore; db-apply exige as guardas", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine salvar_produto_com_grade depois desta",
  );
  assert.equal(
    fontes.at(-2),
    "20261352000000_o_produto_e_a_grade_salvam_numa_transacao_so.sql",
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
  // Sem a troca (o corpo anterior) a verificacao falha; cada marcador tira a verificacao do ar quando some.
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

Deno.test("395100: as consultas 109a/109b sao so de catalogo, quatro linhas fechadas, registradas, e as consultas antigas aceitam o corpo novo", async () => {
  const oitenta = ler(
    "scripts/publicacao/consultas/84a-conferir-produto-com-grade-aplicado.sql",
  );
  assert.ok(oitenta.includes("09c2a4b5724acbe46fb2c2e758e96c8f"));
  assert.ok(
    oitenta.includes(H_DEPOIS),
    "a 84a nao aceita o corpo novo como sucessor",
  );
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A =
    "109a-conferir-a-grade-antiga-nao-ressuscita-variacao-excluida-aplicado";
  const B =
    "109b-antes-a-grade-antiga-nao-ressuscita-variacao-excluida-base-vigente";
  for (const [nomeConsulta, hash] of [
    [A, H_DEPOIS],
    [B, H_ANTES],
  ]) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hash}'`));
    // So catalogo: nenhuma tabela de dado e' lida e a RPC nao e' chamada.
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:marketplace_|produtos|profiles|coupons|store_config|devolucoes|devolucao_itens|product_variants)/,
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
  ).provasDeObjetos.find((p: { versoes: string[] }) => p.versoes.includes(V));
  assert.equal(entrada.consulta, A);
  assert.equal(entrada.ausenciaConfirmadaPor, B);
  assert.deepEqual(entrada.versoes, [V]);
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
      "rodar-isolado.cjs tests/banco/a-grade-antiga-nao-ressuscita-variacao-excluida-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-grade-antiga-nao-ressuscita-variacao-excluida-viva.cjs",
    ),
  );
});
