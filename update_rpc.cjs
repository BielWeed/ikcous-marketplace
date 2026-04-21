const { Client } = require('pg');
const fs = require('fs');

const connectionString = 'postgresql://postgres:IsaBiel%40hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

const client = new Client({
  connectionString
});

async function run() {
  try {
    await client.connect();
    const sql = fs.readFileSync('create_marketplace_order_v22_def.sql', 'utf8');
    await client.query(sql);
    console.log('RPC updated successfully!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
