const { Client } = require('pg');

async function verifySecurity() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        console.log('--- Verificando RPC create_marketplace_order_v2 ---');
        const rpcRes = await client.query(`
            SELECT 
                p.proname as function_name,
                pg_get_functiondef(p.oid) as definition
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v2';
        `);

        if (rpcRes.rows.length > 0) {
            const def = rpcRes.rows[0].definition;
            if (def.includes('auth.uid()') && def.includes('is_admin')) {
                console.log('✅ RPC create_marketplace_order_v2 está REALMENTE blindado com auth.uid().');
            } else {
                console.log('❌ RPC create_marketplace_order_v2 NÃO parece estar blindado corretamente.');
                console.log('Definição encontrada:', def);
            }
        } else {
            console.log('❌ RPC create_marketplace_order_v2 não encontrado.');
        }

        console.log('\n--- Verificando Políticas RLS Suspeitas (Enable all access...) ---');
        const policyRes = await client.query(`
            SELECT tablename, policyname, roles
            FROM pg_policies 
            WHERE policyname ILIKE '%Enable all access%';
        `);

        if (policyRes.rows.length === 0) {
            console.log('✅ Nenhuma política de acesso total ("Enable all access") encontrada. Purga concluída com sucesso.');
        } else {
            console.log('⚠️ Atenção! Ainda existem políticas permissivas:');
            console.table(policyRes.rows);
        }

        console.log('\n--- Verificando Novas Políticas Estritas ---');
        const activePolicies = await client.query(`
            SELECT tablename, policyname, cmd, roles
            FROM pg_policies 
            WHERE tablename IN ('marketplace_orders', 'marketplace_order_items', 'user_addresses', 'coupons')
            ORDER BY tablename, policyname;
        `);
        console.table(activePolicies.rows);

    } catch (err) {
        console.error('Erro na verificação:', err);
    } finally {
        await client.end();
    }
}

verifySecurity();
