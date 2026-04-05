const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function fullNetInspection() {
    try {
        await client.connect();

        console.log('--- Listando TODAS as colunas da schema "net" ---');
        const res = await client.query(`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'net'
            ORDER BY table_name, ordinal_position
        `);

        res.rows.forEach(row => {
            console.log(`Tabela: ${row.table_name} | Coluna: ${row.column_name} (${row.data_type})`);
        });

    } catch (err) {
        console.error('Erro na inspeção total:', err.message);
    } finally {
        await client.end();
    }
}
fullNetInspection();
