const https = require('https');

const apikey = 'BielWeed_ArbitragemPro_2025';
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
        console.log('--- Verificando Instância ---');
        const state = await makeRequest(`/instance/connectionState/${instanceName}`);
        console.log('Connection State:', state.body);

        const data = JSON.parse(state.body);
        if (data.instance?.state !== 'open') {
            console.log('\n--- Instância Desconectada. Buscando QR Code... ---');
            const qr = await makeRequest(`/instance/connect/${instanceName}`);
            const qrData = JSON.parse(qr.body);
            if (qrData.base64) {
                console.log('QR_CODE_READY');
                // Salvar QR code base64 em um arquivo para o usuário ver
                require('node:fs').writeFileSync('whatsapp_qr.txt', qrData.base64);
                console.log('QR Code salvo em whatsapp_qr.txt');
            } else {
                console.log('Resposta do Connect:', qr.body);
            }
        } else {
            console.log('WhatsApp está CONNECTED e pronto para uso!');
        }
    } catch (e) {
        console.error('Erro ao checar status:', e.message);
    }
}

checkStatus();
