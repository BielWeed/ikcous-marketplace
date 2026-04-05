const { Client } = require('pg');

async function checkColumns() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'marketplace_orders' AND table_schema = 'public';
        `);
        console.log(res.rows.map(r => r.column_name).join(', '));
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkColumns();
