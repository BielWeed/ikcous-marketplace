const { Client } = require('pg');

async function checkTables() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('produtos', 'product_variants')
        `);
        console.log('Tables found:', res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await client.end();
    }
}
checkTables();
