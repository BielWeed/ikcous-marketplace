const axios = require('axios');

async function testEvolution() {
    const url = 'https://bdd1-2804-bd8-8014-c501-c8af-25e1-3e30-53a1.ngrok-free.app/instance/fetchInstances';
    const apiKey = '4296144a114008779090b83e370f2a96';

    try {
        console.log('--- Testando Conexão com Evolution API ---');
        const response = await axios.get(url, {
            headers: { 'apikey': apiKey }
        });
        console.log('Resposta:', JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.error('❌ Erro Evolution API:', err.response ? err.response.data : err.message);
    }
}

testEvolution();
