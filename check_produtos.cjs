const { Client } = require('pg');
const c = new Client(process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`);
async function run() {
    await c.connect();
    const { rows } = await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'produtos'");
    console.log(rows.map(x => x.column_name).join(', '));
    await c.end();
}
run();
