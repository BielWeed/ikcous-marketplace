const { Client } = require('pg');

async function inspectVaultAndPublic() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        console.log('--- Public Tables ---');
        const publicRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        console.log(publicRes.rows.map(r => r.table_name).join(', '));

        console.log('\n--- Vault Decrypted Secrets ---');
        try {
            const vaultRes = await client.query(`SELECT * FROM vault.decrypted_secrets`);
            console.log(JSON.stringify(vaultRes.rows, null, 2));
        } catch (e) {
            console.log('Could not access vault.decrypted_secrets:', e.message);
        }

        console.log('\n--- Net Responses ---');
        try {
            const netRes = await client.query(`SELECT * FROM net.http_responses ORDER BY id DESC LIMIT 5`);
            console.log(JSON.stringify(netRes.rows, null, 2));
        } catch (e) {
            console.log('Could not access net.http_responses:', e.message);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

inspectVaultAndPublic();
