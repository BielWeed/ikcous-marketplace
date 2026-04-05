import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from parent directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDiscrepancy() {
    console.log('--- Checking Product Counts via Supabase API ---');

    // 1. Count active products from 'produtos' table
    const { count: tableCount, error: tableError } = await supabase
        .from('produtos')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true);

    if (tableError) {
        console.error('Error fetching from produtos:', tableError.message);
    } else {
        console.log(`Produtos (ativo=true): ${tableCount}`);
    }

    // 2. Count from 'vw_produtos_public' view
    const { count: viewCount, error: viewError } = await supabase
        .from('vw_produtos_public')
        .select('*', { count: 'exact', head: true });

    if (viewError) {
        console.error('Error fetching from vw_produtos_public:', viewError.message);
    } else {
        console.log(`vw_produtos_public: ${viewCount}`);
    }

    if (tableCount !== viewCount) {
        console.log('\n--- DISCREPANCY DETECTED ---');

        // Fetch IDs from both to compare
        const { data: tableIds } = await supabase.from('produtos').select('id, nome').eq('ativo', true);
        const { data: viewIds } = await supabase.from('vw_produtos_public').select('id');

        const viewIdSet = new Set((viewIds || []).map(p => p.id));
        const missing = (tableIds || []).filter(p => !viewIdSet.has(p.id));

        console.log('Products in table but missing in view:');
        console.table(missing);
    } else {
        console.log('\nCounts match between table and view.');
    }
}

checkDiscrepancy();
