
const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('--- Product Relationship Check ---');
        const res = await client.query(`
            SELECT p.id, p.nome, p.categoria_id, c.nome as cat_nome 
            FROM public.produtos p 
            LEFT JOIN public.categorias c ON p.categoria_id = c.id
            LIMIT 20
        `);
        
        console.log(`Verified ${res.rows.length} products.`);
        const orphans = res.rows.filter(r => r.categoria_id && !r.cat_nome);
        console.log(`Orphaned products (missing category): ${orphans.length}`);
        
        if (orphans.length > 0) {
            console.log('First orphan category ID:', orphans[0].categoria_id);
            // We should probably assign them to the 'Geral' category
            const generalCat = await client.query("SELECT id FROM categorias WHERE slug = 'geral' LIMIT 1");
            if (generalCat.rows.length > 0) {
                const gid = generalCat.rows[0].id;
                console.log(`Fixing orphans to 'Geral' (${gid})...`);
                await client.query(`UPDATE produtos SET categoria_id = '${gid}' WHERE categoria_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categorias WHERE id = produtos.categoria_id)`);
                console.log('Orphans fixed.');
            }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
