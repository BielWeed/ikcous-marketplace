import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { flushSync } from 'react-dom';
import { LazyImage } from '@/components/LazyImage';
import {
  Search,
  MessageCircle,
  Package,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  DollarSign,
  Calendar,
  User,
  Filter,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Order, OrderStatus, View } from '@/types';
import { useOrders } from '@/hooks/useOrders';
import { DebouncedSearchInput } from '@/components/admin/DebouncedSearchInput';
import { OrderStatusBadge, statusConfig } from '@/components/admin/orders/OrderStatusBadge';
import { OrderDetail } from '@/components/admin/orders/OrderDetail';
import { SupportBanners } from '@/components/admin/dashboard/SupportBanners';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AdminKpiCarousel, type KpiCardConfig } from '@/components/admin/AdminKpiCarousel';
import { Skeleton } from '@/components/ui/skeleton';
import { LocalErrorBoundary } from '@/components/ui/custom/LocalErrorBoundary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { mapOrderFromDB } from '@/lib/mappers';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX Instantâneo',
  card: 'Crédito Seguro',
  cash: 'Dinheiro'
};

const STATUS_ORDER_COLORS: Record<string, string> = {
  pending: 'bg-blue-500',
  processing: 'bg-amber-500',
  shipping: 'bg-indigo-500',
  delivered: 'bg-emerald-500',
  cancelled: 'bg-zinc-500'
};

interface AdminOrdersViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
  selectedOrderId?: string | null;
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

export const AdminOrdersView = memo(function AdminOrdersView({ onNavigate, active, selectedOrderId, onSetBackOverride }: Readonly<AdminOrdersViewProps>) {
  const isOffline = useOnlineStatus();
  const [recentOrderChanges, setRecentOrderChanges] = useState<Record<string, 'INSERT' | 'UPDATE'>>({});
  const onRealtimeEventRef = useRef<(payload: any) => void>(() => {});
  const { orders, loadOrders, updateOrderStatus, totalOrders, isLoaded, fetchDashboardSummary } = useOrders(active ?? false, true, {
    onRealtimeEvent: (payload) => onRealtimeEventRef.current(payload)
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  });
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<'detailed' | 'compact'>(() => {
    const saved = localStorage.getItem('admin_orders_view_mode');
    return (saved === 'detailed' || saved === 'compact') ? saved : 'compact';
  });

  useEffect(() => {
    localStorage.setItem('admin_orders_view_mode', viewMode);
  }, [viewMode]);

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savedScrollPosition, setSavedScrollPosition] = useState(0);
  const prevSelectedOrderRef = useRef<Order | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 12;

  const lastFilterRef = useRef<OrderStatus | 'all'>('all');
  const lastSearchRef = useRef<string>('');
  const lastDateRef = useRef<string>(JSON.stringify({ start: '', end: '' }));

  const [stats, setStats] = useState({ revenueDay: 0, pending: 0, avgTicket: 0, completed: 0 });

  const kpiCards = useMemo<readonly KpiCardConfig[]>(() => [
    { label: 'Receita Hoje', value: `R$ ${stats.revenueDay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: DollarSign, accent: 'text-emerald-500', subValue: 'Finanças' },
    { label: 'Ações Pendentes', value: stats.pending.toString(), icon: Clock, accent: 'text-amber-500', subValue: stats.pending > 0 ? 'Urgente' : 'Limpo' },
    { label: 'Ticket Médio', value: `R$ ${stats.avgTicket.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: TrendingUp, accent: 'text-admin-gold', subValue: 'Rendimento' },
    { label: 'Total Concluído', value: stats.completed.toString(), icon: CheckCircle2, accent: 'text-sky-500', subValue: 'Concluído' },
  ], [stats]);

  const loadStats = useCallback(async () => {
    const summary = await fetchDashboardSummary();
    if (summary) {
      setStats({
        revenueDay: summary.today?.revenue || 0,
        pending: summary.today?.pending || 0,
        avgTicket: summary.averageTicket || 0,
        completed: summary.month?.count || 0
      });
    }
  }, [fetchDashboardSummary]);

  const handleBackToList = useCallback(() => {
    onNavigate('admin-orders');
  }, [onNavigate]);

  const handleSelectOrder = useCallback((order: Order) => {
    const container = document.querySelector('.admin-scroll-container') || document.querySelector('main');
    if (container) {
      setSavedScrollPosition(container.scrollTop);
    }
    onNavigate('admin-orders', order.id);
  }, [onNavigate]);

  // Clean back override on order detail to prevent intercepting url popstates
  useEffect(() => {
    if (onSetBackOverride) {
      onSetBackOverride(null);
    }
    return () => {
      if (onSetBackOverride) {
        onSetBackOverride(null);
      }
    };
  }, [onSetBackOverride]);

  // Sync selectedOrder with selectedOrderId prop driven by URL
  const lastSelectedOrderIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const nextOrder = selectedOrderId ? (orders.find(o => o.id === selectedOrderId) || null) : null;
    const isIdChanged = lastSelectedOrderIdRef.current !== selectedOrderId;
    lastSelectedOrderIdRef.current = selectedOrderId;

    const updateState = (order: Order | null) => {
      setSelectedOrder(order);
    };

    const triggerUpdate = (order: Order | null) => {
      if (isIdChanged && typeof document !== 'undefined' && 'startViewTransition' in document) {
        document.startViewTransition(() => {
          flushSync(() => {
            updateState(order);
          });
        });
      } else {
        updateState(order);
      }
    };

    if (!selectedOrderId) {
      triggerUpdate(null);
      return;
    }

    if (nextOrder) {
      triggerUpdate(nextOrder);
      return;
    }

    // Fetch from Supabase if not found locally (e.g., deep link or pagination)
    let isCurrent = true;
    const fetchSingleOrder = async () => {
      setLoadingDetail(true);
      try {
        const { data, error } = await supabase
          .from('marketplace_orders')
          .select(`
            *,
            items:marketplace_order_items(*, product:produtos(imagem_url, imagem_urls)),
            address:user_addresses(*)
          `)
          .eq('id', selectedOrderId)
          .single();

        if (error) throw error;
        if (data && isCurrent) {
          const mapped = mapOrderFromDB(data as any);
          triggerUpdate(mapped);
        }
      } catch (err) {
        console.error('Error fetching single order:', err);
        toast.error('Erro ao carregar detalhes do pedido');
      } finally {
        if (isCurrent) setLoadingDetail(false);
      }
    };

    fetchSingleOrder();
    return () => {
      isCurrent = false;
    };
  }, [selectedOrderId, orders]);

  useEffect(() => {
    const container = document.querySelector('.admin-scroll-container') || document.querySelector('main');
    if (!container) return;

    const prev = prevSelectedOrderRef.current;
    prevSelectedOrderRef.current = selectedOrder;

    if (selectedOrder && !prev) {
      // Opened details page: scroll container to top
      container.scrollTop = 0;
    } else if (!selectedOrder && prev) {
      // Returned to list view: restore scroll position
      if (savedScrollPosition > 0) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            container.scrollTop = savedScrollPosition;
          });
        });
      }
    }
  }, [selectedOrder, savedScrollPosition]);

  // Removidas funções bulk status e toggle selecionados para evitar erros de compilação.

  const loadAllData = useCallback((pageToFetch: number) => {
    loadOrders(
      pageToFetch,
      itemsPerPage,
      filter,
      searchQuery,
      dateRange.start || undefined,
      dateRange.end || undefined
    );
    loadStats();
  }, [loadOrders, itemsPerPage, filter, searchQuery, dateRange, loadStats]);

  useEffect(() => {
    if (!active) return;

    const filterChanged = 
      lastFilterRef.current !== filter || 
      lastSearchRef.current !== searchQuery || 
      lastDateRef.current !== JSON.stringify(dateRange);

    lastFilterRef.current = filter;
    lastSearchRef.current = searchQuery;
    lastDateRef.current = JSON.stringify(dateRange);

    let pageToFetch = currentPage;
    if (filterChanged) {
      pageToFetch = 0;
      if (currentPage !== 0) {
        setCurrentPage(0);
        return;
      }
    }

    loadAllData(pageToFetch);
  }, [currentPage, filter, searchQuery, dateRange, active, loadAllData]);

  useEffect(() => {
    onRealtimeEventRef.current = (payload) => {
      console.log('[AdminOrdersView] Realtime event received:', payload.eventType);

      const targetId = payload.new?.id;
      if (targetId && (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE')) {
        setRecentOrderChanges(prev => ({ ...prev, [targetId]: payload.eventType }));
        setTimeout(() => {
          setRecentOrderChanges(prev => {
            const next = { ...prev };
            delete next[targetId];
            return next;
          });
        }, 3000);
      }

      // Dispara aviso Toast
      if (payload.eventType === 'INSERT') {
        const newId = payload.new?.id;
        toast.info(`Novo pedido recebido! #${newId ? newId.slice(-6) : ''}`, {
          action: {
            label: 'Ver',
            onClick: () => {
              if (payload.new) handleSelectOrder(payload.new as Order);
            }
          }
        });
      } else if (payload.eventType === 'UPDATE') {
        const updatedId = payload.new?.id;
        const newStatus = payload.new?.status as OrderStatus;
        toast.info(`Pedido #${updatedId ? updatedId.slice(-6) : ''} atualizado para ${statusConfig[newStatus]?.label || newStatus}`);
      }

      // Atualiza apenas os KPIs (listagem já é atualizada reativamente em memória)
      loadStats();
    };
  }, [loadStats, handleSelectOrder]);

  const totalPages = Math.ceil(totalOrders / itemsPerPage);
  const paginatedOrders = orders;

  const handleStatusChange = async (orderId: string, newStatus: OrderStatus, silent: boolean = false) => {
    if (isOffline) {
      toast.error('Operação não permitida offline.', {
        description: 'Você precisa estar online para alterar o status do pedido.'
      });
      return;
    }
    const order = orders?.find(o => o.id === orderId);

    if (order?.userId && !silent) {
      try {
        const title = 'Status do Pedido Atualizado';
        const body = `Seu pedido #${orderId.slice(-6)} agora está: ${statusConfig[newStatus].label}`;

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        await supabase.functions.invoke('send-push', {
          body: {
            targetUserId: order.userId,
            title,
            body,
            data: { orderId, type: 'order_status' }
          },
          headers: token ? {
            Authorization: `Bearer ${token}`
          } : {}
        });
      } catch (err) {
        console.error('Error sending status push:', err);
      }
    }

    await updateOrderStatus(orderId, newStatus, undefined, silent);

    if (selectedOrder?.id === orderId) {
      setSelectedOrder({ ...selectedOrder, status: newStatus });
    }

    loadStats();
  };


  const handleWhatsApp = useCallback((order: Order) => {
    if (isOffline) {
      toast.error('Operação não permitida offline.', {
        description: 'Contatos via WhatsApp exigem conexão com a internet.'
      });
      return;
    }
    const message = `Olá ${order.customer?.name || 'Cliente'}!\n\n` +
      `Seu pedido #${order.id.slice(-6)} foi atualizado.\n` +
      `Status: ${statusConfig[order.status].label}\n\n` +
      `Obrigado por comprar na IKCOUS!`;

    let phone = (order.customer?.whatsapp || '').replace(/\D/g, '');
    if (phone.length === 11 || phone.length === 10) {
      phone = '55' + phone;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    globalThis.open(url, '_blank');
  }, [isOffline]);

  if (!isLoaded && orders.length === 0) {
    return (
      <div className="p-6 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-48 bg-white/5 rounded-xl animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] space-y-3 sm:space-y-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-xl bg-white/5 animate-pulse" />
                <Skeleton className="h-3 w-20 bg-white/5 animate-pulse" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-8 w-24 bg-white/5 animate-pulse" />
                <Skeleton className="h-3 w-16 bg-white/5 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        {viewMode === 'detailed' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-10">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-zinc-950/40 backdrop-blur-md border border-white/5 rounded-[3rem] p-8 space-y-6 h-[278px] flex flex-col justify-between shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-xl bg-white/5 animate-pulse" />
                    <div className="space-y-2">
                      <Skeleton className="h-3 w-16 bg-white/5 animate-pulse" />
                      <Skeleton className="h-2.5 w-12 bg-white/5 animate-pulse" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-16 bg-white/5 rounded-full animate-pulse" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-6 w-3/4 bg-white/5 animate-pulse" />
                  <Skeleton className="h-3 w-1/2 bg-white/5 animate-pulse" />
                </div>
                <div className="flex justify-between items-end pt-4 border-t border-white/5">
                  <div className="space-y-1">
                    <Skeleton className="h-2.5 w-12 bg-white/5 animate-pulse" />
                    <Skeleton className="h-6 w-24 bg-white/5 animate-pulse" />
                  </div>
                  <Skeleton className="w-12 h-12 rounded-2xl bg-white/5 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-10">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
              <div key={i} className="bg-zinc-950/40 backdrop-blur-md border border-white/5 rounded-[2rem] p-4 sm:p-5 h-[164px] flex flex-col justify-between shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="w-8 h-8 rounded-lg bg-white/5 animate-pulse" />
                    <div className="space-y-1">
                      <Skeleton className="h-2.5 w-12 bg-white/5 animate-pulse" />
                      <Skeleton className="h-2 w-8 bg-white/5 animate-pulse" />
                    </div>
                  </div>
                  <Skeleton className="h-4.5 w-12 bg-white/5 rounded-full animate-pulse" />
                </div>
                <div className="space-y-1">
                  <Skeleton className="h-4 w-3/4 bg-white/5 animate-pulse" />
                  <Skeleton className="h-2.5 w-1/2 bg-white/5 animate-pulse" />
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-white/5">
                  <div className="space-y-1">
                    <Skeleton className="h-2 w-8 bg-white/5 animate-pulse" />
                    <Skeleton className="h-4 w-16 bg-white/5 animate-pulse" />
                  </div>
                  <Skeleton className="w-9 h-9 rounded-xl bg-white/5 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (selectedOrderId && (loadingDetail || !selectedOrder)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] bg-[#09090b] text-white">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-2 border-amber-500/10 animate-ping duration-1000"></div>
          <div className="w-16 h-16 border-2 border-amber-500/10 border-t-amber-500 rounded-full animate-spin"></div>
          <div className="absolute inset-4 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center">
            <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center mt-6">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500 animate-pulse">
            Carregando Pedido
          </p>
          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">
            Aguarde um instante
          </p>
        </div>
      </div>
    );
  }

  if (selectedOrder) {
    return (
      <LocalErrorBoundary>
        <OrderDetail
          order={selectedOrder}
          onBack={handleBackToList}
          onStatusChange={handleStatusChange}
          onWhatsApp={handleWhatsApp}
        />
      </LocalErrorBoundary>
    );
  }

  return (
    <div className="h-auto bg-admin-bg text-white pb-8 font-sans selection:bg-admin-gold/30 animate-in fade-in duration-500">

      {/* Header Elite */}
      <div className="px-6 flex items-center justify-between gap-4 pt-6 pb-2">
          <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase leading-none select-none flex items-center gap-3 shrink-0">
              <span className="flex items-baseline flex-nowrap whitespace-nowrap">
                  <span className="italic text-white">Pedidos</span>
              </span>
              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                title="Guia de Ajuda e Explicações"
              >
                <HelpCircle className="w-4.5 h-4.5" />
              </button>
          </h1>
          <div className="flex items-center gap-3">
            <div className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300",
              !isLoaded 
                ? "bg-amber-500/10 border-amber-500/20 text-amber-500" 
                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
            )}>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                !isLoaded ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-pulse"
              )} />
              <span className="text-[10px] font-black uppercase tracking-widest">
                {!isLoaded ? "Sincronizando..." : "Operações ao Vivo"}
              </span>
            </div>
          </div>
        </div>

      <div className="p-4 sm:p-6 lg:p-8 space-y-12">
        {/* Support Section */}
        <div className="animate-in fade-in slide-in-from-top-4 duration-700">
          <SupportBanners onNavigate={onNavigate} />
        </div>

        {active && (
          <LocalErrorBoundary>
            <AdminKpiCarousel cards={kpiCards} title="Métricas de Pedidos" />
          </LocalErrorBoundary>
        )}

        {/* Unified Control Bar Compacta */}
        <div className="pt-8 border-t border-white/5 relative flex flex-col mb-8 mt-4">
          <div className="flex flex-col md:flex-row md:items-center gap-6 relative z-20">
            <div className="flex items-center gap-4 w-full flex-1">
                <div className="relative group w-full">
                     <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                         {!isLoaded || isTyping ? (
                             <Loader2 className="h-5 w-5 text-admin-gold animate-spin" />
                         ) : (
                             <Search className="h-5 w-5 text-zinc-600 group-focus-within:text-admin-gold transition-colors" />
                         )}
                     </div>
                    <DebouncedSearchInput
                        placeholder="Buscar pedidos..."
                        className="pl-14 h-14 rounded-2xl border-zinc-800 bg-black/40 text-white placeholder:text-zinc-600 focus:ring-admin-gold/20 focus:border-admin-gold/50 transition-all font-bold text-sm w-full"
                        value={searchQuery}
                        onChange={setSearchQuery}
                        onTyping={setIsTyping}
                        delay={300}
                    />
                </div>
                
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-14 w-14 rounded-2xl border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-admin-gold/50 group transition-all shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                        <Filter className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                    </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80 bg-zinc-950 border-zinc-800/50 p-4 rounded-3xl backdrop-blur-3xl mt-2 shadow-2xl">
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.2em] px-1">Filtro Temporal</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="relative group">
                                    <Input
                                    type="date"
                                    className="bg-black/40 border-zinc-800 text-white h-14 rounded-2xl focus:ring-admin-gold/20 focus:border-admin-gold/50 transition-all [color-scheme:dark] px-4 pt-5 pb-1 text-xs font-bold w-full"
                                    value={dateRange.start}
                                    onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                                    />
                                    <span className="absolute top-2 left-4 text-[7px] font-black uppercase text-zinc-600 tracking-widest pointer-events-none group-focus-within:text-admin-gold transition-colors">Início</span>
                                </div>
                                <div className="relative group">
                                    <Input
                                    type="date"
                                    className="bg-black/40 border-zinc-800 text-white h-14 rounded-2xl focus:ring-admin-gold/20 focus:border-admin-gold/50 transition-all [color-scheme:dark] px-4 pt-5 pb-1 text-xs font-bold w-full"
                                    value={dateRange.end}
                                    onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                                    />
                                    <span className="absolute top-2 left-4 text-[7px] font-black uppercase text-zinc-600 tracking-widest pointer-events-none group-focus-within:text-admin-gold transition-colors">Fim</span>
                                </div>
                            </div>
                            {(dateRange.start || dateRange.end) && (
                                <Button 
                                    variant="ghost" 
                                    className="w-full h-10 border border-zinc-800 text-[10px] font-black text-rose-500 hover:text-white hover:bg-rose-500 transition-all rounded-xl uppercase tracking-widest mt-2"
                                    onClick={() => setDateRange({start: '', end: ''})}
                                >
                                    Limpar Datas
                                </Button>
                            )}
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>

                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setViewMode(prev => prev === 'detailed' ? 'compact' : 'detailed')}
                    className="h-14 w-14 rounded-2xl border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-admin-gold/50 group transition-all shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                    title={viewMode === 'detailed' ? "Visualização Compacta" : "Visualização Detalhada"}
                >
                    {viewMode === 'detailed' ? (
                        <LayoutGrid className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                    ) : (
                        <List className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                    )}
                </Button>
            </div>
          </div>

          <div className="flex overflow-x-auto custom-scrollbar-hidden gap-3 pt-6 relative z-10 w-full snap-x">
            <button
              onClick={() => setFilter('all')}
              className={cn(
                "px-5 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border shrink-0 snap-center",
                filter === 'all'
                  ? "bg-admin-gold border-admin-gold text-black shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                  : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white"
              )}
            >
              Todos Ativos
            </button>
            {Object.entries(statusConfig).map(([status, cfg]) => (
              <button
                key={status}
                onClick={() => setFilter(status as OrderStatus)}
                className={cn(
                  "px-5 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border flex items-center gap-3 shrink-0 snap-center",
                  filter === status
                    ? "bg-admin-gold border-admin-gold text-black shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                    : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white"
                )}
              >
                <div className={cn("w-1.5 h-1.5 rounded-full", STATUS_ORDER_COLORS[status] || 'bg-gray-500')} />
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Orders List */}
        <LocalErrorBoundary>
          <div className={cn("space-y-8 relative transition-opacity duration-300", (!isLoaded && paginatedOrders.length === 0) && "opacity-50 pointer-events-none")}>
            {paginatedOrders.length === 0 ? (
              <div className="bg-zinc-950/40 backdrop-blur-md p-20 rounded-[4rem] border border-white/5 text-center relative overflow-hidden">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-admin-gold/5 blur-[100px] rounded-full" />
                <div className="relative z-10">
                  <div className="w-24 h-24 bg-zinc-900/50 rounded-[3rem] flex items-center justify-center mx-auto mb-8 border border-white/5 shadow-2xl">
                    <Package className="w-12 h-12 text-zinc-700" />
                  </div>
                  <h3 className="text-xl font-black text-white uppercase italic tracking-tighter mb-2">Nenhum Registro Detectado</h3>
                  <p className="text-sm font-medium text-zinc-500 uppercase tracking-widest max-w-xs mx-auto mb-8">O sistema de inteligência não localizou tráfego operacional para os parâmetros definidos.</p>
                  <Button
                    variant="outline"
                    onClick={() => { setSearchQuery(''); setFilter('all'); setDateRange({ start: '', end: '' }); }}
                    className="border-admin-gold/50 text-admin-gold hover:bg-admin-gold hover:text-black font-black uppercase text-[10px] tracking-widest rounded-xl hover:scale-105 transition-all"
                  >
                    Resetar Filtros de Segurança
                  </Button>
                </div>
              </div>
            ) : viewMode === 'detailed' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {paginatedOrders.map((order) => (
                  <AdminOrderCard
                    key={order.id}
                    order={order}
                    viewMode="detailed"
                    onSelect={handleSelectOrder}
                    onWhatsApp={handleWhatsApp}
                    changeType={recentOrderChanges[order.id]}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {paginatedOrders.map((order) => (
                  <AdminOrderCard
                    key={order.id}
                    order={order}
                    viewMode="compact"
                    onSelect={handleSelectOrder}
                    onWhatsApp={handleWhatsApp}
                    changeType={recentOrderChanges[order.id]}
                  />
                ))}
              </div>
            )}
          </div>
        </LocalErrorBoundary>


        {/* Elite Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-10 pt-12">
            <Button
              variant="ghost"
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="w-16 h-16 bg-zinc-950/50 border border-white/5 text-zinc-500 rounded-3xl hover:bg-admin-gold hover:text-black transition-all disabled:opacity-20 group"
            >
              <ChevronLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
            </Button>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-black text-white uppercase tracking-[0.4em]">Perfil do Setor</span>
              <span className="text-[11px] font-bold text-admin-gold tabular-nums uppercase tracking-widest">{currentPage + 1} <span className="text-zinc-700">/</span> {totalPages}</span>
            </div>
            <Button
              variant="ghost"
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
              className="w-16 h-16 bg-zinc-950/50 border border-white/5 text-zinc-500 rounded-3xl hover:bg-admin-gold hover:text-black transition-all disabled:opacity-20 group"
            >
              <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        )}
      </div>

      {/* Modal de Ajuda */}
      {showHelpModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
          <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[88vh] sm:max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
              <h3 className="text-sm font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-admin-gold animate-pulse" />
                Guia de Controle de Pedidos
              </h3>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="w-8 h-8 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all flex items-center justify-center font-bold text-sm"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-6 custom-scrollbar text-zinc-300 text-sm">
              <div className="space-y-4">
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Esta tela exibe a Central de Transmissões e Pedidos em tempo real. Aqui você pode gerenciar, auditar e atualizar o ciclo de vida dos pedidos efetuados no aplicativo.
                </p>

                <div className="space-y-3">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                    Ciclo de Vida do Pedido
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                      <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                        Pendente
                      </div>
                      <p className="text-xs text-zinc-400">
                        A transação foi criada pelo cliente, mas o pagamento ainda não foi processado ou verificado (aguardando aprovação).
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                      <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                        Pago / Em Processamento
                      </div>
                      <p className="text-xs text-zinc-400">
                        O pagamento foi validado com sucesso. O pedido está pronto para separação de estoque e embalagem.
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                      <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                        Enviado
                      </div>
                      <p className="text-xs text-zinc-400">
                        A mercadoria já foi despachada ou entregue ao portador/motoboy para transporte até o endereço do cliente.
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                      <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        Entregue
                      </div>
                      <p className="text-xs text-zinc-400">
                        O pedido foi entregue com sucesso ao destinatário. O fluxo operacional desta compra foi finalizado.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                    Recursos e Ações Rápidas
                  </h4>
                  <ul className="space-y-2 text-xs text-zinc-400 list-disc list-inside">
                    <li><strong className="text-white">Busca Dinâmica:</strong> Pesquise pedidos instantaneamente por ID, nome do cliente ou telefone.</li>
                    <li><strong className="text-white">Filtro por Status:</strong> Filtre a lista principal de acordo com o estado do pedido.</li>
                    <li><strong className="text-white">Detalhes do Pedido:</strong> Clique em qualquer linha para abrir a ficha completa do pedido com lista de itens, valores, meio de pagamento e endereço de entrega.</li>
                    <li><strong className="text-white">Contato Direto (WhatsApp):</strong> Clique no botão do WhatsApp nos detalhes do pedido para iniciar uma conversa direta com o cliente já com mensagem pré-formatada.</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-white/5 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="px-5 py-2.5 rounded-xl bg-admin-gold text-black text-[10px] font-black uppercase tracking-widest hover:bg-admin-gold/90 transition-all"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

interface AdminOrderCardProps {
  readonly order: Order;
  readonly viewMode: 'detailed' | 'compact';
  readonly onSelect: (order: Order) => void;
  readonly onWhatsApp: (order: Order) => void;
  readonly changeType?: 'INSERT' | 'UPDATE';
}

const AdminOrderCard = memo(function AdminOrderCard({
  order,
  viewMode,
  onSelect,
  onWhatsApp,
  changeType
}: AdminOrderCardProps) {
  if (viewMode === 'detailed') {
    return (
      <div
        onClick={() => onSelect(order)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(order);
          }
        }}
        className={cn(
          "group relative bg-zinc-950/40 backdrop-blur-md border rounded-[3rem] p-8 transition-all duration-500 hover:scale-[1.01] hover:shadow-[0_20px_60px_rgba(212,175,55,0.05)] hover:border-admin-gold/30 active:scale-[0.98] cursor-pointer focus:outline-none focus:ring-2 focus:ring-admin-gold focus:ring-offset-2 focus:ring-offset-zinc-950 content-visibility-auto",
          changeType === 'INSERT' && "border-admin-gold shadow-[0_0_25px_rgba(212,175,55,0.3)] animate-pulse",
          changeType === 'UPDATE' && "border-blue-500 shadow-[0_0_25px_rgba(59,130,246,0.3)] animate-pulse",
          !changeType && "border-white/5"
        )}
      >
        {/* Glow Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-admin-gold/0 via-transparent to-admin-gold/0 group-hover:from-admin-gold/5 group-hover:to-transparent rounded-[3rem] transition-all duration-700 pointer-events-none z-0" />

        <div className="flex items-center justify-between mb-8 relative z-10">
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              {order.items?.[0]?.image ? (
                <LazyImage src={order.items[0].image} alt="Produto" className="w-10 h-10 rounded-xl object-cover border border-white/10 shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-zinc-600" />
                </div>
              )}
              {order.items?.length > 1 && (
                <div className="absolute -top-2 -right-2 bg-admin-gold text-black text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center shadow-lg border border-zinc-900">
                  +{order.items.length - 1}
                </div>
              )}
            </div>
            <div>
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] block mb-1 group-hover:text-admin-gold transition-colors">#{order.id.slice(-6).toUpperCase()}</span>
              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest flex items-center gap-2">
                <Calendar className="w-3 h-3" />
                {new Date(order.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </span>
            </div>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>

        <div className="space-y-6 relative z-10">
          <div>
            <h4 className="text-lg sm:text-xl font-black text-white group-hover:text-admin-gold transition-colors truncate mb-2">
              {(() => {
                if (!order.items || order.items.length === 0) return 'Pedido Vazio';
                if (order.items.length === 1) return order.items[0].name;
                return `${order.items[0].name} e mais ${order.items.length - 1}`;
              })()}
            </h4>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-[9px] font-black text-zinc-400 uppercase tracking-widest bg-white/5 px-2 py-1 rounded-md border border-white/5">
                <User className="w-3 h-3" />
                {(() => {
                  const nameParts = (order.customer?.name || 'Cliente').split(' ');
                  return nameParts.length > 1
                    ? `${nameParts[0][0]}. ${nameParts.at(-1)}`
                    : nameParts[0];
                })()}
              </div>
              <span className="text-[9px] font-black text-zinc-500 bg-white/5 px-2 py-1 rounded-md border border-white/5 uppercase tracking-widest">{order.items?.length || 0} Prod.</span>
              <div className="w-1 h-1 rounded-full bg-zinc-800" />
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400 font-black">{PAYMENT_METHOD_LABELS[order.paymentMethod] || 'Outro'}</span>
            </div>
          </div>

          <div className="pt-6 border-t border-white/5 flex items-end justify-between">
            <div className="space-y-1">
              <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em] ">Valor Capital</span>
              <p className="text-2xl font-black text-white tracking-widest tabular-nums">
                <span className="text-[10px] font-black text-zinc-500 mr-1 uppercase">R$</span>
                {(order.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onWhatsApp(order);
                }}
                className="w-12 h-12 flex items-center justify-center bg-emerald-500/10 text-emerald-500 rounded-2xl hover:bg-emerald-500 hover:text-black transition-all border border-emerald-500/20 shadow-xl relative z-10"
              >
                <MessageCircle className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 flex items-center justify-center text-zinc-500 group-hover:text-admin-gold transition-all duration-300">
                <ChevronRight className="w-6 h-6 transform transition-transform duration-300 group-hover:translate-x-1 filter group-hover:drop-shadow-[0_0_8px_rgba(212,175,55,0.5)]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // compact mode
  return (
    <div
      onClick={() => onSelect(order)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(order);
        }
      }}
      className={cn(
        "group relative bg-zinc-950/40 backdrop-blur-md border rounded-[2rem] p-4 sm:p-5 transition-all duration-500 hover:scale-[1.01] hover:shadow-[0_15px_40px_rgba(212,175,55,0.05)] hover:border-admin-gold/30 active:scale-[0.98] cursor-pointer focus:outline-none focus:ring-2 focus:ring-admin-gold focus:ring-offset-2 focus:ring-offset-zinc-950 content-visibility-auto",
        changeType === 'INSERT' && "border-admin-gold shadow-[0_0_20px_rgba(212,175,55,0.3)] animate-pulse",
        changeType === 'UPDATE' && "border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)] animate-pulse",
        !changeType && "border-white/5"
      )}
    >
      {/* Glow Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-admin-gold/0 via-transparent to-admin-gold/0 group-hover:from-admin-gold/5 group-hover:to-transparent rounded-[2rem] transition-all duration-700 pointer-events-none z-0" />

      {/* Header Row: Image/ID and Status */}
      <div className="flex flex-col gap-2 min-[400px]:flex-row min-[400px]:items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            {order.items?.[0]?.image ? (
              <LazyImage src={order.items[0].image} alt="Produto" className="w-8 h-8 rounded-lg object-cover border border-white/10 shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center shrink-0">
                <Package className="w-4 h-4 text-zinc-600" />
              </div>
            )}
            {order.items?.length > 1 && (
              <div className="absolute -top-1.5 -right-1.5 bg-admin-gold text-black text-[8px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center shadow-lg border border-zinc-900">
                +{order.items.length - 1}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block group-hover:text-admin-gold transition-colors truncate">#{order.id.slice(-6).toUpperCase()}</span>
            <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-tight block truncate">
              {new Date(order.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
            </span>
          </div>
        </div>
        <div className="shrink-0 flex justify-start min-[400px]:justify-end">
          <OrderStatusBadge status={order.status} className="px-1.5 py-0.5" />
        </div>
      </div>

      {/* Customer & Product description */}
      <div className="space-y-1 mb-4 relative z-10">
        <h4 className="text-sm font-black text-white group-hover:text-admin-gold transition-colors truncate">
          {order.customer?.name || 'Cliente'}
        </h4>
        <p className="text-[9px] text-zinc-500 font-bold uppercase truncate">
          {(() => {
            if (!order.items || order.items.length === 0) return 'Pedido Vazio';
            if (order.items.length === 1) return order.items[0].name;
            return `${order.items[0].name} e mais ${order.items.length - 1}`;
          })()}
        </p>
      </div>

      {/* Footer Row: Price and Quick WhatsApp button */}
      <div className="pt-3 border-t border-white/5 flex items-center justify-between relative z-10">
        <div className="space-y-0.5">
          <span className="text-[8px] font-black text-zinc-600 uppercase tracking-wider block">Valor</span>
          <p className="text-base font-black text-white tracking-tight tabular-nums">
            <span className="text-[9px] font-black text-zinc-500 mr-0.5 uppercase">R$</span>
            {(order.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onWhatsApp(order);
            }}
            className="w-11 h-11 flex items-center justify-center bg-emerald-500/10 text-emerald-500 rounded-xl hover:bg-emerald-500 hover:text-black transition-all border border-emerald-500/20 shadow-lg relative z-10 active:scale-90"
            title="WhatsApp"
          >
            <MessageCircle className="w-5 h-5" />
          </button>
          <ChevronRight className="w-4.5 h-4.5 text-zinc-500 group-hover:text-admin-gold transition-all duration-300 transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </div>
  );
});

export default AdminOrdersView;
