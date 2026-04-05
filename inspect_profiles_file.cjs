const { Client } = require('pg');
const fs = require('node:fs');

async function checkTable() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'profiles'
            ORDER BY ordinal_position;
        `);
        let output = 'Columns in profiles:\n';
        res.rows.forEach(row => {
            output += `${row.column_name} (${row.data_type})\n`;
        });
        fs.writeFileSync('profiles_schema.txt', output);
        console.log('Done writing profiles_schema.txt');

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

checkTable();
