
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ykzlsunvbeclpxkuzskk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlremxzdW52YmVjbHB4a3V6c2trIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgxMjI4NTUsImV4cCI6MjA1MzY5ODg1NX0.5-S6U_qS6U_qS6U_qS6U_qS6U_qS6U_qS6U_qS6U_qS6U_qS6U_qS6U_qS6U_qS6U_qS6U_qS6';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectData() {
    console.log('--- Product Analysis ---');
    const { data: prods, error } = await supabase
        .from('produtos')
        .select('id, nome, preco_venda, ativo, categoria')
        .order('nome');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Total Products: ${prods.length}`);

    const categories = {};
    const activeCount = prods.filter(p => p.ativo).length;
    const inactiveCount = prods.filter(p => !p.ativo).length;

    prods.forEach(p => {
        categories[p.categoria] = (categories[p.categoria] || 0) + 1;
    });

    console.log(`Active: ${activeCount}`);
    console.log(`Inactive: ${inactiveCount}`);
    console.log('Categories:', JSON.stringify(categories, null, 2));

    console.log('\n--- Sample Products (First 20) ---');
    console.table(prods.slice(0, 20));

    console.log('\n--- Profile Analysis (Admins) ---');
    const { data: admins, error: adminError } = await supabase
        .from('profiles')
        .select('email, role')
        .eq('role', 'admin');

    if (adminError) {
        console.error('Admin Error:', adminError);
    } else {
        console.log('Admins listed in profiles table:');
        console.table(admins);
    }
}

inspectData();
