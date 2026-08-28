import { useAuth } from "@/hooks/useAuth";
import { DataVault } from "@/lib/dataVault";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

// A RPC `get_admin_analytics_v2` tem `p_limit_days DEFAULT 90`: chamada sem
// argumento, ela devolve só 90 dias de `revenueHistory` — e o botão "Tudo"
// do gráfico do painel promete o histórico inteiro. Dez anos cobrem a vida
// de qualquer loja deste app; os dias vazios antes da primeira venda são
// aparados na exibição (`desdeOPrimeiroDiaDeMovimento`), não aqui.
export const JANELA_TUDO_DIAS = 3650;

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
  /** Pedidos com `status = 'delivered'`, desde sempre. Opcional: campo novo
   * na RPC `get_admin_analytics_v2`, ainda não aplicado em toda base. */
  deliveredTotal?: number;
  /** Pedidos com `payment_status IN ('pago','pago_apos_expirar',
   * 'recebido_na_entrega') AND status = 'cancelled'` — dinheiro recebido em
   * pedido cancelado. São TRÊS portas desde a migration `20261021000000`
   * (Task 2 de docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md):
   * o cliente que paga o PIX fora do prazo (`pago_apos_expirar`), o pedido
   * já pago que o admin cancela pelo painel (`pago`), que abre com um
   * clique, e agora a loja confirmando que recebeu na mão
   * (`recebido_na_entrega`, sem gateway nenhum). Quem ler só uma delas e
   * escrever um rótulo tipo "pagos depois de expirar" reproduz o defeito
   * que este campo existe para consertar — foi o que quase aconteceu aqui.
   * Mesma ressalva de `deliveredTotal` acima. */
  paidOnCancelled?: number;
}

// Memory cache for SWR pattern
let cachedStats: DashboardStats | null = null;
let cachedCategoryData: any = null;
// PAINEL-10: o cache era servido para QUALQUER range se o throttle
// ainda não tinha expirado — período B mostrava números de A.
let cachedCategoryRange: string | null = null;
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

/**
 * Traduz um erro bruto do banco/rede para a frase que a lojista lê no painel.
 *
 * REGRA DE OURO: cada ramo abaixo só promete uma causa quando dá para
 * DISTINGUIR essa causa de todas as outras que caem no mesmo ponto — os
 * quatro catch deste hook recebem erros da mesma fonte (RPC via
 * callRpcWithRetry), então qualquer erro que não bata num padrão inequívoco
 * fica na frase genérica. Errar para a genérica é seguro; instrução
 * específica errada ("faça login" quando logar não resolve) não é.
 *
 * O texto original do erro NÃO se perde: quem chama SEMPRE registra o erro
 * completo no console.error junto desta frase.
 */
function mensagemParaLojista(erro: unknown, acaoQueFalhou: string): string {
  const sinal =
    typeof erro === "object" && erro !== null
      ? (erro as { code?: unknown; message?: unknown })
      : {};
  const codigo = typeof sinal.code === "string" ? sinal.code : "";
  const texto = typeof sinal.message === "string" ? sinal.message : "";

  // Sessão: só quando o próprio token diz que venceu/é inválido (PGRST301 é
  // o código do PostgREST para JWT problemático). Um 401 genérico NÃO entra
  // aqui — pode ser chave de API errada, e "entre novamente" não resolveria.
  if (
    /\bjwt\b/i.test(texto) ||
    /session expired/i.test(texto) ||
    codigo === "PGRST301"
  ) {
    return "Sua sessão expirou. Entre novamente com sua conta e tente de novo.";
  }
  // Permissão: recusa do Postgres (42501) ou negação de RLS. Não promete que
  // logar resolve — pode ser configuração de acesso no servidor.
  if (
    codigo === "42501" ||
    /permission denied/i.test(texto) ||
    /row-level security/i.test(texto)
  ) {
    return "Sem permissão para acessar estes dados agora. Confirme que você entrou com a conta de administradora da loja.";
  }
  // Rede: textos canônicos de fetch falhado nos principais navegadores
  // (Chrome/Firefox/Safari/Node). Sem conexão, nenhuma consulta sai do lugar.
  if (
    /failed to fetch|networkerror|fetch failed|load failed|network request failed/i.test(
      texto,
    )
  ) {
    return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
  }
  // Tudo o resto (função RPC inexistente, erro 5xx, timeout, erro sem
  // mensagem): sem como nomear a causa com o que chegou — frase honesta que
  // dita a ação que costuma resolver.
  return `Não foi possível ${acaoQueFalhou} agora. Tente atualizar a página; se continuar, tente mais tarde.`;
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
                  { p_limit_days: JANELA_TUDO_DIAS },
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
            // PAINEL-02: sem isto, a falha persistente do background
            // deixava o cache velho servindo indefinidamente como se
            // fosse atual. O dashboard ja renderiza o error state
            // (linha 284) — agora ele fica sabendo.
            setError(
              "Não foi possível atualizar agora — exibindo a última atualização.",
            );
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
              { p_limit_days: JANELA_TUDO_DIAS },
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
        setError(mensagemParaLojista(err, "carregar o resumo do painel"));
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
      const rangeKey = `${start}:${end}`;
      const shouldRevalidate =
        forceRefresh ||
        !cachedCategoryData ||
        cachedCategoryRange !== rangeKey || // PAINEL-10: range diferente = cache inválido
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
              setCategoryError(
                mensagemParaLojista(err, "atualizar os dados de categorias"),
              );
              return;
            }
            if (data) {
              cachedCategoryData = data;
              cachedCategoryRange = rangeKey; // PAINEL-10
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
            setCategoryError(
              mensagemParaLojista(e, "atualizar os dados de categorias"),
            );
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
        cachedCategoryRange = rangeKey; // PAINEL-10
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
        setCategoryError(
          mensagemParaLojista(err, "carregar os dados de categorias"),
        );
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
