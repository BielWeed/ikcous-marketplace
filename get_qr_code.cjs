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

async function checkStatus() {
    try {
        console.log('--- Verificando Conexão ---');
        const state = await makeRequest(`/instance/connectionState/${instanceName}`);
        console.log('State Response:', state.body);

        const data = JSON.parse(state.body);
        if (data.instance?.state !== 'open') {
            console.log('\n--- Buscando QR Code (Base64) ---');
            const qr = await makeRequest(`/instance/connect/${instanceName}`);
            const qrData = JSON.parse(qr.body);
            if (qrData.base64) {
                // Salvar o base64 puramente para conversão posterior se necessário
                fs.writeFileSync('whatsapp_qr.base64', qrData.base64);
                console.log('SUCCESS: QR Code base64 salvo em whatsapp_qr.base64');

                // Criar um HTML simples para visualizar o QR Code
                const html = `<html><body><img src="${qrData.base64}" /></body></html>`;
                fs.writeFileSync('view_qr.html', html);
                console.log('Dica: Abra view_qr.html para escanear o código.');
            } else {
                console.log('QR Code não disponível ou já conectado.');
            }
        } else {
            console.log('WhatsApp já está CONECTADO!');
        }
    } catch (e) {
        console.error('Erro:', e.message);
    }
}

checkStatus();
