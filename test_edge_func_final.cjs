const https = require('https');

async function testEdgeFunction() {
    const url = new URL('https://cafkrminfnokvgjqtkle.functions.supabase.co/send-order-whatsapp');
    const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhZmtybWluZm5va3ZnanF0a2xlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMTExMjU0NSwiZXhwIjoyMDI2Njg4NTQ1fQ.N-8Z_Y9X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X';

    const payload = JSON.stringify({
        type: 'INSERT',
        table: 'marketplace_orders',
        record: {
            id: 'bac89b0e-c2fd-442b-a195-89d811f95082', // UUID Real
            customer_name: 'Gabriel Teste Antigravity',
            customer_data: {
                whatsapp: '553492589326' // Usando um número provavelmente real do usuário se disponível, ou o de teste
            },
            total_price: 150.00,
            payment_method: 'pix'
        }
    });

    const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + serviceKey,
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    console.log('--- Enviando Teste Final para Edge Function ---');
    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log('Status:', res.statusCode);
            console.log('Resposta Bruta:', data);
        });
    });

    req.on('error', (err) => {
        console.error('Erro na requisição:', err.message);
    });

    req.write(payload);
    req.end();
}
testEdgeFunction();
