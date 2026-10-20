#!/usr/bin/env node
/**
 * PROVA A10 — o log de push nasce honesto (laudo novos ângulos 01/09).
 *
 * ESCOPO (15/10/2026): SÓ `reply_review_atomic`. A migration 20261240000000
 * trocou o corpo das duas sobrecargas de `answer_question_atomic`: a resposta
 * à PERGUNTA deixou de gravar a linha em `push_notifications_log` e passou a
 * criar o aviso no sino da cliente (provado por
 * tests/banco/pergunta-respondida-avisa-viva.cjs). Por isso esta prova NÃO
 * mede mais `answer_question_atomic`: o marcador "A10: log honesto" deixou de
 * existir nela, e é esse o motivo de a 20261064 e a 20261065 NUNCA mais serem
 * reaplicadas (recriariam o corpo antigo por cima do novo).
 *
 * O que prova, contra o banco VIVO, numa transação com ROLLBACK no fim
 * (resíduo zero):
 *   1. `reply_review_atomic` grava a linha de log com
 *      `recipient_count = 0` NO CAMINHO DO APP (2 args) e no legado
 *      (3 args);
 *   2. as DUAS assinaturas vivas de `reply_review_atomic` carregam o marcador
 *      "A10: log honesto" (o mesmo que o VERIFICACOES do db-apply confere);
 *   3. nenhuma linha antiga com a mentira (count = 1) sobrou nos títulos da
 *      avaliação.
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

    // ---- massa: produto -> avaliação (filler de NOT NULL) ----
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

    // ---- contexto de admin para as respostas à avaliação (a da PERGUNTA saiu deste escopo) ----
    await virarAdmin();

    // ---- 1. avaliação respondida: 0 aparelhos, nos dois caminhos --------
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

    // ---- 2. marcador do contrato nas DUAS assinaturas vivas de reply_review_atomic ---
    const comMarcador = async (funcao) =>
      (
        await client.query(
          "SELECT pg_get_functiondef($1::regprocedure) AS def",
          [`public.${funcao}`],
        )
      ).rows[0].def.includes("A10: log honesto");
    asserir(
      (await comMarcador("reply_review_atomic(uuid,text)")) &&
        (await comMarcador("reply_review_atomic(uuid,text,uuid)")),
      "as DUAS assinaturas vivas de reply_review_atomic carregam o marcador 'A10: log honesto'",
    );

    // ---- 3. limpeza: nenhuma linha com esses títulos segue em 1 ----------
    const mentira = (
      await client.query(
        "SELECT count(*)::int AS n FROM push_notifications_log WHERE recipient_count = 1 AND title IN ('Sua avaliacao foi respondida!', 'Sua avaliação foi respondida!')",
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
