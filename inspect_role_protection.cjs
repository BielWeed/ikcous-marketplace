const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function inspectTriggers() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('=== DEFINIÇÕES DE FUNÇÕES DE CONTROLE DE ACESSO ===');
        const funcRes = await client.query(`
            SELECT proname, prosrc 
            FROM pg_proc 
            WHERE proname IN ('ensure_role_protection', 'prevent_role_change', 'is_admin', 'check_is_admin');
        `);
        
        for (const row of funcRes.rows) {
            console.log(`\n--- Função: ${row.proname} ---`);
            console.log(row.prosrc);
        }

        console.log('\n=== ESTADO DOS TRIGGERS NA TABELA profiles ===');
        const trigRes = await client.query(`
            SELECT tgname, tgenabled
            FROM pg_trigger
            WHERE tgrelid = 'profiles'::regclass;
        `);
        for (const row of trigRes.rows) {
            console.log(`Trigger: ${row.tgname} | Enabled: ${row.tgenabled}`);
        }
        
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}

inspectTriggers();
