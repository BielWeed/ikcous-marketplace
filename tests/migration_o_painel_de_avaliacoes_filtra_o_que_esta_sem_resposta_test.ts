// O PAINEL DE AVALIACOES FILTRA O QUE ESTA SEM RESPOSTA: prova offline do par 20261399996000 + rollback (lote 148). O COMPORTAMENTO (nula, vazia, so espaco e
// preenchida, paginacao e total, junto com nota e busca, contagem == regra do sino, JSON igual ao de antes para os outros valores, mutantes, rollback, conexao sem BEGIN
// e consultas 148a/148b) e' provado em tests/banco/o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-viva.cjs, que so roda no Postgres efemero do CI.
// Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261399996000_o_painel_de_avaliacoes_filtra_o_que_esta_sem_resposta.sql";
const nome3997 =
  "20261399700000_o_painel_de_avaliacoes_filtra_o_que_esta_em_moderacao.sql";
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

const anterior = ler(`supabase/migrations/${nome3997}`);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const H_ANTES = "af5d21345d167ca44dd327a93f949ea6";
const H_NOVO = "75f5c48de4eb4005a2516e54b3d33135";
const SIG = "public.get_admin_reviews_paged(text,text,integer,integer,text)";
const ARGS =
  "p_search text DEFAULT ''::text, p_rating text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT 'todas'::text";

// As TRES edicoes desta migration sobre o corpo vivo da 20261399700000.
const PREDICADO = "AND (NOT v_so_sem_resposta OR r.merchant_reply IS NULL)";
const CALCULO =
  "    -- Filtro de resposta (20261399996000): so o texto 'sem_resposta' liga este filtro, pela MESMA regra do sino do painel\n" +
  "    -- (src/lib/avaliacoes-para-atender.ts): sem resposta = merchant_reply IS NULL. Resposta em branco NAO conta como sem resposta.\n" +
  "    v_so_sem_resposta := COALESCE(p_status = 'sem_resposta', false);\n";

Deno.test("3996: o corpo anterior e' o vivo da 3997 e esta migration muda TRES pontos; o rollback devolve o da 3997 byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  assert.equal(md5(corpo(sql)), H_NOVO);
  // Desfaz as tres edicoes no corpo novo: sobra a 3997, byte a byte.
  const desfeito = corpo(sql)
    .replace("    v_so_sem_resposta BOOLEAN;\n", "")
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
  assert.equal(md5(corpo(rb)), H_ANTES);
  // MESMA assinatura e mesmos atributos: nada muda no cabecalho.
  assert.equal(cabeca(sql), cabeca(anterior));
  assert.equal(cabeca(rb), cabeca(anterior));
  assert.ok(cabeca(sql).includes(`(${ARGS})`));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  // O filtro de moderacao, os globais, o gate e a ordem ficam como estao.
  assert.equal(
    corpo(sql).split("AND (NOT v_so_pendentes OR r.status = 'pendente')")
      .length - 1,
    2,
  );
  assert.ok(
    corpo(sql).includes(
      "        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)\n    INTO\n        v_global_total_count,",
    ),
  );
  assert.ok(corpo(sql).includes("    FROM public.reviews r;\n"));
  assert.ok(corpo(sql).includes("IF NOT public.is_admin_atual() THEN"));
  assert.ok(corpo(sql).includes("ORDER BY r.created_at DESC"));
  // Nada do p_status vira SQL montado: so e' comparado com literais (um de moderacao, um de resposta).
  assert.doesNotMatch(corpo(sql), /EXECUTE|format\(|quote_/i);
  assert.equal(
    corpo(sql).split("p_status").length - 1,
    2,
    "p_status so nas duas comparacoes com literal",
  );
});

Deno.test("3996: a regra de 'sem resposta' do SQL e' a do sino do front (a mesma constante), nao uma copia", () => {
  const sino = ler("src/lib/avaliacoes-para-atender.ts");
  const regra =
    /FILTRO_POSTGREST_AVALIACAO_SEM_RESPOSTA = "([a-z_]+)\.is\.null"/.exec(
      sino,
    );
  assert.ok(regra, "o front tem de declarar a regra como <coluna>.is.null");
  // <coluna>.is.null (PostgREST) == r.<coluna> IS NULL (SQL).
  assert.ok(
    corpo(sql).includes(`AND (NOT v_so_sem_resposta OR r.${regra[1]} IS NULL)`),
  );
  // O sino (PARA_ATENDER) e' construido em cima da MESMA constante: nao ha duas redacoes da regra.
  assert.ok(
    sino.includes(
      "FILTRO_POSTGREST_AVALIACAO_PARA_ATENDER = `${FILTRO_POSTGREST_AVALIACAO_SEM_RESPOSTA},status.eq.pendente`",
    ),
  );
  // O chip da tela conta com a constante e nao escreve a regra de novo.
  const tela = ler("src/views/admin/AdminReviewsView.tsx");
  assert.ok(tela.includes(".or(FILTRO_POSTGREST_AVALIACAO_SEM_RESPOSTA)"));
  assert.doesNotMatch(tela, /merchant_reply\.is\.null|\.is\("merchant_reply"/);
  // A leitura do sino continua usando a regra completa.
  assert.ok(
    ler("src/hooks/useAvisosDoLojista.ts").includes(
      ".or(FILTRO_POSTGREST_AVALIACAO_PARA_ATENDER)",
    ),
  );
});

Deno.test("3996: sem BEGIN/COMMIT; pre-voo antes do CREATE; sem DROP, sem grant, sem objeto novo; fotografia de OID, dono, ACL e atributos; pos-voo confere corpo e fotografia", () => {
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
    assert.doesNotMatch(semComentario, /^\s*DROP\b/im);
    assert.doesNotMatch(
      semComentario,
      /^\s*(?:GRANT|REVOKE|CREATE\s+(?:TABLE|INDEX|POLICY|TRIGGER|SCHEMA))\b/im,
    );
    assert.doesNotMatch(
      semComentario.replace(definicao(texto), ""),
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CASCADE|ALTER\s+TABLE)\b/i,
    );
    assert.ok(
      semComentario.indexOf("B1_BASELINE_DIVERGENT") <
        semComentario.indexOf("CREATE OR REPLACE FUNCTION"),
      "o pre-voo vem antes do CREATE",
    );
    assert.ok(texto.includes("SET LOCAL lock_timeout = '5s';"));
    assert.ok(texto.includes("SET LOCAL statement_timeout = '30s';"));
    // Uma assinatura so, no pre-voo e no pos-voo; a fotografia inteira (OID, dono, ACL, atributos) antes e depois.
    assert.ok(texto.includes("q.proname = 'get_admin_reviews_paged') <> 1"));
    assert.ok(texto.includes("set_config('ikcous.avaliacoes3996_estado'"));
    assert.ok(
      texto.includes("current_setting('ikcous.avaliacoes3996_estado')::jsonb"),
    );
    assert.ok(texto.includes("to_jsonb(p) - 'prosrc'"));
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
    // O catalogo de argumentos que o pre-voo e o pos-voo conferem e' exatamente o que o banco devolve.
    const aspa = (s: string) => s.replaceAll("'", "''");
    assert.ok(texto.includes(`'${aspa(ARGS)}'`));
  }
  // A migration aceita o corpo da 3997 e o proprio (reaplicar); o rollback so aceita o proprio.
  assert.ok(sql.includes(`v_hash NOT IN ('${H_ANTES}', '${H_NOVO}')`));
  assert.ok(rb.includes(`v_hash <> '${H_NOVO}'`));
  assert.ok(!rb.includes(H_ANTES.concat("', '")));
  // Pos-voo: a migration confere o corpo NOVO; o rollback, o da 3997.
  assert.ok(sql.includes(`md5(replace(p.prosrc, E'\\r', '')) = '${H_NOVO}'`));
  assert.ok(rb.includes(`md5(replace(p.prosrc, E'\\r', '')) = '${H_ANTES}'`));
  // A loja que ainda nao recebeu a 3997 (so a de 4 argumentos) e' recusada pela migration: a de 5 precisa existir.
  assert.ok(
    sql.includes(
      "v_oid oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');",
    ),
  );
  assert.ok(sql.includes("IF v_oid IS NULL"));
});

Deno.test("3996: a vigente e' a ULTIMA redefinicao de get_admin_reviews_paged da arvore (sucede a 3997 direto); db-apply exige as guardas", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => ler(`supabase/migrations/${n}`).includes(ABRE));
  const i = fontes.indexOf(nome);
  assert.ok(i > 0, "a migration nao esta entre as redefinicoes");
  assert.equal(fontes[i - 1], nome3997, "a 3996 sucede a 3997 direto");
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine get_admin_reviews_paged depois da 3996: reveja esta prova e as consultas 148a/123a/86a",
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[nome];
  assert.equal(checagem?.funcao, "get_admin_reviews_paged");
  assert.equal(
    avaliarChecagem(definicao(sql), checagem).situacao,
    "verificada",
  );
  // O CORPO ANTERIOR (sem o filtro de resposta) reprova: a verificacao de pos-apply enxerga a troca.
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
  // O front so conhece esta assinatura (p_status opcional, sem parametro novo): os tipos do banco nao mudam.
  assert.match(
    ler("src/types/database.types.ts"),
    /get_admin_reviews_paged: \{\s*Args: \{\s*p_page\?: number;\s*p_page_size\?: number;\s*p_rating\?: string;\s*p_search\?: string;\s*p_status\?: string;/,
  );
});

Deno.test("3996: consultas 148a/148b so de catalogo, quatro linhas fechadas, hashes certos e registros de publicacao; a 123a e a 86a aceitam o corpo novo", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, string]> = [
    [
      "148a-conferir-o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-aplicado",
      H_NOVO,
    ],
    [
      "148b-antes-o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-base-vigente",
      H_ANTES,
    ],
  ];
  for (const [nomeConsulta, hash] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(hash));
    assert.ok(consulta.includes(`to_regprocedure('${SIG}')`));
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
    p.versoes.includes("20261399996000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.deepEqual(entrada.versoes, ["20261399996000"]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-viva.cjs",
    ),
  );
  // A 123a (da 3997) aceita os dois corpos EXATOS e normaliza ao esperado historico; a 86a aceita os dois na linha da funcao.
  const a123 = ler(
    "scripts/publicacao/consultas/123a-conferir-o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-aplicado.sql",
  );
  assert.ok(a123.includes(`h IN ('${H_ANTES}', '${H_NOVO}')`));
  const a86 = ler(
    "scripts/publicacao/consultas/86a-conferir-ex-admin-no-resto-do-painel-aplicado.sql",
  );
  assert.ok(
    a86.includes(
      `md5(replace(p.prosrc,chr(13),'')) IN ('${H_ANTES}','${H_NOVO}')`,
    ),
  );
  // A 148a e a 148b nao se aceitam entre si.
  assert.ok(
    !ler(`scripts/publicacao/consultas/${consultas[0][0]}.sql`).includes(
      H_ANTES,
    ),
  );
  assert.ok(
    !ler(`scripts/publicacao/consultas/${consultas[1][0]}.sql`).includes(
      H_NOVO,
    ),
  );
});

Deno.test("3996: toda prova que desfaz a 3997 (e a 381) desfaz esta ANTES: o modulo posterior tem o hash e o rollback, e a cadeia o chama", () => {
  const posterior = ler(
    "tests/banco/o-painel-de-avaliacoes-filtra-sem-resposta-posterior.cjs",
  );
  assert.ok(posterior.includes(nome));
  assert.ok(posterior.includes(H_NOVO));
  assert.ok(
    posterior.includes(
      "get_admin_reviews_paged(text,text,integer,integer,text)",
    ),
  );
  assert.ok(posterior.includes("rollback-manual-${FILTRO_SEM_RESPOSTA.nome}"));
  const {
    FILTRO_SEM_RESPOSTA,
  } = require("./banco/o-painel-de-avaliacoes-filtra-sem-resposta-posterior.cjs");
  assert.equal(FILTRO_SEM_RESPOSTA.nome, nome);
  assert.ok(FILTRO_SEM_RESPOSTA.noAr.includes(H_NOVO));
  // O modulo da 3997 (que ex-admin-resto-do-painel-posterior e outras 4 provas usam) chama este ANTES de desfazer a 3997.
  const da3997 = ler("tests/banco/o-painel-de-avaliacoes-filtra-posterior.cjs");
  const iChama = da3997.indexOf("desfazerFiltroSemRespostaNaTransacao");
  const iNoAr = da3997.indexOf("FILTRO_DE_MODERACAO.noAr");
  assert.ok(iChama > 0 && iChama < iNoAr);
  // A prova viva da 3997 tambem a desfaz antes de medir a 3997 isolada, e a reaplica no fim.
  const viva3997 = ler(
    "tests/banco/o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-viva.cjs",
  );
  assert.ok(viva3997.includes("await desfazerSemResposta(c);"));
  assert.ok(
    viva3997.includes("supabase/migrations/${FILTRO_SEM_RESPOSTA.nome}"),
  );
});
