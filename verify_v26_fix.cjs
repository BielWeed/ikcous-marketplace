const { Client } = require('pg');

async function verifyGrants() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'IsaBiel@hgfwq1')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        
        console.log('--- Verificando Permissões (Grants) ---');
        const res = await client.query(`
            SELECT table_name, grantee, privilege_type 
            FROM information_schema.role_table_grants 
            WHERE table_name = 'produtos' AND table_schema = 'public'
            AND grantee IN ('authenticated', 'anon');
        `);
        
        console.table(res.rows);

        console.log('\n--- Verificando Políticas de RLS ---');
        const rlsRes = await client.query(`
            SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
            FROM pg_policies
            WHERE tablename = 'produtos';
        `);
        console.table(rlsRes.rows);

    } catch (err) {
        console.error('Erro na verificação:', err);
    } finally {
        await client.end();
    }
}

verifyGrants();
