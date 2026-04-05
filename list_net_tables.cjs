const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function listNetTables() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'net'
        `);
        console.log('Tables in net schema:', JSON.stringify(res.rows));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
listNetTables();
