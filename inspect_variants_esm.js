import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://cafkrminfnokvgjqtkle.supabase.co';
const supabaseKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectData() {
    console.log('--- Inspecting Products and Variants ---');

    // Fetch all products
    const { data: products, error: pError } = await supabase
        .from('produtos')
        .select('id, nome, estoque, preco_venda, custo');

    if (pError) {
        console.error('Error fetching products:', pError);
        return;
    }

    // Fetch all variants
    const { data: variants, error: vError } = await supabase
        .from('product_variants')
        .select('*');

    if (vError) {
        console.error('Error fetching variants:', vError);
        return;
    }

    const results = products.map(p => {
        const pVariants = variants.filter(v => v.product_id === p.id);
        const variantStockSum = pVariants.reduce((sum, v) => sum + (Number(v.stock_increment) || 0), 0);
        const totalPotentialStock = Number(p.estoque) + variantStockSum;

        return {
            ID: p.id,
            Nome: p.nome,
            EstoqueBase: p.estoque,
            TotalVariantes: pVariants.length,
            SomaStockVariantes: variantStockSum,
            StockTotalReal: totalPotentialStock,
            Preco: p.preco_venda,
            Custo: p.custo
        };
    });

    const output = {
        allProducts: results,
        withVariants: results.filter(r => r.TotalVariantes > 0)
    };

    fs.writeFileSync('product_inspection_full.json', JSON.stringify(output, null, 2));
    console.log('Results saved to product_inspection_full.json');
}

inspectData();
