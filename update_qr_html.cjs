const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';
const htmlFile = 'c:/Users/Gabriel/Downloads/Kimi_Agent_Atualização v4/app_mkt/ABRA_ESTE_ARQUIVO.html';

async function waitAndWrite() {
    console.log('Aguardando QR por 60s...');
    for (let i = 0; i < 12; i++) {
        try {
            const options = {
                hostname: 'localhost',
                port: 8080,
                path: `/instance/connect/${instanceName}`,
                headers: { 'apikey': apikey }
            };

            await new Promise((resolve) => {
                http.get(options, (res) => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            if (json.base64) {
                                let html = fs.readFileSync(htmlFile, 'utf8');
                                html = html.replace('<p>Carregando...</p>', `<img src="${json.base64}" />`);
                                html = html.replace('RECARREGUE</b> esta página em 10 segundos.', 'ESCANEIE AGORA!');
                                fs.writeFileSync(htmlFile, html);
                                console.log('QR CODE GRAVADO NO HTML!');
                                process.exit(0);
                            }
                        } catch (e) { }
                        resolve();
                    });
                }).on('error', resolve);
            });
        } catch (e) { }
        await new Promise(r => setTimeout(r, 5000));
        console.log(`Tentativa ${i + 1}...`);
    }
}

waitAndWrite();
