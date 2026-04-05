const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function inspectStoreConfig() {
    try {
        await client.connect();

        console.log('--- Inspecionando colunas de public.store_config ---');
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'store_config'
        `);

        res.rows.forEach(row => {
            console.log(`Coluna: ${row.column_name} (${row.data_type})`);
        });

    } catch (err) {
        console.error('Erro na inspeção:', err.message);
    } finally {
        await client.end();
    }
}
inspectStoreConfig();
