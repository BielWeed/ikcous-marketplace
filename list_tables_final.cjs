const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function listAllPublicTables() {
    try {
        await client.connect();

        console.log('--- Listando TODAS as tabelas na schema public ---');
        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        res.rows.forEach(row => {
            console.log(`Tabela: ${row.table_name}`);
        });

    } catch (err) {
        console.error('Erro na listagem:', err.message);
    } finally {
        await client.end();
    }
}
listAllPublicTables();
