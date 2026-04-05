const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';
const htmlFile = 'C:/Users/Gabriel/Downloads/Kimi_Agent_Atualização v4/app_mkt/ABRA_ESTE_QR_CODE.html';

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
                try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
            });
        });
        req.on('error', (e) => resolve({ error: e.message }));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function start() {
    console.log('Encerrando instância antiga...');
    await request('DELETE', `/instance/logout/${instanceName}`);
    await request('DELETE', `/instance/delete/${instanceName}`);

    console.log('Criando nova instância...');
    const create = await request('POST', '/instance/create', {
        instanceName: instanceName,
        token: apikey,
        number: '',
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
    });

    if (create.error) {
        console.error('Erro ao criar:', create.error);
        return;
    }

    console.log('Aguardando QR Code (isso pode levar até 30 segundos)...');
    let found = false;
    for (let i = 0; i < 20; i++) {
        const qr = await request('GET', `/instance/connect/${instanceName}`);
        if (qr && qr.base64) {
            let html = `
<!DOCTYPE html>
<html>
<head>
    <title>CONECTAR WHATSAPP</title>
    <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
        h1 { color: #25d366; margin-bottom: 20px; }
        img { border: 10px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.1); margin: 20px 0; }
        p { color: #666; line-height: 1.5; }
        .success { color: #25d366; font-weight: bold; display: none; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Conectar Loja</h1>
        <p>Aponte a f&acirc;mera do WhatsApp para o c&oacute;digo abaixo:</p>
        <img src="${qr.base64}" />
        <p>1. Abra o WhatsApp<br>2. Configura&ccedil;&otilde;es > Aparelhos Conectados<br>3. Conectar um Aparelho</p>
        <p style="font-size: 12px; color: #999;">Esta p&aacute;gina foi atualizada agora. Se o QR expirar, recarregue.</p>
    </div>
</body>
</html>`;
            fs.writeFileSync(htmlFile, html);
            console.log('QR CODE GERADO E SALVO EM ABRA_ESTE_QR_CODE.html');
            found = true;
            break;
        }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 3000));
    }

    if (!found) console.log('\nNão foi possível obter o QR Code a tempo. Tente novamente.');
}

start();
