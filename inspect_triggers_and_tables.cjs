const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function main() {
    try {
        await client.connect();

        console.log('--- Verificando Triggers em marketplace_orders ---');
        const res = await client.query(`
            SELECT tgname, tgenabled, relname 
            FROM pg_trigger t
            JOIN pg_class c ON t.tgrelid = c.oid
            WHERE c.relname = 'marketplace_orders'
        `);
        console.log(res.rows);

        console.log('\n--- Verificando todas as tabelas no schema public ---');
        const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log(tables.rows.map(r => r.table_name));

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}

main();
