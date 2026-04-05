const { Client } = require('pg');
const fs = require('node:fs');

async function checkSignatures() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                n.nspname as schema,
                p.proname, 
                pg_get_function_identity_arguments(p.oid) as args
            FROM pg_proc p 
            JOIN pg_namespace n ON n.oid = p.pronamespace 
            WHERE p.proname LIKE 'create_marketplace_order_v%'
            ORDER BY schema, proname;
        `);
        
        let output = '--- ALL FUNCTIONS FOUND ---\n';
        res.rows.forEach(row => {
            output += `${row.schema}.${row.proname}(${row.args})\n`;
        });
        output += '--- END ---';
        
        fs.writeFileSync('signatures_final.txt', output);
        console.log('Results saved to signatures_final.txt');
        
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkSignatures();
