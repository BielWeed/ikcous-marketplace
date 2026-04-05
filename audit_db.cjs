require('dotenv').config();
const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function audit() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name IN ('store_config', 'marketplace_orders')
            ORDER BY table_name, column_name;
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error('Erro na auditoria:', e.message);
    } finally {
        await client.end();
    }
}
audit();
