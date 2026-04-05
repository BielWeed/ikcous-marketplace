const http = require('http');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            method: method,
            headers: {
                'apikey': apikey,
                'Content-Type': 'application/json'
            }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    try {
        console.log('Deletando...');
        await request('DELETE', `/instance/delete/${instanceName}`);
        await new Promise(r => setTimeout(r, 2000));

        console.log('Criando...');
        const create = await request('POST', '/instance/create', {
            instanceName: instanceName,
            token: apikey,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS'
        });
        console.log('Criar Status:', create.status);

        console.log('Aguardando QR...');
        await new Promise(r => setTimeout(r, 10000));

        const qr = await request('GET', `/instance/connect/${instanceName}`);
        console.log('Conectar Status:', qr.status);

        const data = JSON.parse(qr.body);
        if (data.base64) {
            console.log('QRCODE_START');
            console.log(data.base64);
            console.log('QRCODE_END');
        } else {
            console.log('Sem QR Code. Estado:', data.instance?.state);
        }
    } catch (e) {
        console.error('Erro:', e.message);
    }
}

run();
