#!/usr/bin/env node
/**
 * Prova a correção do A8 (laudo novos ângulos 01/09) sem comitar nada no banco.
 *
 * TUDO roda em UMA transação terminada em ROLLBACK. Nada é gravado. Isso só
 * é verdade porque a migration NÃO tem BEGIN/COMMIT embutido — se alguém
 * acrescentar um, este script passa a gravar em produção sem avisar.
 *
 * A migration é aplicada DENTRO da transação (mesmo padrão do
 * db-prove-admin-090.cjs): a fase ANTES prova o defeito com as funções vivas
 * de hoje, dá ROLLBACK TO SAVEPOINT, aplica o arquivo novo e refaz o cenário
 * — antes e depois na mesma rodada, contra o MESMO banco.
 *
 * O CENÁRIO-CHAVE (a oscilação, A8): pedido "na entrega" (v23, convidado,
 * entrega local) → cancelado (estoque volta) → reativado para 'processing' →
 * cancelado de novo. ANTES: a segunda ida a 'cancelled' creditava de novo
 * (peça fantasma). DEPOIS: devolver_estoque reclama o carimbo
 * stock_returned_at e a segunda volta é um no-op.
 *
 * O SEGUNDO CENÁRIO (cancelado-após-envio): shipping → cancelled (NÃO
 * credita — mercadoria com o cliente) → reativado → cancelado a partir de
 * 'processing'. ANTES: creditava phantom. DEPOIS: a guarda
 * `NOT cancelled_after_shipping` bloqueia; o crédito só acontece em
 * confirmar_retorno_do_produto (e lá, uma única vez).
 *
 * O TERCEIRO CENÁRIO (porta direta): com claims de admin, UPDATE direto de
 * `status` por PostgREST deve ser RECUSADO (grant de coluna); UPDATE de
 * `tracking_code` deve PASSAR (o único uso direto do painel).
 *
 * POR QUE `SET LOCAL ROLE authenticated` + `request.jwt.claims`:
 *   update_order_status_atomic exige auth.uid() e is_admin(); is_admin lê
 *   app_metadata.role das claims (medido: pg_get_functiondef). A
 *   DATABASE_URL conecta como postgres, que é autorizado por atalho na
 *   primeira linha de is_admin — sem trocar o papel, a prova não mediria o
 *   caminho do admin de verdade.
 *
 * USO:  node scripts/db-prove-estoque-volta-uma-vez.cjs
 * Sai com código 0 só se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");
const MIGRATION = path.join(
  RAIZ,
  "supabase/migrations/20261060000000_o_estoque_volta_uma_vez_so.sql",
);
const NOME_PRODUTO = "SONDA PROVA A8 ESTOQUE";
const CEP_LOCAL = "38500000"; // CEP de origem da loja de dev: entrega local certa

let falhas = 0;
function asserir(condicao, rotulo) {
  if (condicao) {
    console.log(`  ✔ ${rotulo}`);
  } else {
    falhas += 1;
    console.error(`  ✘ ${rotulo}`);
  }
}

async function main() {
  const envPath = path.join(RAIZ, ".env");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
  const env = fs.readFileSync(envPath, "utf8");
  const linha = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  const dbUrl = linha
    .slice("DATABASE_URL=".length)
    .replace(/^"|"$/g, "");

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo da migration desta frente, sem entrada externa
  const migration = fs.readFileSync(MIGRATION, "utf8");

  try {
    await client.query("BEGIN");

    // ---- massa: produto de teste com estoque conhecido -------------------
    const obrigatorias = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='produtos'
          AND is_nullable='NO' AND column_default IS NULL
          AND is_identity='NO' AND is_generated='NEVER'`,
    );
    const cols = {
      nome: `'${NOME_PRODUTO}'`,
      preco_venda: "10.00",
      estoque: "5",
      ativo: "true",
      frete_gratis: "false",
    };
    const usadas = new Set(Object.keys(cols));
    for (const { column_name, data_type } of obrigatorias.rows) {
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
    const ins = await client.query(
      `INSERT INTO produtos (${Object.keys(cols).join(", ")})
       VALUES (${Object.values(cols).join(", ")}) RETURNING id`,
    );
    const produtoId = ins.rows[0].id;

    const estoque = async () =>
      (
        await client.query(`SELECT estoque FROM produtos WHERE id = $1`, [
          produtoId,
        ])
      ).rows[0].estoque;

    const criarPedido = async () =>
      (
        await client.query(
          `SELECT public.create_marketplace_order_v23(
              $1::jsonb, 20.00, 0, 'cash', NULL, NULL,
              'SONDA PROVA A8', '5531999999999', NULL,
              '{"cep":"38500000"}'::jsonb, '38500000', 'local-delivery')
            AS pedido_id`,
          [JSON.stringify([{ product_id: produtoId, quantity: 1 }])],
        )
      ).rows[0].pedido_id;

    const adminId = (
      await client.query(`SELECT id FROM profiles WHERE role = 'admin' LIMIT 1`)
    ).rows[0].id;
    const virarAdmin = async () => {
      await client.query(`SET LOCAL ROLE authenticated`);
      await client.query(
        `SELECT set_config('request.jwt.claims', $1, true)`,
        [
          JSON.stringify({
            sub: adminId,
            role: "authenticated",
            app_metadata: { role: "admin" },
          }),
        ],
      );
    };
    const mudarStatus = async (pedidoId, novo) =>
      client.query(
        `SELECT public.update_order_status_atomic($1, $2, 'PROVA A8', true) AS r`,
        [pedidoId, novo],
      );

    // ======================================================================
    // FASE ANTES — as funções vivas de hoje, com o defeito documentado
    // ======================================================================
    console.log("\n[ANTES] funções vivas de hoje (defeito esperado):");
    await client.query("SAVEPOINT sp_antes");
    {
      const pedido = await criarPedido();
      await virarAdmin();
      await mudarStatus(pedido, "cancelled");
      asserir((await estoque()) === 5, "1º cancelamento devolve o estoque (5)");
      await mudarStatus(pedido, "processing");
      await mudarStatus(pedido, "cancelled");
      const estoqueApos = await estoque();
      asserir(
        estoqueApos === 6,
        `oscilação cancelled→processing→cancelled credita DE NOVO (estoque ${estoqueApos}) — o defeito A8, registrado`,
      );
    }
    await client.query("ROLLBACK TO sp_antes");
    await client.query(`SET LOCAL ROLE postgres`);
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);

    // ======================================================================
    // A MIGRATION, dentro da transação
    // ======================================================================
    await client.query(migration);

    // Ficha 1 (transacional): backfill cobriu quem estava com estoque de volta
    const ficha = await client.query(
      `SELECT
         count(*) FILTER (WHERE status = 'cancelled'
                           AND (cancelled_after_shipping = false
                                OR returned_to_seller_at IS NOT NULL)
                           AND stock_returned_at IS NULL) AS faltou_carimbo,
         count(*) FILTER (WHERE status = 'cancelled'
                           AND cancelled_after_shipping = true
                           AND returned_to_seller_at IS NULL
                           AND stock_returned_at IS NOT NULL) AS carimbou_sem_direito
       FROM public.marketplace_orders`,
    );
    asserir(
      Number(ficha.rows[0].faltou_carimbo) === 0,
      "backfill: nenhum cancelado com estoque devolvido ficou sem carimbo",
    );
    asserir(
      Number(ficha.rows[0].carimbou_sem_direito) === 0,
      "backfill: ninguém com mercadoria fora recebeu carimbo indevido",
    );

    // ======================================================================
    // FASE DEPOIS — o mesmo cenário, agora com a cura
    // ======================================================================
    console.log("\n[DEPOIS] migration aplicada na transação:");
    await virarAdmin();
    {
      const pedido = await criarPedido();
      await mudarStatus(pedido, "cancelled");
      asserir((await estoque()) === 5, "1º cancelamento devolve o estoque (5)");
      const carimbo = await client.query(
        `SELECT stock_returned_at FROM marketplace_orders WHERE id = $1`,
        [pedido],
      );
      asserir(
        carimbo.rows[0].stock_returned_at !== null,
        "o carimbo stock_returned_at ficou gravado",
      );
      await mudarStatus(pedido, "processing");
      await mudarStatus(pedido, "cancelled");
      asserir(
        (await estoque()) === 5,
        "oscilação cancelled→processing→cancelled NÃO credita de novo (5) — A8 fechado",
      );
    }

    // Cenário cancelado-após-envio: mercadoria fora, crédito só no retorno
    {
      const pedido = await criarPedido(); // estoque 5 -> 4
      await mudarStatus(pedido, "processing");
      await mudarStatus(pedido, "shipping");
      await mudarStatus(pedido, "cancelled");
      asserir(
        (await estoque()) === 4,
        "cancelado em shipping NÃO credita (produto com o cliente) — 4",
      );
      await mudarStatus(pedido, "processing");
      await mudarStatus(pedido, "cancelled");
      asserir(
        (await estoque()) === 4,
        "re-cancelado a partir de processing NÃO credita phantom (4) — guarda do cancelled_after_shipping",
      );
      const retorno = await client.query(
        `SELECT public.confirmar_retorno_do_produto($1) AS r`,
        [pedido],
      );
      asserir(
        retorno.rows[0].r.ok === true &&
          (await estoque()) === 5,
        "confirmar_retorno_do_produto credita o retorno (5)",
      );
      const segunda = await client.query(
        `SELECT public.confirmar_retorno_do_produto($1) AS r`,
        [pedido],
      );
      asserir(
        segunda.rows[0].r.ja_confirmado === true &&
          (await estoque()) === 5,
        "segundo 'produto voltou' é no-op (5) — idempotência mantida",
      );
    }

    // Porta direta: status recusado, tracking_code liberado
    {
      const pedido = await criarPedido();
      let recusou = false;
      await client.query("SAVEPOINT sp_status");
      try {
        await client.query(
          `UPDATE marketplace_orders SET status = 'processing' WHERE id = $1`,
          [pedido],
        );
      } catch (e) {
        recusou = /permission denied/i.test(e.message);
      } finally {
        await client.query("ROLLBACK TO sp_status");
      }
      asserir(
        recusou,
        "UPDATE direto de `status` por admin é RECUSADO (grant de coluna)",
      );
      const tracking = await client.query(
        `UPDATE marketplace_orders SET tracking_code = 'SONDA-TRK' WHERE id = $1 RETURNING id`,
        [pedido],
      );
      asserir(
        tracking.rowCount === 1,
        "UPDATE direto de `tracking_code` pelo painel continua funcionando",
      );
    }

    await client.query(`SET LOCAL ROLE postgres`);
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
  } finally {
    // O ROLLBACK é o ponto inteiro do script: nada do que foi feito aqui
    // sobrevive — nem a massa, nem a migration, nem os carimbos.
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
