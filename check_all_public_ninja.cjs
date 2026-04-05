const { Client } = require('pg');
const fs = require('node:fs');

async function checkAllFunctions() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                p.proname, 
                pg_get_function_identity_arguments(p.oid) as args
            FROM pg_proc p 
            JOIN pg_namespace n ON n.oid = p.pronamespace 
            WHERE n.nspname = 'public'
            ORDER BY proname;
        `);
        
        let output = '--- ALL PUBLIC FUNCTIONS ---\n';
        res.rows.forEach(row => {
            output += `${row.proname}(${row.args})\n`;
        });
        output += '--- END ---';
        
        fs.writeFileSync('all_public_functions.txt', output);
        console.log('Results saved to all_public_functions.txt');
        
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkAllFunctions();
