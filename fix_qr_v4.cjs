const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
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
    const timestamp = Date.now();
    const name = `Code_${timestamp}`;
    console.log(`Tentando Code Chat na instancia: ${name}`);

    // Tentar criar com integração genérica se Baileys está falhando
    const c = await req('POST', '/instance/create', {
        instanceName: name,
        qrcode: true
        // Removendo explicitamente a integração para usar o default do sistema que pode estar mais estável
    });

    if (c.instance) {
        console.log('Monitorando...');
        for (let i = 0; i < 40; i++) {
            const q = await req('GET', `/instance/connect/${name}`);
            if (q.base64) {
                const html = `
<!DOCTYPE html>
<html>
<head>
    <title>CONECTAR WHATSAPP</title>
    <style>
        body { background:#128C7E; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; font-family:sans-serif; color:white; }
        .card { background:white; padding:40px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.3); text-align:center; color:#333; }
        img { border:1px solid #ddd; padding:10px; margin:20px 0; background:white; }
    </style>
</head>
<body>
    <div class="card">
        <h1>CONECTAR LOJA</h1>
        <p>Aponte o celular:</p>
        <img src="${q.base64}" />
        <p>1. WhatsApp > Aparelhos Conectados<br>2. Conectar um Aparelho</p>
        <p style="font-size:11px; color:#999">ID: ${name}</p>
    </div>
</body>
</html>`;
                fs.writeFileSync(htmlFile, html);
                console.log(`PRONTO_${name}`);
                return;
            }
            process.stdout.write('.');
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    console.log('FALHA');
}

start();
