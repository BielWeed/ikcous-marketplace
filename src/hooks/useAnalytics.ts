import { useAuth } from "@/hooks/useAuth";
import { DataVault } from "@/lib/dataVault";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

async function callRpcWithRetry<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  retries = 3,
  delay = 500,
): Promise<{ data: T | null; error: any }> {
  let lastError: any = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fn();
      if (!res.error) {
        return res;
      }
      lastError = res.error;

      if (lastError.message?.includes("JWT") || lastError.status === 401) {
        const {
          data: { session },
        } = await supabase.auth.refreshSession();
        if (session) {
          const retryRes = await fn();
          if (!retryRes.error) return retryRes;
          lastError = retryRes.error;
        }
      }

      if (
        i < retries &&
        (!lastError.status ||
          lastError.status >= 500 ||
          lastError.status === 408)
      ) {
        await new Promise((resolve) => setTimeout(resolve, delay * 2 ** i));
      } else {
        break;
      }
    } catch (err: any) {
      lastError = err;
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, delay * 2 ** i));
      } else {
        break;
      }
    }
  }
  return { data: null, error: lastError };
}

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

const STATS_EVENT = "ikcous-admin-stats-updated";
const CATEGORY_EVENT = "ikcous-admin-category-updated";

function broadcastStats(data: DashboardStats | null) {
  if (typeof window !== "undefined" && data) {
    window.dispatchEvent(new CustomEvent(STATS_EVENT, { detail: data }));
  }
}

function broadcastCategory(data: any) {
  if (typeof window !== "undefined" && data) {
    window.dispatchEvent(new CustomEvent(CATEGORY_EVENT, { detail: data }));
  }
}

export function clearAnalyticsCache() {
  cachedStats = null;
  cachedCategoryData = null;
  lastStatsFetchTime = 0;
  lastCategoryFetchTime = 0;
}

export function useAnalytics() {
  const { isAdmin } = useAuth();
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const loading = summaryLoading || categoryLoading;
  const [error, setError] = useState<string | null>(null);
  // #104: estado de erro PRÓPRIO da análise por categoria — separado do
  // `error` acima (que é só do resumo executivo). Sem isto, uma falha na
  // RPC `get_category_analytics` não tinha como chegar até o bloco visual,
  // que caía no empty state "Sem Dados Registrados" mesmo quando a consulta
  // tinha quebrado, não devolvido zero linhas.
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(cachedStats);
  const [categoryData, setCategoryData] = useState<any>(cachedCategoryData);

  useEffect(() => {
    // Load from DataVault if memory cache is empty
    if (!cachedStats || !cachedCategoryData) {
      const loadCachedData = async () => {
        try {
          const vault = await DataVault.init();
          if (!cachedStats) {
            const localStats = await vault.getById<{
              id: string;
              data: DashboardStats;
            }>("store_config", "admin_dashboard_stats");
            if (localStats?.data) {
              cachedStats = localStats.data;
              setStats(cachedStats);
              broadcastStats(cachedStats);
            }
          }
          if (!cachedCategoryData) {
            const localCategory = await vault.getById<{
              id: string;
              data: any;
            }>("store_config", "admin_category_data");
            if (localCategory?.data) {
              cachedCategoryData = localCategory.data;
              setCategoryData(cachedCategoryData);
              broadcastCategory(cachedCategoryData);
            }
          }
        } catch (e) {
          console.error(
            "[useAnalytics] Failed to load local stats from DataVault:",
            e,
          );
        }
      };
      loadCachedData();
    }
  }, []);

  useEffect(() => {
    const handleStats = (e: Event) => {
      setStats((e as CustomEvent).detail);
    };
    const handleCategory = (e: Event) => {
      setCategoryData((e as CustomEvent).detail);
    };

    window.addEventListener(STATS_EVENT, handleStats);
    window.addEventListener(CATEGORY_EVENT, handleCategory);

    return () => {
      window.removeEventListener(STATS_EVENT, handleStats);
      window.removeEventListener(CATEGORY_EVENT, handleCategory);
    };
  }, []);

  const fetchExecutiveSummary = useCallback(
    async (forceRefresh = false): Promise<DashboardStats | null> => {
      if (!isAdmin) {
        console.warn(
          "[useAnalytics] fetchExecutiveSummary bypassed: user is not admin",
        );
        return null;
      }

      // Verify active session before calling RPC to avoid transient auth errors
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        console.warn(
          "[useAnalytics] fetchExecutiveSummary bypassed: user session not active in client",
        );
        return null;
      }

      const now = Date.now();
      const shouldRevalidate =
        forceRefresh ||
        !cachedStats ||
        now - lastStatsFetchTime > REVALIDATION_THROTTLE_MS;

      if (cachedStats && !shouldRevalidate) {
        // Stats are cached and fresh, return immediately
        return cachedStats;
      }

      if (cachedStats && !forceRefresh) {
        // Background revalidation
        (async () => {
          try {
            const { data, error: err } = await callRpcWithRetry<DashboardStats>(
              async () => {
                const { data, error } = await supabase.rpc(
                  "get_admin_analytics_v2",
                );
                return { data: data as DashboardStats | null, error };
              },
            );
            if (!err && data) {
              cachedStats = data;
              lastStatsFetchTime = Date.now();
              setStats(cachedStats);
              broadcastStats(cachedStats);

              // Persist in DataVault
              DataVault.init()
                .then((vault) => {
                  vault.put("store_config", {
                    id: "admin_dashboard_stats",
                    data: cachedStats,
                  });
                })
                .catch(() => {});
            }
          } catch (e) {
            console.error("Background fetch stats failed:", e);
          }
        })();
        return cachedStats;
      }

      try {
        setSummaryLoading(true);
        setError(null);

        const { data, error: err } = await callRpcWithRetry<DashboardStats>(
          async () => {
            const { data, error } = await supabase.rpc(
              "get_admin_analytics_v2",
            );
            return { data: data as DashboardStats | null, error };
          },
        );

        if (err) throw err;
        cachedStats = data as any as DashboardStats;
        lastStatsFetchTime = Date.now();
        setStats(cachedStats);
        broadcastStats(cachedStats);

        // Persist in DataVault
        DataVault.init()
          .then((vault) => {
            vault.put("store_config", {
              id: "admin_dashboard_stats",
              data: cachedStats,
            });
          })
          .catch(() => {});

        return cachedStats;
      } catch (err: any) {
        console.error("Error fetching executive summary:", err);
        setError(err.message || "Error fetching executive summary");
        return null;
      } finally {
        setSummaryLoading(false);
      }
    },
    [isAdmin],
  );

  const fetchRetentionAnalytics = useCallback(async () => {
    try {
      // Verify active session before calling RPC to avoid transient auth errors
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        console.warn(
          "[useAnalytics] fetchRetentionAnalytics bypassed: user session not active in client",
        );
        return null;
      }

      const { data, error } = await callRpcWithRetry<any>(() =>
        (supabase as any).rpc("get_retention_rate"),
      );
      if (error) throw error;
      return data;
    } catch (err) {
      console.error("Error fetching retention analytics:", err);
      return null;
    }
  }, []);

  const fetchCategoryAnalytics = useCallback(
    async (start: string, end: string, forceRefresh = false) => {
      // Verify active session before calling RPC to avoid transient auth errors
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        console.warn(
          "[useAnalytics] fetchCategoryAnalytics bypassed: user session not active in client",
        );
        return null;
      }

      const now = Date.now();
      const shouldRevalidate =
        forceRefresh ||
        !cachedCategoryData ||
        now - lastCategoryFetchTime > REVALIDATION_THROTTLE_MS;

      if (cachedCategoryData && !shouldRevalidate) {
        return cachedCategoryData;
      }

      if (cachedCategoryData && !forceRefresh) {
        // Background revalidation. #104: essa IIFE não é aguardada pelo
        // chamador (dado stale volta na hora), mas uma falha aqui NÃO pode
        // ficar muda — antes só olhava `data` e ignorava `error`, então uma
        // RPC quebrada em segundo plano desaparecia sem deixar rastro.
        (async () => {
          try {
            const { data, error: err } = await callRpcWithRetry<any>(() =>
              (supabase as any).rpc("get_category_analytics", {
                start_date: start,
                end_date: end,
              }),
            );
            if (err) {
              console.error("Background fetch category failed:", err);
              setCategoryError(err.message || "Erro ao atualizar categorias");
              return;
            }
            if (data) {
              cachedCategoryData = data;
              lastCategoryFetchTime = Date.now();
              setCategoryData(data);
              setCategoryError(null);
              broadcastCategory(data);

              // Persist in DataVault
              DataVault.init()
                .then((vault) => {
                  vault.put("store_config", {
                    id: "admin_category_data",
                    data: cachedCategoryData,
                  });
                })
                .catch(() => {});
            }
          } catch (e: any) {
            console.error("Background fetch category failed:", e);
            setCategoryError(e?.message || "Erro ao atualizar categorias");
          }
        })();
        return cachedCategoryData;
      }

      try {
        setCategoryLoading(true);
        const { data, error } = await callRpcWithRetry<any>(() =>
          (supabase as any).rpc("get_category_analytics", {
            start_date: start,
            end_date: end,
          }),
        );
        if (error) throw error;
        cachedCategoryData = data;
        lastCategoryFetchTime = Date.now();
        setCategoryData(data);
        setCategoryError(null);
        broadcastCategory(data);

        // Persist in DataVault
        DataVault.init()
          .then((vault) => {
            vault.put("store_config", {
              id: "admin_category_data",
              data: cachedCategoryData,
            });
          })
          .catch(() => {});

        return data;
      } catch (err: any) {
        console.error("Error fetching category analytics:", err);
        setCategoryError(err?.message || "Erro ao carregar categorias");
        return null;
      } finally {
        setCategoryLoading(false);
      }
    },
    [],
  );

  return {
    loading,
    error,
    categoryError,
    stats,
    categoryData,
    fetchExecutiveSummary,
    fetchRetentionAnalytics,
    fetchCategoryAnalytics,
  };
}
