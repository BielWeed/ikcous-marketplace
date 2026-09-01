#!/usr/bin/env node
/**
 * PROVA P-1+P-7+P-10 — o sino, o count de moderação e o carrinho usam os
 * índices novos (laudo varredura 01/09).
 *
 * O que prova, contra o banco VIVO de DEV, numa transação com ROLLBACK no
 * fim (resíduo zero — a massa sintética e os ÍNDICES criados inline morrem
 * juntos):
 *
 *   1. com massa grande (10 mil+ notificacoes, ~4 mil reviews, ~2 mil
 *      cart_items), o EXPLAIN das QUATRO consultas do app usa o índice
 *      correspondente (Index Scan ou Bitmap Index Scan — o que se asserre é
 *      o NOME do índice no plano, não o sabor do scan);
 *   2. pg_indexes lista os QUATRO com as definições esperadas.
 *
 * Controle de honestidade do instrumento: o EXPLAIN roda também ANTES dos
 * índices, provando que o plano de antes NÃO os citava (senão uma prova
 * cega passaria verde com ou sem migration).
 *
 * Por que massa grande: em tabela vazia o planejador prefere seq-scan por
 * custo — o que seria verdade sobre a massa, não sobre o índice. As
 * consultas do app têm LIMIT + ORDER BY (o plano para no primeiro lote do
 * índice) ou contagem parcial (só as pendentes), então o índice vence com
 * folga quando há massa.
 *
 * USO: node scripts/db-prove-indices-sino-carrinho.cjs   (DATABASE_URL do .env)
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");

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

// As QUATRO consultas do app, na grafia exata do que o PostgREST manda para
// o Postgres (valores inline — ids vêm do próprio banco neste script local).
const CONSULTAS = [
  {
    rotulo: "sino do usuário (NotificationContext:105-111)",
    sql: (idA) =>
      `SELECT * FROM notificacoes WHERE usuario_id = '${idA}' ORDER BY created_at DESC LIMIT 50`,
    indice: "idx_notificacoes_usuario_created",
  },
  {
    rotulo: "campanha global (NotificationContext:112-117)",
    sql: () =>
      "SELECT * FROM notificacoes WHERE usuario_id IS NULL ORDER BY created_at DESC LIMIT 20",
    indice: "idx_notificacoes_globais_created",
  },
  {
    rotulo: "badge de moderação (AdminLayout:209)",
    sql: () => "SELECT count(*) FROM reviews WHERE merchant_reply IS NULL",
    indice: "idx_reviews_resposta_pendente",
  },
  {
    rotulo: "sync do carrinho (CartContext:212-214)",
    sql: (idA) => `SELECT * FROM cart_items WHERE user_id = '${idA}'`,
    indice: "idx_cart_items_user_id",
  },
];

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

    // ---- donos reais (cart_items e reviews têm FK para auth.users/profiles)
    const naoAdmins = (
      await client.query(
        `SELECT u.id FROM auth.users u
          JOIN profiles p ON p.id = u.id
          WHERE coalesce(u.raw_app_meta_data ->> 'role', '') <> 'admin'
          ORDER BY u.created_at LIMIT 2`,
      )
    ).rows;
    if (naoAdmins.length < 2) {
      throw new Error("dev sem dois usuários não-admin para a prova");
    }
    const idA = naoAdmins[0].id; // o usuário "do sino"
    const idB = naoAdmins[1].id; // o recheio da massa

    // ---- massa descartável -------------------------------------------------
    // notificacoes: sem FK — o recheio pode ser um uuid sintético. O usuário
    // A fica com POUCAS linhas (o caso real: as dele num mar de campanha e
    // de avisos de outros), e as globais são 5.
    const idRecheio = randomUUID();
    await client.query(
      `INSERT INTO notificacoes (usuario_id, tipo, titulo)
       SELECT $1, 'info', 'SONDA P-1 proprio'
       FROM generate_series(1, 30)`,
      [idA],
    );
    await client.query(
      `INSERT INTO notificacoes (usuario_id, tipo, titulo)
       SELECT '${idRecheio}', 'info', 'SONDA P-1 recheio'
       FROM generate_series(1, 10000)`,
    );
    await client.query(
      `INSERT INTO notificacoes (usuario_id, tipo, titulo)
       SELECT NULL, 'info', 'SONDA P-1 global'
       FROM generate_series(1, 5)`,
    );

    // reviews: 1 produto sonda + 40 pendentes num mar de 4000 respondidas.
    const produtoId = (
      await client.query(
        `INSERT INTO produtos (nome, preco_venda, estoque, ativo, frete_gratis)
         VALUES ('SONDA PROVA P-1', 10.00, 5, true, false) RETURNING id`,
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO reviews (product_id, user_id, rating, comment, merchant_reply)
       SELECT '${produtoId}', $1, 5, 'SONDA P-1 respondida', 'obrigado!'
       FROM generate_series(1, 4000)`,
      [idA],
    );
    await client.query(
      `INSERT INTO reviews (product_id, user_id, rating, comment, merchant_reply)
       SELECT '${produtoId}', $1, 4, 'SONDA P-1 pendente', NULL
       FROM generate_series(1, 40)`,
      [idA],
    );

    // cart_items: 2 do usuário A num mar de 2000 de outro dono real. O
    // product_id VARIA por linha — a UNIQUE (user_id, product_id,
    // variant_id_key) recusaria linhas iguais.
    await client.query(
      `INSERT INTO cart_items (user_id, product_id, quantity)
       SELECT $1, 'SONDA P-10 item do A ' || g, 1 FROM generate_series(1, 2) g`,
      [idA],
    );
    await client.query(
      `INSERT INTO cart_items (user_id, product_id, quantity)
       SELECT $1, 'SONDA P-10 item do B ' || g, 2 FROM generate_series(1, 2000) g`,
      [idB],
    );

    // ---- CONTROLE NEGATIVO: SEM os índices, o plano não os cita ----------
    for (const consulta of CONSULTAS) {
      const planoAntes = (
        await client.query(`EXPLAIN ${consulta.sql(idA)}`)
      ).rows
        .map((r) => r["QUERY PLAN"])
        .join("\n");
      asserir(
        !planoAntes.includes(consulta.indice),
        `controle negativo (sem índice): "${consulta.rotulo}" não cita ${consulta.indice}`,
      );
    }

    // ---- os ÍNDICES da migration, criados INLINE (morrem no ROLLBACK) ----
    await client.query(
      `CREATE INDEX idx_notificacoes_usuario_created
         ON public.notificacoes (usuario_id, created_at DESC);
       CREATE INDEX idx_notificacoes_globais_created
         ON public.notificacoes (created_at DESC) WHERE usuario_id IS NULL;
       CREATE INDEX idx_reviews_resposta_pendente
         ON public.reviews (created_at DESC) WHERE merchant_reply IS NULL;
       CREATE INDEX idx_cart_items_user_id
         ON public.cart_items (user_id);`,
    );

    // ---- a PROVA: cada consulta do app usa o índice dela ------------------
    for (const consulta of CONSULTAS) {
      const plano = (await client.query(`EXPLAIN ${consulta.sql(idA)}`)).rows
        .map((r) => r["QUERY PLAN"])
        .join("\n");
      asserir(
        plano.includes(consulta.indice),
        `com índice: "${consulta.rotulo}" usa ${consulta.indice}`,
      );
    }

    // ---- pg_indexes lista os QUATRO ----------------------------------------
    const catalogo = (
      await client.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'idx_notificacoes_usuario_created',
              'idx_notificacoes_globais_created',
              'idx_reviews_resposta_pendente',
              'idx_cart_items_user_id')`,
      )
    ).rows;
    asserir(
      catalogo.length === 4,
      `pg_indexes lista os 4 índices (${catalogo.length})`,
    );
    asserir(
      catalogo.some((i) =>
        /notificacoes USING btree \(usuario_id, created_at DESC\)/.test(
          i.indexdef,
        ),
      ) &&
        catalogo.some((i) =>
          /\(created_at DESC\) WHERE \(usuario_id IS NULL\)/.test(i.indexdef),
        ) &&
        catalogo.some((i) =>
          /reviews USING btree \(created_at DESC\) WHERE \(merchant_reply IS NULL\)/.test(
            i.indexdef,
          ),
        ) &&
        catalogo.some((i) =>
          /cart_items USING btree \(user_id\)$/.test(i.indexdef),
        ),
      "as definições batem com a migration (colunas, ordem DESC e predicados parciais)",
    );
  } finally {
    // Transação descartável: nem a massa, nem os índices sobrevivem.
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
