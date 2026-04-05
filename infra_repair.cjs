const { Client } = require('pg');
const http = require('http');
const fs = require('node:fs');
const { exec } = require('child_process');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';
const supabaseConn = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const htmlFile = 'C:/Users/Gabriel/Downloads/Kimi_Agent_Atualização v4/app_mkt/ABRA_ESTE_QR_CODE.html';

async function runRepair() {
    console.log('--- Iniciando Reparo Infra ---');

    // 1. Iniciar Túnel
    console.log('Criando novo túnel...');
    const tunnelProc = exec('npx localtunnel --port 8080');
    let tunnelUrl = '';

    await new Promise((resolve) => {
        tunnelProc.stdout.on('data', (data) => {
            const match = data.match(/https?:\/\/[^\s]+/);
            if (match) {
                tunnelUrl = match[0];
                console.log('Nova URL do Túnel:', tunnelUrl);
                resolve();
            }
        });
        setTimeout(resolve, 15000); // Timeout se não pegar URL
    });

    if (tunnelUrl) {
        // 2. Atualizar Supabase
        console.log('Sincronizando com Supabase...');
        const client = new Client({ connectionString: supabaseConn });
        try {
            await client.connect();
            await client.query('UPDATE public.store_config SET whatsapp_api_url = $1 WHERE id = 1', [tunnelUrl]);
            console.log('Supabase Atualizado!');
        } catch (e) {
            console.error('Erro Supabase:', e.message);
        } finally {
            await client.end();
        }
    }

    // 3. Pegar QR via Localhost
    console.log('Capturando QR Code local...');
    for (let i = 0; i < 5; i++) {
        try {
            const res = await new Promise((resolve) => {
                http.get({
                    hostname: 'localhost',
                    port: 8080,
                    path: `/instance/connect/${instanceName}`,
                    headers: { 'apikey': apikey }
                }, (r) => {
                    let d = '';
                    r.on('data', c => d += c);
                    r.on('end', () => resolve(JSON.parse(d)));
                }).on('error', () => resolve(null));
            });

            if (res && res.base64) {
                let html = fs.readFileSync(htmlFile, 'utf8');
                html = html.replace('Gerando QR Code... por favor, recarregue esta página em 15 segundos.', '<b>ESCANEIE AGORA:</b>');
                html = html.replace('<div id="qr-container"></div>', `<div id="qr-container"><img src="${res.base64}" style="max-width:300px;" /></div>`);
                fs.writeFileSync(htmlFile, html);
                console.log('QR CODE ENTREGUE!');
                break;
            }
        } catch (e) { }
        console.log('Aguardando QR...');
        await new Promise(r => setTimeout(r, 10000));
    }

    console.log('Concluído.');
}

runRepair();
