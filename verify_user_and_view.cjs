const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const testId = 'eaaf8550-41b4-b6e0-5c91-66cd8a855016';

async function verify() {
    try {
        await client.connect();

        console.log(`Checking ID: ${testId}`);

        const authCheck = await client.query("SELECT id FROM auth.users WHERE id = $1", [testId]);
        console.log('Exists in auth.users?', authCheck.rows.length > 0);

        const profileCheck = await client.query("SELECT * FROM public.profiles WHERE id = $1", [testId]);
        console.log('Exists in public.profiles?', profileCheck.rows.length > 0);

        // Se profiles é uma view, vamos ver a definição
        const viewDef = await client.query("SELECT definition FROM medical_views.profiles_view_source WHERE viewname = 'profiles' LIMIT 1").catch(() => null);
        if (!viewDef) {
            const genericViewDef = await client.query("SELECT pg_get_viewdef('public.profiles', true)");
            console.log('Profiles View Definition:', genericViewDef.rows[0].pg_get_viewdef);
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
verify();
