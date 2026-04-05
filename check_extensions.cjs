const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkExtensions() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT extname FROM pg_extension WHERE extname = 'pg_net'
        `);
        console.log('Extensions:', JSON.stringify(res.rows));
        
        const schemas = await client.query(`
            SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'net'
        `);
        console.log('Schemas:', JSON.stringify(schemas.rows));

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
checkExtensions();
