const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';
const htmlFile = 'C:/Users/Gabriel/Downloads/Kimi_Agent_Atualização v4/app_mkt/ABRA_ESTE_QR_CODE.html';

async function req(method, path, body = null) {
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
        const r = http.request(options, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
            });
        });
        r.on('error', (e) => resolve({ error: e.message }));
        if (body) r.write(JSON.stringify(body));
        r.end();
    });
}

async function start() {
    console.log('Limpando...');
    await req('DELETE', `/instance/delete/${instanceName}`);

    console.log('Criando...');
    const c = await req('POST', '/instance/create', {
        instanceName: instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        reject_call: true,
        groups_ignore: true,
        always_online: true
    });

    if (c.instance) {
        console.log('Aguardando QR Code...');
        for (let i = 0; i < 30; i++) {
            const q = await req('GET', `/instance/connect/${instanceName}`);
            if (q.base64) {
                const html = `
<!DOCTYPE html>
<html>
<head>
    <title>CONECTAR WHATSAPP</title>
    <style>
        body { background:#e5ddd5; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; font-family:sans-serif; }
        .card { background:white; padding:40px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.1); text-align:center; max-width:400px; }
        h1 { color:#075e54; margin-bottom:20px; }
        img { border:2px solid #ddd; padding:10px; margin:20px 0; max-width:100%; }
        p { color:#666; font-size:14px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>ESCANEIE AGORA</h1>
        <p>Use o WhatsApp da loja para escanear:</p>
        <img src="${q.base64}" />
        <p>1. WhatsApp > Configurações<br>2. Aparelhos Conectados<br>3. Conectar um Aparelho</p>
    </div>
</body>
</html>`;
                fs.writeFileSync(htmlFile, html);
                console.log('QR_GERADO_SUCESSO');
                return;
            }
            process.stdout.write('.');
            await new Promise(r => setTimeout(r, 4000));
        }
    }
    console.log('FALHA OU TIMEOUT');
}

start();
