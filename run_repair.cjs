
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const connectionString = 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        console.log('--- Executing Final Repair SQL ---');
        
        const sql = fs.readFileSync(path.join(__dirname, 'final_repair.sql'), 'utf8');
        await client.query(sql);
        console.log('SQL executed successfully.');

        // Final verification
        const prod = await client.query('SELECT count(*) FROM produtos');
        const cat = await client.query('SELECT count(*) FROM categorias');
        const banner = await client.query('SELECT count(*) FROM banners');
        const config = await client.query('SELECT count(*) FROM store_config');
        
        console.log('Final Database State:');
        console.log(`- Produtos: ${prod.rows[0].count}`);
        console.log(`- Categorias: ${cat.rows[0].count}`);
        console.log(`- Banners: ${banner.rows[0].count}`);
        console.log(`- Store Config: ${config.rows[0].count}`);

    } catch (err) {
        console.error('CRITICAL ERROR during repair:', err);
    } finally {
        await client.end();
    }
}

run();
