const { Client } = require('pg');
require('dotenv').config();

async function check() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("No db url");
    return;
  }
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'product_variants'
    `);
    console.log("COLUMNS:");
    console.table(res.rows);

    const pol = await client.query(`
      SELECT * FROM pg_policies WHERE tablename = 'product_variants'
    `);
    console.log("POLICIES:");
    console.table(pol.rows);

  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}

check();
