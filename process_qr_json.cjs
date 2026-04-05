const fs = require('node:fs');
const path = require('path');

const jsonPath = path.join(__dirname, 'qr_response.json');
const htmlPath = path.join(__dirname, 'ABRA_ESTE_QR_CODE.html');

try {
    const data = fs.readFileSync(jsonPath, 'utf8');
    const res = JSON.parse(data);

    if (res.base64) {
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>CONECTAR WHATSAPP</title>
    <style>
        body { background:#e5ddd5; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; font-family:sans-serif; }
        .card { background:white; padding:40px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.1); text-align:center; max-width:400px; }
        h1 { color:#075e54; margin-bottom:20px; }
        img { border:2px solid #ddd; padding:10px; margin:20px 0; max-width:100%; }
        p { color:#666; font-size:14px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>ESCANEIE AGORA</h1>
        <p>Aponte o WhatsApp da loja para o c&oacute;digo abaixo:</p>
        <img src="${res.base64}" />
        <p>1. WhatsApp > Configura&ccedil;&otilde;es<br>2. Aparelhos Conectados<br>3. Conectar um Aparelho</p>
    </div>
</body>
</html>`;
        fs.writeFileSync(htmlPath, html);
        console.log('HTML_GERADO_SUCESSO');
    } else {
        console.log('ERRO: Base64 nao encontrado no JSON.', res);
    }
} catch (e) {
    console.error('ERRO AO PROCESSAR JSON:', e.message);
}
