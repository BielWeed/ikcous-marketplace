async function checkLocal() {
    const url = 'http://localhost:8080/instance/fetchInstances';
    const apiKey = '4296144a114008779090b83e370f2a96';

    try {
        console.log('--- Testando Conexão Local (Fetch) ---');
        const response = await fetch(url, {
            headers: { 'apikey': apiKey }
        });
        
        const data = await response.json();
        console.log('Resposta:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('❌ Erro Local API:', err.message);
    }
}

checkLocal();
