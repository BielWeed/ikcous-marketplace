const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigrations() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;

    let myLog = "";
    const log = (msg) => {
        console.log(msg);
        myLog += msg + "\n";
    };

    const files = [
        '20260311_secure_store_config_refactor.sql',
        '20260330_product_soft_delete.sql'
    ];

    for (const file of files) {
        let client = new Client({ connectionString });
        try {
            await client.connect();
            const sqlPath = path.join(__dirname, 'supabase', 'migrations', file);
            if (fs.existsSync(sqlPath)) {
                const sql = fs.readFileSync(sqlPath, 'utf8');
                log(`\n--- Applying migration: ${file} ---`);
                try {
                    await client.query(sql);
                    log(`Migration ${file} applied successfully!`);
                } catch (e) {
                    log(`Error in migration ${file}:`);
                    log(`MESSAGE: ${e.message}`);
                    log(`DETAIL: ${e.detail}`);
                    log(`CODE: ${e.code}`);
                    log(`COLUMN: ${e.column}`);
                }
            } else {
                log(`File not found: ${sqlPath}`);
            }
        } catch (err) {
            log(`Database Connection Error: ${err}`);
        } finally {
            await client.end();
            fs.writeFileSync('migration_log.txt', myLog);
        }
    }
}

applyMigrations();
