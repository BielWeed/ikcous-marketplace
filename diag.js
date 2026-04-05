
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ykzlsunvbeclpxkuzskk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZl9pZCI6InlremxzdW52YmVjbHB4a3V6c2trIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIwNDU5MDIsImV4cCI6MjA1NzYyMTkwMn0.Y8_gH90I459jY-Opbq28IWk5A8PoFV7WYPvVk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function runDiagnostics() {
    console.log('--- Running Diagnostics ---');

    // 1. Check product counts
    const { count: totalCount, error: totalError } = await supabase
        .from('produtos')
        .select('*', { count: 'exact', head: true });

    const { count: activeCount, error: activeError } = await supabase
        .from('produtos')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true);

    console.log(`Total Products (produtos): ${totalCount} (Error: ${totalError?.message || 'none'})`);
    console.log(`Active Products (ativo=true): ${activeCount} (Error: ${activeError?.message || 'none'})`);

    // 2. Check public view count
    const { count: viewCount, error: viewError } = await supabase
        .from('vw_produtos_public')
        .select('*', { count: 'exact', head: true });

    console.log(`Public View Count (vw_produtos_public): ${viewCount} (Error: ${viewError?.message || 'none'})`);

    // 3. Find admin profiles
    const { data: admins, error: adminError } = await supabase
        .from('profiles')
        .select('id, email, role')
        .eq('role', 'admin')
        .limit(5);

    console.log('Admin Profiles:', JSON.stringify(admins, null, 2) || 'none', `(Error: ${adminError?.message || 'none'})`);

    console.log('--- Diagnostics Complete ---');
}

runDiagnostics();
