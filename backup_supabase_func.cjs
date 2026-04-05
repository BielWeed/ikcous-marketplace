const { Client } = require('pg');
const fs = require('node:fs');
const supabaseConn = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;

async function saveFunc() {
    const client = new Client({ connectionString: supabaseConn });
    try {
        await client.connect();
        const r = await client.query(`
            SELECT routine_definition 
            FROM information_schema.routines 
            WHERE routine_name = 'handle_new_order_whatsapp'
        `);
        if (r.rows[0]) {
            fs.writeFileSync('supabase_func_backup.sql', r.rows[0].routine_definition);
            console.log('Backup salvo em supabase_func_backup.sql');
        }
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
saveFunc();
