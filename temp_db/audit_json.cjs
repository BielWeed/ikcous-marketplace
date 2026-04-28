const { Client } = require('pg');
const fs = require('fs');

const client = new Client('postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres');

async function analyzeDatabase() {
  await client.connect();
  const report = {};

  try {
    report.tables = (await client.query(`
      SELECT relname AS table_name, n_live_tup AS row_count
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC;
    `)).rows;

    report.missing_fk_indexes = (await Milliseconds_query(`
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
    `)).rows;

    report.unused_indexes = (await client.query(`
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
    `)).rows;

    report.duplicate_indexes = (await client.query(`
      SELECT
        indrelid::regclass AS table_name,
        array_agg(indexrelid::regclass) AS indexes
      FROM pg_index
      GROUP BY indrelid, indkey, indclass
      HAVING COUNT(*) > 1;
    `)).rows;

    report.custom_triggers = (await client.query(`
      SELECT
        event_object_table AS table_name,
        trigger_name,
        event_manipulation AS event,
        action_statement
      FROM information_schema.triggers
      WHERE trigger_schema = 'public';
    `)).rows;

  } catch (err) {
    report.error = err.message;
  } finally {
    await client.end();
    fs.writeFileSync('temp_db/audit.json', JSON.stringify(report, null, 2), 'utf-8');
  }
}

async function Milliseconds_query(sql) {
    return await client.query(sql);
}

analyzeDatabase();
