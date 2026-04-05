
const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        // Find an admin user
        const adminRes = await client.query("SELECT id FROM profiles WHERE role = 'admin' OR role = 'Administrator' LIMIT 1");
        if (adminRes.rows.length === 0) {
            console.log("No admin user found!");
            return;
        }
        const adminId = adminRes.rows[0].id;
        console.log(`Verifying with admin ID: ${adminId}`);

        // We use a transaction to experiment with settings without persisting
        await client.query("BEGIN;");
        
        // Mock the Supabase/PostgREST session parameters
        // Note: In some setups, we need to set the role TO 'authenticated' first
        try {
            await client.query(`SET LOCAL "request.jwt.claims" = '{"sub": "${adminId}", "role": "authenticated"}'`);
            await client.query("SET LOCAL ROLE authenticated;");
            
            const isAdm = await client.query("SELECT public.is_admin() as val");
            console.log(`is_admin() check: ${isAdm.rows[0].val}`);

            const prodCount = await client.query("SELECT count(*) FROM public.produtos");
            console.log(`Products visible to admin: ${prodCount.rows[0].count}`);

            const catCount = await client.query("SELECT count(*) FROM public.categorias");
            console.log(`Categories visible to admin: ${catCount.rows[0].count}`);

            const bannerCount = await client.query("SELECT count(*) FROM public.banners");
            console.log(`Banners visible to admin: ${bannerCount.rows[0].count}`);

            const configCount = await client.query("SELECT count(*) FROM public.store_config");
            console.log(`Config visible to admin: ${configCount.rows[0].count}`);

        } catch (e) {
            console.log("RLS Simulation Error (Expected if role mapping is strict):", e.message);
        }

        await client.query("ROLLBACK;");

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
