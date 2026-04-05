const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'Evolution_Miracle_Final';
let attempts = 0;

console.log(`--- MONITORANDO QR CODE: ${instanceName} ---`);

const fetchQR = () => {
    attempts++;
    process.stdout.write(`\rTentativa ${attempts}/100... `);

    const options = {
        hostname: 'localhost',
        port: 8080,
        path: `/instance/connect/${instanceName}`,
        method: 'GET',
        headers: { 'apikey': apikey }
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                if (json.code && json.code.includes('base64')) {
                    console.log('\n✅ QR CODE ENCONTRADO!');
                    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>SCAN ME - Evolution API</title>
    <style>
        body { background: #0f172a; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 2rem; border-radius: 1.5rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); text-align: center; border: 1px solid #334155; }
        img { border: 12px solid white; border-radius: 0.75rem; margin: 20px 0; background: white; }
        h1 { margin: 0; font-size: 1.5rem; color: #38bdf8; }
        p { color: #94a3b8; }
        .status { margin-top: 1rem; font-size: 0.875rem; color: #10b981; font-weight: bold; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Conectar WhatsApp (MIRACLE)</h1>
        <img src="${json.code}" alt="QR Code">
        <div class="status">Instância: ${instanceName}</div>
    </div>
    <script>setTimeout(() => window.location.reload(), 10000);</script>
</body>
</html>`;
                    fs.writeFileSync('ABRA_ESTE_QR_CODE.html', html);
                    process.exit(0);
                }

                if (attempts >= 100) {
                    console.log('\n❌ TIMEOUT FINAL.');
                    process.exit(1);
                }

                setTimeout(fetchQR, 2000);
            } catch (e) {
                setTimeout(fetchQR, 2000);
            }
        });
    });

    req.on('error', () => setTimeout(fetchQR, 2000));
    req.end();
};

fetchQR();
