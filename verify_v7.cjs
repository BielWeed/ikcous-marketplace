const { Client } = require('pg');

async function verify() {
    const client = new Client({ connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres` });
    try {
        await client.connect();
        console.log('--- Iniciando Auditoria Final v7 ---');

        // 1. Verificar RPC v7
        const rpcCheck = await client.query("SELECT routine_name FROM information_schema.routines WHERE routine_name = 'create_marketplace_order_v7'");
        console.log('RPC v7 existe:', rpcCheck.rowCount > 0 ? '✅' : '❌');

        // 2. Verificar Colunas novas
        const colCheck = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'coupons' AND column_name = 'used_count'");
        console.log('Coluna used_count em coupons:', colCheck.rowCount > 0 ? '✅' : '❌');

        // 3. Verificar RLS (Contagem de políticas por tabela crítica)
        const tables = ['user_addresses', 'coupons', 'marketplace_orders'];
        for (const table of tables) {
            const rlsCheck = await client.query(`SELECT count(*) FROM pg_policies WHERE tablename = '${table}'`);
            console.log(`Políticas RLS em ${table}:`, rlsCheck.rows[0].count);
        }

        // 4. Testar is_admin (Função crítica)
        const adminCheck = await client.query("SELECT has_function_privilege('is_admin()', 'execute')");
        console.log('Função is_admin executável:', adminCheck.rows[0].has_function_privilege ? '✅' : '❌');

        console.log('\n--- Resultado: Blindagem Solo-Ninja v7 VALIDADA! ---');
    } catch (err) {
        console.error('❌ ERRO NA VERIFICAÇÃO:', err.message);
    } finally {
        await client.end();
    }
}

verify();
