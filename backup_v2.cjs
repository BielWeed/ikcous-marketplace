const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');
const supabaseConn = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const outputFile = path.join(__dirname, 'supabase_func_backup.sql');

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
            fs.writeFileSync(outputFile, r.rows[0].routine_definition);
            console.log('SUCCESS: Backup salvo em ' + outputFile);
        } else {
            console.log('ERROR: Funcao nao encontrada');
        }
    } catch (e) {
        console.error('ERROR:', e.message);
    } finally {
        await client.end();
    }
}
saveFunc();
