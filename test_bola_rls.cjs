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

        output += 'Testing access to vendas (ERP table) as normal user...\n';
        try {
            const res = await client.query('SELECT * FROM public.vendas LIMIT 1;');
            output += `Normal user saw ${res.rowCount} rows in vendas.\n`;
        } catch (e) {
            output += `Error accessing vendas: ${e.message}\n`;
        }

        output += '\nTesting access to notificacoes as normal user...\n';
        try {
            const notifRes = await client.query('SELECT * FROM public.notificacoes LIMIT 5;');
            output += `Normal user saw ${notifRes.rowCount} rows in notificacoes.\n`;
        } catch (e) {
            output += `Error accessing notificacoes: ${e.message}\n`;
        }

        fs.writeFileSync('test_bola_rls_output.txt', output);
        console.log('Test completed. Results in test_bola_rls_output.txt');

    } catch (err) {
        console.error('Erro geral:', err);
    } finally {
        await client.end();
    }
}

testRLS();
