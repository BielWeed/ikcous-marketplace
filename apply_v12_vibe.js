
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const sqlPath = './supabase/migrations/20260309_solo_ninja_v12_final_security_consolidation.sql';
const sql = fs.readFileSync(sqlPath, 'utf8');

async function applyFix() {
    console.log('Applying v12 RPC fix via apply_sql...');

    const { data, error } = await supabase.rpc('apply_sql', { sql_query: sql });

    if (error) {
        console.error('Error applying fix via RPC:', error);
        process.exit(1);
    } else {
        console.log('Fix applied successfully via RPC!');
        process.exit(0);
    }
}

applyFix();
