const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DB_CONFIG = {
    host: process.env.SUPABASE_DB_HOST || 'db.cafkrminfnokvgjqtkle.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
};

async function apply() {
    const client = new Client(DB_CONFIG);
    try {
        await client.connect();
        const sql = fs.readFileSync(path.join(__dirname, '../migrations/20260501_enable_guest_checkout_v22.sql'), 'utf8');
        console.log('Applying SQL...');
        await client.query(sql);
        console.log('✅ SQL Applied successfully.');
        
        // Also register it in _ninja_migrations to avoid future confusion
        await client.query('INSERT INTO _ninja_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING', ['20260501_enable_guest_checkout_v22.sql']);
        console.log('✅ Registered in _ninja_migrations.');

    } catch (err) {
        console.error('💥 Error:', err.message);
    } finally {
        await client.end();
    }
}

apply();
