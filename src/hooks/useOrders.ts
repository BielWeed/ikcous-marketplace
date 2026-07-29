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

    if (!user?.id) {
      setOrders([]);
      return;
    }
    const cacheKey = `ikcous_orders_cache_${user.id}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setOrders(parsed);
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
          items:marketplace_order_items(*, product:vw_produtos_public(imagem_url, imagem_urls)),
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
        setOrders(mappedOrders);
        localStorage.setItem(cacheKey, JSON.stringify(mappedOrders));
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
          "*, items:marketplace_order_items(*, product:vw_produtos_public(imagem_url, imagem_urls)), address:user_addresses(*)",
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

  const fetchUserOrdersRef = useRef(fetchUserOrders);
  const handleRealtimeInsertRef = useRef(handleRealtimeInsert);
  const handleRealtimeUpdateRef = useRef(handleRealtimeUpdate);
  const handleRealtimeDeleteRef = useRef(handleRealtimeDelete);
  const onRealtimeEventRef = useRef(options?.onRealtimeEvent);

  useEffect(() => {
    fetchUserOrdersRef.current = fetchUserOrders;
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
            const isNormalClose =
              err?.message?.includes("1000") ||
              err?.message?.includes("normal") ||
              (typeof err === "string" &&
                (err.includes("1000") || err.includes("normal")));
            if (isNormalClose) {
              console.log(
                "[Realtime] Order channel closed normally (socket closed: 1000)",
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
            await fetchUserOrdersRef.current();
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
            fetchUserOrdersRef.current().then(() => {
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
          fetchUserOrdersRef.current().then(() => {
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

  const createOrder = useCallback(async (orderData: any) => {
    // 🛡️ Checkout de Convidados: O login não é mais obrigatório no frontend.
    // O RPC v22 cuidará da atribuição do user_id (NULL para convidados).

    try {
      // 🛡️ SECURITY: Usando a RPC v22 Blindada (Zero-Trust)
      // O backend recalcula o total consultando os preços diretamente do banco (produtos/variants)
      // e usa o 'p_total_amount' como um Checksum para garantir integridade.
      const { data, error } = await (supabase as any).rpc(
        "create_marketplace_order_v22",
        {
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
        },
      );

      if (error) throw error;
      if (!data) throw new Error("Falha ao obter ID do pedido");

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
  }, []);

  const generateOrderOtp = useCallback(
    async (
      email: string,
      whatsapp: string,
      orderFragment: string,
    ): Promise<boolean> => {
      try {
        const { data, error } = await (supabase.rpc as any)(
          "generate_order_otp_v1",
          {
            p_email: email,
            p_whatsapp: whatsapp,
            p_order_fragment: orderFragment,
          },
        );

        if (error) throw error;
        return !!data;
      } catch (err: any) {
        console.error("Error generating OTP:", err);
        toast.error(err.message || "Erro ao gerar código de verificação");
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
          if (isNormalClose) {
            console.log(
              `[Realtime] Orders channel closed normally: ${channelId}`,
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
    fetchDashboardSummary,
    fetchOrderHistory,
    subscribeToOrders,
  };
}
