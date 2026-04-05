const { Client } = require('pg');
const fs = require('node:fs');

async function checkPolicies() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT policyname, roles, cmd, qual, with_check 
            FROM pg_policies 
            WHERE tablename = 'marketplace_orders';
        `);
        fs.writeFileSync('policies.json', JSON.stringify(res.rows, null, 2));
        console.log('Saved policies.json');
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

checkPolicies();
