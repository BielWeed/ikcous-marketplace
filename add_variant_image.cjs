const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();

async function addVariantImage() {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL or Key is missing');
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/check_db`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        query: `ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_url TEXT;`
      })
    });

    const result = await response.text();
    console.log('Result:', result);
  } catch (err) {
    console.error('Error:', err);
  }
}
addVariantImage();
