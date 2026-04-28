const { Client } = require('pg');
const client = new Client('postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres');
async function test() {
  await client.connect();
  const { rows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'product_variants'");
  console.log('Columns:', rows);
  await client.end();
}
test();
