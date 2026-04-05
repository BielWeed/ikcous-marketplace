const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function main() {
    try {
        await client.connect();

        console.log('--- Colunas da tabela store_config ---');
        const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'store_config'");
        console.log(res.rows.map(r => r.column_name));

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}

main();
