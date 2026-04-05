const https = require('https');

const apikey = 'BielWeed_ArbitragemPro_2025';
const baseUrl = 'tired-deer-speak.loca.lt';
const instanceName = 'MainInstance';

async function createInstance() {
    console.log(`--- Criando Instância: ${instanceName} ---`);

    const postData = JSON.stringify({
        instanceName: instanceName,
        token: apikey,
        qrcode: true
    });

    const options = {
        hostname: baseUrl,
        path: '/instance/create',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': apikey,
            'Content-Length': postData.length
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function run() {
    try {
        const res = await createInstance();
        console.log('Status Code:', res.status);
        console.log('Result:', res.body);

        const data = JSON.parse(res.body);
        if (data.qrcode?.base64) {
            console.log('SUCCESS: QR CODE GENERATED');
            require('node:fs').writeFileSync('whatsapp_qr_new.txt', data.qrcode.base64);
            console.log('Novo QR Code salvo em whatsapp_qr_new.txt');
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

run();
