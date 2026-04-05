const { Client } = require('pg');

async function checkCols() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query(`
            SELECT column_name, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'produtos'
        `);
        console.log(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await client.end();
    }
}
checkCols();
