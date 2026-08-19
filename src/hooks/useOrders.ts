import { clearAnalyticsCache } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { mapOrderFromDB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";
import type { DashboardSummary, Order, OrderStatus } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface SharedSubscription {
  channel: any;
  refCount: number;
  callbacks: Set<(payload: any) => void>;
  cleanupTimeout?: ReturnType<typeof setTimeout>;
}
const globalOrderSubscriptions = new Map<string, SharedSubscription>();

const validateStatusUpdate = (
  order: Order | undefined,
  isAdmin: boolean,
  status: OrderStatus,
  silent: boolean,
) => {
  if (!isAdmin) {
    if (status !== "cancelled") {
      const errorMsg = "Usuários só podem cancelar pedidos";
      if (!silent) toast.error(errorMsg);
      throw new Error(errorMsg);
    }

    if (order && order.status !== "pending") {
      const errorMsg = "Apenas pedidos pendentes podem ser cancelados";
      if (!silent) toast.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
};

async function syncOfflineOrderUpdates(): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.onLine) return false;
  const queueStr = localStorage.getItem("orders_offline_updates_queue");
  if (!queueStr) return false;

  try {
    const queue = JSON.parse(queueStr);
    if (!Array.isArray(queue) || queue.length === 0) return false;

    const remainingQueue: any[] = [];
    const toastId = toast.loading(
      `Sincronizando ${queue.length} atualizações de status de pedidos offline...`,
    );

    for (const item of queue) {
      const { orderId, status, notes, silent } = item;
      try {
        const { error } = await (supabase.rpc as any)(
          "update_order_status_atomic",
          {
            p_order_id: orderId,
            p_new_status: status,
            p_notes: notes || null,
            p_silent: silent || false,
          },
        );

        if (error) throw error;
      } catch (err) {
        console.error(
          "[Offline Sync] Failed to sync order status %s:",
          orderId,
          err,
        );
        remainingQueue.push(item);
      }
    }

    const syncedAny = remainingQueue.length < queue.length;

    if (remainingQueue.length > 0) {
      localStorage.setItem(
        "orders_offline_updates_queue",
        JSON.stringify(remainingQueue),
      );
      toast.error(
        `Falha ao sincronizar ${remainingQueue.length} alterações de pedidos. Tentando novamente mais tarde.`,
        { id: toastId },
      );
    } else {
      localStorage.removeItem("orders_offline_updates_queue");
      clearAnalyticsCache();
      toast.success(
        "Todas as atualizações de status de pedidos foram sincronizadas!",
        { id: toastId },
      );
    }

    return syncedAny;
  } catch (e) {
    console.error("[Offline Sync] Error parsing offline orders queue:", e);
    return false;
  }
}

// Memory cache for Admin Orders (SWR Pattern)
let cachedAdminOrders: Order[] | null = null;
let cachedAdminTotalOrders = 0;

/**
 * CHECKOUT-080 (#213): o conjunto fechado que `criar-pagamento` (edge
 * function) emite no campo `statusPagamento` — o MESMO `payment_status` que
 * a coluna `marketplace_orders.payment_status` já usa (CHECK constraint
 * marketplace_orders_payment_status_check). `pago_apos_expirar` fica de
 * fora de propósito: só a RPC `confirmar_pagamento` produz esse valor,
 * olhando o estado ATUAL do pedido no banco — `criar-pagamento` não tem
 * como emitir isso na resposta de uma criação/reconsulta.
 *
 * ESCOLHA DE TIPAGEM (relatório da CHECKOUT-080): o campo do retorno de
 * `criarPagamento`, abaixo, é `statusPagamento: string`, NÃO
 * `StatusPagamentoConhecido` — mesmo esta união existindo. O ramo de
 * RECONSULTA da Orders API (`criar-pagamento/index.ts`, par desconhecido)
 * devolve o par CRU "status:status_detail" quando o MP manda uma
 * combinação que `mapearStatusOrder` não reconhece; o ramo clássico
 * devolve o `status` cru do MP quando `mapearStatus` também não reconhece.
 * Tipar o campo como a união fechada seria dizer ao TypeScript algo que o
 * runtime não garante — e um `as StatusPagamentoConhecido` no meio do
 * caminho só esconderia a mentira, não a resolveria. `string` deixa
 * PagamentoOnline.tsx comparar `statusPagamento` contra os literais deste
 * conjunto (com "valor desconhecido = terminal" como rede de segurança),
 * sem o TypeScript prometer algo que a função pode não entregar.
 *
 * Achado da revisão da CHECKOUT-080: esta união teve, por uma rodada, um
 * type guard de pertencimento (`ehStatusPagamentoConhecido`) que NINGUÉM
 * chamava — e cuja semântica (`"recusado"` é "conhecido") era o OPOSTO da
 * checagem que `PagamentoOnline.tsx` faz de verdade (lá "conhecido" quer
 * dizer "pode seguir", e `"recusado"` é justamente um dos terminais). Foi
 * apagado por isso: superfície morta que mente sobre o próprio nome é pior
 * que não existir.
 */
export type StatusPagamentoConhecido =
  | "aguardando"
  | "pago"
  | "recusado"
  | "expirado"
  | "estornado";

/** Argumentos de uma chamada de `loadOrders`, guardados para poder repeti-la. */
export type ConsultaAdmin = [
  page?: number,
  pageSize?: number,
  statusFilter?: string,
  searchQuery?: string,
  startDate?: string,
  endDate?: string,
  silent?: boolean,
];

/**
 * Escolhe QUAL consulta o realtime deve repetir quando a conexão volta
 * (PEDIDO-030, #83).
 *
 * O `useOrders` serve as duas metades do app pelo mesmo hook: o cliente, com
 * `fetchUserOrders` (filtra por `user_id`), e o painel, com `loadOrders`
 * (paginada, sem filtro de dono). Os três caminhos de reconexão —
 * `handleReconnect`, `handleVisibilityChange` e `handleOnline` — chamavam sempre
 * a consulta do CLIENTE.
 *
 * Para a lojista isso devolvia zero, porque ela não compra na própria loja: o
 * painel passava a dizer "Ainda não tem nenhum pedido" com a paginação ainda
 * indicando várias páginas, e com pedido real parado esperando ser separado.
 * Cair e voltar a rede é rotina em celular; o defeito aparecia sozinho.
 *
 * Duas escolhas dentro desta função, e as duas são sobre não trocar um estrago
 * por outro:
 *
 * - **`silent` forçado para true** no modo admin: a recarga acontece sem ela
 *   pedir, no meio da operação. Acender o esqueleto de carregamento por cima da
 *   lista assusta igual ao defeito original.
 * - **sem consulta anterior, não dispara nada**: não há página nem filtro a
 *   preservar, e a tela do painel já carrega ao montar. Chamar com os valores
 *   padrão jogaria a lojista de volta para a página 1 sem filtro.
 */
export function escolherRecargaDeReconexao(deps: {
  isAdmin: boolean;
  fetchUserOrders: () => Promise<unknown>;
  loadOrders: (...args: ConsultaAdmin) => Promise<unknown>;
  ultimaConsultaAdmin: ConsultaAdmin | null;
}): () => Promise<unknown> {
  const { isAdmin, fetchUserOrders, loadOrders, ultimaConsultaAdmin } = deps;

  if (!isAdmin) return () => fetchUserOrders();

  if (!ultimaConsultaAdmin) return () => Promise.resolve();

  const [page, pageSize, statusFilter, searchQuery, startDate, endDate] =
    ultimaConsultaAdmin;

  return () =>
    loadOrders(
      page,
      pageSize,
      statusFilter,
      searchQuery,
      startDate,
      endDate,
      true,
    );
}

export function useOrders(
  enabled = true,
  isAdmin = false,
  options?: { onRealtimeEvent?: (payload: any) => void },
) {
  const { user, isAdmin: isUserAdmin } = useAuth();
  const { isLeader } = useLeaderElection();
  const userOrdersAbortControllerRef = useRef<AbortController | null>(null);
  const adminOrdersAbortControllerRef = useRef<AbortController | null>(null);
  const [orders, setOrders] = useState<Order[]>(() => {
    if (isAdmin) return cachedAdminOrders || [];
    if (typeof window === "undefined" || !user?.id) return [];
    try {
      const cacheKey = `ikcous_orders_cache_${user.id}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Error loading cached orders:", e);
    }
    return [];
  });
  const [loading, setLoading] = useState(enabled);
  const [totalOrders, setTotalOrders] = useState(() => {
    return isAdmin ? cachedAdminTotalOrders : 0;
  });

  // Synchronously load cache on mount or when user changes
  useEffect(() => {
    if (isAdmin) return;

    // Mesma regra do fetch: só troca a referência se o conteúdo mudou. Aqui o
    // efeito roda pouco (só quando o usuário muda), mas manter as duas
    // escritas com a mesma disciplina evita que a próxima pessoa reintroduza o
    // loop da PEDIDO-040 por este caminho.
    if (!user?.id) {
      setOrders((atual) => (atual.length === 0 ? atual : []));
      return;
    }
    const cacheKey = `ikcous_orders_cache_${user.id}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setOrders((atual) =>
            JSON.stringify(atual) === JSON.stringify(parsed) ? atual : parsed,
          );
        }
      }
    } catch (e) {
      console.error("Error loading cached orders:", e);
    }
  }, [user?.id, isAdmin]);

  // Fetch orders for the logged-in user
  const fetchUserOrders = useCallback(async () => {
    if (!user || !enabled) return [];
    const cacheKey = `ikcous_orders_cache_${user.id}`;
    let hasCache = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        hasCache = true;
      }
    } catch {
      // ignore localStorage issues
    }

    if (userOrdersAbortControllerRef.current) {
      userOrdersAbortControllerRef.current.abort();
    }
    userOrdersAbortControllerRef.current = new AbortController();
    const signal = userOrdersAbortControllerRef.current.signal;

    if (!hasCache) {
      setLoading(true);
    }
    try {
      const query = supabase
        .from("marketplace_orders")
        .select(
          `
          *,
          items:marketplace_order_items(*, product:produtos(imagem_url, imagem_urls)),
          address:user_addresses(*)
        `,
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .abortSignal(signal);

      const { data, error } = await query;

      if (error) throw error;

      if (data) {
        const mappedOrders = data.map((item) => mapOrderFromDB(item as any));
        const serializado = JSON.stringify(mappedOrders);

        // Devolver a MESMA referência quando o resultado não mudou faz o React
        // desistir do re-render. Sem isto, `setOrders` trocava a referência a
        // cada volta — inclusive para lista vazia, porque `if (data)` é
        // verdadeiro para `[]` — e quem tivesse `orders` nas dependências de um
        // useCallback ficava em loop de requisição. Era o caso do
        // OrderDetailsView para usuário logado sem nenhum pedido (PEDIDO-040,
        // #84).
        //
        // A comparação é contra o state ATUAL, não contra o último fetch: se um
        // update otimista mexeu na lista e o servidor devolver o valor antigo,
        // a tela precisa voltar para o que o servidor diz.
        setOrders((atual) =>
          JSON.stringify(atual) === serializado ? atual : mappedOrders,
        );
        localStorage.setItem(cacheKey, serializado);
        return mappedOrders;
      }
      return [];
    } catch (err: any) {
      if (
        err?.name === "AbortError" ||
        err?.message === "Fetch is aborted" ||
        err?.message?.includes("aborted")
      ) {
        return [];
      }
      console.error("Error fetching user orders:", err);
      toast.error("Erro ao carregar seus pedidos");
      return [];
    } finally {
      setLoading(false);
    }
  }, [user, enabled]);

  // Load orders with pagination (Admin) - Optimized
  const loadOrders = useCallback(
    async (
      page = 0,
      pageSize = 20,
      statusFilter?: string,
      searchQuery?: string,
      startDate?: string,
      endDate?: string,
      silent = false,
    ) => {
      if (!enabled) return { orders: [], total: 0 };

      // Guarda a consulta para a reconexao poder repetir ESTA pagina e ESTE
      // filtro em vez de jogar a lojista para a pagina 1 (PEDIDO-030, #83).
      ultimaConsultaAdminRef.current = [
        page,
        pageSize,
        statusFilter,
        searchQuery,
        startDate,
        endDate,
        silent,
      ];

      if (adminOrdersAbortControllerRef.current) {
        adminOrdersAbortControllerRef.current.abort();
      }
      adminOrdersAbortControllerRef.current = new AbortController();
      const signal = adminOrdersAbortControllerRef.current.signal;

      try {
        if (!silent) {
          setLoading(true);
        }

        const query = (supabase.rpc as any)("get_admin_orders_paged", {
          p_search: searchQuery || "",
          p_status: statusFilter || "all",
          p_start_date: startDate || "",
          p_end_date: endDate || "",
          p_page: page,
          p_page_size: pageSize,
        }).abortSignal(signal);

        const { data, error } = await query;

        if (error) throw error;

        if (data) {
          const orderData = data.data || [];
          const totalCount = Number(data.total_count) || 0;

          const mappedOrders = orderData.map((item: any) =>
            mapOrderFromDB(item),
          );
          setOrders(mappedOrders);
          setTotalOrders(totalCount);

          cachedAdminOrders = mappedOrders;
          cachedAdminTotalOrders = totalCount;

          return { orders: mappedOrders, total: totalCount };
        }
        return { orders: [], total: 0 };
      } catch (err: any) {
        if (
          err?.name === "AbortError" ||
          err?.message === "Fetch is aborted" ||
          err?.message?.includes("aborted")
        ) {
          return { orders: [], total: 0 };
        }
        console.error("Error loading orders:", err);
        toast.error("Erro ao carregar pedidos");
        return { orders: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    [enabled],
  );

  // Wrapper for backward compatibility
  const fetchOrders = useCallback(
    async (limitCount?: number) => {
      return loadOrders(0, limitCount || 50);
    },
    [loadOrders],
  );

  const handleRealtimeInsert = useCallback(
    async (newPayload: any) => {
      const { data, error } = await supabase
        .from("marketplace_orders")
        .select(
          "*, items:marketplace_order_items(*, product:produtos(imagem_url, imagem_urls)), address:user_addresses(*)",
        )
        .eq("id", newPayload.id)
        .single();

      if (!error && data) {
        if (!isAdmin && data.user_id !== user?.id) return;
        const newOrder = mapOrderFromDB(data as any);
        setOrders((prev) => {
          if (prev.some((o) => o.id === newOrder.id)) return prev;
          const updated = [newOrder, ...prev];
          if (user?.id && !isAdmin) {
            const cacheKey = `ikcous_orders_cache_${user.id}`;
            localStorage.setItem(cacheKey, JSON.stringify(updated));
          }
          return updated;
        });
        if (!isAdmin && !onRealtimeEventRef.current) {
          toast.info(`Novo pedido recebido! #${newOrder.id.slice(0, 8)}`);
        }
      }
    },
    [isAdmin, user?.id],
  );

  const handleRealtimeUpdate = useCallback(
    (updatedOrder: any) => {
      if (!updatedOrder.id) return;
      setOrders((prev) => {
        const updated = prev.map((o) =>
          o.id === updatedOrder.id
            ? {
                ...o,
                status: updatedOrder.status,
                trackingCode: updatedOrder.tracking_code,
              }
            : o,
        );
        if (user?.id && !isAdmin) {
          const cacheKey = `ikcous_orders_cache_${user.id}`;
          localStorage.setItem(cacheKey, JSON.stringify(updated));
        }
        return updated;
      });
    },
    [isAdmin, user?.id],
  );

  const handleRealtimeDelete = useCallback(
    (oldId: string | undefined) => {
      if (oldId) {
        setOrders((prev) => {
          const updated = prev.filter((o) => o.id !== oldId);
          if (user?.id && !isAdmin) {
            const cacheKey = `ikcous_orders_cache_${user.id}`;
            localStorage.setItem(cacheKey, JSON.stringify(updated));
          }
          return updated;
        });
      }
    },
    [isAdmin, user?.id],
  );

  const ultimaConsultaAdminRef = useRef<ConsultaAdmin | null>(null);
  const fetchUserOrdersRef = useRef(fetchUserOrders);
  /**
   * O que os tres caminhos de reconexao devem recarregar: a consulta pessoal do
   * cliente, ou a paginada do painel na pagina e no filtro em que a lojista
   * estava (PEDIDO-030, #83). Ver `escolherRecargaDeReconexao`.
   */
  const recarregarAposReconexaoRef = useRef<() => Promise<unknown>>(() =>
    Promise.resolve(),
  );
  const handleRealtimeInsertRef = useRef(handleRealtimeInsert);
  const handleRealtimeUpdateRef = useRef(handleRealtimeUpdate);
  const handleRealtimeDeleteRef = useRef(handleRealtimeDelete);
  const onRealtimeEventRef = useRef(options?.onRealtimeEvent);

  useEffect(() => {
    fetchUserOrdersRef.current = fetchUserOrders;
    recarregarAposReconexaoRef.current = escolherRecargaDeReconexao({
      isAdmin,
      fetchUserOrders,
      loadOrders,
      ultimaConsultaAdmin: ultimaConsultaAdminRef.current,
    });
    handleRealtimeInsertRef.current = handleRealtimeInsert;
    handleRealtimeUpdateRef.current = handleRealtimeUpdate;
    handleRealtimeDeleteRef.current = handleRealtimeDelete;
    onRealtimeEventRef.current = options?.onRealtimeEvent;
  });

  // Realtime subscription for orders
  useEffect(() => {
    if (!enabled || !user?.id) return;

    const channelId = isAdmin
      ? "admin_order_updates"
      : `order_updates_${user.id}`;
    let isUnmounting = false;
    let isConnecting = false;
    let retryCount = 0;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let visibilityTimeout: ReturnType<typeof setTimeout> | undefined;
    let onlineTimeout: ReturnType<typeof setTimeout> | undefined;

    const bc =
      typeof window !== "undefined"
        ? new BroadcastChannel("ikcous_orders_realtime")
        : null;
    let bcListener: ((event: MessageEvent) => void) | null = null;

    const onEvent = async (payload: any) => {
      if (isUnmounting) return;
      const newId = (payload.new as any)?.id;
      const oldId = (payload.old as any)?.id;

      console.log(
        "[Realtime] Order change event processed:",
        payload.eventType,
        newId || oldId,
      );

      if (
        payload.eventType === "INSERT" &&
        payload.new &&
        "id" in payload.new
      ) {
        await handleRealtimeInsertRef.current(payload.new);
      } else if (payload.eventType === "UPDATE" && payload.new) {
        handleRealtimeUpdateRef.current(payload.new);
      } else if (payload.eventType === "DELETE") {
        handleRealtimeDeleteRef.current(oldId);
      }

      if (onRealtimeEventRef.current) {
        onRealtimeEventRef.current(payload);
      }
    };

    const setupRealtime = async () => {
      if (isUnmounting || isConnecting) return;

      const existing = globalOrderSubscriptions.get(channelId);
      if (existing) {
        existing.callbacks.add(onEvent);
        return;
      }

      isConnecting = true;
      try {
        console.log(
          `[Realtime] Creating new order channel (${isAdmin ? "Admin" : "User"}): ${channelId}`,
        );
        const channel = supabase.channel(channelId);

        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "marketplace_orders",
            ...(isAdmin ? {} : { filter: `user_id=eq.${user.id}` }),
          },
          async (payload) => {
            // Leader posts message to other tabs
            bc?.postMessage({ type: "order_change", channelId, payload });

            const sub = globalOrderSubscriptions.get(channelId);
            if (sub) {
              const cbPromises = Array.from(sub.callbacks).map((cb) => {
                try {
                  return Promise.resolve(cb(payload));
                } catch (e) {
                  console.error("[Realtime] Order callback error:", e);
                  return Promise.resolve();
                }
              });
              await Promise.all(cbPromises);
            }
          },
        );

        const subObj: SharedSubscription = {
          channel,
          refCount: 1,
          callbacks: new Set([onEvent]),
        };
        globalOrderSubscriptions.set(channelId, subObj);

        channel.subscribe(async (status: any, err?: any) => {
          isConnecting = false;
          if (isUnmounting) return;

          if (status === "SUBSCRIBED") {
            retryCount = 0;
            console.log(`[Realtime] Active shared channel: ${channelId}`);
          } else if (status === "CHANNEL_ERROR") {
            const errMessage =
              err?.message || (typeof err === "string" ? err : "");
            const isNormalClose =
              errMessage.includes("1000") || errMessage.includes("normal");
            const isAbnormalClose =
              errMessage.includes("1006") || errMessage.includes("abnormal");
            if (isNormalClose) {
              console.log(
                "[Realtime] Order channel closed normally (socket closed: 1000)",
              );
            } else if (isAbnormalClose) {
              console.warn(
                "[Realtime] Order channel closed abnormally (socket closed: 1006). SDK will auto-reconnect.",
              );
            } else {
              console.error(
                "[Realtime] Order channel error:",
                err?.message || err,
              );
            }
            handleReconnect();
          } else if (status === "TIMED_OUT" || status === "CLOSED") {
            handleReconnect();
          }
        });
      } catch (err) {
        console.error("[Realtime] Orders critical setup error:", err);
        isConnecting = false;
        handleReconnect();
      }
    };

    const handleReconnect = (initialDelay?: number) => {
      if (isUnmounting) return;

      const timeout = initialDelay || Math.min(1000 * 1.5 ** retryCount, 30000);
      retryCount++;

      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(
        async () => {
          if (isUnmounting) return;
          try {
            await recarregarAposReconexaoRef.current();
            if (!isUnmounting) setupRealtime();
          } catch {
            if (!isUnmounting) setupRealtime();
          }
        },
        timeout + Math.random() * 1000,
      );
    };

    if (isLeader) {
      const existing = globalOrderSubscriptions.get(channelId);
      if (existing) {
        if (existing.cleanupTimeout) {
          clearTimeout(existing.cleanupTimeout);
          existing.cleanupTimeout = undefined;
          console.log(
            `[Realtime] Cancelled cleanup timeout for channel (existing mount): ${channelId}`,
          );
        }
        existing.refCount++;
        existing.callbacks.add(onEvent);
      } else {
        setupRealtime();
      }
    } else {
      console.log(
        `[Realtime-Orders] Secondary tab listening via BroadcastChannel: ${channelId}`,
      );
      if (bc) {
        bcListener = (event: MessageEvent) => {
          if (
            event.data?.type === "order_change" &&
            event.data?.channelId === channelId
          ) {
            console.log(
              "[Realtime-Orders-Secondary] Received order change broadcast event",
            );
            onEvent(event.data.payload);
          }
        };
        bc.addEventListener("message", bcListener);
      }
    }

    const handleVisibilityChange = () => {
      if (!isLeader) return;
      if (document.visibilityState === "visible") {
        clearTimeout(visibilityTimeout);
        visibilityTimeout = setTimeout(() => {
          const sub = globalOrderSubscriptions.get(channelId);
          if ((!sub || sub.refCount <= 0) && !isUnmounting && !isConnecting) {
            console.log("[Realtime] Orders foregrounded. Forcing reconnect...");
            retryCount = 0;
            clearTimeout(reconnectTimeout);
            recarregarAposReconexaoRef.current().then(() => {
              if (!isUnmounting) setupRealtime();
            });
          }
        }, 500);
      }
    };

    const handleOnline = () => {
      if (!isLeader) return;
      clearTimeout(onlineTimeout);
      onlineTimeout = setTimeout(() => {
        const sub = globalOrderSubscriptions.get(channelId);
        if ((!sub || sub.refCount <= 0) && !isUnmounting && !isConnecting) {
          console.log("[Realtime] Orders online. Checking...");
          retryCount = 0;
          clearTimeout(reconnectTimeout);
          recarregarAposReconexaoRef.current().then(() => {
            if (!isUnmounting) setupRealtime();
          });
        }
      }, 500);
    };

    globalThis.addEventListener("visibilitychange", handleVisibilityChange);
    globalThis.addEventListener("online", handleOnline);

    return () => {
      isUnmounting = true;
      clearTimeout(reconnectTimeout);
      clearTimeout(visibilityTimeout);
      clearTimeout(onlineTimeout);
      globalThis.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      globalThis.removeEventListener("online", handleOnline);

      if (isLeader) {
        const sub = globalOrderSubscriptions.get(channelId);
        if (sub) {
          sub.callbacks.delete(onEvent);
          sub.refCount--;
          if (sub.refCount <= 0) {
            if (sub.cleanupTimeout) {
              clearTimeout(sub.cleanupTimeout);
            }
            sub.cleanupTimeout = setTimeout(() => {
              const currentSub = globalOrderSubscriptions.get(channelId);
              if (currentSub && currentSub.refCount <= 0) {
                globalOrderSubscriptions.delete(channelId);
                supabase.removeChannel(currentSub.channel).catch(() => {});
                console.log(
                  `[Realtime] Cleaned up shared channel after debounce: ${channelId}`,
                );
              }
            }, 4000); // 4 seconds debounce
            console.log(
              `[Realtime] Scheduled cleanup for channel: ${channelId} (refCount: ${sub.refCount})`,
            );
          }
        }
      } else {
        if (bcListener && bc) {
          bc.removeEventListener("message", bcListener);
        }
      }
      bc?.close();
    };
  }, [enabled, user?.id, isAdmin, isLeader]);

  const updateOrderStatus = useCallback(
    async (
      orderId: string,
      status: OrderStatus,
      notes?: string,
      silent = false,
    ) => {
      const originalOrders = [...orders];
      let originalCache: Order[] | null = null;
      try {
        // Find the order in the current state to check its existing status
        const order = orders.find((o) => o.id === orderId);

        // Validation logic extracted for clarity
        validateStatusUpdate(order, isAdmin, status, silent);

        // Optimistic update
        originalCache = cachedAdminOrders ? [...cachedAdminOrders] : null;
        cachedAdminOrders = (cachedAdminOrders || []).map((o) => {
          if (o.id === orderId) {
            const updatedOrder = Object.assign({}, o);
            updatedOrder.status = status;
            return updatedOrder;
          }
          return o;
        });

        setOrders((prev) => {
          const updated = prev.map((o) => {
            if (o.id === orderId) {
              const updatedOrder = Object.assign({}, o);
              updatedOrder.status = status;
              return updatedOrder;
            }
            return o;
          });
          if (user?.id && !isAdmin) {
            const cacheKey = `ikcous_orders_cache_${user.id}`;
            localStorage.setItem(cacheKey, JSON.stringify(updated));
          }
          return updated;
        });

        // Check if offline
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const queueStr =
            localStorage.getItem("orders_offline_updates_queue") || "[]";
          const queue = JSON.parse(queueStr);
          const cleanQueue = queue.filter(
            (item: any) => item.orderId !== orderId,
          );
          cleanQueue.push({
            orderId,
            status,
            notes,
            silent,
            timestamp: Date.now(),
          });
          localStorage.setItem(
            "orders_offline_updates_queue",
            JSON.stringify(cleanQueue),
          );

          if (!silent) {
            toast.info("Alteração de status guardada offline.", {
              description:
                "Será sincronizada com o servidor quando reestabelecer conexão.",
            });
          }
          return;
        }

        const { error } = await (supabase.rpc as any)(
          "update_order_status_atomic",
          {
            p_order_id: orderId,
            p_new_status: status,
            p_notes: notes || null,
            p_silent: silent,
          },
        );

        if (error) throw error;

        clearAnalyticsCache();
        if (!silent) toast.success("Status atualizado com sucesso");
      } catch (err: any) {
        console.error("Error updating status:", err);
        cachedAdminOrders = cachedAdminOrders
          ? [...(cachedAdminOrders || [])]
          : null; // will revert below or use originalCache
        cachedAdminOrders = originalCache;
        setOrders(originalOrders);
        if (user?.id && !isAdmin) {
          const cacheKey = `ikcous_orders_cache_${user.id}`;
          localStorage.setItem(cacheKey, JSON.stringify(originalOrders));
        }
        if (!silent) toast.error(err.message || "Erro ao atualizar status");
        throw err;
      }
    },
    [isAdmin, orders, user?.id],
  );

  const fetchOrderHistory = useCallback(async (orderId: string) => {
    try {
      // Cast to any because table might be missing in generated types
      const { data, error } = await (supabase as any)
        .from("marketplace_order_history")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    } catch (err) {
      console.error("Error fetching order history:", err);
      return [];
    }
  }, []);

  const fetchOrdersByWhatsapp = useCallback(
    async (
      whatsapp: string,
      email?: string,
      orderFragment?: string,
    ): Promise<Order[]> => {
      try {
        const { data, error } = await (supabase.rpc as any)(
          "get_orders_by_whatsapp_v3",
          {
            p_phone_number: whatsapp,
            p_customer_email: email || null,
            p_order_fragment: orderFragment || null,
          },
        );

        if (error) throw error;
        return ((data as any[]) || []).map((item) => mapOrderFromDB(item));
      } catch (err) {
        console.error("Error fetching orders by whatsapp:", err);
        toast.error("Erro ao buscar pedidos. Verifique os dados informados.");
        return [];
      }
    },
    [],
  );

  const fetchDashboardSummary =
    useCallback(async (): Promise<DashboardSummary | null> => {
      if (!isUserAdmin) {
        console.warn(
          "[useOrders] fetchDashboardSummary bypassed: user is not admin",
        );
        return null;
      }
      try {
        const { data } = await (supabase.rpc as any)("get_admin_analytics_v2");
        if (data) {
          return data as DashboardSummary;
        }
        return null;
      } catch (err) {
        console.error("Error fetching dashboard summary:", err);
        return null;
      }
    }, [isUserAdmin]);

  /**
   * Avisa o lojista que entrou pedido novo (PEDIDO-020, #89).
   *
   * Deliberadamente SEM await e com catch que só registra. Neste ponto o pedido
   * JÁ está criado no banco: o critério 3 da issue exige que falha do aviso não
   * derrube o checkout, e a forma de garantir isso é o fluxo do cliente nunca
   * esperar por esta chamada nem enxergar o resultado dela.
   *
   * O que pode dar errado aqui e é aceito de propósito: função fora do ar, rede
   * do cliente caindo, ou o cliente fechando a aba antes de a requisição sair.
   * Nos três casos o pedido está salvo e o lojista vê pelo painel. É o preço da
   * arquitetura sem trigger, registrado na issue — quando a BANCO-040 (#40) for
   * respondida e o trigger virar possível, este disparo passa a ser redundante,
   * não errado.
   */
  const avisarLojista = useCallback((orderId: string) => {
    try {
      void (supabase as any).functions
        .invoke("notify-new-order", { body: { orderId } })
        .then((r: any) => {
          if (r?.error) {
            console.warn("notify-new-order: aviso não saiu", r.error);
          }
        })
        .catch((err: unknown) => {
          console.warn("notify-new-order: aviso não saiu", err);
        });
    } catch (err) {
      // invoke() lançar de forma síncrona não deveria acontecer, mas se
      // acontecer não pode chegar ao checkout.
      console.warn("notify-new-order: aviso não saiu", err);
    }
  }, []);

  const createOrder = useCallback(
    async (orderData: any, opts?: { comPagamentoOnline?: boolean }) => {
      // 🛡️ Checkout de Convidados: O login não é mais obrigatório no frontend.
      // O RPC v22 cuidará da atribuição do user_id (NULL para convidados).

      // A v24 é idêntica à v23 no caminho do dinheiro — validação de preço,
      // estoque, frete e cupom são o mesmo corpo. A ÚNICA diferença é que ela
      // carimba payment_status='aguardando' e expires_at = now() + 30min.
      //
      // Por isso a escolha é do chamador e não uma troca global: pedido "na
      // entrega" não pode ganhar prazo, senão o pg_cron cancela venda legítima
      // — foi essa a correção que tirou a troca da Fase 1.
      const rpc = opts?.comPagamentoOnline
        ? "create_marketplace_order_v24"
        : "create_marketplace_order_v23";

      try {
        // 🛡️ SECURITY: Usando a RPC v22 Blindada (Zero-Trust)
        // O backend recalcula o total consultando os preços diretamente do banco (produtos/variants)
        // e usa o 'p_total_amount' como um Checksum para garantir integridade.
        const { data, error } = await (supabase as any).rpc(rpc, {
          p_items: orderData.items.map((item: any) => ({
            product_id: item.product_id || item.productId,
            variant_id: item.variant_id || item.variantId || null,
            quantity: item.quantity,
          })),
          p_total_amount: orderData.totalAmount,
          p_shipping_cost: orderData.shippingCost,
          p_payment_method: orderData.paymentMethod,
          p_address_id: orderData.addressId || null,
          p_coupon_code: orderData.couponCode || null,
          p_customer_name: orderData.customer.name,
          p_customer_phone: orderData.customer.whatsapp,
          p_observation: orderData.notes || null,
          p_address_data: orderData.addressData || null,
          // O banco usa estes dois para localizar a cotação que ELE gravou e
          // confirmar o valor do frete. O preço enviado pelo cliente é ignorado.
          p_destination_cep: orderData.destinationCep || null,
          p_shipping_option_id: orderData.shippingOptionId || null,
        });

        if (error) throw error;
        if (!data) throw new Error("Falha ao obter ID do pedido");

        // PEDIDO-020 (#89). Depois do `throw`, para não avisar de pedido que não
        // existe; e antes do return, para o disparo sair mesmo que a tela navegue
        // em seguida.
        //
        // A-3 da revisão final: no caminho online o pedido é uma RESERVA que o
        // pg_cron cancela em 30 min, não um pedido definitivo — avisar aqui faria
        // o lojista separar mercadoria de um pedido que pode morrer. Quem avisa
        // nesse caminho é o webhook da Fase 3, quando o pagamento é confirmado
        // ("aprovado → payment_status='pago', dispara notify-new-order").
        if (!opts?.comPagamentoOnline) avisarLojista(data);

        return {
          ...orderData,
          id: data,
          status: "pending" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } catch (err: any) {
        console.error("Error creating order:", err);
        toast.error(err.message || "Erro ao processar pedido");
        throw err;
      }
    },
    [avisarLojista],
  );

  /**
   * Pede à edge function que crie a cobrança no Mercado Pago.
   *
   * Diferente do avisarLojista (PEDIDO-020), aqui o cliente ESPERA: sem a
   * resposta não há QR code para mostrar. Erro aqui não perde o pedido — ele
   * já está criado e expira sozinho em 30 minutos, que é a rede descrita na
   * spec.
   */
  const criarPagamento = useCallback(
    async (args: {
      orderId: string;
      metodo: "pix" | "cartao";
      token?: string;
      parcelas?: number;
      paymentMethodId?: string;
      issuerId?: string;
      email?: string;
      documento?: { type: string; number: string };
    }) => {
      const { data, error } = await (supabase as any).functions.invoke(
        "criar-pagamento",
        { body: args },
      );

      // ATENÇÃO ao contrato do supabase-js v2, que não é o intuitivo: quando a
      // resposta NÃO é 2xx, `data` chega NULL e o corpo fica em `error.context`,
      // que é um Response. Ler só `data?.error` — como a primeira versão deste
      // plano mandava — jogaria fora as quatro mensagens distintas que a edge
      // function escreve com cuidado ("Este pedido já tem uma cobrança gerada.",
      // "O prazo para pagar este pedido acabou.", "Pedido inválido.",
      // "Pagamento indisponível.") e mostraria a mesma frase genérica em todas.
      if (error) {
        let mensagem = "Não foi possível gerar a cobrança.";
        // CHECKOUT-050 (#194): `terminal` viaja JUNTO da mensagem, lido do
        // mesmo corpo — é o campo que a edge function grava nos três ramos
        // de "recusar" de podeCobrar() (supabase/functions/criar-pagamento
        // /index.ts). Sem ele, quem chama esta função tinha que ADIVINHAR a
        // categoria comparando a MENSAGEM por igualdade exata com um texto
        // fixo — e quebrava assim que a mensagem real mudava (achado da
        // revisão, ver o comentário grande em PagamentoOnline.tsx). Default
        // `false`: falha fechada quando o corpo não tem o campo (edge
        // function antiga ainda no ar, ou corpo ilegível) — de propósito
        // SEM reconstruir a categoria a partir de texto nesse caso.
        let terminal = false;
        try {
          const corpo = await (error as any).context?.json?.();
          if (corpo?.error) mensagem = corpo.error;
          if (typeof corpo?.terminal === "boolean") terminal = corpo.terminal;
        } catch {
          // Corpo ilegível: fica a mensagem genérica, que é melhor que vazar
          // o texto cru de um erro de infraestrutura para o cliente.
        }
        throw Object.assign(new Error(mensagem), { terminal });
      }
      if (data?.error) {
        // Mesma regra estrita do ramo `error` acima: só `true` literal vira
        // terminal. `Boolean(...)` aceitaria "false" (string), 1, `{}` — este
        // ramo é inalcançável hoje (o supabase-js v2 sempre preenche `error`
        // numa resposta não-2xx), mas duas leituras do mesmo campo lado a
        // lado é convite para elas divergirem.
        throw Object.assign(new Error(data.error), {
          terminal:
            typeof (data as any).terminal === "boolean" &&
            (data as any).terminal,
        });
      }
      return data as {
        paymentId: string;
        // CHECKOUT-080 (#213): renomeado de `status` — o campo agora fala o
        // vocabulário FECHADO do banco ('aguardando'/'pago'/'recusado'/
        // 'expirado'/'estornado'), não mais o vocabulário clássico do MP, e
        // o nome novo torna impossível confundir com o `status` de PEDIDO
        // (`OrderStatus`, valores diferentes) que já existe neste mesmo
        // arquivo. `string`, não `StatusPagamentoConhecido` — ver o
        // comentário grande de `StatusPagamentoConhecido`, acima: a edge
        // function pode devolver um par cru para status que ela mesma não
        // reconhece, e o tipo não pode prometer o que o runtime não garante.
        statusPagamento: string;
        expiraEm: string;
        qrCode?: string;
        qrCodeBase64?: string;
        ticketUrl?: string;
      };
    },
    [],
  );

  const generateOrderOtp = useCallback(
    async (
      email: string,
      whatsapp: string,
      orderFragment: string,
    ): Promise<boolean> => {
      // Inversão de 19/08/2026 (#161 + #86). Antes isto chamava a RPC
      // `generate_order_otp_v1`, que só GRAVAVA o código e deixava um gatilho
      // do banco enfileirar o e-mail com `net.http_post` — e essa fila só é
      // processada DEPOIS do commit, então a RPC voltava `true` antes de
      // qualquer envio existir. Era esse `true` prematuro que fazia a tela
      // escrever "código de verificação enviado" sem que ninguém tivesse como
      // saber se algo saiu.
      //
      // Agora quem envia é a edge function, e ela responde. `true` aqui passa
      // a significar "o e-mail saiu", que é o que a tela sempre afirmou.
      const NAO_ENVIOU =
        "Não conseguimos enviar seu código agora. Tente de novo em alguns minutos.";
      // Mensagem única para "pedido não existe", "e-mail não bate" e
      // "fragmento curto demais": distinguir os três diria a quem está
      // adivinhando qual metade ele já acertou (AUTH-010, #118).
      const NAO_CONFERE =
        "Não encontramos um pedido com esse e-mail, WhatsApp e ID juntos.";

      try {
        const { data, error } = await supabase.functions.invoke(
          "send-otp-email",
          { body: { email, whatsapp, orderFragment } },
        );

        // `invoke` transforma status >= 400 em `error`. A função devolve 502
        // quando a loja falhou (envio ou remetente ausente) — daí o erro sem
        // corpo cair no mesmo aviso de "não conseguimos enviar".
        if (error && !data) {
          console.error("Error generating OTP:", error);
          toast.error(NAO_ENVIOU);
          return false;
        }

        if (data?.ok) return true;

        if (data?.motivo === "muito_recente") {
          toast.error(
            `Já enviamos um código há pouco. Espere ${data.espereSegundos ?? 60} segundos e confira sua caixa de entrada.`,
          );
          return false;
        }

        if (
          data?.motivo === "envio_falhou" ||
          data?.motivo === "sem_remetente"
        ) {
          toast.error(NAO_ENVIOU);
          return false;
        }

        toast.error(NAO_CONFERE);
        return false;
      } catch (err: any) {
        // Rede caiu, função fora do ar, corpo ilegível: nada disso é culpa de
        // quem está comprando, e nenhum deles pode virar `true`.
        console.error("Error generating OTP:", err);
        toast.error(NAO_ENVIOU);
        return false;
      }
    },
    [],
  );

  const fetchOrdersByOtp = useCallback(
    async (email: string, otp: string): Promise<Order[]> => {
      try {
        setLoading(true);
        const { data, error } = await (supabase.rpc as any)(
          "get_orders_by_otp_v1",
          {
            p_email: email,
            p_otp: otp,
          },
        );

        if (error) throw error;

        // Contrato novo desde a AUTH-010 (#118): a RPC devolve
        // { ok, orders } ou { ok: false, error, restantes } em vez de um array
        // cru. O caminho de falha RETORNA em vez de levantar exceção de
        // propósito — no PostgREST cada RPC é uma transação, e um RAISE
        // reverteria o incremento do contador de tentativas.
        if (data && typeof data === "object" && "ok" in data) {
          if (!data.ok) {
            const restantes = (data as any).restantes;
            toast.error(
              typeof restantes === "number" && restantes > 0
                ? `${(data as any).error} Restam ${restantes} tentativa(s).`
                : (data as any).error || "Código inválido ou expirado",
            );
            return [];
          }
          return (((data as any).orders as any[]) || []).map((item) =>
            mapOrderFromDB(item),
          );
        }

        // Resposta no formato antigo (array cru): acontece se o front subir
        // antes da migration. Continua funcionando em vez de quebrar a tela.
        return ((data as any[]) || []).map((item) => mapOrderFromDB(item));
      } catch (err: any) {
        console.error("Error fetching orders by OTP:", err);
        toast.error(err.message || "Código inválido ou expirado");
        return [];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const subscribeToOrders = useCallback(
    (onChange?: (payload: any) => void) => {
      if (!user) return () => {};

      const channelId = isAdmin
        ? "admin_order_updates_realtime"
        : `order_updates_realtime_${user.id}`;
      console.log(
        `[Realtime] Subscribing to orders (${isAdmin ? "Admin" : "User"}): ${channelId}`,
      );

      const channel = supabase.channel(channelId);

      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "marketplace_orders",
          ...(isAdmin ? {} : { filter: `user_id=eq.${user.id}` }),
        },
        async (payload) => {
          console.log("[Realtime] Order change event:", payload.eventType);
          if (onChange) {
            onChange(payload);
          }
        },
      );

      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log(`[Realtime] Active orders channel: ${channelId}`);
        } else if (status === "CHANNEL_ERROR") {
          const errMessage =
            (err as any)?.message ||
            (typeof (err as any) === "string" ? (err as any) : "");
          const isNormalClose =
            errMessage.includes("1000") || errMessage.includes("normal");
          const isAbnormalClose =
            errMessage.includes("1006") || errMessage.includes("abnormal");
          if (isNormalClose) {
            console.log(
              `[Realtime] Orders channel closed normally: ${channelId}`,
            );
          } else if (isAbnormalClose) {
            console.warn(
              `[Realtime] Orders channel closed abnormally (socket closed: 1006): ${channelId}. SDK will auto-reconnect.`,
            );
          } else {
            console.error(
              "[Realtime] Orders channel error:",
              err?.message || err,
            );
          }
        }
      });

      return () => {
        console.log(`[Realtime] Cleaning up orders channel: ${channelId}`);
        supabase.removeChannel(channel).catch(() => {});
      };
    },
    [user, isAdmin],
  );

  // Synchronize queued offline order status updates when coming back online
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnlineSync = () => {
      setTimeout(() => {
        syncOfflineOrderUpdates().then((synced) => {
          if (synced) {
            if (isAdmin) {
              loadOrders(0, 10, "all", "", "", "", true).catch(() => {});
            } else if (user?.id) {
              fetchUserOrders().catch(() => {});
            }
          }
        });
      }, 1000);
    };

    window.addEventListener("online", handleOnlineSync);
    if (navigator.onLine) {
      handleOnlineSync();
    }
    return () => {
      window.removeEventListener("online", handleOnlineSync);
    };
  }, [user?.id, isAdmin, loadOrders, fetchUserOrders]);

  useEffect(() => {
    return () => {
      if (userOrdersAbortControllerRef.current) {
        userOrdersAbortControllerRef.current.abort();
      }
      if (adminOrdersAbortControllerRef.current) {
        adminOrdersAbortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    orders,
    loading,
    isLoaded: !loading,
    totalOrders,
    fetchUserOrders,
    loadOrders, // New pagination function
    fetchOrders, // Legacy alias
    updateOrderStatus,
    fetchOrdersByWhatsapp,
    generateOrderOtp,
    fetchOrdersByOtp,
    createOrder,
    criarPagamento,
    fetchDashboardSummary,
    fetchOrderHistory,
    subscribeToOrders,
  };
}
