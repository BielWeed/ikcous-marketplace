const { Client } = require('pg');
const fs = require('node:fs');

async function auditRPCs() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                p.proname,
                p.prosecdef as is_security_definer,
                pg_get_functiondef(p.oid) as definition
            FROM pg_proc p 
            JOIN pg_namespace n ON n.oid = p.pronamespace 
            WHERE n.nspname = 'public'
            ORDER BY p.proname;
        `);
        
        fs.writeFileSync('rpc_audit_results.json', JSON.stringify(res.rows, null, 2));
        console.log(`Audit results saved to rpc_audit_results.json (${res.rows.length} functions found)`);
    } catch (err) {
        console.error('Error during audit:', err);
    } finally {
        await client.end();
    }
}

auditRPCs();
