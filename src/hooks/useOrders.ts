import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { mapOrderFromDB } from '@/lib/mappers';
import type { Order, OrderStatus, DashboardSummary } from '@/types';

const validateStatusUpdate = (order: Order | undefined, isAdmin: boolean, status: OrderStatus, silent: boolean) => {
  if (!isAdmin) {
    if (status !== 'cancelled') {
      const errorMsg = 'Usuários só podem cancelar pedidos';
      if (!silent) toast.error(errorMsg);
      throw new Error(errorMsg);
    }

    if (order && order.status !== 'pending') {
      const errorMsg = 'Apenas pedidos pendentes podem ser cancelados';
      if (!silent) toast.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
};

export function useOrders(enabled: boolean = true, isAdmin: boolean = false) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalOrders, setTotalOrders] = useState(0);

  // Fetch orders for the logged-in user
  const fetchUserOrders = useCallback(async () => {
    if (!user || !enabled) return [];
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('marketplace_orders')
        .select(`
          *,
          items:marketplace_order_items(*, product:produtos(imagem_url, imagem_urls)),
          address:user_addresses(*)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        const mappedOrders = data.map(item => mapOrderFromDB(item as any));
        setOrders(mappedOrders);
        return mappedOrders;
      }
      return [];
    } catch (err) {
      console.error('Error fetching user orders:', err);
      toast.error('Erro ao carregar seus pedidos');
      return [];
    } finally {
      setLoading(false);
    }
  }, [user, enabled]);

  // Load orders with pagination (Admin) - Optimized
  const loadOrders = useCallback(async (page = 0, pageSize = 20, statusFilter?: string) => {
    if (!enabled) return { orders: [], total: 0 };
    try {
      setLoading(true);
      let query = supabase
        .from('marketplace_orders')
        .select(`
          *,
          items:marketplace_order_items(*, product:produtos(imagem_url, imagem_urls)),
          address:user_addresses(*)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      if (data) {
        // Explicit casting to match Mapper expectations for joined data
        const mappedOrders = data.map(item => mapOrderFromDB(item as any));
        setOrders(mappedOrders);
        if (count !== null) setTotalOrders(count);
        return { orders: mappedOrders, total: count || 0 };
      }
      return { orders: [], total: 0 };
    } catch (err) {
      console.error('Error loading orders:', err);
      toast.error('Erro ao carregar pedidos');
      return { orders: [], total: 0 };
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  // Wrapper for backward compatibility
  const fetchOrders = useCallback(async (limitCount?: number) => {
    return loadOrders(0, limitCount || 50);
  }, [loadOrders]);

  const handleRealtimeInsert = useCallback(async (newPayload: any) => {
    const { data, error } = await supabase
      .from('marketplace_orders')
      .select('*, items:marketplace_order_items(*, product:produtos(imagem_url, imagem_urls)), address:user_addresses(*)')
      .eq('id', newPayload.id)
      .single();

    if (!error && data) {
      if (!isAdmin && data.user_id !== user?.id) return;
      const newOrder = mapOrderFromDB(data as any);
      setOrders(prev => {
        if (prev.some(o => o.id === newOrder.id)) return prev;
        return [newOrder, ...prev];
      });
      toast.info(`Novo pedido recebido! #${newOrder.id.slice(0, 8)}`);
    }
  }, [isAdmin, user?.id]);

  const handleRealtimeUpdate = useCallback((updatedOrder: any) => {
    if (!updatedOrder.id) return;
    setOrders(prev => prev.map(o =>
      o.id === updatedOrder.id ? { ...o, status: updatedOrder.status, trackingCode: updatedOrder.tracking_code } : o
    ));
  }, []);

  const handleRealtimeDelete = useCallback((oldId: string | undefined) => {
    if (oldId) {
      setOrders(prev => prev.filter(o => o.id !== oldId));
    }
  }, []);

  // Realtime subscription for orders
  useEffect(() => {
    if (!enabled || !user) return;

    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    let retryCount = 0;
    let isSubscribed = false;
    let isUnmounting = false;
    let isConnecting = false;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let visibilityTimeout: ReturnType<typeof setTimeout> | undefined;
    let onlineTimeout: ReturnType<typeof setTimeout> | undefined;

    const setupRealtime = async () => {
      if (isUnmounting || isConnecting) return;
      isConnecting = true;

      try {
        if (activeChannel) {
          supabase.removeChannel(activeChannel).catch(() => {});
        }

        const channelId = isAdmin ? 'admin_order_updates' : `order_updates_${user.id}`;
        console.log(`[Realtime] Subscribing to orders (${isAdmin ? 'Admin' : 'User'}): ${channelId}`);

        const channel = supabase.channel(channelId);

        channel
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'marketplace_orders',
            ...(isAdmin ? {} : { filter: `user_id=eq.${user.id}` })
          },
            async (payload) => {
              if (isUnmounting) return;
              const newId = (payload.new as any)?.id;
              const oldId = (payload.old as any)?.id;

              console.log('[Realtime] Order change:', payload.eventType, newId || oldId);

              if (payload.eventType === 'INSERT' && payload.new && 'id' in payload.new) {
                await handleRealtimeInsert(payload.new);
              } else if (payload.eventType === 'UPDATE' && payload.new) {
                handleRealtimeUpdate(payload.new);
              } else if (payload.eventType === 'DELETE') {
                handleRealtimeDelete(oldId);
              }
            }
          );

        activeChannel = channel;

        channel.subscribe(async (status, err) => {
          isConnecting = false;
          if (isUnmounting || activeChannel !== channel) return;

          if (status === 'SUBSCRIBED') {
            isSubscribed = true;
            retryCount = 0;
            console.log(`[Realtime] Active: orders for ${user.id}`);
          } else if (status === 'CHANNEL_ERROR') {
            isSubscribed = false;
            const errorMsg = err?.message || String(err);
            console.error('[Realtime] Order channel error:', errorMsg);

            if (errorMsg.includes('InvalidJWTToken') || errorMsg.includes('expired') || errorMsg.includes('401')) {
              console.warn('[Realtime] Auth issue detected. Refreshing session...');
              await supabase.auth.refreshSession().catch(() => {});
              handleReconnect(1000);
            } else {
              handleReconnect();
            }
          } else if (status === 'TIMED_OUT' || status === 'CLOSED') {
            isSubscribed = false;
            handleReconnect();
          }
        });
      } catch (err) {
        console.error('[Realtime] Orders critical setup error:', err);
        isConnecting = false;
        handleReconnect();
      }
    };

    const handleReconnect = (initialDelay?: number) => {
      if (isUnmounting) return;

      const EXTENDED_MAX_RETRIES = 15;
      if (retryCount >= EXTENDED_MAX_RETRIES) {
        console.error('[Realtime] Max retries reached for orders.');
        return;
      }

      const timeout = initialDelay || Math.min(1000 * Math.pow(1.5, retryCount), 30000);
      retryCount++;

      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(async () => {
        if (isUnmounting) return;
        try {
          await fetchUserOrders();
          if (!isUnmounting) setupRealtime();
        } catch {
          if (!isUnmounting) setupRealtime();
        }
      }, timeout + Math.random() * 1000);
    };

    setupRealtime();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(visibilityTimeout);
        visibilityTimeout = setTimeout(() => {
          if (!isSubscribed && !isUnmounting && !isConnecting) {
            console.log('[Realtime] Orders foregrounded. Forcing reconnect...');
            retryCount = 0;
            clearTimeout(reconnectTimeout);
            fetchUserOrders().then(() => {
              if (!isUnmounting) setupRealtime();
            });
          }
        }, 500);
      }
    };

    const handleOnline = () => {
      clearTimeout(onlineTimeout);
      onlineTimeout = setTimeout(() => {
        if (!isSubscribed && !isUnmounting && !isConnecting) {
          console.log('[Realtime] Orders online. Checking...');
          retryCount = 0;
          clearTimeout(reconnectTimeout);
          fetchUserOrders().then(() => {
            if (!isUnmounting) setupRealtime();
          });
        }
      }, 500);
    };

    globalThis.addEventListener('visibilitychange', handleVisibilityChange);
    globalThis.addEventListener('online', handleOnline);

    return () => {
      isUnmounting = true;
      clearTimeout(reconnectTimeout);
      clearTimeout(visibilityTimeout);
      clearTimeout(onlineTimeout);
      globalThis.removeEventListener('visibilitychange', handleVisibilityChange);
      globalThis.removeEventListener('online', handleOnline);
      if (activeChannel) {
        supabase.removeChannel(activeChannel).catch(() => {});
      }
    };
  }, [enabled, user, isAdmin, fetchUserOrders, handleRealtimeInsert, handleRealtimeUpdate, handleRealtimeDelete]);


  const updateOrderStatus = useCallback(async (orderId: string, status: OrderStatus, notes?: string, silent: boolean = false) => {
    try {
      // Find the order in the current state to check its existing status
      const order = orders.find(o => o.id === orderId);

      // Validation logic extracted for clarity
      validateStatusUpdate(order, isAdmin, status, silent);

      const { error } = await (supabase.rpc as any)('update_order_status_atomic', {
        p_order_id: orderId,
        p_new_status: status,
        p_notes: notes || null,
        p_silent: silent
      });

      if (error) throw error;

      setOrders(prev => prev.map(order =>
        order.id === orderId ? { ...order, status } : order
      ));
      if (!silent) toast.success('Status atualizado com sucesso');
    } catch (err: any) {
      console.error('Error updating status:', err);
      if (!silent) toast.error(err.message || 'Erro ao atualizar status');
      throw err;
    }
  }, [isAdmin, orders]);

  const fetchOrderHistory = useCallback(async (orderId: string) => {
    try {
      // Cast to any because table might be missing in generated types
      const { data, error } = await (supabase as any)
        .from('marketplace_order_history')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error fetching order history:', err);
      return [];
    }
  }, []);

  const fetchOrdersByWhatsapp = useCallback(async (whatsapp: string, email?: string, orderFragment?: string): Promise<Order[]> => {
    try {
      const { data, error } = await (supabase.rpc as any)('get_orders_by_whatsapp_v3', {
        p_phone_number: whatsapp,
        p_customer_email: email || null,
        p_order_fragment: orderFragment || null
      });

      if (error) throw error;
      return (data as any[] || []).map(item => mapOrderFromDB(item));
    } catch (err) {
      console.error('Error fetching orders by whatsapp:', err);
      toast.error('Erro ao buscar pedidos. Verifique os dados informados.');
      return [];
    }
  }, []);

  const fetchDashboardSummary = useCallback(async (): Promise<DashboardSummary | null> => {
    try {
      const { data } = await (supabase.rpc as any)('get_admin_analytics_v2');
      if (data) {
        return data as DashboardSummary;
      }
      return null;
    } catch (err) {
      console.error('Error fetching dashboard summary:', err);
      return null;
    }
  }, []);

  const createOrder = useCallback(async (orderData: any) => {
    // 🛡️ Checkout de Convidados: O login não é mais obrigatório no frontend.
    // O RPC v22 cuidará da atribuição do user_id (NULL para convidados).
    
    try {
      // 🛡️ SECURITY: Usando a RPC v22 Blindada (Zero-Trust)
      // O backend recalcula o total consultando os preços diretamente do banco (produtos/variants)
      // e usa o 'p_total_amount' como um Checksum para garantir integridade.
      const { data, error } = await (supabase as any).rpc('create_marketplace_order_v22', {
        p_items: orderData.items.map((item: any) => ({
          product_id: item.productId,
          variant_id: item.variantId || null,
          quantity: item.quantity
        })),
        p_total_amount: orderData.totalAmount, 
        p_shipping_cost: orderData.shippingCost, 
        p_payment_method: orderData.paymentMethod,
        p_address_id: orderData.addressId || null,
        p_coupon_code: orderData.couponCode || null,
        p_customer_name: orderData.customer.name,
        p_customer_phone: orderData.customer.whatsapp,
        p_observation: orderData.notes || null,
        p_address_data: orderData.addressData || null
      });

      if (error) throw error;
      if (!data) throw new Error('Falha ao obter ID do pedido');

      return {
        ...orderData,
        id: data, 
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } catch (err: any) {
      console.error('Error creating order:', err);
      toast.error(err.message || 'Erro ao processar pedido');
      throw err;
    }
  }, []);

  const generateOrderOtp = useCallback(async (email: string, whatsapp: string, orderFragment: string): Promise<string | null> => {
    try {
      const { data, error } = await (supabase.rpc as any)('generate_order_otp_v1', {
        p_email: email,
        p_whatsapp: whatsapp,
        p_order_fragment: orderFragment
      });

      if (error) throw error;
      return data;
    } catch (err: any) {
      console.error('Error generating OTP:', err);
      toast.error(err.message || 'Erro ao gerar código de verificação');
      return null;
    }
  }, []);

  const fetchOrdersByOtp = useCallback(async (email: string, otp: string): Promise<Order[]> => {
    try {
      setLoading(true);
      const { data, error } = await (supabase.rpc as any)('get_orders_by_otp_v1', {
        p_email: email,
        p_otp: otp
      });

      if (error) throw error;
      return (data as any[] || []).map(item => mapOrderFromDB(item));
    } catch (err: any) {
      console.error('Error fetching orders by OTP:', err);
      toast.error(err.message || 'Código inválido ou expirado');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    orders,
    loading,
    isLoaded: !loading,
    totalOrders,
    fetchUserOrders,
    loadOrders,     // New pagination function
    fetchOrders,    // Legacy alias
    updateOrderStatus,
    fetchOrdersByWhatsapp,
    generateOrderOtp,
    fetchOrdersByOtp,
    createOrder,
    fetchDashboardSummary,
    fetchOrderHistory
  };
};
