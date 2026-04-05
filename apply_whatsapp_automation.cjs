const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigrations() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    const migrations = [
        path.join(__dirname, '..', 'migrations', '20260322_add_whatsapp_api_config.sql'),
        path.join(__dirname, 'supabase', 'migrations', '20260322_setup_whatsapp_webhook.sql')
    ];

    try {
        await client.connect();

        for (const migrationPath of migrations) {
            if (fs.existsSync(migrationPath)) {
                console.log(`Applying migration: ${path.basename(migrationPath)}...`);
                const sql = fs.readFileSync(migrationPath, 'utf8');
                await client.query(sql);
                console.log(`${path.basename(migrationPath)} applied successfully!`);
            } else {
                console.warn(`File not found: ${migrationPath}`);
            }
        }
    } catch (err) {
        console.error('Erro ao aplicar migrações:', err);
    } finally {
        await client.end();
    }
}

applyMigrations();
