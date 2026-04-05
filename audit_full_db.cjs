
const { Client } = require('pg');
const fs = require('node:fs');

async function audit() {
    // Corrected connection string from check_products_data.cjs
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    const results = {
        productCount: 0,
        activeProductCount: 0,
        productsSample: [],
        profiles: [],
        tableList: [],
        errors: []
    };

    try {
        await client.connect();

        const prodReport = await client.query('SELECT nome, codigo, LEFT(descricao, 100) as desc_preview, custo, preco_venda FROM public.produtos ORDER BY codigo');
        results.productReport = prodReport.rows;

    } catch (err) {
        results.errors.push({ type: 'connection', message: err.message });
    } finally {
        await client.end();
    }

    fs.writeFileSync('product_report.json', JSON.stringify(results.productReport, null, 2));
    console.log('Report complete. Results written to product_report.json');
}

audit();
