const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function checkPermissive() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('=== POLICIES PERMISSIVAS (QUAL = true OU ROLES = public) ===');
        const res = await client.query(`
            SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check 
            FROM pg_policies 
            WHERE schemaname = 'public'
            AND (qual = 'true' OR roles = '{public}')
            ORDER BY tablename, policyname;
        `);
        res.rows.forEach(r => {
            console.log(`Table: ${r.tablename} | Policy: ${r.policyname} | CMD: ${r.cmd}`);
            console.log(`  Roles: ${r.roles}`);
            console.log(`  Qual (USING): ${r.qual}`);
            console.log(`  With Check: ${r.with_check}`);
            console.log('----------------------------------------------------');
        });
        
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}

checkPermissive();
