#!/usr/bin/env node
/**
 * PROVA A10 — o log de push nasce honesto (laudo novos ângulos 01/09).
 *
 * O que prova, contra o banco VIVO, numa transação com ROLLBACK no fim
 * (resíduo zero):
 *   1. `answer_question_atomic` grava a linha de log com
 *      `recipient_count = 0` NO CAMINHO DO APP (2 args) e no legado
 *      (3 args); re-editar grava OUTRA linha, também 0 (nunca 1);
 *   2. `reply_review_atomic` idem, nos dois caminhos;
 *   3. as QUATRO assinaturas vivas carregam o marcador
 *      "A10: log honesto" (o mesmo que o VERIFICACOES do db-apply confere);
 *   4. nenhuma linha antiga com a mentira (count = 1) sobrou.
 *
 * Contexto de admin: `SET LOCAL ROLE authenticated` + `request.jwt.claims`
 * com `app_metadata.role = admin` de um perfil admin real — o mesmo padrão
 * do db-prove-estoque-volta-uma-vez.cjs.
 *
 * USO: node scripts/db-prove-push-log-honesto.cjs   (DATABASE_URL do .env)
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");

let falhas = 0;
function asserir(condicao, rotulo) {
  if (condicao) {
    console.log(`  ok  ${rotulo}`);
  } else {
    falhas += 1;
    console.error(`  FALHOU  ${rotulo}`);
  }
}

async function main() {
  const envPath = path.join(RAIZ, ".env");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
  const env = fs.readFileSync(envPath, "utf8");
  const linha = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  const dbUrl = linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    // ---- massa: produto -> pergunta -> avaliação (filler de NOT NULL) ----
    const obrigatorias = async (tabela) =>
      (
        await client.query(
          `SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1
              AND is_nullable='NO' AND column_default IS NULL
              AND is_identity='NO' AND is_generated='NEVER'`,
          [tabela],
        )
      ).rows;

    const semear = async (tabela, cols) => {
      const usadas = new Set(Object.keys(cols));
      for (const { column_name, data_type } of await obrigatorias(tabela)) {
        if (usadas.has(column_name)) continue;
        const generico =
          data_type === "text" ||
          data_type === "character varying" ||
          data_type === "character"
            ? "'SONDA'"
            : data_type === "boolean"
              ? "false"
              : data_type === "numeric" ||
                  data_type === "integer" ||
                  data_type === "bigint"
                ? "0"
                : data_type.includes("timestamp") || data_type === "date"
                  ? "now()"
                  : data_type === "jsonb" || data_type === "json"
                    ? "'{}'"
                    : null;
        if (generico === null) continue;
        // eslint-disable-next-line security/detect-object-injection -- coluna vem do information_schema, script local sem entrada de rede
        cols[column_name] = generico;
      }
      const sql = `INSERT INTO ${tabela} (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).join(", ")}) RETURNING id`;
      return (await client.query(sql)).rows[0].id;
    };

    const produtoId = await semear("produtos", {
      nome: "'SONDA PROVA A10 PUSH LOG'",
      preco_venda: "10.00",
      estoque: "5",
      ativo: "true",
      frete_gratis: "false",
    });

    const adminId = (
      await client.query("SELECT id FROM profiles WHERE role = 'admin' LIMIT 1")
    ).rows[0].id;

    const perguntaId = await semear("questions", {
      product_id: `uuid '${produtoId}'`,
      user_id: `uuid '${adminId}'`,
      question: "'SONDA A10?'",
    });

    const reviewId = await semear("reviews", {
      product_id: `uuid '${produtoId}'`,
      user_id: `uuid '${adminId}'`,
      rating: "5",
      comment: "'SONDA A10'",
      status: "'publicada'",
      verified: "false",
    });

    const virarAdmin = async () => {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: adminId,
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ]);
    };

    const logsDaSonda = async (titulo, url) =>
      (
        await client.query(
          "SELECT recipient_count FROM push_notifications_log WHERE title = $1 AND url = $2 ORDER BY sent_at",
          [titulo, url],
        )
      ).rows;

    // ---- 1. pergunta respondida: 0 aparelhos, em AMBOS os caminhos ------
    // (2 args = o caminho que o front usa; 3 args = legado da 64)
    await virarAdmin();
    await client.query("SELECT public.answer_question_atomic($1, $2)", [
      perguntaId,
      "primeira resposta",
    ]);
    await client.query("SELECT public.answer_question_atomic($1, $2)", [
      perguntaId,
      "resposta editada",
    ]);
    await client.query("SELECT public.answer_question_atomic($1, $2, $3)", [
      perguntaId,
      "resposta pelo caminho legado",
      adminId,
    ]);
    const linhasPergunta = await logsDaSonda(
      "Sua pergunta foi respondida!",
      `/product/${produtoId}`,
    );
    asserir(
      linhasPergunta.length === 3,
      `pergunta: 3 respostas (2x app + 1x legado) gravaram 3 linhas (${linhasPergunta.length})`,
    );
    asserir(
      linhasPergunta.every((l) => l.recipient_count === 0),
      "pergunta: TODAS as linhas nascem com recipient_count = 0",
    );

    // ---- 2. avaliação respondida: 0 aparelhos, nos dois caminhos --------
    await client.query("SELECT public.reply_review_atomic($1, $2)", [
      reviewId,
      "obrigado pela avaliação!",
    ]);
    await client.query("SELECT public.reply_review_atomic($1, $2, $3)", [
      reviewId,
      "obrigado de novo (legado)",
      adminId,
    ]);
    const replicasComAcento = await logsDaSonda(
      "Sua avaliação foi respondida!",
      `/product/${produtoId}`,
    );
    const replicasSemAcento = await logsDaSonda(
      "Sua avaliacao foi respondida!",
      `/product/${produtoId}`,
    );
    asserir(
      replicasComAcento.length === 1 &&
        replicasComAcento[0].recipient_count === 0,
      "avaliação: a réplica do app (2 args, título acentuado) nasce com 0",
    );
    asserir(
      replicasSemAcento.length === 1 &&
        replicasSemAcento[0].recipient_count === 0,
      "avaliação: a réplica legada (3 args, título sem acento) nasce com 0",
    );

    // ---- 3. marcador do contrato nas QUATRO assinaturas vivas -----------
    const comMarcador = async (funcao) =>
      (
        await client.query(
          "SELECT pg_get_functiondef($1::regprocedure) AS def",
          [`public.${funcao}`],
        )
      ).rows[0].def.includes("A10: log honesto");
    asserir(
      (await comMarcador("answer_question_atomic(uuid,text)")) &&
        (await comMarcador("answer_question_atomic(uuid,text,uuid)")) &&
        (await comMarcador("reply_review_atomic(uuid,text)")) &&
        (await comMarcador("reply_review_atomic(uuid,text,uuid)")),
      "as QUATRO assinaturas vivas carregam o marcador 'A10: log honesto'",
    );

    // ---- 4. limpeza: nenhuma linha com esses títulos segue em 1 ----------
    const mentira = (
      await client.query(
        "SELECT count(*)::int AS n FROM push_notifications_log WHERE recipient_count = 1 AND title IN ('Sua pergunta foi respondida!', 'Sua avaliacao foi respondida!', 'Sua avaliação foi respondida!')",
      )
    ).rows[0].n;
    asserir(
      mentira === 0,
      `linhas antigas com a mentira (count=1): ${mentira}`,
    );

    await client.query("SET LOCAL ROLE postgres");
    await client.query("SELECT set_config('request.jwt.claims', '', true)");
  } finally {
    // Transação descartável: ou tudo confirma (não confirma — ROLLBACK
    // explícito), ou nada sobrevive — nem a massa, nem as linhas de log.
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(
    falhas === 0
      ? "\nPROVA COMPLETA: todas as asserções passaram. Nada foi gravado (ROLLBACK)."
      : `\nPROVA REPROVADA: ${falhas} asserção(ões) falharam. NADA foi gravado (ROLLBACK).`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("[PROVA FALHOU]", e.message);
  process.exit(1);
});
