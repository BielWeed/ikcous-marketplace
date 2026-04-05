const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';
const client = new Client({ connectionString });

async function check() {
  try {
    await client.connect();
    console.log('--- Database Check ---');
    
    // Check Products
    const productsRes = await client.query('SELECT count(*) FROM public.produtos');
    console.log(`Total Products: ${productsRes.rows[0].count}`);
    
    // Check Active Products
    const activeProductsRes = await client.query('SELECT count(*) FROM public.produtos WHERE ativo = true AND deleted_at IS NULL');
    console.log(`Active Products (viewable by public): ${activeProductsRes.rows[0].count}`);
    
    // Check Orders
    const ordersRes = await client.query('SELECT count(*) FROM public.marketplace_orders');
    console.log(`Total Orders: ${ordersRes.rows[0].count}`);
    
    // Check Config
    const configRes = await client.query('SELECT count(*) FROM public.store_config');
    console.log(`Store Config Entries: ${configRes.rows[0].count}`);

    // Check if any product has missing fields that might cause mapping errors
    const sampleProduct = await client.query('SELECT * FROM public.produtos LIMIT 1');
    console.log('Sample Product (columns):', Object.keys(sampleProduct.rows[0] || {}).join(', '));
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

check();
