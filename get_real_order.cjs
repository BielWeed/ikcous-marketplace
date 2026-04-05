const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cafkrminfnokvgjqtkle.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhZmtybWluZm5va3ZnanF0a2xlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMTExMjU0NSwiZXhwIjoyMDI2Njg4NTQ1fQ.N-8Z_Y9X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X';
const supabase = createClient(supabaseUrl, supabaseKey);

async function getOrder() {
    const { data, error } = await supabase
        .from('marketplace_orders')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Erro:', error);
    } else {
        console.log('Pedido:', JSON.stringify(data[0], null, 2));
    }
}

getOrder();
