// @ts-nocheck
// A LISTA DE PERFIS PUBLICOS SO PARA QUEM ESTA LOGADO, E SO COM QUEM ESCREVEU — prova offline do
// par 20261219000000 + rollback (auditoria de 12/10/2026, lote L2), e a GUARDA DO LOTE INTEIRO
// contra reabertura por migration futura. O COMPORTAMENTO (visitante sem login: zero linhas sem
// erro; logado ve a si, o autor de avaliacao publicada e o de pergunta; admin atual ve todos; a
// vitrine do visitante continua com nome e foto do autor) e' provado em
// tests/banco/portas-do-banco-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: politica sem `TO authenticated` vale para PUBLIC, e o `rls_admin_atual()` (que o anon nao
// executa) troca o vazio do visitante por erro 42501; `id` sem qualificar dentro do EXISTS liga ao
// id da AVALIACAO, nao do perfil; `is_admin()` no lugar de `rls_admin_atual()` deixa o admin
// rebaixado com cracha velho listando todo mundo; o literal do pre-voo diferente do da conferencia
// recusa o proprio estado que a migration deixa; rollback que nao e' o vigente deixa a loja num
// terceiro estado; migration futura que reabre o que o lote fechou passa calada.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = new URL("../", import.meta.url);
const NOME = "20261219000000_perfil_publico_so_de_quem_escreveu.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const migracoes = () =>
  [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .sort();

/** O CREATE POLICY da migration, do DROP ate o `);`. */
const politica = (() => {
  const i = migration.indexOf(
    "CREATE POLICY public_profiles_select_policy ON public.public_profiles",
  );
  assert.ok(i >= 0);
  return migration.slice(i, migration.indexOf("\n  );\n", i) + "\n  );".length);
})();

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("o ponto de partida e o baseline: nenhuma migration antes desta redefine a politica", () => {
  const re =
    /(CREATE|ALTER|DROP) POLICY (IF EXISTS )?"?public_profiles_select_policy"?\s+ON (public\.)?"?public_profiles"?/;
  const com = migracoes()
    .filter((n) => n < NOME)
    .filter((n) => re.test(semComentarios(ler(n))));
  assert.deepEqual(com, ["20260806000000_baseline_do_schema_vivo.sql"]);
  assert.ok(
    ler(com[0]).includes(
      "CREATE POLICY public_profiles_select_policy ON public.public_profiles FOR SELECT USING (true);",
    ),
  );
});

Deno.test("a politica nova: SELECT so para authenticated, quatro ramos, nenhum ramo para o visitante", () => {
  const p = politica.replace(/\s+/g, " ");
  assert.ok(
    p.startsWith(
      "CREATE POLICY public_profiles_select_policy ON public.public_profiles FOR SELECT TO authenticated USING (",
    ),
    p,
  );
  assert.ok(p.includes("public_profiles.id = (SELECT auth.uid())"));
  assert.ok(p.includes("OR (SELECT public.rls_admin_atual())"));
  assert.ok(
    p.includes(
      "OR EXISTS (SELECT 1 FROM public.reviews r WHERE r.user_id = public_profiles.id AND r.status = 'publicada')",
    ),
  );
  assert.ok(
    p.includes(
      "OR EXISTS (SELECT 1 FROM public.questions q WHERE q.user_id = public_profiles.id)",
    ),
  );
  assert.doesNotMatch(p, /\bis_admin\(\)/, "admin pela regra atual");
  assert.doesNotMatch(p, /\banswers\b/, "autor de resposta nao entra");
  assert.doesNotMatch(p, /\banon\b|\bPUBLIC\b|USING \(true\)/);
  // todo `id` na expressao e' qualificado (r.user_id, q.user_id, public_profiles.id)
  const ids = [...p.matchAll(/([\w.]*)\bid\b/g)].map((m) => m[0]);
  assert.deepEqual(
    ids.filter((x) => !/^(public_profiles\.id|r\.user_id|q\.user_id)$/.test(x)),
    [],
    `id sem qualificar: ${ids.join(", ")}`,
  );
  assert.ok(
    migration.indexOf(
      "DROP POLICY IF EXISTS public_profiles_select_policy ON public.public_profiles;",
    ) < migration.indexOf(politica),
  );
});

Deno.test("so a politica muda: nenhum GRANT/REVOKE, nada de tabela, funcao ou outra politica", () => {
  const sql = limpo(migration);
  assert.doesNotMatch(sql, /\b(GRANT|REVOKE)\b/i);
  assert.doesNotMatch(sql, /\b(CREATE|ALTER|DROP)\s+(TABLE|FUNCTION|VIEW|TRIGGER)\b/i);
  assert.equal((sql.match(/\bCREATE POLICY\b/g) || []).length, 1);
  assert.equal((sql.match(/\bDROP POLICY\b/g) || []).length, 1);
});

Deno.test("pre-voo, conferencia e pre-voo do rollback citam o MESMO literal deparseado, e o md5 REAL de rls_admin_atual()", () => {
  const literais = (sql) =>
    [...sql.matchAll(/v_qual (?:=|IS DISTINCT FROM) E'(\(\(id = [^\n]*?\)\)\)\))'/g)].map(
      (m) => m[1],
    );
  const todos = [...literais(migration), ...literais(rollback)];
  assert.equal(todos.length, 3, "pre-voo + conferencia + pre-voo do rollback");
  assert.equal(new Set(todos).size, 1, "os tres literais sao o mesmo");
  const l = todos[0];
  // o literal casa com a politica: mesmos ramos, nomes qualificados (search_path = pg_catalog)
  for (const trecho of [
    "( SELECT auth.uid() AS uid)",
    "( SELECT public.rls_admin_atual() AS rls_admin_atual)",
    "FROM public.reviews r",
    "(r.user_id = public_profiles.id) AND (r.status = ''publicada''::text)",
    "FROM public.questions q",
    "(q.user_id = public_profiles.id)",
  ])
    assert.ok(l.includes(trecho), trecho);
  for (const sql of [migration, rollback]) {
    assert.ok(sql.includes("set_config('search_path', 'pg_catalog', true)"));
    assert.ok(sql.includes("set_config('search_path', v_caminho, true)"));
  }
  const da97 = ler("20261197000000_dinheiro_exige_admin_atual.sql");
  const i = da97.indexOf("\nCREATE OR REPLACE FUNCTION public.rls_admin_atual()");
  assert.ok(i >= 0);
  const f = da97.slice(i + 1, da97.indexOf("\n$$;", i + 1) + "\n$$;".length);
  const h = md5(f.slice(f.indexOf("AS $$") + "AS $$".length, f.length - "$$;".length));
  assert.equal(h, "ccb7a56e835b8181795fffb7bee97305");
  assert.ok(migration.includes(`IS DISTINCT FROM '${h}'`));
  assert.ok(
    migration.includes(
      "has_function_privilege('authenticated', 'public.rls_admin_atual()', 'EXECUTE')",
    ),
  );
});

Deno.test("a conferencia final recusa politica para PUBLIC/anon, mais de uma politica ou RLS desligada", () => {
  const c = migration.slice(migration.indexOf("DO $conferencia_20261219$"));
  assert.ok(
    migration.indexOf("DO $conferencia_20261219$") > migration.indexOf(politica),
  );
  for (const trecho of [
    "relrowsecurity",
    "v_total <> 1",
    "0::oid = ANY (p.polroles) OR to_regrole('anon') = ANY (p.polroles)",
    "v_roles IS DISTINCT FROM 'authenticated'",
    "p.polcmd = 'r' AND p.polpermissive AND p.polwithcheck IS NULL",
  ])
    assert.ok(c.includes(trecho), trecho);
  for (const sql of [migration, rollback])
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
});

Deno.test("o rollback devolve a politica vigente, byte a byte com o baseline", () => {
  const sql = limpo(rollback);
  assert.ok(
    sql.includes(
      "DROP POLICY IF EXISTS public_profiles_select_policy ON public.public_profiles; CREATE POLICY public_profiles_select_policy ON public.public_profiles FOR SELECT USING (true);",
    ),
  );
  assert.doesNotMatch(sql, /\b(GRANT|REVOKE)\b/i);
  assert.ok(rollback.includes("DO $preflight_rollback_20261219$"));
  assert.ok(rollback.includes("DO $conferencia_rollback_20261219$"));
});

// ---------------------------------------------------------------------------------------------
// GUARDA CONTRA REABERTURA (o lote L2 inteiro: 20261218000000, 20261218000100, 20261219000000).
// Nenhuma migration POSTERIOR a esta pode devolver ao visitante (ou a PUBLIC) o que o lote fechou.
// Le o texto limpo (sem comentario, string nem corpo entre $$): um GRANT montado dentro de um DO
// com EXECUTE dinamico escapa daqui, e por isso a 22a confere o mesmo POR OBJETO no banco.
// ---------------------------------------------------------------------------------------------

const FECHADAS_A = {
  // objeto -> papeis que NAO podem receber GRANT dele
  app_settings: ["anon", "authenticated", "public"],
  otp_verifications: ["anon", "authenticated", "public"],
  vw_produtos_admin: ["anon", "public"],
  get_segmented_push_count: ["anon", "public"],
};

/** Achados de reabertura num texto de migration. Exportado so para o teste dos casos. */
function reaberturas(sql) {
  const achados = [];
  const comandos = removerRuido(sql)
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const cmd of comandos) {
    const g = /^GRANT\b(.*?)\bON\b(.*?)\bTO\b(.*)$/i.exec(cmd);
    if (g) {
      const objetos = g[2].toLowerCase();
      const papeis = g[3]
        .replace(/\bWITH GRANT OPTION\b|\bGRANTED BY\b.*$/gi, "")
        .split(",")
        .map((p) => p.trim().replace(/"/g, "").toLowerCase());
      const emMassa = /\ball (tables|functions|routines) in schema\b/.test(objetos);
      for (const [obj, proibidos] of Object.entries(FECHADAS_A)) {
        if (!emMassa && !new RegExp(`\\b${obj}\\b`).test(objetos)) continue;
        const ruim = papeis.filter((p) => proibidos.includes(p));
        if (ruim.length) achados.push(`GRANT de ${obj} a ${ruim.join(",")}: ${cmd}`);
      }
      continue;
    }
    const pol = /^(CREATE|ALTER) POLICY\b.*?\bON (?:public\.)?"?(public_profiles|profiles)"?\b(.*)$/i.exec(cmd);
    if (pol) {
      const resto = pol[3];
      const to = /\bTO (.*?)(?:\bUSING\b|\bWITH CHECK\b|$)/i.exec(resto);
      const papeis = to ? to[1].toLowerCase().split(",").map((p) => p.trim()) : [];
      if (pol[1].toUpperCase() === "CREATE" && !to)
        achados.push(`politica em ${pol[2]} sem TO (vale para PUBLIC): ${cmd}`);
      if (papeis.some((p) => p === "public" || p === "anon"))
        achados.push(`politica em ${pol[2]} para PUBLIC/anon: ${cmd}`);
      if (pol[2].toLowerCase() === "public_profiles" && /\bUSING \(\s*true\s*\)/i.test(resto))
        achados.push(`politica em public_profiles com USING (true): ${cmd}`);
      continue;
    }
    if (/^DROP FUNCTION\b.*\bget_segmented_push_count\b/i.test(cmd))
      achados.push(`DROP da contagem do push (renasce com EXECUTE de PUBLIC): ${cmd}`);
    if (/^(DROP VIEW\b.*|CREATE VIEW\b.*)\bvw_produtos_admin\b/i.test(cmd))
      achados.push(`view do painel recriada do zero (renasce com o grant padrao do anon): ${cmd}`);
    if (/^DROP TRIGGER\b.*\btr_perfil_recusa_imagem_grande\b/i.test(cmd))
      achados.push(`teto da imagem do perfil removido: ${cmd}`);
    if (/^ALTER TABLE\b.*\b(public_profiles|app_settings|otp_verifications)\b.*\bDISABLE ROW LEVEL SECURITY\b/i.test(cmd))
      achados.push(`RLS desligada: ${cmd}`);
  }
  return achados;
}

Deno.test("guarda de reabertura: os casos que tem de acusar e os que nao", () => {
  const acusa = [
    "GRANT SELECT ON public.app_settings TO anon;",
    "GRANT ALL ON TABLE public.otp_verifications TO authenticated;",
    'GRANT SELECT, INSERT ON TABLE "public"."otp_verifications" TO "anon";',
    "GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;",
    "GRANT SELECT ON public.vw_produtos_admin TO anon;",
    "GRANT EXECUTE ON FUNCTION public.get_segmented_push_count(text, numeric, integer) TO PUBLIC;",
    "GRANT EXECUTE ON FUNCTION public.get_segmented_push_count(text, numeric, integer) TO authenticated, anon;",
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;",
    "CREATE POLICY x ON public.public_profiles FOR SELECT USING (true);",
    "CREATE POLICY x ON public.public_profiles FOR SELECT TO authenticated USING (true);",
    "CREATE POLICY x ON public.public_profiles FOR SELECT TO anon, authenticated USING (id = auth.uid());",
    "ALTER POLICY public_profiles_select_policy ON public.public_profiles TO public;",
    "CREATE POLICY y ON public.profiles FOR SELECT USING (id = auth.uid());",
    "DROP FUNCTION IF EXISTS public.get_segmented_push_count(text, numeric, integer);",
    "DROP VIEW IF EXISTS public.vw_produtos_admin;",
    "CREATE VIEW public.vw_produtos_admin AS SELECT 1;",
    "DROP TRIGGER IF EXISTS tr_perfil_recusa_imagem_grande ON public.profiles;",
    "ALTER TABLE public.public_profiles DISABLE ROW LEVEL SECURITY;",
  ];
  for (const sql of acusa) assert.ok(reaberturas(sql).length >= 1, sql);
  const passa = [
    "GRANT SELECT ON public.app_settings TO service_role;",
    "GRANT EXECUTE ON FUNCTION public.get_segmented_push_count(text, numeric, integer) TO authenticated;",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON public.vw_produtos_admin TO authenticated;",
    "GRANT SELECT ON public.vw_produtos_public TO anon;",
    "CREATE POLICY x ON public.public_profiles FOR SELECT TO authenticated USING (public_profiles.id = (SELECT auth.uid()));",
    "CREATE OR REPLACE VIEW public.vw_produtos_admin AS SELECT 1;",
    "CREATE OR REPLACE FUNCTION public.get_segmented_push_count(p text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1 $$;",
    "-- GRANT SELECT ON public.app_settings TO anon;",
    "COMMENT ON TABLE public.app_settings IS 'GRANT SELECT ON public.app_settings TO anon';",
  ];
  for (const sql of passa) assert.deepEqual(reaberturas(sql), [], sql);
});

Deno.test("guarda de reabertura: o proprio lote nao reabre, e NENHUMA migration posterior a esta reabre", () => {
  for (const n of [
    "20261218000000_a_foto_do_perfil_tem_teto_e_o_painel_fecha_ao_visitante.sql",
    "20261218000100_configuracoes_e_codigos_so_do_servidor.sql",
    NOME,
  ])
    assert.deepEqual(reaberturas(ler(n)), [], n);
  // o rollback do lote reabre de proposito: a guarda o enxerga (controle de que ela le de verdade)
  assert.ok(
    reaberturas(ler(`rollback-manual-${NOME}`)).length >= 1,
    "controle: o rollback reabre e a guarda acusa",
  );
  const posteriores = migracoes().filter((n) => n > NOME);
  for (const n of posteriores)
    assert.deepEqual(reaberturas(ler(n)), [], `${n} reabre o que este lote fechou`);
});

Deno.test("composicao: a migration entra em POSTERIORES_A_97 (admin-atual-viva e pagamentos-rpc-viva), depois das entradas indexadas", () => {
  // A politica nova usa rls_admin_atual(): o rollback da 20261197 recusa enquanto ela
  // estiver no ar. As provas que desfazem a 97 precisam desfaze-la antes.
  for (const arq of [
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/pagamentos-rpc-viva.cjs",
  ]) {
    const t = Deno.readTextFileSync(new URL(arq, DIR)).replace(/\r\n/g, "\n");
    const ini = t.indexOf("const POSTERIORES_A_97 = [");
    const fim = t.indexOf("\n];", ini);
    assert.ok(ini > 0 && fim > ini, `${arq}: sem a lista`);
    const lista = t.slice(ini, fim);
    const nomes = [...lista.matchAll(/nome: "([^"]+)"/g)].map((x) => x[1]);
    const pos = nomes.indexOf(NOME);
    const pos98 = nomes.indexOf("20261198000000_cancelar_pedido_anula_a_cobranca.sql");
    assert.ok(pos98 >= 0 && pos > pos98, `${arq}: a 20261219 fora do fim da lista`);
    for (const depois of nomes.slice(pos + 1))
      assert.ok(depois > NOME, `${arq}: ${depois} vem depois da 20261219 sem ser mais nova`);
    const entrada = lista.slice(lista.indexOf(`nome: "${NOME}"`));
    assert.ok(
      /polname = 'public_profiles_select_policy'[\s\S]*rls_admin_atual/.test(
        entrada.slice(0, entrada.indexOf("},")),
      ),
      `${arq}: o "no ar" da 20261219 nao olha a politica de public_profiles`,
    );
  }
});
