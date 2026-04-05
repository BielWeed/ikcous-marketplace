const localtunnel = require('localtunnel');
const fs = require('node:fs');

async function createTunnel() {
    try {
        const tunnel = await localtunnel({ port: 8080 });
        console.log('Novo Túnel Criado:', tunnel.url);
        fs.writeFileSync('current_tunnel_url.txt', tunnel.url);

        tunnel.on('close', () => {
            console.log('Túnel fechado');
        });
    } catch (e) {
        console.error('Erro ao criar túnel:', e.message);
    }
}

createTunnel();
