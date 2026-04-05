const { Client } = require('pg');

async function checkViews() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.views 
            WHERE table_schema = 'public' AND table_name = 'vw_produtos_public';
        `);
        console.log('Views found:', res.rows);
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkViews();
