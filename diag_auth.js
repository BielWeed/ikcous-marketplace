import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAuth() {
    console.log('--- Checking Auth & Admin Status ---');

    // Check RPC definition for is_admin
    const { data: rpcDef, error: rpcError } = await supabase.rpc('is_admin');
    console.log('is_admin RPC result (as anon):', rpcDef, rpcError ? rpcError.message : 'No error');

    // Check products count without filters as anon
    const { count: anonCount } = await supabase.from('produtos').select('*', { count: 'exact', head: true });
    console.log('Produtos count (as anon/fallback):', anonCount);

    // Check vw_produtos_public count
    const { count: viewCount } = await supabase.from('vw_produtos_public').select('*', { count: 'exact', head: true });
    console.log('vw_produtos_public count:', viewCount);

    // Check if there are products with ativo = false
    const { count: inactiveCount } = await supabase.from('produtos').select('*', { count: 'exact', head: true }).eq('ativo', false);
    console.log('Produtos (ativo=false):', inactiveCount);
}

checkAuth();
