const { Client } = require('pg');

async function checkAdmins() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        // Check columns in profiles
        const columnsRes = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'profiles'
        `);
        console.log('Columns in profiles:', columnsRes.rows.map(r => r.column_name));

        const res = await client.query("SELECT id, role FROM public.profiles WHERE role = 'admin'");
        console.log('Admins found:', res.rows);

        const rpcCheck = await client.query("SELECT proname FROM pg_proc WHERE proname = 'is_admin'");
        console.log('is_admin RPC exists:', rpcCheck.rows.length > 0);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkAdmins();
