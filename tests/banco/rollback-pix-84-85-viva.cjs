"use strict";

// Executar apenas no clone efêmero do rpc-ci: prova o SQL de rollback real.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const SQL = fs.readFileSync("scripts/sql/pix-84-85-revert.sql", "utf8");
const V84 = "20261184000000";
const V85 = "20261185000000";

async function estado(db) {
  const {
    rows: [r],
  } = await db.query(`SELECT
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${V84}') AS v84,
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${V85}') AS v85,
    to_regprocedure('public.iniciar_venda_presencial_pix(jsonb,uuid,uuid,text,text,numeric,text)') IS NOT NULL AS rpc84,
    to_regprocedure('public.anular_venda_presencial(uuid,text)') IS NOT NULL AS rpc85,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.marketplace_orders'::regclass AND tgname = 'tr_venda_do_balcao_paga_e_entregue' AND NOT tgisinternal) AS trigger84`);
  return r;
}

async function cenario(db, nome, preparar, provar) {
  await db.query("SAVEPOINT caso");
  try {
    await preparar();
    await provar();
    console.log(`[rollback-pix] OK: ${nome}`);
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT caso");
    await db.query("RELEASE SAVEPOINT caso");
  }
}

async function main() {
  const db = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations
        (version text PRIMARY KEY, name text NOT NULL);
      INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES
        ('${V84}', 'o_pix_do_balcao_abre_na_hora'),
        ('${V85}', 'a_venda_do_balcao_se_anula_no_mesmo_dia');`);
    assert.deepEqual(await estado(db), {
      v84: true,
      v85: true,
      rpc84: true,
      rpc85: true,
      trigger84: true,
    });

    await cenario(
      db,
      "gatilho 84 desabilitado recusa drift",
      async () => {
        await db.query(
          "ALTER TABLE public.marketplace_orders DISABLE TRIGGER tr_venda_do_balcao_paga_e_entregue",
        );
      },
      async () => {
        await assert.rejects(() => db.query(SQL), /ROLLBACK_PIX_RECUSADO/);
      },
    );
    assert.deepEqual(await estado(db), {
      v84: true,
      v85: true,
      rpc84: true,
      rpc85: true,
      trigger84: true,
    });

    await cenario(
      db,
      "84 e 85 saem juntos com o ledger",
      async () => {},
      async () => {
        await db.query(SQL);
        assert.deepEqual(await estado(db), {
          v84: false,
          v85: false,
          rpc84: false,
          rpc85: false,
          trigger84: false,
        });
        assert.equal(
          (
            await db.query(
              "SELECT to_regprocedure('public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)') IS NOT NULL AS old_rpc",
            )
          ).rows[0].old_rpc,
          true,
        );
      },
    );

    await cenario(
      db,
      "84 isolada sai se 85 nunca entrou",
      async () => {
        await db.query(
          "DROP FUNCTION public.anular_venda_presencial(uuid,text)",
        );
        await db.query(
          `DELETE FROM supabase_migrations.schema_migrations WHERE version = '${V85}'`,
        );
      },
      async () => {
        await db.query(SQL);
        assert.deepEqual(await estado(db), {
          v84: false,
          v85: false,
          rpc84: false,
          rpc85: false,
          trigger84: false,
        });
      },
    );

    await cenario(
      db,
      "ledger divergente recusa sem mudar objetos",
      async () => {
        await db.query(
          `DELETE FROM supabase_migrations.schema_migrations WHERE version = '${V84}'`,
        );
      },
      async () => {
        await assert.rejects(() => db.query(SQL), /ROLLBACK_PIX_RECUSADO/);
      },
    );
    assert.deepEqual(await estado(db), {
      v84: true,
      v85: true,
      rpc84: true,
      rpc85: true,
      trigger84: true,
    });

    await db.query(`INSERT INTO auth.users(id,email) VALUES
      ('71111111-1111-1111-1111-111111111111', 'rollback-pix@fixture.invalid');
      INSERT INTO public.marketplace_orders
        (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
         payment_method, metodo_online, payment_status, expires_at)
      VALUES ('72222222-2222-2222-2222-222222222222',
        '71111111-1111-1111-1111-111111111111', 'Fixture', '{}'::jsonb,
        10, 10, 'pending', 'online', 'online', 'pix', 'aguardando', now() + interval '30 minutes');`);

    await cenario(
      db,
      "PIX de balcão criado recusa, inclusive aguardando",
      async () => {
        await db.query(`UPDATE public.marketplace_orders SET canal = 'presencial'
        WHERE id = '72222222-2222-2222-2222-222222222222'`);
      },
      async () => {
        await assert.rejects(() => db.query(SQL), /ROLLBACK_PIX_RECUSADO/);
      },
    );
    assert.deepEqual(await estado(db), {
      v84: true,
      v85: true,
      rpc84: true,
      rpc85: true,
      trigger84: true,
    });

    await cenario(
      db,
      "anulação já usada recusa mesmo sem PIX QR",
      async () => {
        await db.query(`INSERT INTO public.marketplace_order_history
        (order_id, old_status, new_status, notes)
        VALUES ('72222222-2222-2222-2222-222222222222', 'delivered', 'cancelled',
          'Venda do balcão anulada: fixture')`);
      },
      async () => {
        await assert.rejects(() => db.query(SQL), /ROLLBACK_PIX_RECUSADO/);
      },
    );
    assert.deepEqual(await estado(db), {
      v84: true,
      v85: true,
      rpc84: true,
      rpc85: true,
      trigger84: true,
    });
    await cenario(
      db,
      "anulação financeira recusa mesmo sem histórico do pedido",
      async () => {
        await db.query(`INSERT INTO public.marketplace_order_payment_history
        (order_id, acao, payment_status_antes, payment_status_depois)
        VALUES ('72222222-2222-2222-2222-222222222222', 'desfeito',
          'recebido_na_entrega', 'estornado')`);
      },
      async () => {
        await assert.rejects(() => db.query(SQL), /ROLLBACK_PIX_RECUSADO/);
      },
    );
    assert.deepEqual(await estado(db), {
      v84: true,
      v85: true,
      rpc84: true,
      rpc85: true,
      trigger84: true,
    });
    await db.query("ROLLBACK");
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error("[rollback-pix] FALHOU:", e.message);
  process.exitCode = 1;
});
