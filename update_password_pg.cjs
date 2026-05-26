const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel%40hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        // Update user
        const email = 'jetski.test.user.2026@gmail.com';
        const password = 'Antigravity#2026!Secure';
        
        console.log(`Updating password for ${email}...`);
        
        const res = await client.query(
            "UPDATE auth.users SET encrypted_password = crypt($1, gen_salt('bf', 10)), email_confirmed_at = NOW() WHERE email = $2",
            [password, email]
        );
        
        console.log(`Update status. Rows affected: ${res.rowCount}`);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

run();
