const { Client } = require('pg');

async function checkTable() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- Table: profiles ---');
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'profiles'
            ORDER BY ordinal_position;
        `);
        res.rows.forEach(row => console.log(`${row.column_name}: ${row.data_type}`));

        console.log('\n--- RLS Policies ---');
        const policies = await client.query(`
            SELECT policyname, cmd, qual, with_check
            FROM pg_policies
            WHERE tablename = 'profiles';
        `);
        policies.rows.forEach(row => {
            console.log(`Policy: ${row.policyname} [${row.cmd}]`);
            console.log(`Qual: ${row.qual}`);
            console.log('---');
        });

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkTable();
