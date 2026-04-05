const { Client } = require('pg');

const c = new Client(process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`);

async function run() {
    await c.connect();
    try {
        // 1. Check if Function exists and requires what arguments
        const { rows } = await c.query(`
      SELECT prosrc, proargnames, proargtypes
      FROM pg_proc 
      WHERE proname = 'get_admin_analytics_v2'
    `);
        console.log('Function Definition:', rows.length > 0 ? 'Found' : 'Not Found');

        // 2. Reload Schema Cache
        await c.query("NOTIFY pgrst, 'reload schema'");
        console.log('Cache reloaded successfully');

    } catch (e) {
        console.error(e);
    } finally {
        await c.end();
    }
}

run();
