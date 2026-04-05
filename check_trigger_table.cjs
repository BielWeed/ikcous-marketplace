const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkTriggerTable() {
    try {
        await client.connect();

        console.log('--- Verificando em qual tabela o trigger on_order_created_whatsapp está ---');
        const res = await client.query(`
            SELECT event_object_table, event_manipulation 
            FROM information_schema.triggers 
            WHERE trigger_name = 'on_order_created_whatsapp'
        `);

        if (res.rows.length > 0) {
            console.log('TRIGGER ENCONTRADO:');
            res.rows.forEach(row => console.log(`Tabela: ${row.event_object_table} | Evento: ${row.event_manipulation}`));
        } else {
            console.log('Trigger on_order_created_whatsapp não encontrado em nenhuma tabela.');
        }

    } catch (err) {
        console.error('Erro na busca do trigger:', err.message);
    } finally {
        await client.end();
    }
}
checkTriggerTable();
