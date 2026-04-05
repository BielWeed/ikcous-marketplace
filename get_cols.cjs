
const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query('SELECT * FROM public.produtos LIMIT 1');
        console.log('Columns in produtos:', Object.keys(res.rows[0]));
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
