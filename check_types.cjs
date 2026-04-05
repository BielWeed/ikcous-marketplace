
const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('--- Column Type Check ---');
        const tables = ['store_config', 'banners', 'produtos', 'categorias', 'profiles'];
        for (const table of tables) {
            const res = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = '${table}'
                ORDER BY column_name
            `);
            console.log(`Table '${table}':`);
            res.rows.forEach(r => console.log(`  - ${r.column_name}: ${r.data_type}`));
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
