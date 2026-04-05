const { Client } = require('pg');

async function check() {
    const client = new Client({ connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres` });
    try {
        await client.connect();

        const res = await client.query(`
            SELECT id, nome, preco_venda, custo, estoque 
            FROM public.produtos 
            WHERE nome ILIKE '%canetas%' OR nome ILIKE '%boobie%' OR nome ILIKE '%bobbie%';
        `);

        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}
check();
