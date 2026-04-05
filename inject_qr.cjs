const http = require('http');
const fs = require('node:fs');
const path = require('path');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';
const htmlFile = path.join(__dirname, 'ABRA_ESTE_QR_CODE.html');

async function injectQR() {
    console.log('Iniciando monitoramento de QR...');

    // Forçar criação da instância via Localhost
    const postData = JSON.stringify({
        instanceName,
        token: apikey,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
    });

    for (let attempt = 1; attempt <= 15; attempt++) {
        console.log(`Tentativa ${attempt}/15...`);
        try {
            // Tenta pegar o QR
            const res = await new Promise((resolve) => {
                http.get({
                    hostname: 'localhost',
                    port: 8080,
                    path: `/instance/connect/${instanceName}`,
                    headers: { 'apikey': apikey }
                }, (r) => {
                    let d = '';
                    r.on('data', c => d += c);
                    r.on('end', () => resolve({ status: r.statusCode, body: d }));
                }).on('error', () => resolve({ status: 500 }));
            });

            if (res.status === 200) {
                const json = JSON.parse(res.body);
                if (json.base64) {
                    let html = fs.readFileSync(htmlFile, 'utf8');
                    html = html.replace('Gerando QR Code... por favor, recarregue esta página em 15 segundos.', '<b>ESCANEIE AGORA:</b>');
                    html = html.replace('<div id="qr-container"></div>', `<div id="qr-container"><img src="${json.base64}" style="max-width:300px;" /></div>`);
                    fs.writeFileSync(htmlFile, html);
                    console.log('QR CODE INJETADO COM SUCESSO NO HTML!');
                    return;
                }
            }

            // Se não pegou QR, tenta garantir que a instância existe
            if (attempt === 1 || attempt % 5 === 0) {
                console.log('Verificando/Criando instância...');
                const req = http.request({
                    hostname: 'localhost',
                    port: 8080,
                    path: '/instance/create',
                    method: 'POST',
                    headers: { 'apikey': apikey, 'Content-Type': 'application/json' }
                });
                req.write(postData);
                req.end();
            }

        } catch (e) {
            console.log('Erro:', e.message);
        }
        await new Promise(r => setTimeout(r, 6000));
    }
    console.log('Monitoramento encerrado sem capturar QR.');
}

injectQR();
