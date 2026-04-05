const { Client } = require('pg');
const fs = require('node:fs');

async function applySecuritySequence() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        console.log('🔗 Connecting to database...');
        await client.connect();

        console.log('📝 Reading SQL patch...');
        const sql = fs.readFileSync('./20260315_solo_ninja_security_patch.sql', 'utf8');

        console.log('🛡️ Applying Solo-Ninja Security Patch 2 (V15)...');
        await client.query(sql);
        console.log('✅ Security Patch V15 Applied Successfully.');

    } catch (err) {
        console.error('❌ Failed to apply Security Patch:', err.message);
    } finally {
        await client.end();
        console.log('🔌 Connection closed.');
    }
}

applySecuritySequence();
