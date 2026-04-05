const http = require('http');
const fs = require('node:fs');
const { Client } = require('pg');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'Evolution_Ultra';
const supabaseConn = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;

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
            res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }));
        });
        req.on('error', (e) => resolve({ status: 500, data: { error: e.message } }));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log(`--- INICIANDO PROTOCOLO ULTRA PARA ${instanceName} ---`);
    try {
        // 1. Criar Instancia
        const createRes = await request('/instance/create', 'POST', {
            instanceName: instanceName,
            token: apikey,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS'
        });
        console.log('Create Status:', createRes.status);

        // 2. Atualizar Supabase (sempre, para garantir sincronia)
        const client = new Client({ connectionString: supabaseConn });
        await client.connect();
        await client.query("UPDATE store_config SET whatsapp_api_instance = $1 WHERE id = 1", [instanceName]);
        await client.end();
        console.log('Supabase Atualizado com:', instanceName);

        // 3. Pequeno delay para inicializacao
        await new Promise(r => setTimeout(r, 5000));

        // 4. Capturar QR em Loop
        for (let i = 1; i <= 10; i++) {
            console.log(`Tentativa QR ${i}/10...`);
            const connectRes = await request(`/instance/connect/${instanceName}`, 'GET');
            if (connectRes.data && connectRes.data.base64) {
                const qrBase64 = connectRes.data.base64;
                const html = `
                    <html>
                    <body style="background: #1a1a1a; color: white; text-align: center; font-family: sans-serif;">
                        <h1 style="color: #25D366;">WhatsApp Evolution API</h1>
                        <h2>INSTANCIA: ${instanceName}</h2>
                        <p>Escaneie o QR Code abaixo no seu WhatsApp Celular.</p>
                        <div style="background: white; padding: 20px; display: inline-block; border-radius: 20px;">
                            <img src="${qrBase64}" style="display: block;" />
                        </div>
                        <p style="margin-top: 20px; font-size: 0.9em; opacity: 0.7;">Capturado em: ${new Date().toLocaleString()}</p>
                        <p><b>Este QR Code expira rapido. Escaneie agora!</b></p>
                    </body>
                    </html>
                `;
                fs.writeFileSync('QR_CODE_ULTRA.html', html);
                console.log('--- SUCESSO ABSOLUTO! QR SALVO ---');
                return;
            }
            await new Promise(r => setTimeout(r, 4000));
        }
        console.log('TIMEOUT: QR Code nao gerado.');
    } catch (e) {
        console.error('FALHA NO PROTOCOLO:', e.message);
    }
}

run();
