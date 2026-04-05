const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;

async function update() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const query = `
            UPDATE store_config 
            SET 
                whatsapp_api_url = 'http://localhost:8080',
                whatsapp_api_key = '4296144a114008779090b83e370f2a96',
                whatsapp_api_instance = 'MainInstance'
            WHERE id = 1;
        `;
        await client.query(query);
        console.log('Banco de dados atualizado com sucesso!');
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}
update();
