const https = require('https');

const apikey = '4296144a114008779090b83e370f2a96';
const baseUrl = 'tired-deer-speak.loca.lt';
const instanceName = 'MainInstance';

async function createInstance() {
    console.log(`--- Criando Instância v2: ${instanceName} ---`);

    const postData = JSON.stringify({
        instanceName: instanceName,
        token: apikey,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
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
    } catch (e) {
        console.error('Error:', e.message);
    }
}

run();
