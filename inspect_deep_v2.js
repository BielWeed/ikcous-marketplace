
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://cafkrminfnokvgjqtkle.supabase.co';
const supabaseKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectData() {
    const result = {
        products: [],
        admins: [],
        errors: []
    };

    try {
        const { data: prods, error: prodError } = await supabase
            .from('produtos')
            .select('id, nome, preco_venda, custo, ativo, categoria, estoque')
            .order('nome');

        if (prodError) result.errors.push({ type: 'products', error: prodError });
        else result.products = prods;

        const { data: admins, error: adminError } = await supabase
            .from('profiles')
            .select('id, email, role');

        if (adminError) result.errors.push({ type: 'profiles', error: adminError });
        else result.admins = admins;

    } catch (e) {
        result.errors.push({ type: 'global', error: e.message });
    }

    fs.writeFileSync('inspection_results.json', JSON.stringify(result, null, 2));
    console.log('Results written to inspection_results.json');
    console.log(`Total Products: ${result.products.length}`);
    console.log(`Total Profiles: ${result.admins.length}`);
}

inspectData();
