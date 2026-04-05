const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function findOrderTable() {
    try {
        await client.connect();

        console.log('--- Buscando Tabela de Pedidos ---');
        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name ILIKE '%order%'
        `);

        if (res.rows.length > 0) {
            console.log('TABELAS ENCONTRADAS:');
            res.rows.forEach(row => console.log(`- ${row.table_name}`));
        } else {
            console.log('Nenhuma tabela com "order" no nome encontrada.');
        }

    } catch (err) {
        console.error('Erro na busca:', err.message);
    } finally {
        await client.end();
    }
}
findOrderTable();
