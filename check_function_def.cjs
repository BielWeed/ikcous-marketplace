const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkFunction() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT pg_get_functiondef(p.oid) as definition
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'handle_new_order_whatsapp'
        `);
        if (res.rows.length > 0) {
            console.log('Function Definition:');
            console.log(res.rows[0].definition);
        } else {
            console.log('❌ Função handle_new_order_whatsapp não encontrada.');
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
checkFunction();
