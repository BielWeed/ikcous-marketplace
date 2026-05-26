const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel%40hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function confirm(email) {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query("UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = $1", [email]);
        console.log(`Confirmed user ${email}. Rows affected: ${res.rowCount}`);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

if (process.argv[2]) {
    confirm(process.argv[2]);
} else {
    console.log("Please specify an email address to confirm.");
}
