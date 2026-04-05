const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function deepTableAudit() {
    try {
        await client.connect();

        console.log('--- Auditoria Profunda de Tabelas de Pedidos ---');
        const res = await client.query(`
            SELECT table_schema, table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name ILIKE '%order%' 
              AND table_schema NOT IN ('information_schema', 'pg_catalog')
            ORDER BY table_schema, table_name, ordinal_position
        `);

        let currentTable = '';
        res.rows.forEach(row => {
            if (currentTable !== `${row.table_schema}.${row.table_name}`) {
                console.log(`\nTABELA: ${row.table_schema}.${row.table_name}`);
                currentTable = `${row.table_schema}.${row.table_name}`;
            }
            console.log(` - ${row.column_name} (${row.data_type})`);
        });

    } catch (err) {
        console.error('Erro na auditoria:', err.message);
    } finally {
        await client.end();
    }
}
deepTableAudit();
