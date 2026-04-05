const { Client } = require('pg');
const fs = require('node:fs');

async function verifyDeep() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    let report = 'SECURITY VERIFICATION REPORT\n';
    report += '============================\n\n';

    try {
        await client.connect();

        const funcs = [
            'upsert_store_config',
            'update_order_status_atomic',
            'get_customer_intelligence',
            'get_inventory_health',
            'get_coupon_stats',
            'swap_banner_order',
            'get_retention_analytics',
            'get_retention_rate',
            'get_admin_customers_paged',
            'create_marketplace_order_v15'
        ];

        report += '--- Proteção is_admin() em RPCs ---\n';
        for (const func of funcs) {
            const res = await client.query(`
                SELECT prosrc, proname 
                FROM pg_proc p 
                JOIN pg_namespace n ON n.oid = p.pronamespace 
                WHERE n.nspname = 'public' AND proname = $1;
            `, [func]);

            if (res.rows.length === 0) {
                report += `RPC ${func}: NÃO ENCONTRADA!\n`;
                continue;
            }

            const src = res.rows[0].prosrc;
            const isProtected = src.includes('is_admin()');
            report += `RPC ${func}: ${isProtected ? '[OK] Protegida' : '[FALHA] NÃO PROTEGIDA'}\n`;

            if (func === 'create_marketplace_order_v15') {
                const recalculatesTotal = src.includes('total_amount :=') || src.includes('total :=') || src.includes('SUM(');
                report += `   -> Recálculo de Total: ${recalculatesTotal ? '[SÌM]' : '[NÃO - POSSÍVEL VULNERABILIDADE]'}\n`;
            }
        }

        report += '\n--- RLS em tabelas críticas ---\n';
        const tables = ['marketplace_order_history', 'notificacoes', 'marketplace_orders'];
        for (const table of tables) {
            const res = await client.query(`
                SELECT relrowsecurity 
                FROM pg_class c 
                JOIN pg_namespace n ON n.oid = c.relnamespace 
                WHERE n.nspname = 'public' AND relname = $1;
            `, [table]);
            report += `Tabela ${table}: RLS ${res.rows[0].relrowsecurity ? 'Ativo' : 'Inativo'}\n`;
        }

        fs.writeFileSync('verification_report.txt', report);
        console.log('Report saved to verification_report.txt');

    } catch (err) {
        fs.writeFileSync('verification_report.txt', 'ERROR: ' + err.message);
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

verifyDeep();
