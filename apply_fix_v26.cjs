const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyFix() {
    // Attempt to use environment variables, fallback to known Supabase pattern
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260324_01_fix_produtos_permissions_v26.sql');
        
        if (!fs.existsSync(sqlPath)) {
            throw new Error(`Migration file not found at: ${sqlPath}`);
        }

        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Applying Fix Migration (v26) - Restoring Product Permissions...');
        await client.query(sql);
        console.log('Migration applied successfully!');
    } catch (err) {
        console.error('Error applying migration:', err.message);
        if (err.detail) console.error('Detail:', err.detail);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applyFix();
