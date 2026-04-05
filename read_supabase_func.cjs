const { Client } = require('pg');
const supabaseConn = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;

async function readFunc() {
    const client = new Client({ connectionString: supabaseConn });
    try {
        await client.connect();
        const r = await client.query(`
            SELECT routine_definition 
            FROM information_schema.routines 
            WHERE routine_name = 'handle_new_order_whatsapp'
        `);
        if (r.rows[0]) {
            console.log('--- DEFINICAO DA FUNCAO ---');
            console.log(r.rows[0].routine_definition);
        } else {
            console.log('Funcao nao encontrada.');
        }
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
readFunc();
