const { Client } = require('pg');
const fs = require('node:fs');

async function testRLS() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    let output = '';

    try {
        await client.connect();
        await client.query("SET ROLE authenticated;");
        await client.query("SELECT set_config('request.jwt.claims', '{\"sub\": \"12345678-1234-1234-1234-123456789012\", \"role\": \"authenticated\"}', true);");

        try {
            const notifRes = await client.query('SELECT usuario_id, titulo FROM public.notificacoes LIMIT 5;');
            output += `Rows seen:\n${JSON.stringify(notifRes.rows, null, 2)}\n`;
        } catch (e) {
            output += `Error accessing notificacoes: ${e.message}\n`;
        }

        fs.writeFileSync('test_bola_rls_output2.txt', output);

    } catch (err) {
        console.error('Erro geral:', err);
    } finally {
        await client.end();
    }
}

testRLS();
