const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  // Parsing manually since there's @ in password
  const urlParams = new URL(process.env.DATABASE_URL.replace('IsaBiel@hgfwq1@', 'IsaBiel%40hgfwq1@'));
  
  const client = new Client({
    connectionString: urlParams.href,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    await client.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_url TEXT;`);
    console.log('Column image_url added successfully to product_variants');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
