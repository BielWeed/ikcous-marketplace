const { Client } = require('pg');
const fs = require('node:fs');

async function checkRpcs() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT proname, proargnames 
            FROM pg_proc 
            WHERE proname LIKE 'create_marketplace_order%' 
               OR proname LIKE 'validate_coupon_secure%'
               OR proname = 'is_admin'
            ORDER BY proname;
        `);

        fs.writeFileSync('db_check.json', JSON.stringify(res.rows, null, 2));
        console.log('✅ Verificação completa. Dados salvos em db_check.json');

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkRpcs();
