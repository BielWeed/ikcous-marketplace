const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';
const logFile = 'debug_log.txt';

function log(msg, obj = null) {
    const s = `[${new Date().toISOString()}] ${msg} ${obj ? JSON.stringify(obj) : ''}\n`;
    fs.appendFileSync(logFile, s);
    console.log(msg);
}

async function request(method, path, body = null) {
    return new Promise((resolve) => {
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
            let d = '';
            res.on('data', chunk => d += chunk);
            res.on('end', () => {
                log(`Response ${method} ${path}: ${res.statusCode}`);
                try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, data: d }); }
            });
        });
        req.on('error', (e) => resolve({ status: 500, error: e.message }));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function start() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log('--- INICIANDO DEBUG PROFUNDO ---');

    log('1. Verificando saude da API...');
    const health = await request('GET', '/instance/fetchInstances');
    log('Instancias atuais:', health.data);

    log('2. Limpando instancia se existir...');
    await request('DELETE', `/instance/delete/${instanceName}`);

    log('3. Criando instancia...');
    const create = await request('POST', '/instance/create', {
        instanceName: instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
    });
    log('Resposta Criacao:', create);

    if (create.status === 201 || (create.data && create.data.instance)) {
        log('4. Aguardando QR Code...');
        for (let i = 0; i < 30; i++) {
            const qr = await request('GET', `/instance/connect/${instanceName}`);
            log(`Tentativa ${i + 1} QR Status: ${qr.status}`);
            if (qr.data && qr.data.base64) {
                log('!!! QR CODE ENCONTRADO !!!');
                const html = `<html><body style="background:#e5ddd5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif"><div style="background:white;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center"><h1>ESCANEIE AGORA</h1><img src="${qr.data.base64}" /></div></body></html>`;
                fs.writeFileSync('C:/Users/Gabriel/Downloads/Kimi_Agent_Atualização v4/app_mkt/ABRA_ESTE_QR_CODE.html', html);
                log('HTML ATUALIZADO');
                return;
            }
            await new Promise(r => setTimeout(r, 4000));
        }
    } else {
        log('FALHA CRITICA NA CRIACAO');
    }
}

start();
