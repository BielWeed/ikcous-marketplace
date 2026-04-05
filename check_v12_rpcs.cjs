const { Client } = require('pg');

async function checkRpcs() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- Verificando RPCs de Segurança ---');

        const res = await client.query(`
            SELECT proname, proargnames 
            FROM pg_proc 
            WHERE proname LIKE 'create_marketplace_order%' 
               OR proname LIKE 'validate_coupon_secure%'
               OR proname = 'is_admin'
            ORDER BY proname;
        `);

        console.table(res.rows);

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkRpcs();
