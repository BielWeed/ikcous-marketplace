const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const fs = require('node:fs');

async function run() {
    let output = '';
    const log = (msg) => { output += msg + '\n'; };

    try {
        await client.connect();

        log('--- marketplace_orders columns ---');
        const colsRes = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'marketplace_orders' AND table_schema = 'public'");
        colsRes.rows.forEach(r => log(`${r.column_name} (${r.data_type})`));

        log('\n--- create_marketplace_order_v21 definition ---');
        const funcRes = await client.query("SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v21'");
        log(funcRes.rows[0]?.def || 'NOT FOUND');

        fs.writeFileSync('inspection_results.txt', output);
        console.log('Results saved to inspection_results.txt');

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
run();
