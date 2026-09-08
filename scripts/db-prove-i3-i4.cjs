#!/usr/bin/env node
/**
 * PROVA de I-3 + I-4 (frente i3-i4-anon-nao-le-autor-0809, 08/09/2026 —
 * brief equipe/entregas/20260908-brief-i3-i4-anon-nao-le-autor-nem-grava-analytics.md).
 *
 * NADA É GRAVADO: as três migrations (20261110000000, 20261111000000,
 * 20261112000000) são LIDAS DO DISCO e executadas DENTRO de uma transação
 * desfeita com ROLLBACK no final — nada redigitado, nada aplicado.
 *
 * DATABASE_URL vem do ambiente (injetada por com-env-main.cjs/com-env-savy.cjs
 * — este script NUNCA lê `.env`).
 *
 * O QUE ELE PROVA, NA ORDEM:
 *   0. CONTROLE NEGATIVO (antes de qualquer migration, no estado vivo de
 *      hoje): `anon` LÊ `user_id` de uma avaliação publicada e de uma
 *      pergunta — prova que o instrumento discrimina (se isto já desse
 *      zero linhas, a suíte inteira seria vácuo).
 *   1. Aplica as três migrations, na ordem, lidas do disco.
 *   2. `anon` para de alcançar `user_id`: `SELECT * FROM reviews` e
 *      `SELECT * FROM questions` devolvem ZERO linhas (RLS nega por
 *      padrão — GRANT continua existindo, só não há policy para o papel).
 *   3. `anon` continua lendo pelas views, SEM a coluna `user_id`
 *      (`vw_reviews_public`, `vw_questions_public`) — checado por
 *      CATÁLOGO (information_schema.columns), não só pela ausência na
 *      linha (uma linha vazia não provaria nada).
 *   4. Efeito colateral documentado no cabeçalho da 20261111000000:
 *      `vw_questions_with_answers_count` (security_invoker) também fecha
 *      para `anon`.
 *   5. `anon` não grava mais em `analytics_events` (42501 — a dupla
 *      fechadura: REVOKE de GRANT barra antes mesmo da RLS ser avaliada).
 *   6. `authenticated` (sub de um usuário real com avaliação/pergunta
 *      própria, se existir uma no banco) continua lendo a própria linha —
 *      NOT APPLICABLE e não falha se o banco não tiver fixture (mesmo
 *      padrão de `db-prove-blindagem-anon-produtos.cjs`, S5).
 *   7. Rollback das NÃO aditivas devolve o corpo vivo medido em 08/09/2026
 *      (byte a byte, pg_get_expr) — comparação estrutural, não textual.
 *
 * Exit 0 = tudo OK. Exit 1 = alguma afirmativa caiu. Exit 2 = INCONCLUSIVO
 * (pré-condição não bateu — nada foi simulado).
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

/* eslint-disable security/detect-object-injection --
 * Os únicos índices dinâmicos deste arquivo percorrem POLICIES_COM_ROLLBACK,
 * uma lista FIXA de 3 nomes declarada neste mesmo arquivo (nunca payload de
 * terceiro) — mesma convenção de scripts/db-prove-blindagem-anon-produtos.cjs. */

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIG_DIR = path.join(PROJECT_ROOT, "supabase/migrations");
const MIGRATIONS = [
  "20261110000000_o_visitante_le_avaliacoes_e_perguntas_pela_vitrine.sql",
  "20261111000000_o_visitante_para_de_ler_o_autor_direto_da_tabela.sql",
  "20261112000000_analytics_events_para_de_aceitar_gravacao_anonima.sql",
].map((f) => path.join(MIG_DIR, f));
const ROLLBACKS = [
  "rollback-manual-20261111000000_o_visitante_para_de_ler_o_autor_direto_da_tabela.sql",
  "rollback-manual-20261112000000_analytics_events_para_de_aceitar_gravacao_anonima.sql",
].map((f) => path.join(MIG_DIR, f));

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error(
    "DATABASE_URL não encontrada no ambiente — rode com com-env-main.cjs/com-env-savy.cjs.",
  );
}

function lerSql(caminho) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho é da lista fixa MIGRATIONS/ROLLBACKS, sem entrada externa
  return fs.readFileSync(caminho, "utf8");
}

let falhas = 0;
function afirmar(descricao, condicao, extra = "") {
  if (condicao) {
    console.log(`  [OK   ] ${descricao}`);
  } else {
    falhas += 1;
    console.log(`  [FALHOU] ${descricao}${extra ? ` — ${extra}` : ""}`);
  }
}

async function sondar(client, papel, sql, claims = "", params = []) {
  await client.query("SAVEPOINT sonda");
  try {
    await client.query(`SET LOCAL ROLE ${papel}`);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      claims,
    ]);
    try {
      const r = await client.query(sql, params);
      return { ok: true, rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT sonda");
    await client.query("RESET ROLE").catch(() => {});
  }
}

/** Fotografa USING/WITH CHECK + papéis de uma lista de policies, por nome —
 * usada para provar que o rollback devolve o corpo vivo (comparação
 * estrutural via pg_get_expr, nunca texto do arquivo). */
async function fotografarPolicies(client, nomes) {
  const r = await client.query(
    `SELECT polname,
            pg_get_expr(polqual, polrelid) AS q,
            pg_get_expr(polwithcheck, polrelid) AS wc,
            polroles::regrole[]::text AS roles
     FROM pg_policy WHERE polname = ANY($1)`,
    [nomes],
  );
  const porNome = new Map(r.rows.map((row) => [row.polname, row]));
  return nomes.map((nome) => porNome.get(nome) || null);
}

async function colunas(client, tabela) {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tabela],
  );
  return r.rows.map((row) => row.column_name);
}

async function rodar(rotulo) {
  const client = new Client({ connectionString: lerDatabaseUrl() });
  await client.connect();
  console.log(`\n===== ${rotulo} =====`);

  try {
    await client.query("BEGIN");

    // ---- 0. Controle negativo: o estado vivo de HOJE vaza user_id -------
    titulo("0. Controle negativo (estado vivo, antes das migrations)");
    const POLICIES_COM_ROLLBACK = [
      "reviews_select_policy",
      "questions_select_policy",
      "analytics_events_insert_policy",
    ];
    const corposOriginais = await fotografarPolicies(
      client,
      POLICIES_COM_ROLLBACK,
    );
    const reviewPublicada = await client.query(
      `SELECT id, product_id, user_id FROM public.reviews
       WHERE status = 'publicada' AND user_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
    );
    const perguntaQualquer = await client.query(
      `SELECT id, product_id, user_id FROM public.questions
       ORDER BY created_at DESC LIMIT 1`,
    );

    if (reviewPublicada.rows.length > 0) {
      const alvo = reviewPublicada.rows[0];
      const antes = await sondar(
        client,
        "anon",
        "SELECT user_id FROM public.reviews WHERE id = $1",
        "",
        [alvo.id],
      );
      afirmar(
        `anon LÊ user_id de reviews HOJE (avaliação ${alvo.id.slice(0, 8)}…) — prova que o instrumento discrimina`,
        antes.ok &&
          antes.rows.length === 1 &&
          antes.rows[0].user_id === alvo.user_id,
        JSON.stringify(antes),
      );
    } else {
      console.log(
        "  [N/A  ] controle negativo de reviews — nenhuma avaliação publicada com user_id no banco.",
      );
    }

    if (perguntaQualquer.rows.length > 0) {
      const alvo = perguntaQualquer.rows[0];
      const antes = await sondar(
        client,
        "anon",
        "SELECT user_id FROM public.questions WHERE id = $1",
        "",
        [alvo.id],
      );
      afirmar(
        `anon LÊ user_id de questions HOJE (pergunta ${alvo.id.slice(0, 8)}…) — prova que o instrumento discrimina`,
        antes.ok &&
          antes.rows.length === 1 &&
          antes.rows[0].user_id === alvo.user_id,
        JSON.stringify(antes),
      );
    } else {
      console.log(
        "  [N/A  ] controle negativo de questions — nenhuma pergunta no banco.",
      );
    }

    // ---- 1. Aplica as três migrations, lidas do disco --------------------
    titulo("1. Aplicando as três migrations (lidas do disco)");
    for (const caminho of MIGRATIONS) {
      await client.query(lerSql(caminho));
      console.log(`  [OK   ] aplicada: ${path.basename(caminho)}`);
    }

    // ---- 2. anon perde a tabela --------------------------------------
    titulo("2. anon para de alcançar reviews/questions PELA TABELA");
    const semReviews = await sondar(
      client,
      "anon",
      "SELECT * FROM public.reviews",
    );
    afirmar(
      "anon: SELECT * FROM reviews devolve ZERO linhas",
      semReviews.ok && semReviews.rowCount === 0,
      JSON.stringify(semReviews),
    );
    const semQuestions = await sondar(
      client,
      "anon",
      "SELECT * FROM public.questions",
    );
    afirmar(
      "anon: SELECT * FROM questions devolve ZERO linhas",
      semQuestions.ok && semQuestions.rowCount === 0,
      JSON.stringify(semQuestions),
    );

    // ---- 3. anon lê pelas views, sem user_id -----------------------------
    titulo("3. anon lê pelas views públicas, SEM a coluna user_id");
    const colsReviewsView = await colunas(client, "vw_reviews_public");
    afirmar(
      "vw_reviews_public NÃO tem coluna user_id",
      !colsReviewsView.includes("user_id"),
      colsReviewsView.join(","),
    );
    const colsQuestionsView = await colunas(client, "vw_questions_public");
    afirmar(
      "vw_questions_public NÃO tem coluna user_id",
      !colsQuestionsView.includes("user_id"),
      colsQuestionsView.join(","),
    );

    const anonReviewsView = await sondar(
      client,
      "anon",
      "SELECT * FROM public.vw_reviews_public LIMIT 5",
    );
    afirmar(
      "anon: SELECT * FROM vw_reviews_public FUNCIONA (sem erro de permissão)",
      anonReviewsView.ok,
      JSON.stringify(anonReviewsView),
    );
    const anonQuestionsView = await sondar(
      client,
      "anon",
      "SELECT * FROM public.vw_questions_public LIMIT 5",
    );
    afirmar(
      "anon: SELECT * FROM vw_questions_public FUNCIONA (sem erro de permissão)",
      anonQuestionsView.ok,
      JSON.stringify(anonQuestionsView),
    );

    if (reviewPublicada.rows.length > 0) {
      const alvo = reviewPublicada.rows[0];
      const linha = await sondar(
        client,
        "anon",
        "SELECT * FROM public.vw_reviews_public WHERE id = $1",
        "",
        [alvo.id],
      );
      afirmar(
        "a MESMA avaliação do controle negativo aparece na view, sem user_id na linha",
        linha.ok &&
          linha.rows.length === 1 &&
          !Object.hasOwn(linha.rows[0], "user_id"),
        JSON.stringify(linha),
      );
    }

    // ---- 4. Efeito colateral: vw_questions_with_answers_count fecha -----
    titulo(
      "4. Efeito colateral documentado: vw_questions_with_answers_count fecha para anon",
    );
    const viewAntiga = await sondar(
      client,
      "anon",
      "SELECT * FROM public.vw_questions_with_answers_count",
    );
    afirmar(
      "anon: SELECT * FROM vw_questions_with_answers_count devolve ZERO linhas (security_invoker herda a RLS nova)",
      viewAntiga.ok && viewAntiga.rowCount === 0,
      JSON.stringify(viewAntiga),
    );

    // ---- 5. analytics_events não aceita mais INSERT anônimo --------------
    titulo("5. analytics_events para de aceitar INSERT anônimo");
    const insertAnon = await sondar(
      client,
      "anon",
      "INSERT INTO public.analytics_events (event_type) VALUES ('teste-i4')",
    );
    afirmar(
      "anon: INSERT em analytics_events falha com 42501 (GRANT revogado)",
      !insertAnon.ok && insertAnon.code === "42501",
      JSON.stringify(insertAnon),
    );

    // ---- 6. authenticated continua lendo a própria linha -----------------
    titulo("6. authenticated continua lendo a própria avaliação/pergunta");
    const donoReview = await client.query(
      `SELECT r.id, r.user_id FROM public.reviews r
       JOIN auth.users u ON u.id = r.user_id
       ORDER BY r.created_at DESC LIMIT 1`,
    );
    if (donoReview.rows.length > 0) {
      const alvo = donoReview.rows[0];
      const claims = JSON.stringify({
        sub: alvo.user_id,
        role: "authenticated",
      });
      const propria = await sondar(
        client,
        "authenticated",
        "SELECT id FROM public.reviews WHERE id = $1",
        claims,
        [alvo.id],
      );
      afirmar(
        `authenticated (sub=${alvo.user_id.slice(0, 8)}…) continua lendo a própria avaliação (${alvo.id.slice(0, 8)}…)`,
        propria.ok && propria.rows.length === 1,
        JSON.stringify(propria),
      );
    } else {
      console.log(
        "  [N/A  ] nenhuma avaliação com autor em auth.users encontrada — assertiva de leitura própria não aplicável neste banco.",
      );
    }

    // ---- 7. Rollback das NÃO aditivas devolve o corpo vivo ---------------
    titulo(
      "7. Rollback manual devolve o corpo VIVO (medido antes desta transação)",
    );
    for (const caminho of ROLLBACKS) {
      await client.query(lerSql(caminho));
      console.log(`  [OK   ] rollback aplicado: ${path.basename(caminho)}`);
    }
    const corposDepois = await fotografarPolicies(
      client,
      POLICIES_COM_ROLLBACK,
    );
    for (let i = 0; i < POLICIES_COM_ROLLBACK.length; i += 1) {
      const nome = POLICIES_COM_ROLLBACK[i];
      const antes = corposOriginais[i];
      const depois = corposDepois[i];
      afirmar(
        `${nome}: o rollback devolve EXATAMENTE o corpo que estava vivo ANTES desta transação (USING+WITH CHECK+papéis, comparado dentro da própria tx, não hardcoded)`,
        antes !== null &&
          depois !== null &&
          antes.q === depois.q &&
          antes.wc === depois.wc &&
          antes.roles === depois.roles,
        `antes=${JSON.stringify(antes)} depois=${JSON.stringify(depois)}`,
      );
    }
    const anonDepoisDoRollback = await sondar(
      client,
      "anon",
      "SELECT user_id FROM public.reviews LIMIT 1",
    );
    afirmar(
      "depois do rollback: anon volta a alcançar user_id de reviews (o furo reabre — efeito colateral honesto documentado)",
      anonDepoisDoRollback.ok,
      JSON.stringify(anonDepoisDoRollback),
    );
    const grantAnonDepois = await client.query(
      `SELECT 1 FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name='analytics_events'
         AND grantee='anon' AND privilege_type='INSERT'`,
    );
    afirmar(
      "depois do rollback: GRANT INSERT em analytics_events volta para anon (o furo do I-4 reabre — efeito colateral honesto documentado)",
      grantAnonDepois.rows.length === 1,
      JSON.stringify(grantAnonDepois.rows),
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(
    `\n${rotulo}: ${falhas === 0 ? "TODAS AS AFIRMATIVAS OK" : `${falhas} FALHA(S)`}`,
  );
}

function titulo(t) {
  console.log(`\n-- ${t}`);
}

(async () => {
  falhas = 0;
  await rodar(process.argv[2] || "banco");
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("INCONCLUSIVO:", e.message);
  process.exit(2);
});
