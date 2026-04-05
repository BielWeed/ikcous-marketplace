const { Client } = require('pg');
const fs = require('node:fs');

async function checkRLS() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT relname, relrowsecurity 
            FROM pg_class 
            WHERE relnamespace = 'public'::regnamespace 
            AND relkind = 'r'
            ORDER BY relname;
        `);
        fs.writeFileSync('rls_enabled.json', JSON.stringify(res.rows, null, 2));
        console.log('Saved to rls_enabled.json');
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkRLS();
