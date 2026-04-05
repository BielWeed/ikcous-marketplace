const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DB_CONFIG = {
    host: process.env.SUPABASE_DB_HOST || 'db.cafkrminfnokvgjqtkle.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
};

async function check() {
    const client = new Client(DB_CONFIG);
    try {
        await client.connect();
        const res = await client.query('SELECT filename FROM _ninja_migrations ORDER BY id DESC LIMIT 10');
        console.log(res.rows.map(r => r.filename));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

check();
