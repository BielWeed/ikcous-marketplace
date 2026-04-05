const { Client } = require('pg');

async function checkRpcs() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT proname, proargnames, proargmodes, proallargtypes, prosrc
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND proname = 'get_my_complete_profile';
        `);

        res.rows.forEach(row => {
            console.log(`Function: ${row.proname}`);
            console.log(`Arg Names: ${row.proargnames}`);
            console.log(`Arg Modes: ${row.proargmodes}`);
            console.log('--- Source ---');
            console.log(row.prosrc);
        });

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkRpcs();
