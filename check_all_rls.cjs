const { Client } = require('pg');
const fs = require('node:fs');

async function checkRLS() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT tablename, policyname, roles, cmd, qual, with_check 
            FROM pg_policies 
            WHERE schemaname = 'public';
        `);
        fs.writeFileSync('all_rls_policies.json', JSON.stringify(res.rows, null, 2));
        console.log('Saved to all_rls_policies.json');
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkRLS();
