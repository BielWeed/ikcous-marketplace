const { Client } = require('pg');

async function checkRpcs() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- Database Functions ---');

        const res = await client.query(`
            SELECT proname, proargnames, prosrc
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND proname LIKE '%profile%'
            ORDER BY proname;
        `);

        res.rows.forEach(row => {
            console.log(`Function: ${row.proname}`);
            console.log(`Args: ${row.proargnames}`);
            console.log('---');
        });

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkRpcs();
