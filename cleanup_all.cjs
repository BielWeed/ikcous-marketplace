const http = require('http');

const apikey = '4296144a114008779090b83e370f2a96';

function request(path, method = 'GET') {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            method: method,
            headers: { 'apikey': apikey }
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
        req.end();
    });
}

async function clean() {
    console.log('--- BUSCANDO INSTANCIAS PARA LIMPEZA ---');
    const res = await request('/instance/fetchInstances');
    if (Array.isArray(res.data)) {
        for (const inst of res.data) {
            const name = inst.instanceName || inst.name;
            console.log('Deletando:', name);
            await request('/instance/delete/' + name, 'DELETE');
        }
        console.log('Limpeza concluida.');
    } else {
        console.log('Nenhuma instancia encontrada ou erro:', JSON.stringify(res.data));
    }
}

clean();
