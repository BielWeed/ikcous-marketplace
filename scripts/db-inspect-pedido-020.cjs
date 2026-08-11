#!/usr/bin/env node
/**
 * Levanta o estado REAL do canal de aviso de pedido novo (PEDIDO-020, #89).
 *
 * NAO ALTERA NADA. Só SELECT.
 *
 * POR QUE ESTE SCRIPT EXISTE ANTES DO CODIGO:
 *   O criterio 1 da issue é "criar um pedido de teste com o painel fechado e o
 *   lojista recebe o aviso em ate 1 minuto". Existe um jeito de escrever todo o
 *   caminho, publicar, testar e o aviso nao chegar — sem nenhum bug: se NENHUMA
 *   inscricao de push pertencer a um admin, o canal funciona e ninguem e
 *   avisado. A #38 registra 8 linhas em push_subscriptions, 6 com user_id NULL.
 *
 *   Entao antes de escrever a funcao, medir:
 *
 *   1. Quantas inscricoes existem, e quantas tem user_id preenchido?
 *   2. Alguma delas pertence a um usuario com role='admin'?
 *   3. Quantos admins existem, e algum deles tem inscricao?
 *   4. marketplace_orders tem trigger non-internal? (a issue afirma que nao;
 *      se aparecer algum, o desenho muda)
 *   5. store_config tem as colunas da Evolution API preenchidas? (decide se a
 *      send-order-whatsapp orfa esta ativa de fato ou so publicada)
 *
 * O que ele imprime e evidencia para desenhar o caminho, nao um veredito.
 *
 * USO:  node scripts/db-inspect-pedido-020.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

const titulo = (t) => console.log(`\n=== ${t} ===`);

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    titulo("1. Colunas de push_subscriptions");
    const colunas = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
      ORDER BY ordinal_position
    `);
    console.table(colunas.rows);

    titulo("2. Inscricoes: total e quantas tem dono");
    const totais = await client.query(`
      SELECT
        count(*)                                    AS total,
        count(user_id)                              AS com_user_id,
        count(*) FILTER (WHERE user_id IS NULL)     AS sem_user_id
      FROM public.push_subscriptions
    `);
    console.table(totais.rows);

    titulo("3. Alguma inscricao pertence a um admin?");
    const admins = await client.query(`
      SELECT
        p.role,
        count(DISTINCT p.id)  AS usuarios,
        count(s.id)           AS inscricoes
      FROM public.profiles p
      LEFT JOIN public.push_subscriptions s ON s.user_id = p.id
      GROUP BY p.role
      ORDER BY p.role
    `);
    console.table(admins.rows);

    titulo("4. Triggers non-internal em marketplace_orders");
    const triggers = await client.query(`
      SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definicao
      FROM pg_trigger
      WHERE tgrelid = 'public.marketplace_orders'::regclass
        AND NOT tgisinternal
    `);
    console.log(
      triggers.rowCount === 0
        ? "nenhum (confirma a evidencia da issue)"
        : triggers.rows,
    );

    titulo("5. store_config: Evolution API configurada?");
    const cfg = await client.query(`
      SELECT
        whatsapp_api_url      IS NOT NULL AND whatsapp_api_url      <> '' AS tem_url,
        whatsapp_api_key      IS NOT NULL AND whatsapp_api_key      <> '' AS tem_key,
        whatsapp_api_instance IS NOT NULL AND whatsapp_api_instance <> '' AS tem_instance
      FROM public.store_config
      LIMIT 1
    `);
    console.table(cfg.rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
