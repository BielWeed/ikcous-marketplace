const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function checkConstraint() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('=== DEFINIÇÃO DE CONSTRAINT DE ROLE ===');
        const res = await client.query(`
            SELECT pg_get_constraintdef(oid) AS constraint_def
            FROM pg_constraint
            WHERE conname = 'profiles_role_check';
        `);
        if (res.rows.length > 0) {
            console.log(res.rows[0].constraint_def);
        } else {
            console.log('Constraint profiles_role_check não encontrada.');
        }

        console.log('\n=== LISTA DE TODAS AS CONSTRAINTS EM profiles ===');
        const allRes = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) AS constraint_def
            FROM pg_constraint
            WHERE conrelid = 'profiles'::regclass;
        `);
        for (const row of allRes.rows) {
            console.log(`Constraint: ${row.conname} | Def: ${row.constraint_def}`);
        }
        
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}

checkConstraint();
