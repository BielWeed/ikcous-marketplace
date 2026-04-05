const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const name = 'MainInstance';
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
    console.log('--- Garantindo Instancia Limpa ---');
    await req('DELETE', `/instance/delete/${name}`);

    console.log('--- Criando Instancia ---');
    const c = await req('POST', '/instance/create', {
        instanceName: name,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
    });

    if (c.instance || c.status === 201 || (c.error && c.error.includes('already exists'))) {
        console.log('--- Monitorando QR Code ---');
        for (let i = 0; i < 30; i++) {
            const q = await req('GET', `/instance/connect/${name}`);
            if (q.base64) {
                const html = `<html><body style="background:#e5ddd5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif"><div style="background:white;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center"><h1>ESCANEIE AGORA</h1><img src="${q.base64}" /><p>Aponte o WhatsApp para o c&oacute;digo acima.</p></div></body></html>`;
                fs.writeFileSync(htmlFile, html);
                console.log('--- QR_CODE_PRONTO ---');
                return;
            }
            process.stdout.write('.');
            await new Promise(r => setTimeout(r, 4000));
        }
    } else {
        console.error('--- FALHA NA CRIACAO ---', c);
    }
}

start();
