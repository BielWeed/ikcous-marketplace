const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260324_definitive_security_hardening.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Applying definitive security hardening v25...');
        await client.query(sql);
        console.log('Migration applied successfully!');
        
        console.log('Reloading PostgREST schema cache...');
        await client.query("NOTIFY pgrst, 'reload schema'");
        console.log('Cache reloaded successfully!');
    } catch (err) {
        console.error('Erro ao aplicar migração:', err);
    } finally {
        await client.end();
    }
}

applyMigration();
