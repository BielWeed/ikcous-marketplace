const http = require('http');
const fs = require('node:fs');
const path = require('path');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            headers: { 'apikey': apikey }
        };
        const req = http.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
    });
}

async function monitor() {
    const filePath = 'C:/Users/Gabriel/Downloads/Kimi_Agent_Atualização v4/app_mkt/CONECTAR_WHATSAPP_AGORA.html';
    console.log('Monitorando QR Code por 60 segundos...');

    for (let i = 0; i < 12; i++) {
        try {
            const qrRes = await makeRequest(`/instance/connect/${instanceName}`);
            if (qrRes.status === 200 || qrRes.status === 201) {
                const data = JSON.parse(qrRes.body);
                if (data.base64) {
                    const html = `<html><body style="text-align:center;padding:50px;"><h1>ESCANEIE PARA CONECTAR</h1><img src="${data.base64}" /></body></html>`;
                    fs.writeFileSync(filePath, html);
                    console.log('SUCCESS: QR Code capturado e salvo em ' + filePath);
                    return;
                }
            }
            console.log(`Tentativa ${i + 1}: Aguardando geração do QR...`);
        } catch (e) {
            console.log('Erro na tentativa ' + (i + 1) + ': ' + e.message);
        }
        await new Promise(r => setTimeout(r, 5000));
    }

    // Se falhar, cria o arquivo com erro para o usuário ver algo
    fs.writeFileSync(filePath, '<html><body><h1>Erro: QR Code nao gerado a tempo.</h1><p>Tente recarregar a pagina ou me chame novamente.</p></body></html>');
    console.log('Monitoramento finalizado sem sucesso.');
}

monitor();
