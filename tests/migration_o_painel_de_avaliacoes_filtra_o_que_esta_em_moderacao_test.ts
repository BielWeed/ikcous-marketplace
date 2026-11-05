import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261399700000_o_painel_de_avaliacoes_filtra_o_que_esta_em_moderacao.sql";
const nome381 =
  "20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const ABRE = "CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(";
const definicao = (sql: string) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.get_admin_reviews_paged\([\s\S]*?\n\$function\$;/,
  )?.[0] ?? "";
const corpo = (sql: string) =>
  definicao(sql).split("AS $function$")[1]?.slice(0, -"$function$;".length) ??
  "";
const cabeca = (sql: string) => definicao(sql).split("AS $function$")[0];
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const anterior = ler(`supabase/migrations/${nome381}`);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const H_ANTES = "8571a56a9b21e90ebdcf941d762870ac";
const H_NOVO = "af5d21345d167ca44dd327a93f949ea6";
const SIG_ANTIGA = "public.get_admin_reviews_paged(text,text,integer,integer)";
const SIG_NOVA =
  "public.get_admin_reviews_paged(text,text,integer,integer,text)";

// As QUATRO edicoes desta migration sobre o corpo vivo da 20261381000000.
const PREDICADO = "AND (NOT v_so_pendentes OR r.status = 'pendente')";
const CALCULO =
  "    -- Filtro de moderacao (20261399700000): so o texto 'pendente' liga o filtro. NULL, 'todas' e qualquer\n" +
  "    -- outro texto valem 'todas' (o mesmo de antes): nunca erro, e o texto nunca entra em SQL montado.\n" +
  "    v_so_pendentes := COALESCE(p_status = 'pendente', false);\n";

Deno.test("3997: o corpo anterior e' o vivo da 381 e esta migration muda QUATRO pontos; o rollback devolve o da 381 byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  assert.equal(md5(corpo(sql)), H_NOVO);
  // Desfaz as quatro edicoes no corpo novo: sobra a 381, byte a byte.
  const desfeito = corpo(sql)
    .replace(
      "    v_rating_val INTEGER;\n    v_so_pendentes BOOLEAN;\n",
      "    v_rating_val INTEGER;\n",
    )
    .replace(CALCULO, "")
    .replace(`\n      ${PREDICADO}\n`, "\n")
    .replace(`\n          ${PREDICADO}\n`, "\n");
  assert.equal(desfeito, corpo(anterior));
  assert.equal(
    corpo(sql).split(PREDICADO).length - 1,
    2,
    "contagem e consulta paginada",
  );
  assert.equal(corpo(rb), corpo(anterior));
  assert.equal(cabeca(rb), cabeca(anterior));
  assert.equal(md5(corpo(rb)), H_ANTES);
  // O cabecalho: os 4 parametros de antes, na mesma ordem, e o p_status no FIM com DEFAULT 'todas'.
  assert.equal(
    cabeca(sql),
    cabeca(anterior).replace(
      "p_page_size integer DEFAULT 10)",
      "p_page_size integer DEFAULT 10, p_status text DEFAULT 'todas'::text)",
    ),
  );
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  // Os globais NAO levam o filtro: a consulta dos contadores globais e' a mesma de antes.
  assert.ok(
    corpo(sql).includes(
      "        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)\n    INTO\n        v_global_total_count,",
    ),
  );
  assert.ok(corpo(sql).includes("    FROM public.reviews r;\n"));
  // O gate e a ordem sao os de antes.
  assert.ok(corpo(sql).includes("IF NOT public.is_admin_atual() THEN"));
  assert.ok(corpo(sql).includes("ORDER BY r.created_at DESC"));
  // Nada do p_status vira SQL montado: so e' comparado com o literal.
  assert.doesNotMatch(corpo(sql), /EXECUTE|format\(|quote_/i);
  assert.equal(
    corpo(sql).split("p_status").length - 1,
    1,
    "p_status so na comparacao com o literal",
  );
});

Deno.test("3997: sem BEGIN/COMMIT; pre-voo antes do DROP; DROP so da assinatura antiga; REVOKE/GRANT refeitos; pos-voo confere corpo, atributos e ACL", () => {
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
    const semComentario = texto.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(semComentario, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im);
    assert.doesNotMatch(
      semComentario.replace(definicao(texto), ""),
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CASCADE|CREATE\s+TABLE|ALTER\s+TABLE)\b/i,
    );
    assert.ok(
      semComentario.indexOf("B1_BASELINE_DIVERGENT") <
        semComentario.indexOf("DROP FUNCTION"),
      "o pre-voo vem antes do DROP",
    );
    assert.ok(
      semComentario.indexOf("DROP FUNCTION") <
        semComentario.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(texto.includes("SET LOCAL lock_timeout = '5s';"));
    // Uma assinatura so, no pre-voo e no pos-voo; atributos e ACL fotografados antes e comparados depois.
    assert.ok(texto.includes("q.proname = 'get_admin_reviews_paged') <> 1"));
    assert.ok(texto.includes("set_config('ikcous.avaliacoes3997_atributos'"));
    assert.ok(texto.includes("set_config('ikcous.avaliacoes3997_acl'"));
    assert.ok(
      texto.includes(
        "current_setting('ikcous.avaliacoes3997_atributos')::jsonb",
      ),
    );
    assert.ok(
      texto.includes("current_setting('ikcous.avaliacoes3997_acl')::jsonb"),
    );
    // Os atributos do desenho de sempre.
    assert.ok(
      texto.includes(
        "p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'",
      ),
    );
    assert.ok(
      texto.includes(
        "p.proconfig = ARRAY['search_path=public, extensions']::text[]",
      ),
    );
    assert.ok(
      texto.includes("NOT has_function_privilege('anon', p.oid, 'EXECUTE')"),
    );
    assert.ok(
      texto.includes(
        "p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))",
      ),
    );
    assert.ok(!definicao(texto).includes("\r"));
  }
  // A migration: DROP so da antiga (a de 4, com os tipos por inteiro), REVOKE de PUBLIC e anon, GRANT so de authenticated e service_role.
  assert.deepEqual(sql.match(/^DROP .*$/gm), [
    "DROP FUNCTION IF EXISTS public.get_admin_reviews_paged(text, text, integer, integer);",
  ]);
  assert.ok(
    sql.includes(`REVOKE ALL ON FUNCTION ${SIG_NOVA} FROM PUBLIC, anon;`),
  );
  assert.ok(
    sql.includes(
      `GRANT EXECUTE ON FUNCTION ${SIG_NOVA} TO authenticated, service_role;`,
    ),
  );
  assert.deepEqual(sql.match(/^(?:GRANT|REVOKE) .*$/gm)?.length, 2);
  // O rollback: o inverso.
  assert.deepEqual(rb.match(/^DROP .*$/gm), [
    "DROP FUNCTION IF EXISTS public.get_admin_reviews_paged(text, text, integer, integer, text);",
  ]);
  assert.ok(
    rb.includes(`REVOKE ALL ON FUNCTION ${SIG_ANTIGA} FROM PUBLIC, anon;`),
  );
  assert.ok(
    rb.includes(
      `GRANT EXECUTE ON FUNCTION ${SIG_ANTIGA} TO authenticated, service_role;`,
    ),
  );
  // A migration so aceita a antiga com o corpo da 381, ou a nova com o dela (reaplicar); o rollback so aceita a nova.
  assert.ok(sql.includes(`v_hash <> '${H_ANTES}'`));
  assert.ok(sql.includes(`v_hash <> '${H_NOVO}'`));
  assert.ok(rb.includes(`v_hash <> '${H_NOVO}'`));
  assert.ok(
    !rb.includes(`v_hash <> '${H_ANTES}'`),
    "o rollback nao aceita a antiga",
  );
  // Pos-voo: a migration confere o corpo NOVO; o rollback, o da 381.
  assert.ok(sql.includes(`md5(replace(p.prosrc, E'\\r', '')) = '${H_NOVO}'`));
  assert.ok(rb.includes(`md5(replace(p.prosrc, E'\\r', '')) = '${H_ANTES}'`));
  // Os argumentos conferidos sao exatamente os que o catalogo devolve.
  const aspa = (s: string) => s.replaceAll("'", "''");
  const ARGS_ANTIGA =
    "p_search text DEFAULT ''::text, p_rating text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10";
  assert.ok(sql.includes(`'${aspa(ARGS_ANTIGA)}'`));
  assert.ok(
    sql.includes(
      `'${aspa(`${ARGS_ANTIGA}, p_status text DEFAULT 'todas'::text`)}'`,
    ),
  );
});

Deno.test("3997: a vigente e' a ULTIMA redefinicao de get_admin_reviews_paged da arvore (sucede a 381 direto); db-apply exige as guardas", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => ler(`supabase/migrations/${n}`).includes(ABRE));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine get_admin_reviews_paged depois da 3997",
  );
  assert.equal(fontes.at(-2), nome381, "a 3997 sucede a 381 direto");
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[nome];
  assert.equal(checagem?.funcao, "get_admin_reviews_paged");
  assert.equal(
    avaliarChecagem(definicao(sql), checagem).situacao,
    "verificada",
  );
  // O CORPO ANTERIOR (sem o filtro) reprova: a verificacao de pos-apply enxerga a troca.
  assert.equal(
    avaliarChecagem(definicao(anterior), checagem).situacao,
    "falhou",
  );
  for (const marcador of checagem.esperado) {
    const texto = typeof marcador === "string" ? marcador : marcador.texto;
    assert.equal(
      avaliarChecagem(definicao(sql).replace(texto, ""), checagem).situacao,
      "falhou",
      `sem "${texto}" a verificacao tem de falhar`,
    );
  }
  // O front so conhece esta assinatura: os tipos do banco a listam com p_status opcional.
  assert.match(
    ler("src/types/database.types.ts"),
    /get_admin_reviews_paged: \{\s*Args: \{\s*p_page\?: number;\s*p_page_size\?: number;\s*p_rating\?: string;\s*p_search\?: string;\s*p_status\?: string;/,
  );
  // A lista de portas do visitante cita a assinatura NOVA, e nao a antiga.
  const portas = ler("tests/banco/portas-do-visitante-permitidas.json");
  assert.ok(
    portas.includes(
      "public.get_admin_reviews_paged(p_search text, p_rating text, p_page integer, p_page_size integer, p_status text)",
    ),
  );
  assert.ok(
    !portas.includes(
      'public.get_admin_reviews_paged(p_search text, p_rating text, p_page integer, p_page_size integer)"',
    ),
  );
});

Deno.test("3997: a 86a aceita a funcao nova como sucessora da 381; as consultas 123a/123b sao so de catalogo, quatro linhas fechadas, e estao registradas", async () => {
  const c86a = ler(
    "scripts/publicacao/consultas/86a-conferir-ex-admin-no-resto-do-painel-aplicado.sql",
  );
  assert.ok(
    c86a.includes(`'8571a56a9b21e90ebdcf941d762870ac'`),
    "a 86a segue aceitando o corpo da 381",
  );
  assert.ok(c86a.includes(`md5(replace(p.prosrc,chr(13),''))='${H_NOVO}'`));
  assert.ok(
    c86a.includes(
      "to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)')",
    ),
  );
  // O hash novo so vale para a linha da get_admin_reviews_paged na assinatura de 5.
  assert.equal(c86a.split(H_NOVO).length - 1, 1);
  const c86b = ler(
    "scripts/publicacao/consultas/86b-antes-ex-admin-no-resto-do-painel-base-vigente.sql",
  );
  assert.ok(
    !c86b.includes(H_NOVO),
    "a 86b (o ANTES da 381) nunca aceita a sucessora",
  );
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas = [
    [
      "123a-conferir-o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-aplicado",
      H_NOVO,
      SIG_NOVA,
    ],
    [
      "123b-antes-o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-base-vigente",
      H_ANTES,
      SIG_ANTIGA,
    ],
  ];
  for (const [nomeConsulta, hash, assinatura] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(hash));
    assert.ok(consulta.includes(`to_regprocedure('${assinatura}')`));
    // So catalogo: nenhuma leitura de avaliacao, nenhuma chamada da propria RPC.
    assert.doesNotMatch(
      consulta.replace(/--[^\n]*/g, ""),
      /FROM public\.(?:reviews|produtos|profiles)|public\.get_admin_reviews_paged\(\s*[^t)]/,
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
    p.versoes.includes("20261399700000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.deepEqual(entrada.versoes, ["20261399700000"]);
  const rpcCi = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    rpcCi.includes(
      "rodar-isolado.cjs tests/banco/o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-viva.cjs",
    ),
  );
});

Deno.test("3997: toda prova que desfaz a 381 desfaz esta ANTES (o modulo posterior tem o hash e o rollback da migration)", () => {
  const posterior = ler(
    "tests/banco/o-painel-de-avaliacoes-filtra-posterior.cjs",
  );
  assert.ok(posterior.includes(nome));
  assert.ok(posterior.includes(H_NOVO));
  assert.ok(posterior.includes(SIG_NOVA));
  const {
    FILTRO_DE_MODERACAO,
  } = require("./banco/o-painel-de-avaliacoes-filtra-posterior.cjs");
  assert.equal(FILTRO_DE_MODERACAO.nome, nome);
  // O modulo da 381 (que 8 provas usam) chama este ANTES de desfazer a 381.
  const da381 = ler("tests/banco/ex-admin-resto-do-painel-posterior.cjs");
  const iFiltro = da381.indexOf("desfazerFiltroDeModeracaoNaTransacao");
  const iRollback = da381.indexOf(
    "rollback-manual-${EX_ADMIN_RESTO_DO_PAINEL.nome}",
  );
  assert.ok(iFiltro > 0 && iFiltro < iRollback);
  // As tres provas que desfazem a 381 sem passar pelo modulo dela chamam o mesmo desfazer.
  for (const arq of [
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/pagamentos-rpc-viva.cjs",
    "tests/banco/admin-atual-endurecimento-viva.cjs",
  ])
    assert.ok(
      ler(arq).includes("desfazerFiltroDeModeracaoNaTransacao"),
      `${arq}: nao desfaz a 3997 antes da 381`,
    );
});
