const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT column_name, data_type, udt_name 
            FROM information_schema.columns 
            WHERE table_name = 'marketplace_orders' AND column_name = 'payment_method'
        `);
        console.log('COLUMN_TYPE:', JSON.stringify(res.rows, null, 2));

        const constraints = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) 
            FROM pg_constraint 
            WHERE conname = 'check_payment_method'
        `);
        console.log('CONSTRAINT_DEF:', JSON.stringify(constraints.rows, null, 2));

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
check();
