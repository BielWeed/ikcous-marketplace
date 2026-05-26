const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function checkOrdersPolicies() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('=== POLICIES NA TABELA marketplace_orders ===');
        const res = await client.query(`
            SELECT policyname, cmd, roles, qual, with_check 
            FROM pg_policies 
            WHERE tablename = 'marketplace_orders'
            AND schemaname = 'public'
            ORDER BY policyname;
        `);
        res.rows.forEach(r => {
            console.log(`Policy: ${r.policyname} | CMD: ${r.cmd}`);
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

checkOrdersPolicies();
