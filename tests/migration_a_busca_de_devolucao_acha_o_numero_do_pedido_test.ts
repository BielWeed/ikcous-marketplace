import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261395000000_a_busca_de_devolucao_acha_o_numero_do_pedido.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$$";
const FN = "admin_devolucoes_listar";
const V = "20261395000000";
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

const H_ANTES = "5a632e0a239104598dcdc4eb323c09b1";
const H_DEPOIS = "989a6c6151eb35efc7c834c6cce20f01";

const ANTIGA_LINHA = "            OR d.order_id::text ILIKE v_busca || '%')\n";
const RAMO =
  "            OR upper(right(d.order_id::text, 6)) = upper(btrim(ltrim(v_busca, '#'))))\n";
const inverso = (c: string) => {
  const ini = c.indexOf(
    "            OR d.order_id::text ILIKE v_busca || '%'\n            -- 20261395000000:",
  );
  const fim = c.indexOf(RAMO, ini) + RAMO.length;
  return c.slice(0, ini) + ANTIGA_LINHA + c.slice(fim);
};

const anterior = ler(
  "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("395000: o corpo anterior e' o da 20261199000000; esta migration so acrescenta a troca declarada; o rollback devolve o corpo byte a byte", () => {
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

Deno.test("395000: a troca declarada esta onde deve e o resto do corpo (portas, dinheiro, estoque, retorno) nao mudou", () => {
  const c = corpo(sql);
  assert.equal(c.split(RAMO).length - 1, 1);
  assert.ok(
    c.includes(
      "upper(right(d.order_id::text, 6)) = upper(btrim(ltrim(v_busca, '#')))",
    ),
  );
  // Os tres ramos de antes seguem: protocolo, nome do cliente e o comeco do id.
  assert.ok(c.includes("d.protocolo ILIKE '%' || v_busca || '%'"));
  assert.ok(c.includes("o.customer_name ILIKE '%' || v_busca || '%'"));
  assert.ok(c.includes("OR d.order_id::text ILIKE v_busca || '%'\n"));
  // As duas portas de admin e a paginacao nao mudam.
  assert.ok(c.includes("IF NOT public.is_admin() THEN"));
  assert.ok(c.includes("IF NOT public.is_admin_atual() THEN"));
  assert.ok(c.includes("LIMIT v_limite OFFSET v_offset"));
  assert.equal(
    corpo(sql).split("20261395000000: o numero que o painel mostra").length - 1,
    1,
  );
});

Deno.test("395000: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
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
    assert.ok(texto.includes("p.proname = 'admin_devolucoes_listar') <> 1"));
    assert.ok(texto.includes("AND p.prosecdef"));
    assert.ok(texto.includes("AND p.provolatile = 's'"));
    assert.ok(texto.includes("AND p.pronargs = 4"));
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
    sql.includes("current_setting('ikcous.busca395_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.busca395_rb_atributos')::jsonb"),
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

Deno.test("395000: a vigente e' a ultima redefinicao de admin_devolucoes_listar da arvore; db-apply exige as guardas", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine admin_devolucoes_listar depois desta",
  );
  assert.equal(
    fontes.at(-2),
    "20261199000000_portas_do_painel_exigem_admin_atual.sql",
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

Deno.test("395000: as consultas 108a/108b sao so de catalogo, quatro linhas fechadas, registradas, e as consultas antigas aceitam o corpo novo", async () => {
  const oito = ler(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    oito.includes(`('${FN}', '${H_DEPOIS}', '${V}')`),
    "a 8e nao lista o corpo novo como sucessor",
  );
  assert.ok(
    oito.includes(`('${FN}', '${H_ANTES}')`),
    "a 8e perdeu o corpo da 199 como final",
  );
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A =
    "108a-conferir-a-busca-de-devolucao-acha-o-numero-do-pedido-aplicado";
  const B =
    "108b-antes-a-busca-de-devolucao-acha-o-numero-do-pedido-base-vigente";
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
      "rodar-isolado.cjs tests/banco/a-busca-de-devolucao-acha-o-numero-do-pedido-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-busca-de-devolucao-acha-o-numero-do-pedido-viva.cjs",
    ),
  );
});
