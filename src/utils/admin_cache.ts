import { supabase } from '@/lib/supabase';

export interface Customer {
    id: string;
    email: string | null;
    full_name: string | null;
    phone: string | null;
    role: string;
    created_at: string;
    orders_count?: number;
    total_spent?: number;
    last_order_date?: string;
    avatar_url?: string;
    is_push_subscribed?: boolean;
}

export let cachedCustomersData: {
    customers: Customer[];
    total: number;
    stats: {
        total_customers: number;
        global_ltv: number;
        global_orders: number;
        new_customers_30d: number;
    };
} | null = null;

export function setCachedCustomersData(data: typeof cachedCustomersData) {
    cachedCustomersData = data;
}

export async function prefetchCustomersData() {
    try {
        const { data, error } = await (supabase.rpc as any)('get_admin_customers_paged', {
            p_search: '',
            p_sort_field: 'total_spent',
            p_sort_direction: 'desc',
            p_page: 0,
            p_page_size: 10
        });
        if (!error && data) {
            cachedCustomersData = {
                customers: data.data || [],
                total: data.total_count || 0,
                stats: data.stats
            };
        }
    } catch (e) {
        console.error('Prefetch customers failed:', e);
    }
}
