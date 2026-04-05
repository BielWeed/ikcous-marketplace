const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function run() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                tgname,
                tgrelid::regclass AS table_name,
                pg_get_triggerdef(t.oid) AS definition
            FROM 
                pg_trigger t
            JOIN 
                pg_proc p ON t.tgfoid = p.oid
            WHERE 
                p.prosrc ILIKE '%estoque%' OR p.prosrc ILIKE '%stock%'
                OR tgname ILIKE '%estoque%' OR tgname ILIKE '%stock%'
        `);
        console.log(res.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
run();
