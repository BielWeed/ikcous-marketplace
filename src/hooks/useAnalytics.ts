import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface DashboardStats {
    today: {
        revenue: number;
        count: number;
        pending: number;
        revenueTrend: number;
        countTrend: number;
    };
    month: {
        revenue: number;
        count: number;
        revenueTrend: number;
        countTrend: number;
    };
    executive: {
        totalRevenue: number;
        totalOrders: number;
        revenueTrend: number;
        ordersTrend: number;
        avgTicket: number;
        avgTicketTrend: number;
        activeCustomers: number;
        activeCustomersTrend: number;
    };
    revenueHistory: Array<{
        date: string;
        full_date: string;
        revenue: number;
        orders: number;
    }>;
    topProducts: Array<{
        id: string;
        name: string;
        quantity: number;
        total: number;
        image: string;
    }>;
    inventoryAlerts: number;
    growth?: number;
}


export function useAnalytics() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchExecutiveSummary = useCallback(async (): Promise<DashboardStats | null> => {
        try {
            setLoading(true);
            setError(null);
            
            const { data, error: err } = await supabase.rpc('get_admin_analytics_v2');
            
            if (err) throw err;
            return data as any as DashboardStats;
        } catch (err: any) {

            console.error('Error fetching executive summary:', err);
            setError(err.message || 'Error fetching executive summary');
            return null;
        } finally {
            setLoading(false);
        }
    }, []);


    const fetchRetentionAnalytics = useCallback(async () => {
        try {
            const { data } = await (supabase as any).rpc('get_retention_rate');
            return data;
        } catch (err) {
            console.error('Error fetching retention analytics:', err);
            return null;
        }
    }, []);

    const fetchCategoryAnalytics = useCallback(async (start: string, end: string) => {
        try {
            const { data } = await (supabase as any).rpc('get_category_analytics', { 
                start_date: start, 
                end_date: end 
            });
            return data;
        } catch (err) {
            console.error('Error fetching category analytics:', err);
            return null;
        }
    }, []);

    return {
        loading,
        error,
        fetchExecutiveSummary,
        fetchRetentionAnalytics,
        fetchCategoryAnalytics
    };
};

