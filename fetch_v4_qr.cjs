const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'Evolution_V4';

function request(path) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            headers: { 'apikey': apikey }
        };
        http.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
                } catch (e) {
                    resolve({ status: res.statusCode, data: { raw: data } });
                }
            });
        }).on('error', (e) => resolve({ status: 500, data: { error: e.message } }));
    });
}

async function run() {
    console.log(`--- MONITORANDO QR CODE: ${instanceName} ---`);
    for (let i = 1; i <= 30; i++) {
        console.log(`Tentativa ${i}/30...`);
        const res = await request(`/instance/connect/${instanceName}`);

        if (res.data && res.data.base64) {
            const html = `
                <html>
                <body style="background: #0d1117; color: #c9d1d9; text-align: center; font-family: sans-serif; padding: 40px;">
                    <div style="max-width: 600px; margin: auto; background: #161b22; padding: 40px; border-radius: 20px; border: 1px solid #30363d;">
                        <h1 style="color: #238636;">WhatsApp Evolution API</h1>
                        <p>Escaneie o QR Code abaixo com seu celular.</p>
                        <div style="background: white; padding: 20px; display: inline-block; border-radius: 15px; margin: 20px 0;">
                            <img src="${res.data.base64}" style="width: 320px; height: 320px;" />
                        </div>
                        <p>Instancia: <strong>${instanceName}</strong></p>
                        <p style="color: #f85149;"><strong>NAO FECHE ESTA PAGINA ATE PAREAR</strong></p>
                    </div>
                </body>
                </html>
            `;
            fs.writeFileSync('ABRA_ESTE_QR_CODE.html', html);
            console.log('SUCCESS: QR CODE SALVO EM ABRA_ESTE_QR_CODE.html');
            return;
        }
        await new Promise(r => setTimeout(r, 4000));
    }
    console.log('TIMEOUT.');
}
run();
