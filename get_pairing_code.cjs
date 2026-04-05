const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const finalName = 'Evolution_Final';
const phoneNumber = '553496333333'; // Exemplo, o usuario pode precisar ajustar ou eu busco no store_config

function request(path, method) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            method: method,
            headers: {
                'apikey': apikey
            }
        };
        const req = http.get(options, (res) => {
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
    });
}

async function run() {
    console.log(`--- OBTENDO PAIRING CODE: ${finalName} ---`);
    // O endpoint costuma ser /instance/pairingCode/NAME?number=55...
    const pairingRes = await request(`/instance/pairingCode/${finalName}?number=${phoneNumber}`, 'GET');
    console.log('Response:', JSON.stringify(pairingRes.data));

    if (pairingRes.data && pairingRes.data.code) {
        fs.writeFileSync('PAIRING_CODE.txt', `CODIGO DE PAREAMENTO: ${pairingRes.data.code}\n\nInstrucoes:\n1. No WhatsApp, vá em Aparelhos Conectados\n2. Clique em Conectar um Aparelho\n3. Clique em 'Conectar com numero de telefone'\n4. Insira este codigo.`);
        console.log('SUCESSO: CODIGO SALVO EM PAIRING_CODE.txt');
    } else {
        console.log('Nao foi possivel obter o Pairing Code.');
    }
}
run();
