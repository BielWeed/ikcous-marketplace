const { Client } = require('pg');

const client = new Client('postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres');

async function analyzeDatabase() {
  await client.connect();

  console.log("=== SUPABASE DATABASE HEALTH & OPTIMIZATION AUDIT ===\n");

  try {
    // 1. Check all tables and row counts
    console.log("--- 1. Tables and Row Counts ---");
    const tablesRes = await client.query(`
      SELECT relname AS table_name, n_live_tup AS row_count
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC;
    `);
    console.table(tablesRes.rows);

    // 2. Missing Indexes on Foreign Keys (Crucial for performance and cascading deletes)
    console.log("\n--- 2. Missing Indexes on Foreign Keys ---");
    const missingFkIdxRes = await client.query(`
      SELECT
        c.conrelid::regclass AS table_name,
        c.conname AS constraint_name,
        a.attname AS column_name
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND i.indkey[0] = a.attnum
        );
    `);
    if (missingFkIdxRes.rows.length === 0) {
      console.log("✅ All foreign keys have indexes.");
    } else {
      console.table(missingFkIdxRes.rows);
    }

    // 3. Unused or rarely used indexes (wastes disk space and slows down INSERT/UPDATE)
    console.log("\n--- 3. Unused Indexes ---");
    const unusedIdxRes = await client.query(`
      SELECT
        schemaname,
        relname AS table_name,
        indexrelname AS index_name,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
        AND indexrelname NOT LIKE '%_pkey'
        AND indexrelname NOT LIKE '%_key'
      ORDER BY idx_scan ASC, relname;
    `);
    if (unusedIdxRes.rows.length === 0) {
      console.log("✅ No completely unused non-primary/unique indexes found.");
    } else {
      console.table(unusedIdxRes.rows);
    }

    // 4. Duplicate Indexes
    console.log("\n--- 4. Duplicate Indexes ---");
    const dupIdxRes = await client.query(`
      SELECT
        indrelid::regclass AS table_name,
        array_agg(indexrelid::regclass) AS indexes
      FROM pg_index
      GROUP BY indrelid, indkey, indclass
      HAVING COUNT(*) > 1;
    `);
    if (dupIdxRes.rows.length === 0) {
      console.log("✅ No duplicate indexes found.");
    } else {
      console.table(dupIdxRes.rows);
    }

    // 5. Triggers analysis
    console.log("\n--- 5. Custom Triggers ---");
    const triggersRes = await client.query(`
      SELECT
        event_object_table AS table_name,
        trigger_name,
        event_manipulation AS event,
        action_statement
      FROM information_schema.triggers
      WHERE trigger_schema = 'public';
    `);
    if (triggersRes.rows.length === 0) {
      console.log("No custom triggers found in public schema.");
    } else {
      console.table(triggersRes.rows);
    }

    // 6. Security/RLS Policies
    console.log("\n--- 6. Row Level Security (RLS) Policies ---");
    const rlsRes = await client.query(`
      SELECT
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
      FROM pg_policies
      WHERE schemaname = 'public';
    `);
    if (rlsRes.rows.length === 0) {
      console.log("⚠️ WARNING: No RLS policies found in public tables.");
    } else {
      console.table(rlsRes.rows);
    }

  } catch (err) {
    console.error("Error running audit queries:", err);
  } finally {
    await client.end();
  }
}

analyzeDatabase();
