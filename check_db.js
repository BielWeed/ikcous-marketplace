const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase.from('vw_produtos_public').select('*').limit(1);
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Sample data:', data);
  }
}
check();
