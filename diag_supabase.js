import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cafkrminfnokvgjqtkle.supabase.co';
const supabaseAnonKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  try {
    console.log('--- Supabase Public Data Check ---');
    
    // Check Products from View
    const { data: viewData, error: viewError } = await supabase
      .from('vw_produtos_public')
      .select('*');
    
    if (viewError) {
      console.error('Error fetching from view:', viewError);
    } else {
      console.log(`Products in Public View: ${viewData?.length || 0}`);
    }
    
    // Check Products from Table (should fail if RLS is strict, or show same/more)
    const { data: tableData, error: tableError } = await supabase
      .from('produtos')
      .select('*');
      
    if (tableError) {
      console.error('Error fetching from table:', tableError);
    } else {
      console.log(`Products in Table (Anon): ${tableData?.length || 0}`);
    }

    // Check Categories
    if (tableData && tableData.length > 0) {
        const categories = [...new Set(tableData.map(p => p.categoria || p.category))];
        console.log('Categories found:', categories.join(', '));
    }

  } catch (err) {
    console.error('Exception:', err);
  }
}

check();
