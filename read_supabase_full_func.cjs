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
            const def = r.rows[0].routine_definition;
            console.log('--- DEFINICAO COMPLETA ---');
            console.log(def);

            // Tentar extrair o nome da instância se estiver em um JSON ou URL
            const instanceMatch = def.match(/\/message\/sendText\/([^\s']+)/);
            if (instanceMatch) {
                console.log('Instancia Detectada na Funcao:', instanceMatch[1]);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
readFunc();
