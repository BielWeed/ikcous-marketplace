async function testEvolution() {
    const url = 'https://bdd1-2804-bd8-8014-c501-c8af-25e1-3e30-53a1.ngrok-free.app/instance/fetchInstances';
    const apiKey = '4296144a114008779090b83e370f2a96';

    try {
        console.log('--- Testando Conexão com Evolution API (Fetch) ---');
        const response = await fetch(url, {
            headers: { 'apikey': apiKey }
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`HTTP ${response.status}: ${error}`);
        }
        
        const data = await response.json();
        console.log('Resposta:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('❌ Erro Evolution API:', err.message);
    }
}

testEvolution();
