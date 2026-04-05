const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';

function request(path, method, body) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'apikey': apikey
            }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
                } catch (e) {
                    resolve({ status: res.statusCode, data: { raw: data } });
                }
            });
        });
        req.on('error', (e) => resolve({ status: 500, data: { error: e.message } }));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log('--- LIMPANDO TODAS AS INSTANCIAS ---');
    const fetchRes = await request('/instance/fetchInstances', 'GET');
    if (Array.isArray(fetchRes.data)) {
        for (const inst of fetchRes.data) {
            console.log('Deletando:', inst.name);
            await request('/instance/delete/' + inst.name, 'DELETE');
        }
    }

    const finalName = 'Evolution_Final';
    console.log('--- CRIANDO:', finalName);
    const createRes = await request('/instance/create', 'POST', {
        instanceName: finalName,
        token: apikey,
        qrcode: true
    });
    console.log('Create Status:', createRes.status);
    console.log('Create Data:', JSON.stringify(createRes.data));

    if (createRes.status === 201) {
        console.log('Aguardando QR...');
        for (let i = 1; i <= 20; i++) {
            console.log(`Tentativa ${i}/20...`);
            const connectRes = await request(`/instance/connect/${finalName}`, 'GET');
            if (connectRes.data && (connectRes.data.base64 || connectRes.data.code)) {
                const qrBase64 = connectRes.data.base64 || connectRes.data.code;
                const html = `
                    <html>
                    <body style="background: #1a1a1a; color: white; text-align: center; font-family: sans-serif; padding: 50px;">
                        <h1 style="color: #25D366; font-size: 3em;">WhatsApp Conectado!</h1>
                        <p style="font-size: 1.2em;">Escaneie o QR Code abaixo para ativar as notificacoes de pedidos.</p>
                        <div style="background: white; padding: 25px; display: inline-block; border-radius: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin: 30px;">
                            <img src="${qrBase64}" style="width: 300px; height: 300px;" />
                        </div>
                        <p style="opacity: 0.6;">Instancia: ${finalName} | Gerado em: ${new Date().toLocaleString()}</p>
                        <h3 style="color: #ff9800;">NAO FECHE ESTA PAGINA ATE ESCANEAR</h3>
                    </body>
                    </html>
                `;
                fs.writeFileSync('QR_CODE_FINAL.html', html);
                console.log('SUCCESS: QR CODE SALVO EM QR_CODE_FINAL.html');
                return;
            }
            await new Promise(r => setTimeout(r, 4000));
        }
    }
}
run();
