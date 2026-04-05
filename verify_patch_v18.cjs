const { Client } = require('pg');

async function verifyPatchV18() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('🚀 Iniciando Validação do Patch v18...\n');

        // 1. Verificar RPCs Críticas
        const rpcs = [
            'update_order_status_atomic',
            'upsert_store_config',
            'get_customer_intelligence',
            'get_inventory_health',
            'swap_banner_order',
            'get_coupon_stats'
        ];

        for (const rpcName of rpcs) {
            const res = await client.query(`
                SELECT prosrc FROM pg_proc p 
                JOIN pg_namespace n ON n.oid = p.pronamespace 
                WHERE n.nspname = 'public' AND proname = $1;
            `, [rpcName]);

            if (res.rows.length > 0) {
                const src = res.rows[0].prosrc;
                const isProtected = src.includes('public.is_admin()') || src.includes('is_admin()');
                console.log(`${isProtected ? '✅' : '❌'} RPC ${rpcName.padEnd(30)}: ${isProtected ? 'Protegida' : 'VULNERÁVEL'}`);
            } else {
                console.log(`⚠️ RPC ${rpcName} não encontrada.`);
            }
        }

        // 2. Verificar RLS em profiles
        console.log('\n--- Verificando RLS: profiles ---');
        const profilesRLS = await client.query(`
            SELECT policyname, qual 
            FROM pg_policies 
            WHERE tablename = 'profiles' AND cmd = 'SELECT';
        `);
        profilesRLS.rows.forEach(p => {
            const isSecure = p.qual && (p.qual.includes('is_admin') || p.qual.includes('auth.uid'));
            console.log(`${isSecure ? '✅' : '❌'} Política selecionada: ${p.policyname.padEnd(40)} | Condição: ${p.qual}`);
        });

        // 2.1 Verificar RLS em marketplace_orders
        console.log('\n--- Verificando RLS: marketplace_orders (UPDATE/BOLA) ---');
        const ordersRLS = await client.query(`
            SELECT policyname, qual, with_check 
            FROM pg_policies 
            WHERE tablename = 'marketplace_orders' AND cmd = 'UPDATE';
        `);
        ordersRLS.rows.forEach(p => {
            const isSecure = (p.qual || '').includes('is_admin') || (p.qual || '').includes('user_id');
            console.log(`${isSecure ? '✅' : '❌'} Política de Update: ${p.policyname.padEnd(40)} | Condição: ${p.qual}`);
        });

        // 3. Verificar RLS em answers
        console.log('\n--- Verificando RLS: answers ---');
        const answersRLS = await client.query(`
            SELECT policyname, with_check 
            FROM pg_policies 
            WHERE tablename = 'answers' AND cmd = 'INSERT';
        `);
        answersRLS.rows.forEach(p => {
            const isSecure = p.with_check && p.with_check.includes('is_admin');
            console.log(`${isSecure ? '✅' : '❌'} Política: ${p.policyname.padEnd(40)} | With Check: ${p.with_check}`);
        });

        // 4. Verificar Definição de update_order_status_atomic (BOLA Fix)
        console.log('\n--- Detalhes: update_order_status_atomic (BOLA) ---');
        const bolaRes = await client.query(`
            SELECT prosrc FROM pg_proc WHERE proname = 'update_order_status_atomic';
        `);
        if (bolaRes.rows.length > 0) {
            const src = bolaRes.rows[0].prosrc;
            // Procurar por partes da lógica para ser mais robusto
            const hasUserId = src.includes('v_user_id != v_caller_id') || src.includes('v_user_id != v_caller_id');
            const hasAdminCheck = src.includes('public.is_admin()') || src.includes('is_admin()');
            const hasBolaCheck = hasUserId && hasAdminCheck;

            console.log(`${hasBolaCheck ? '✅' : '❌'} Check de BOLA (Owner/Admin): ${hasBolaCheck ? 'Encontrado' : 'Ausente'}`);
            if (!hasBolaCheck) {
                console.log('--- DEBUG: Início do Source Code ---');
                console.log(src.substring(0, 500));
                console.log('--- DEBUG: Fim do Snippet ---');
            }
        }

    } catch (err) {
        console.error('❌ Erro na verificação:', err);
    } finally {
        await client.end();
        console.log('\n🏁 Verificação concluída.');
    }
}

verifyPatchV18();
