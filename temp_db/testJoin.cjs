const { Client } = require('pg');
const client = new Client('postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres');
async function test() {
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE conrelid = 'public.product_variants'::regclass;
    `);
    console.log('Result:', JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
  await client.end();
}
test();
