const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = process.env.NODE_ENV === 'production' 
  ? '.env.production' 
  : '.env.vercel';

let envPath = `./${envFile}`;
if (!fs.existsSync(envPath)) {
  envPath = '.env';
}

require('dotenv').config({ path: envPath });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in environment");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});

async function main() {
  console.log("Checking product_variants table rules and columns...");

  // check columns
  const { data: cols, error: errCols } = await supabase.rpc('execute_sql_query', {
    query: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'product_variants'"
  });

  if (errCols) {
    console.error("Error columns:", errCols);
  } else {
    console.log("Columns:", cols);
  }

  // check RLS
  const { data: rls, error: errRls } = await supabase.rpc('execute_sql_query', {
    query: "SELECT * FROM pg_policies WHERE tablename = 'product_variants'"
  });

  if (errRls) {
    console.error("Error RLS:", errRls);
  } else {
    console.log("Policies:", rls);
  }
}

main();
