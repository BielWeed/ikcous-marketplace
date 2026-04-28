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
      SELECT proname, prosrc 
      FROM pg_proc 
      WHERE proname IN ('is_admin', 'check_is_admin', 'admin_check', 'auth_admin_check');
    `);
    console.log("FUNCTIONS:");
    console.table(res.rows);

  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}

check();
