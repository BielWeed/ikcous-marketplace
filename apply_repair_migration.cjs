const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyRepairMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260323_repair_missing_rpcs_v24.sql');

        // Check if I named it v24 or v25 in the previous step.
        // I named it 20260323_repair_missing_rpcs_v25.sql in my previous write_to_file call.
        const actualSqlPath = path.join(__dirname, 'supabase', 'migrations', '20260323_repair_missing_rpcs_v25.sql');
        const sql = fs.readFileSync(actualSqlPath, 'utf8');

        console.log('Applying Repair Migration (v25)...');
        await client.query(sql);
        console.log('Repair migration applied successfully!');
    } catch (err) {
        console.error('Erro ao aplicar migração. Veja apply_error.log');
        const errorContent = `ERROR:\n${JSON.stringify(err, null, 2)}\n\nSTACK:\n${err.stack}\n`;
        fs.writeFileSync(path.join(__dirname, 'apply_error.log'), errorContent);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applyRepairMigration();
