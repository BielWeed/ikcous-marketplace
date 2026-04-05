
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching profiles:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Columns in profiles table:', Object.keys(data[0]));
    } else {
        console.log('No data in profiles table to determine columns.');
        // Fallback: try to see if we can get columns from RPC or something else
    }
}

checkColumns();
