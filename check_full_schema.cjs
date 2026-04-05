const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'marketplace_orders'
            ORDER BY ordinal_position
        `);
        console.log('--- Columns and Nullability ---');
        res.rows.forEach(r => {
            console.log(`${r.column_name.padEnd(20)} | Nullable: ${r.is_nullable} | Default: ${r.column_default}`);
        });
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
