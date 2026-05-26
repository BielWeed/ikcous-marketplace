const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://cafkrminfnokvgjqtkle.supabase.co';
const supabaseKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const email = 'antigravity-test-auth@example.com';
  const password = 'Antigravity#2026!Secure';
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: 'Antigravity Test',
        phone: '(34) 99999-9999'
      }
    }
  });
  if (error) {
    console.error('Error during signup:', error.message);
  } else {
    console.log('Signup successful:', data.user ? data.user.id : 'no user returned');
  }
}
run();
