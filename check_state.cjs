const http = require('http');
const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'Evolution_Ultra';

function get(path) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            method: 'GET',
            headers: { 'apikey': apikey }
        };
        const req = http.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data: data }));
        });
        req.on('error', (e) => resolve({ status: 500, data: e.message }));
    });
}

async function run() {
    console.log(`--- ESTADO DA CONEXAO: ${instanceName} ---`);
    const res = await get(`/instance/connectionState/${instanceName}`);
    console.log('Status:', res.status);
    console.log('Body:', res.data);
}
run();
