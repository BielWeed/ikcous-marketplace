
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cafkrminfnokvgjqtkle.supabase.co';
const supabaseKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';

const supabase = createClient(supabaseUrl, supabaseKey);

async function listProfiles() {
    const { data, error } = await supabase
        .from('profiles')
        .select('email, role, full_name')
        .limit(100);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('--- User Profiles ---');
    console.table(data);
}

listProfiles();
