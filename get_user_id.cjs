const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function getUserId() {
    try {
        await client.connect();
        const res = await client.query("SELECT id FROM profiles LIMIT 1");
        if (res.rows.length > 0) {
            console.log('USER_ID:', res.rows[0].id);
        } else {
            console.log('Nenhum perfil encontrado.');
        }
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
getUserId();
