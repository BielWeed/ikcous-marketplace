
const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        // Find an admin user
        const adminRes = await client.query("SELECT id FROM profiles WHERE role = 'admin' LIMIT 1");
        if (adminRes.rows.length === 0) {
            console.log("No admin user found in profiles!");
            return;
        }
        const adminId = adminRes.rows[0].id;
        console.log(`Testing with admin ID: ${adminId}`);

        // Simulate session
        await client.query("BEGIN;");
        await client.query(`SET LOCAL "request.jwt.claims" = '{"sub": "${adminId}", "role": "authenticated"}'`);
        await client.query("SET LOCAL ROLE authenticated;");

        // Test check_is_admin()
        const checkAdmin = await client.query("SELECT public.check_is_admin() as is_admin");
        console.log(`Is admin according to check_is_admin()? ${checkAdmin.rows[0].is_admin}`);

        // Query products as authenticated admin
        const prodRes = await client.query("SELECT id, nome, ativo FROM public.produtos");
        console.log(`Products visible to admin: ${prodRes.rows.length}`);
        
        // Query products as anon (should only see ativo = true)
        await client.query("SET LOCAL ROLE anon;");
        await client.query(`SET LOCAL "request.jwt.claims" = '{}'`);
        const anonRes = await client.query("SELECT id, nome, ativo FROM public.produtos");
        console.log(`Products visible to anon: ${anonRes.rows.length}`);

        await client.query("ROLLBACK;");

    } catch (err) {
        console.error('Error:', err);
        if (client) await client.query("ROLLBACK;");
    } finally {
        await client.end();
    }
}

run();
