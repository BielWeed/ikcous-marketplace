const axios = require('axios');

const BASE_URL = 'https://api.mail.tm';

async function getDomain() {
    const res = await axios.get(`${BASE_URL}/domains`);
    return res.data['hydra:member'][0].domain;
}

async function createAccount(address, password) {
    try {
        const res = await axios.post(`${BASE_URL}/accounts`, { address, password });
        return res.data;
    } catch (e) {
        console.error('Erro ao criar conta:', e.response?.data || e.message);
        throw e;
    }
}

async function getToken(address, password) {
    const res = await axios.post(`${BASE_URL}/token`, { address, password });
    return res.data.token;
}

async function getMessages(token) {
    const res = await axios.get(`${BASE_URL}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return res.data['hydra:member'];
}

async function getMessageSource(id, token) {
    const res = await axios.get(`${BASE_URL}/messages/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return res.data.text || res.data.html;
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === 'create') {
        const domain = await getDomain();
        const user = `ninja_${Math.random().toString(36).substring(7)}`;
        const address = `${user}@${domain}`;
        const password = `NinjaPass_${Math.random().toString(36).substring(7)}!`;
        
        await createAccount(address, password);
        console.log(JSON.stringify({ address, password }));
    } else if (command === 'poll') {
        const [address, password] = args.slice(1);
        const token = await getToken(address, password);
        
        console.log('Aguardando e-mail...');
        let found = false;
        for (let i = 0; i < 20; i++) {
            const messages = await getMessages(token);
            if (messages.length > 0) {
                const content = await getMessageSource(messages[0].id, token);
                console.log(content);
                found = true;
                break;
            }
            await new Promise(r => setTimeout(r, 5000));
        }
        if (!found) console.log('Timeout: Nenhum e-mail recebido.');
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
