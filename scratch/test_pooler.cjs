const { Client } = require('pg');

const regions = [
    'sa-east-1',
    'us-east-1',
    'us-west-2',
    'us-west-1',
    'eu-west-1',
    'ap-southeast-1'
];

async function findRegion() {
    for (const reg of regions) {
        const host = `aws-0-${reg}.pooler.supabase.com`;
        const connectionString = `postgresql://postgres.cafkrminfnokvgjqtkle:IsaBiel%40hgfwq1@${host}:6543/postgres`;
        const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
        try {
            console.log(`Trying ${host}...`);
            await client.connect();
            console.log(`SUCCESS! Connected via ${host}`);
            const res = await client.query('SELECT now();');
            console.log('Now:', res.rows[0].now);
            await client.end();
            return;
        } catch (err) {
            console.log(`Failed ${host}: ${err.message}`);
        }
    }
    // Also try aws-1 prefix
    for (const reg of regions) {
        const host = `aws-1-${reg}.pooler.supabase.com`;
        const connectionString = `postgresql://postgres.cafkrminfnokvgjqtkle:IsaBiel%40hgfwq1@${host}:6543/postgres`;
        const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
        try {
            console.log(`Trying ${host}...`);
            await client.connect();
            console.log(`SUCCESS! Connected via ${host}`);
            const res = await client.query('SELECT now();');
            console.log('Now:', res.rows[0].now);
            await client.end();
            return;
        } catch (err) {
            console.log(`Failed ${host}: ${err.message}`);
        }
    }
}

findRegion();
