const { Client } = require('pg');
const fs = require('node:fs');

async function checkRpcs() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT proname, proargnames, prosrc
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            ORDER BY proname;
        `);

        let output = '';
        res.rows.forEach(row => {
            output += `F: ${row.proname} | Args: ${row.proargnames || '[]'}\n`;
        });
        fs.writeFileSync('db_funcs.txt', output);
        console.log('Done writing db_funcs.txt');

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkRpcs();
