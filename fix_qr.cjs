const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'Evolution_Miracle_Final';

const fetchQR = () => {
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
                if (json.code) {
                    const isBase64 = json.code.includes('base64');
                    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>SCAN ME - Evolution API</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <style>
        body { background: #0f172a; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 2rem; border-radius: 1.5rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); text-align: center; border: 1px solid #334155; }
        #qrcode-container img, #qrcode-container canvas { border: 12px solid white; border-radius: 0.75rem; margin: 20px auto; background: white; width: 300px; height: 300px; }
        h1 { margin: 0; font-size: 1.5rem; color: #38bdf8; }
        p { color: #94a3b8; }
        .status { margin-top: 1rem; font-size: 0.875rem; color: #10b981; font-weight: bold; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Conectar WhatsApp (Versão 2.3.7)</h1>
        <div id="qrcode-container"></div>
        <div class="status">Instância Pronta: ${instanceName}</div>
        <p>Aponte o WhatsApp do celular para a tela.</p>
        <p style="font-size: 0.8rem;">Atualização automática a cada 20s.</p>
    </div>
    <script>
        const code = "${json.code}";
        const container = document.getElementById('qrcode-container');
        
        if (code.includes('base64')) {
            const img = document.createElement('img');
            img.src = code;
            container.appendChild(img);
        } else {
            new QRCode(container, {
                text: code,
                width: 300,
                height: 300,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        }
        
        setTimeout(() => window.location.reload(), 20000);
    </script>
</body>
</html>`;
                    fs.writeFileSync('ABRA_ESTE_QR_CODE.html', html);
                    console.log('✅ QR CODE CAPTURADO E SALVO!');
                    process.exit(0);
                } else {
                    console.log('⏳ Aguardando QR Code...');
                    setTimeout(fetchQR, 2000);
                }
            } catch (e) {
                console.log('❌ Erro no Parsing, tentando novamente...');
                setTimeout(fetchQR, 2000);
            }
        });
    });

    req.on('error', () => setTimeout(fetchQR, 2000));
    req.end();
};

fetchQR();
