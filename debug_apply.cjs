const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function debugApply() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    let log = '';

    function logMsg(msg) {
        console.log(msg);
        log += msg + '\n';
    }

    try {
        await client.connect();
        logMsg('--- Depuração de Aplicação SQL ---');

        const sqlArr = [
            `DROP POLICY IF EXISTS "Users can view own orders" ON marketplace_orders`,
            `DROP POLICY IF EXISTS "Admins full access on orders" ON marketplace_orders`,
            `CREATE POLICY "Users can view own orders" ON marketplace_orders FOR SELECT USING (auth.uid() = user_id)`,
            `CREATE POLICY "Admins full access on orders" ON marketplace_orders FOR ALL USING (is_admin())`,
            `ALTER TABLE marketplace_orders ENABLE ROW LEVEL SECURITY`,
            `DROP POLICY IF EXISTS "Users view active coupons" ON coupons`,
            `DROP POLICY IF EXISTS "Admins full access on coupons" ON coupons`,
            `CREATE POLICY "Users view active coupons" ON coupons FOR SELECT USING (active = true)`,
            `CREATE POLICY "Admins full access on coupons" ON coupons FOR ALL USING (is_admin())`,
            `ALTER TABLE coupons ENABLE ROW LEVEL SECURITY`
        ];

        for (const sql of sqlArr) {
            try {
                logMsg(`Executando: ${sql}`);
                await client.query(sql);
                logMsg('✅ OK');
            } catch (e) {
                logMsg(`❌ FALHA: ${e.message}`);
            }
        }

        logMsg('--- VERIFICANDO ESTADO FINAL ---');
        const res = await client.query(`
            SELECT tablename, policyname, cmd, qual 
            FROM pg_policies 
            WHERE tablename IN ('marketplace_orders', 'coupons')
        `);
        logMsg(`Total de políticas encontradas: ${res.rows.length}`);
        res.rows.forEach(r => logMsg(`${r.tablename} | ${r.policyname} | ${r.cmd}`));

    } catch (err) {
        logMsg(`ERRO CRÍTICO: ${err.message}`);
    } finally {
        await client.end();
        fs.writeFileSync('debug_sql_log.txt', log);
        console.log('Log salvo em debug_sql_log.txt');
    }
}

debugApply();
