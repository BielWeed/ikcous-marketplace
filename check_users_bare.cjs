const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT id FROM users LIMIT 1");
        console.log('ID_IN_USERS_BARE:', res.rows[0].id);
    } catch (err) {
        console.error('Error in users (bare):', err.message);
    } finally {
        await client.end();
    }
}
check();
