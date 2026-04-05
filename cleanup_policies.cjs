const { Client } = require('pg');

async function cleanupPolicies() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- Limpeza Profunda de Políticas RLS ---');

        const tables = ['marketplace_orders', 'coupons'];

        for (const table of tables) {
            const res = await client.query(`
                SELECT policyname 
                FROM pg_policies 
                WHERE schemaname = 'public' AND tablename = $1
            `, [table]);

            console.log(`Limpando tabela: ${table} (${res.rows.length} políticas encontradas)`);

            for (const row of res.rows) {
                console.log(`Removendo política: ${row.policyname}`);
                await client.query(`DROP POLICY IF EXISTS "${row.policyname}" ON ${table}`);
            }
        }

        console.log('✅ Limpeza concluída.');

    } catch (err) {
        console.error('❌ Erro na limpeza:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

cleanupPolicies();
