
const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        console.log('--- Comprehensive Database Audit ---');

        const tables = ['produtos', 'categorias', 'banners', 'store_config', 'product_variants', 'profiles'];
        for (const table of tables) {
            const res = await client.query(`SELECT count(*) FROM public.${table}`);
            console.log(`Table '${table}': ${res.rows[0].count} rows`);
        }

        const adminProfiles = await client.query(`SELECT id, full_name, role FROM public.profiles WHERE role = 'admin'`);
        console.log('Admin profiles count:', adminProfiles.rows.length);
        if (adminProfiles.rows.length > 0) {
            console.log('Sample Admin IDs:', adminProfiles.rows.map(r => r.id).join(', '));
        }

        // Check if any products are INACTIVE
        const inactive = await client.query("SELECT count(*) FROM public.produtos WHERE ativo = false");
        console.log(`Inactive products: ${inactive.rows[0].count}`);

    } catch (err) {
        console.error('Error during audit:', err);
    } finally {
        await client.end();
    }
}

run();
