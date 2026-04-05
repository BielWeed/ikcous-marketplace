const { Client } = require('pg');

async function getConstraint() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT pg_get_constraintdef(oid) as def 
            FROM pg_constraint 
            WHERE conname = 'marketplace_orders_status_check';
        `);
        console.log('Constraint definition:', res.rows[0]?.def);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

getConstraint();
