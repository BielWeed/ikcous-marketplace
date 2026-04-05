const https = require('https');

const apikey = '4296144a114008779090b83e370f2a96';
const baseUrl = 'tired-deer-speak.loca.lt';
const instanceName = 'MainInstance';

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: baseUrl,
            path: path,
            method: method,
            headers: {
                'apikey': apikey,
                'Content-Type': 'application/json'
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function forceReset() {
    try {
        console.log('--- Deletando Instância Antiga ---');
        await request('DELETE', `/instance/delete/${instanceName}`);

        console.log('--- Aguardando 3 segundos... ---');
        await new Promise(r => setTimeout(r, 3000));

        console.log('--- Criando Nova Instância ---');
        const create = await request('POST', '/instance/create', {
            instanceName: instanceName,
            token: apikey,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS'
        });
        console.log('Create Status:', create.status);
        console.log('Create Body:', create.body);

        if (create.status === 201) {
            console.log('--- Buscando QR Code ---');
            await new Promise(r => setTimeout(r, 5000));
            const qr = await request('GET', `/instance/connect/${instanceName}`);
            console.log('Connect Status:', qr.status);
            const data = JSON.parse(qr.body);
            if (data.base64) {
                require('node:fs').writeFileSync('view_qr_final.html', `<html><body><img src="${data.base64}" /></body></html>`);
                console.log('SUCCESS: QR Code disponível em view_qr_final.html');
            }
        }
    } catch (e) {
        console.error('Erro no Reset:', e.message);
    }
}

forceReset();
