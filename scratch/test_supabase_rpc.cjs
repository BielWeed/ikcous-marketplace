const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://cafkrminfnokvgjqtkle.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testSupabaseRPC() {
    // Connect via pg first to insert a temporary coupon
    const connectionString = 'postgresql://postgres.cafkrminfnokvgjqtkle:IsaBiel%40hgfwq1@aws-0-us-west-2.pooler.supabase.com:6543/postgres';
    const pgClient = new Client({ connectionString });

    try {
        await pgClient.connect();
        console.log('Inserting temporary coupon TEST20...');
        await pgClient.query(`
            INSERT INTO public.coupons (code, type, value, active, usage_limit, usage_count, min_purchase)
            VALUES ('TEST20', 'percentage', 20, true, 5, 0, 50)
            ON CONFLICT (code) DO NOTHING;
        `);

        console.log('Calling RPC via Supabase JS client...');
        const { data, error } = await supabase.rpc('validate_coupon_secure_v2', {
            p_code: 'TEST20',
            p_subtotal: 100
        });

        if (error) {
            console.error('Supabase RPC Error:', error);
        } else {
            console.log('Supabase RPC Data:', JSON.stringify(data, null, 2));
            console.log('Type of Data:', typeof data);
            console.log('Is Array?', Array.isArray(data));
            console.log('Data[0]:', data?.[0]);
        }

        console.log('Cleaning up temporary coupon...');
        await pgClient.query("DELETE FROM public.coupons WHERE code = 'TEST20';");
    } catch (err) {
        console.error('Error during test:', err);
    } finally {
        await pgClient.end();
    }
}

testSupabaseRPC();
