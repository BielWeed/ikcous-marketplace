const { Client } = require('pg');

async function verify() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                p.proname, 
                pg_get_function_identity_arguments(p.oid) as args,
                format_type(p.prorettype, NULL) as return_type
            FROM pg_proc p 
            JOIN pg_namespace n ON n.oid = p.pronamespace 
            WHERE n.nspname = 'public' 
              AND p.proname LIKE 'create_marketplace_order_v%'
            ORDER BY proname;
        `);
        
        console.log('Functions found:');
        res.rows.forEach(row => {
            console.log(`- ${row.proname}(${row.args}) -> ${row.return_type}`);
        });
        
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

verify();
