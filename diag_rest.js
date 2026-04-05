
const https = require('https');

const supabaseUrl = 'ykzlsunvbeclpxkuzskk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZl9pZCI6InlremxzdW52YmVjbHB4a3V6c2trIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIwNDU5MDIsImV4cCI6MjA1NzYyMTkwMn0.Y8_gH90I459jY-Opbq28IWk5A8PoFV7WYPvVk';

function supabaseGet(path, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: supabaseUrl,
            path: `/rest/v1/${path}`,
            method: 'GET',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Range': '0-9',
                ...headers
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({
                        data: JSON.parse(data),
                        count: res.headers['content-range'] ? res.headers['content-range'].split('/')[1] : null,
                        status: res.statusCode
                    });
                } catch (e) {
                    resolve({ data, status: res.statusCode });
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function run() {
    console.log('--- REST API Diagnostics ---');

    // 1. Total products
    const products = await supabaseGet('produtos?select=*', { 'Prefer': 'count=exact' });
    console.log(`Total Products: ${products.count} (Status: ${products.status})`);

    // 2. Active products
    const active = await supabaseGet('produtos?ativo=eq.true&select=*', { 'Prefer': 'count=exact' });
    console.log(`Active Products (ativo=true): ${active.count}`);

    // 3. View products
    const view = await supabaseGet('vw_produtos_public?select=*', { 'Prefer': 'count=exact' });
    console.log(`Public View Count: ${view.count}`);

    // 4. Admin profiles
    const profiles = await supabaseGet('profiles?role=eq.admin&select=id,email,role');
    console.log('Admin Profiles:', JSON.stringify(profiles.data, null, 2));

    console.log('--- Done ---');
}

run().catch(console.error);
