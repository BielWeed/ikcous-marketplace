const https = require('https');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const baseUrl = 'tired-deer-speak.loca.lt';
const instanceName = 'MainInstance';

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: baseUrl,
            path: path,
            headers: { 'apikey': apikey }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }).on('error', reject);
    });
}

async function waitAndGetQR() {
    let attempts = 0;
    while (attempts < 6) {
        console.log(`Tentativa ${attempts + 1} de 6...`);
        try {
            const stateRes = await makeRequest(`/instance/connectionState/${instanceName}`);
            const stateData = JSON.parse(stateRes.body);
            console.log('Estado atual:', stateData.instance?.state);

            if (stateData.instance?.state === 'connecting' || stateData.instance?.state === 'close') {
                const qrRes = await makeRequest(`/instance/connect/${instanceName}`);
                const qrData = JSON.parse(qrRes.body);
                if (qrData.base64) {
                    fs.writeFileSync('whatsapp_qr_final.base64', qrData.base64);
                    const html = `<html><body><h2>Escaneie para conectar:</h2><img src="${qrData.base64}" /></body></html>`;
                    fs.writeFileSync('view_qr.html', html);
                    console.log('SUCCESS: QR Code capturado!');
                    return;
                }
            } else if (stateData.instance?.state === 'open') {
                console.log('WhatsApp já está CONECTADO!');
                return;
            }
        } catch (e) {
            console.log('Aguardando servidor...', e.message);
        }
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
    }
    console.log('Tempo esgotado. Tente rodar o script novamente depois.');
}

waitAndGetQR();
