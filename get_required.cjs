const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'marketplace_orders' AND is_nullable = 'NO' AND column_default IS NULL
        `);
        console.log('REQUIRED_COLUMNS_NO_DEFAULT:', res.rows.map(r => r.column_name));

        const res2 = await client.query(`
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'marketplace_orders' AND is_nullable = 'NO'
        `);
        console.log('ALL_NOT_NULL_COLUMNS:', res2.rows.map(r => `${r.column_name} (default: ${r.column_default})`));

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
