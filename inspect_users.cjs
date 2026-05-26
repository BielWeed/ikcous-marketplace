const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function inspectUsers() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('=== COLUNAS DE auth.users ===');
        const colsRes = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'users' 
            AND table_schema = 'auth';
        `);
        colsRes.rows.forEach(r => {
            console.log(`${r.column_name} (${r.data_type}) | Nullable: ${r.is_nullable}`);
        });

        console.log('\n=== PRIMEIROS 3 PROFILES EXISTENTES ===');
        const profRes = await client.query(`
            SELECT id, role, full_name 
            FROM public.profiles 
            LIMIT 3;
        `);
        profRes.rows.forEach(r => {
            console.log(`ID: ${r.id} | Role: ${r.role} | Name: ${r.full_name}`);
        });
        
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}

inspectUsers();
