const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function findTableEverywhere() {
    try {
        await client.connect();

        console.log('--- Buscando Tabelas de Pedidos em TODAS as Schemas ---');
        const res = await client.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_name ILIKE '%order%'
            ORDER BY table_schema, table_name
        `);

        if (res.rows.length > 0) {
            console.log('TABELAS ENCONTRADAS:');
            res.rows.forEach(row => console.log(`Schema: ${row.table_schema} | Tabela: ${row.table_name}`));
        } else {
            console.log('Nenhuma tabela com "order" no nome encontrada em lugar nenhum.');
        }

    } catch (err) {
        console.error('Erro na busca global:', err.message);
    } finally {
        await client.end();
    }
}
findTableEverywhere();
