const { Client } = require('pg');

async function check() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        console.log('--- TABLE vs VIEW COUNT ---');
        const resTable = await client.query('SELECT count(*) FROM public.produtos WHERE ativo = true');
        const resView = await client.query('SELECT count(*) FROM public.vw_produtos_public');

        console.log('Produtos (ativo=true):', resTable.rows[0].count);
        console.log('vw_produtos_public:', resView.rows[0].count);

        if (resTable.rows[0].count !== resView.rows[0].count) {
            console.log('\n--- DISCREPANCY DETECTED ---');
            const diff = await client.query(`
                SELECT id, nome, ativo 
                FROM public.produtos 
                WHERE ativo = true 
                AND id NOT IN (SELECT id FROM public.vw_produtos_public)
            `);
            console.log('Products in table but missing in view:');
            console.table(diff.rows);
        } else {
            console.log('\nCounts match between table and view.');
        }

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

check();
