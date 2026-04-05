const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function deepAudit() {
    try {
        await client.connect();

        console.log('--- Verificando Pedidos na marketplace_orders ---');
        const orders = await client.query(`
            SELECT id, customer_name, total, status, created_at 
            FROM public.marketplace_orders 
            ORDER BY created_at DESC 
            LIMIT 3
        `);
        console.log(JSON.stringify(orders.rows, null, 2));

        console.log('--- Listando as tabelas de sistema da schema "net" ---');
        const netTables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'net'
        `);
        console.log('Tabelas na schema net:', netTables.rows.map(t => t.table_name));

        if (netTables.rows.some(t => t.table_name === 'http_request_queue')) {
            console.log('--- Verificando fila de requests (http_request_queue) ---');
            const queue = await client.query(`SELECT * FROM net.http_request_queue LIMIT 5`);
            console.log(JSON.stringify(queue.rows, null, 2));
        }

    } catch (err) {
        console.error('Erro no Deep Audit:', err.message);
    } finally {
        await client.end();
    }
}
deepAudit();
