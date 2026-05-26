const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function inspectRequired() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('=== REQUIRED (NOT NULL) COLUMNS IN marketplace_orders ===');
        const resOrders = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'marketplace_orders' 
            AND is_nullable = 'NO'
            AND table_schema = 'public';
        `);
        resOrders.rows.forEach(r => {
            console.log(`- ${r.column_name} (${r.data_type})`);
        });

        console.log('\n=== REQUIRED (NOT NULL) COLUMNS IN marketplace_order_history ===');
        const resHist = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'marketplace_order_history' 
            AND is_nullable = 'NO'
            AND table_schema = 'public';
        `);
        resHist.rows.forEach(r => {
            console.log(`- ${r.column_name} (${r.data_type})`);
        });
        
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}

inspectRequired();
