const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function findOrderTables() {
    try {
        await client.connect();
        console.log('--- Buscando tabelas relacionadas a "order" ---');
        const res = await client.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_name ILIKE '%order%'
            ORDER BY table_schema, table_name
        `);

        if (res.rows.length === 0) {
            console.log('Nenhuma tabela encontrada com "order" no nome.');
            
            console.log('\n--- Listando TODAS as tabelas do schema public ---');
            const allRes = await client.query(`
                SELECT table_name FROM information_schema.tables 
                WHERE table_schema = 'public'
            `);
            allRes.rows.forEach(r => console.log(`- ${r.table_name}`));
        } else {
            res.rows.forEach(row => {
                console.log(`Schema: ${row.table_schema} | Tabela: ${row.table_name}`);
            });
        }

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
findOrderTables();
