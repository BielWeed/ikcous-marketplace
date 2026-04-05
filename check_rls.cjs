const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkRLS() {
    try {
        await client.connect();
        console.log('--- Status de RLS e Políticas ---');
        const res = await client.query(`
            SELECT 
                tablename, 
                rowsecurity,
                (SELECT count(*) FROM pg_policy WHERE tablename = pt.tablename) as policy_count
            FROM pg_tables pt
            WHERE schemaname = 'public'
            ORDER BY tablename
        `);

        res.rows.forEach(row => {
            console.log(`Tabela: ${row.tablename.padEnd(25)} | RLS: ${row.rowsecurity ? 'Ativo' : 'INATIVO'} | Políticas: ${row.policy_count}`);
        });

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
checkRLS();
