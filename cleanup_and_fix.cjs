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
    console.log('Listando instâncias...');
    const list = await req('GET', '/instance/fetchInstances');

    if (Array.isArray(list)) {
        for (const item of list) {
            const name = item.instance ? item.instance.instanceName : null;
            if (name) {
                console.log(`Deletando: ${name}`);
                await req('DELETE', `/instance/delete/${name}`);
            }
        }
    }

    const name = 'MainInstance';
    console.log(`Recriando: ${name}`);
    const c = await req('POST', '/instance/create', { instanceName: name, qrcode: true });

    if (c.instance) {
        console.log('Aguardando QR Code...');
        for (let i = 0; i < 20; i++) {
            const q = await req('GET', `/instance/connect/${name}`);
            if (q.base64) {
                const html = `<html><body style="background:#e5ddd5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif"><div style="background:white;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center"><h1>ESCANEIE AGORA</h1><img src="${q.base64}" /><p>Aponte o WhatsApp para o c&oacute;digo acima.</p></div></body></html>`;
                fs.writeFileSync(htmlFile, html);
                console.log('SUCESSO_QR_PRONTO');
                return;
            }
            process.stdout.write('.');
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    console.log('FALHA');
}

start();
