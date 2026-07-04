import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

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
        profit: number;
        cost_sold: number;
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
    inventory?: {
        totalCost: number;
        totalValue: number;
    };
    averageTicket?: number;
}


// Memory cache for SWR pattern
let cachedStats: DashboardStats | null = null;
let cachedCategoryData: any = null;
let lastStatsFetchTime = 0;
let lastCategoryFetchTime = 0;
const REVALIDATION_THROTTLE_MS = 30000; // 30 seconds

export function useAnalytics() {
    const { isAdmin } = useAuth();
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [categoryLoading, setCategoryLoading] = useState(false);
    const loading = summaryLoading || categoryLoading;
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<DashboardStats | null>(cachedStats);
    const [categoryData, setCategoryData] = useState<any>(cachedCategoryData);

    const fetchExecutiveSummary = useCallback(async (forceRefresh = false): Promise<DashboardStats | null> => {
        if (!isAdmin) {
            console.warn('[useAnalytics] fetchExecutiveSummary bypassed: user is not admin');
            return null;
        }

        // Verify active session before calling RPC to avoid transient auth errors
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            console.warn('[useAnalytics] fetchExecutiveSummary bypassed: user session not active in client');
            return null;
        }

        const now = Date.now();
        const shouldRevalidate = forceRefresh || !cachedStats || (now - lastStatsFetchTime) > REVALIDATION_THROTTLE_MS;

        if (cachedStats && !shouldRevalidate) {
            // Stats are cached and fresh, return immediately
            return cachedStats;
        }

        if (cachedStats && !forceRefresh) {
            // Background revalidation
            (async () => {
                try {
                    const { data, error: err } = await supabase.rpc('get_admin_analytics_v2');
                    if (!err && data) {
                        cachedStats = data as any as DashboardStats;
                        lastStatsFetchTime = Date.now();
                        setStats(cachedStats);
                    }
                } catch (e) {
                    console.error('Background fetch stats failed:', e);
                }
            })();
            return cachedStats;
        }

        try {
            setSummaryLoading(true);
            setError(null);
            
            const { data, error: err } = await supabase.rpc('get_admin_analytics_v2');
            
            if (err) throw err;
            cachedStats = data as any as DashboardStats;
            lastStatsFetchTime = Date.now();
            setStats(cachedStats);
            return cachedStats;
        } catch (err: any) {
            console.error('Error fetching executive summary:', err);
            setError(err.message || 'Error fetching executive summary');
            return null;
        } finally {
            setSummaryLoading(false);
        }
    }, [isAdmin]);

    const fetchRetentionAnalytics = useCallback(async () => {
        try {
            // Verify active session before calling RPC to avoid transient auth errors
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                console.warn('[useAnalytics] fetchRetentionAnalytics bypassed: user session not active in client');
                return null;
            }

            const { data } = await (supabase as any).rpc('get_retention_rate');
            return data;
        } catch (err) {
            console.error('Error fetching retention analytics:', err);
            return null;
        }
    }, []);

    const fetchCategoryAnalytics = useCallback(async (start: string, end: string, forceRefresh = false) => {
        // Verify active session before calling RPC to avoid transient auth errors
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            console.warn('[useAnalytics] fetchCategoryAnalytics bypassed: user session not active in client');
            return null;
        }

        const now = Date.now();
        const shouldRevalidate = forceRefresh || !cachedCategoryData || (now - lastCategoryFetchTime) > REVALIDATION_THROTTLE_MS;

        if (cachedCategoryData && !shouldRevalidate) {
            return cachedCategoryData;
        }

        if (cachedCategoryData && !forceRefresh) {
            // Background revalidation
            (async () => {
                try {
                    const { data } = await (supabase as any).rpc('get_category_analytics', { 
                        start_date: start, 
                        end_date: end 
                    });
                    if (data) {
                        cachedCategoryData = data;
                        lastCategoryFetchTime = Date.now();
                        setCategoryData(data);
                    }
                } catch (e) {
                    console.error('Background fetch category failed:', e);
                }
            })();
            return cachedCategoryData;
        }

        try {
            setCategoryLoading(true);
            const { data, error } = await (supabase as any).rpc('get_category_analytics', { 
                start_date: start, 
                end_date: end 
            });
            if (error) throw error;
            cachedCategoryData = data;
            lastCategoryFetchTime = Date.now();
            setCategoryData(data);
            return data;
        } catch (err) {
            console.error('Error fetching category analytics:', err);
            return null;
        } finally {
            setCategoryLoading(false);
        }
    }, []);

    return {
        loading,
        error,
        stats,
        categoryData,
        fetchExecutiveSummary,
        fetchRetentionAnalytics,
        fetchCategoryAnalytics
    };
}

