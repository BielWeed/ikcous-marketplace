import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Carrega as variáveis do .env na raiz do projeto
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE URL or KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testOrdersQuery() {
    console.log("Testing Admin orders query...");
    const { data, error, count } = await supabase
        .from('marketplace_orders')
        .select(`
      *,
      items:marketplace_order_items(*),
      address:user_addresses(*)
    `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(0, 19);

    if (error) {
        console.error("QUERY ERROR:", error);
    } else {
        console.log(`Success! Found ${count} orders.`);
        console.log("First order sample:", JSON.stringify(data[0], null, 2));
    }
}

testOrdersQuery();
