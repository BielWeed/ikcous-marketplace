const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyFix() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260322_fix_rpc_and_trigger.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Applying RPC and Trigger fix...');
        await client.query(sql);
        console.log('Fix applied successfully!');
    } catch (err) {
        console.error('Erro ao aplicar correção:', err);
    } finally {
        await client.end();
    }
}

applyFix();
