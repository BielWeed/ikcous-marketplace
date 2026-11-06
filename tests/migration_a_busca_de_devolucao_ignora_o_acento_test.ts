// A BUSCA DE DEVOLUCOES IGNORA O ACENTO — prova offline do par 20261399910000 + rollback (tela Devolucoes do painel; lote 40 do modo
// autonomo). O COMPORAMENTO ("jose" acha "Jose" e "Jose Antonio" com acento, "conceicao" acha "Conceicao", o ramo do numero do pedido e o do
// comeco do id seguem, o resto do JSON identico, rollback, pre/pos-voo, consultas 126a/126b) e' provado em
// tests/banco/a-busca-de-devolucao-ignora-o-acento-viva.cjs, que so roda no Postgres efemero do CI. Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261399910000_a_busca_de_devolucao_ignora_o_acento.sql";
const nome395 =
  "20261395000000_a_busca_de_devolucao_acha_o_numero_do_pedido.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$$";
const FN = "admin_devolucoes_listar";
const V = "20261399910000";
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

// O corpo vigente (o da 20261395000000) e o que esta migration deixa.
const H_ANTES = "989a6c6151eb35efc7c834c6cce20f01";
const H_DEPOIS = "82d381944fb7b3337e7272a258b65260";
// O corpo da 20261199000000, que esta migration RECUSA (a 20261395000000 vem antes).
const H_199 = "5a632e0a239104598dcdc4eb323c09b1";

const RAMOS_VELHOS =
  "            OR d.protocolo ILIKE '%' || v_busca || '%'\n            OR o.customer_name ILIKE '%' || v_busca || '%'\n";
const COMENTARIO =
  "            -- 20261399910000: protocolo e nome do cliente ignoram o acento nos DOIS lados (public.f_unaccent, a mesma da busca de\n" +
  '            -- Pedidos, Clientes e CRM): "jose" acha "Jose" e "José"; "conceicao" acha "Conceição". Os outros ramos nao mudam.\n';
const RAMO_PROTOCOLO =
  "            OR public.f_unaccent(d.protocolo) ILIKE public.f_unaccent('%' || v_busca || '%')\n";
const RAMO_NOME =
  "            OR public.f_unaccent(o.customer_name) ILIKE public.f_unaccent('%' || v_busca || '%')\n";
const RAMOS_NOVOS = `${COMENTARIO}${RAMO_PROTOCOLO}${RAMO_NOME}`;

const anterior = ler(`supabase/migrations/${nome395}`);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("3999100: o corpo anterior e' o da 20261395000000; esta migration troca SO os ramos do protocolo e do nome (com duas linhas de comentario); o rollback devolve o corpo byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  assert.equal(md5(corpo(sql)), H_DEPOIS);
  assert.equal(md5(corpo(rb)), H_ANTES);
  assert.equal(corpo(rb), corpo(anterior));
  assert.equal(definicao(rb), definicao(anterior));
  // O cabecalho (assinatura, SECURITY DEFINER, STABLE, search_path, retorno) e' o mesmo.
  assert.equal(
    definicao(sql).split(DELIM)[0],
    definicao(anterior).split(DELIM)[0],
  );
  // Os ramos antigos existem uma vez no corpo anterior e nenhuma no novo; os novos existem uma vez.
  assert.equal(corpo(anterior).split(RAMOS_VELHOS).length - 1, 1);
  assert.equal(corpo(sql).includes("OR d.protocolo ILIKE"), false);
  assert.equal(corpo(sql).includes("OR o.customer_name ILIKE"), false);
  assert.equal(corpo(sql).split(RAMOS_NOVOS).length - 1, 1);
  // Troca os ramos novos pelos antigos: sobra o corpo anterior, byte a byte.
  assert.equal(
    corpo(sql).replace(RAMOS_NOVOS, () => RAMOS_VELHOS),
    corpo(anterior),
  );
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
});

Deno.test("3999100: a regra — public.f_unaccent nos DOIS lados do protocolo e do nome; o ramo do comeco do id e o do numero do pedido (20261395000000), as duas portas e a paginacao ficam", () => {
  const c = corpo(sql);
  assert.equal(c.split(RAMO_PROTOCOLO).length - 1, 1);
  assert.equal(c.split(RAMO_NOME).length - 1, 1);
  // So f_unaccent(coluna) ILIKE f_unaccent(termo): nunca um lado sem a funcao.
  assert.equal(c.split("public.f_unaccent(").length - 1, 4);
  assert.ok(c.includes("OR d.order_id::text ILIKE v_busca || '%'\n"));
  assert.ok(
    c.includes(
      "OR upper(right(d.order_id::text, 6)) = upper(btrim(ltrim(v_busca, '#'))))\n",
    ),
  );
  assert.equal(
    c.split("20261395000000: o numero que o painel mostra").length - 1,
    1,
  );
  assert.ok(c.includes("IF NOT public.is_admin() THEN"));
  assert.ok(c.includes("IF NOT public.is_admin_atual() THEN"));
  assert.ok(c.includes("LIMIT v_limite OFFSET v_offset"));
  assert.ok(c.includes("count(*) FILTER (WHERE status = 'solicitada')"));
  // A f_unaccent do banco e' STRICT e IMMUTABLE e o corpo a chama com o esquema (search_path 'public').
  const f = ler(
    "supabase/migrations/20261068000000_a_busca_de_pedidos_para_de_varrer_o_banco.sql",
  );
  assert.ok(f.includes("CREATE OR REPLACE FUNCTION public.f_unaccent(text)"));
  assert.ok(f.includes("STRICT"));
  assert.equal(
    c.includes(" f_unaccent("),
    false,
    "toda chamada traz o esquema public.",
  );
});

Deno.test("3999100: sem BEGIN/COMMIT, pre-voo antes do CREATE (exige f_unaccent), hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
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
  // O pre-voo aceita o corpo vigente OU o desta migration (reaplicar e' no-op) e RECUSA o da 20261199; o rollback so aceita o desta.
  assert.ok(sql.includes("v_hash NOT IN (v_vigente, v_desta)"));
  assert.ok(sql.includes(`', '${H_ANTES}', '${H_DEPOIS}')`));
  assert.equal(sql.includes(H_199), false);
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${H_DEPOIS}' THEN`));
  assert.ok(sql.includes("to_regprocedure('public.f_unaccent(text)') IS NULL"));
  assert.ok(
    sql.indexOf("to_regprocedure('public.f_unaccent(text)') IS NULL") <
      sql.indexOf("CREATE OR REPLACE FUNCTION"),
  );
  assert.ok(
    sql.includes("current_setting('ikcous.devolucao3999_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.devolucao3999_rb_atributos')::jsonb"),
  );
  assert.ok(
    sql.includes("a troca desta migration não aparece exatamente uma vez"),
  );
  assert.ok(sql.includes("um ramo antigo com acento ainda está no corpo"));
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(!sql.includes("\r"));
  assert.ok(!rb.includes("\r"));
  for (const arquivo of [nome, `rollback-manual-${nome}`]) {
    const bruto = Deno.readTextFileSync(
      new URL(`../supabase/migrations/${arquivo}`, import.meta.url),
    );
    assert.ok(!bruto.includes("\r"), `${arquivo} em disco tem CR`);
  }
});

Deno.test("3999100: e' a ULTIMA redefinicao de admin_devolucoes_listar da arvore (depois da 20261395000000); db-apply exige as guardas", () => {
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
  assert.equal(fontes.at(-2), nome395);
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
  // A verificacao da 395 segue de pe com o corpo novo (o ramo do numero do pedido continua la): nada do que ela cobra foi tirado.
  // eslint-disable-next-line security/detect-object-injection -- Nome literal da migration anterior, nunca entrada externa.
  const da395 = VERIFICACOES[nome395];
  assert.equal(
    avaliarChecagem(corpo(sql), da395[0]).situacao,
    "verificada",
    "o corpo novo perdeu algo que a verificacao da 20261395000000 cobra",
  );
  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  const registro = SUCESSORAS_DA_99.find(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.equal(registro.hashVigente, H_ANTES);
  assert.equal(registro.hashDesta, H_DEPOIS);
});

Deno.test("3999100: as consultas 108a, 8e, 126a e 126b aceitam o corpo certo; 126a/126b sao so de catalogo, quatro linhas fechadas, e estao registradas", async () => {
  const oito = ler(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    oito.includes(`('${FN}', '${H_DEPOIS}', '${V}')`),
    "a 8e nao lista o corpo novo como sucessor",
  );
  assert.ok(
    oito.includes(`('${FN}', '${H_ANTES}', '20261395000000')`),
    "a 8e perdeu o corpo da 395 como sucessor",
  );
  assert.ok(
    oito.includes(`('${FN}', '${H_199}')`),
    "a 8e perdeu o corpo da 199 como final",
  );
  // A 108a aceita o corpo desta como sucessor do da 395 e normaliza ao esperado historico.
  const a108 = ler(
    "scripts/publicacao/consultas/108a-conferir-a-busca-de-devolucao-acha-o-numero-do-pedido-aplicado.sql",
  );
  assert.ok(a108.includes(`h IN ('${H_ANTES}', '${H_DEPOIS}')`));
  assert.ok(a108.includes(`THEN '${H_ANTES}' ELSE h END`));
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A = "126a-conferir-a-busca-de-devolucao-ignora-o-acento-aplicado";
  const B = "126b-antes-a-busca-de-devolucao-ignora-o-acento-base-vigente";
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
      "rodar-isolado.cjs tests/banco/a-busca-de-devolucao-ignora-o-acento-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-busca-de-devolucao-ignora-o-acento-viva.cjs",
    ),
  );
  // As provas que desfazem a 20261395000000 sobre a arvore migrada (portao da 8e) desfazem esta ANTES, pelo helper.
  const posterior = ler(
    "tests/banco/a-busca-de-devolucao-ignora-o-acento-posterior.cjs",
  );
  assert.ok(posterior.includes(`"${H_DEPOIS}"`));
  assert.ok(posterior.includes(`"${H_ANTES}"`));
  assert.ok(posterior.includes(nome));
  assert.ok(posterior.includes("`rollback-manual-${"));
  assert.ok(
    ler("tests/banco/a-busca-de-devolucao-posterior.cjs").includes(
      "a-busca-de-devolucao-ignora-o-acento-posterior.cjs",
    ),
  );
});
