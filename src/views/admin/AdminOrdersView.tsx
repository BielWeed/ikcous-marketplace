import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Eye,
  MessageCircle,
  Package,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  DollarSign,
  ShoppingCart,
  Calendar,
  User,
  Filter
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import type { Order, OrderStatus, View } from '@/types';
import { useOrders } from '@/hooks/useOrders';
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
  onNavigate: (view: View) => void;
}

export function AdminOrdersView({ onNavigate }: Readonly<AdminOrdersViewProps>) {
  const { orders, fetchOrders, updateOrderStatus, isLoaded } = useOrders(true, true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  });
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 12;

  // Removidas funções bulk status e toggle selecionados para evitar erros de compilação.

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery, filter, dateRange]);

  // Métricas Operacionais
  const operationalStats = useMemo(() => {
    if (!orders) return { revenueDay: 0, pending: 0, avgTicket: 0, completed: 0 };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayOrders = orders.filter(o => {
      const d = new Date(o.createdAt);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime();
    });

    const revenue = todayOrders.reduce((acc, o) => acc + (o.total || 0), 0);
    const pending = orders.filter(o => o.status === 'pending' || o.status === 'processing').length;
    const completed = orders.filter(o => o.status === 'delivered').length;
    const avgTicket = orders.length > 0 ? orders.reduce((acc, o) => acc + (o.total || 0), 0) / orders.length : 0;

    return {
      revenueDay: revenue,
      pending,
      avgTicket,
      completed
    };
  }, [orders]);

  const filteredOrders = orders.filter(order => {
    if (filter !== 'all' && order.status !== filter) return false;

    if (dateRange.start || dateRange.end) {
      const orderDate = new Date(order.createdAt);
      orderDate.setHours(0, 0, 0, 0);

      if (dateRange.start) {
        const start = new Date(dateRange.start);
        start.setHours(0, 0, 0, 0);
        if (orderDate < start) return false;
      }

      if (dateRange.end) {
        const end = new Date(dateRange.end);
        end.setHours(0, 0, 0, 0);
        if (orderDate > end) return false;
      }
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        (order.customer?.name || '').toLowerCase().includes(query) ||
        (order.id || '').includes(query) ||
        (order.customer?.whatsapp || '').includes(query)
      );
    }
    return true;
  });

  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const paginatedOrders = filteredOrders.slice(
    currentPage * itemsPerPage,
    (currentPage + 1) * itemsPerPage
  );

  const handleStatusChange = async (orderId: string, newStatus: OrderStatus, silent: boolean = false) => {
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
  };


  const handleWhatsApp = (order: Order) => {
    const message = `Olá ${order.customer?.name || 'Cliente'}!\n\n` +
      `Seu pedido #${order.id.slice(-6)} foi atualizado.\n` +
      `Status: ${statusConfig[order.status].label}\n\n` +
      `Obrigado por comprar na IKCOUS!`;

    const url = `https://wa.me/55${order.customer?.whatsapp?.replaceAll(/\D/g, '') || ''}?text=${encodeURIComponent(message)}`;
    globalThis.open(url, '_blank');
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-admin-bg flex items-center justify-center">
        <div className="relative w-20 h-20 mb-6">
          <div className="absolute inset-0 border-4 border-admin-gold/10 rounded-full" />
          <div className="absolute inset-0 border-4 border-t-admin-gold rounded-full animate-spin" />
          <ShoppingCart className="absolute inset-0 m-auto w-8 h-8 text-admin-gold animate-pulse" />
        </div>
      </div>
    );
  }

  if (selectedOrder) {
    return (
      <OrderDetail
        order={selectedOrder}
        onBack={() => setSelectedOrder(null)}
        onStatusChange={handleStatusChange}
        onWhatsApp={handleWhatsApp}
      />
    );
  }

  return (
    <div className="min-h-screen bg-admin-bg text-white pb-32 font-sans selection:bg-admin-gold/30">

      {/* Header Elite */}
      <div className="px-6 flex items-center justify-between pt-6 pb-2">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <ShoppingCart className="w-5 h-5 text-admin-gold animate-pulse" />
              <h1 className="text-2xl font-black tracking-tighter uppercase italic bg-gradient-to-r from-white via-zinc-400 to-zinc-600 bg-clip-text text-transparent">
                Inteligência de Pedidos
              </h1>
            </div>
            <p className="text-[10px] font-bold text-admin-gold uppercase tracking-[0.3em] opacity-80">
              {orders.length === 0 ? 'Limpo' : `${orders.length} Transmissões Ativas`}
            </p>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Operações ao Vivo</span>
            </div>
          </div>
        </div>

      <div className="p-4 sm:p-6 lg:p-8 space-y-12">
        {/* Elite Operational Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {[
            { label: 'Receita Hoje', value: `R$ ${operationalStats.revenueDay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: DollarSign, accent: 'text-emerald-500', subValue: 'Finanças' },
            { label: 'Ações Pendentes', value: operationalStats.pending.toString(), icon: Clock, accent: 'text-amber-500', subValue: operationalStats.pending > 0 ? 'Urgente' : 'Limpo' },
            { label: 'Ticket Médio', value: `R$ ${operationalStats.avgTicket.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: TrendingUp, accent: 'text-admin-gold', subValue: 'Rendimento' },
            { label: 'Total Concluído', value: operationalStats.completed.toString(), icon: CheckCircle2, accent: 'text-sky-500', subValue: 'Concluído' },
          ].map((stat) => (
            <div key={stat.label} className="bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] shadow-2xl relative group hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.05)] transition-all duration-500" style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}>
                <div className="flex items-center gap-3 mb-4">
                    <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center border border-white/5 shadow-inner bg-zinc-950",
                        stat.accent
                    )}>
                        <stat.icon className="w-4 h-4 flex-shrink-0" />
                    </div>
                    <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 leading-tight">
                        {stat.label}
                    </p>
                </div>
                <div className="flex flex-col xl:flex-row xl:items-baseline gap-1 xl:gap-2 relative z-10">
                    <h3 className="text-xl sm:text-2xl font-black tracking-tighter text-white leading-none whitespace-nowrap">
                        {stat.value}
                    </h3>
                    <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-tight truncate xl:whitespace-nowrap opacity-80">
                        {stat.subValue}
                    </p>
                </div>
            </div>
          ))}
        </div>

        {/* Unified Control Bar Compacta */}
        <div className="pt-8 border-t border-white/5 relative flex flex-col mb-8 mt-4">
          <div className="flex flex-col md:flex-row md:items-center gap-6 relative z-20">
            <div className="flex items-center gap-4 w-full flex-1">
                <div className="relative group w-full">
                    <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                        <Search className="h-5 w-5 text-zinc-600 group-focus-within:text-admin-gold transition-colors" />
                    </div>
                    <Input
                        placeholder="Pesquisar protocolo (Nome, ID, WhatsApp)..."
                        className="pl-14 h-14 rounded-2xl border-zinc-800 bg-black/40 text-white placeholder:text-zinc-600 focus:ring-admin-gold/20 focus:border-admin-gold/50 transition-all font-bold text-sm w-full"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoComplete="off"
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
        <div className="space-y-8 relative">
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
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {paginatedOrders.map((order) => {
                return (
                  <div
                    key={order.id}
                  className={cn(
                    "group relative bg-zinc-950/40 backdrop-blur-md border rounded-[3rem] p-8 transition-all duration-500 hover:shadow-[0_20px_60px_rgba(0,0,0,0.5)] active:scale-[0.98] focus-within:ring-2 focus-within:ring-admin-gold focus-within:ring-offset-2 focus-within:ring-offset-zinc-950",
                    "border-white/5 hover:border-admin-gold/30"
                  )}
                >
                  {/* Native Click Target for Accessibility */}
                  <button
                    type="button"
                    onClick={() => setSelectedOrder(order)}
                    className="absolute inset-0 w-full h-full rounded-[3rem] opacity-0 z-0 cursor-pointer focus:outline-none"
                    aria-label={`Ver detalhes do pedido ${order.id.slice(-6).toUpperCase()}`}
                  />
                  
                  {/* Glow Background */}
                  <div className="absolute inset-0 bg-gradient-to-br from-admin-gold/0 via-transparent to-admin-gold/0 group-hover:from-admin-gold/5 group-hover:to-transparent rounded-[3rem] transition-all duration-700 pointer-events-none z-0" />

                  <div className="flex items-center justify-between mb-8 relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        {order.items?.[0]?.image ? (
                          <img src={order.items[0].image} alt="Produto" className="w-10 h-10 rounded-xl object-cover border border-white/10 shrink-0" />
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
                        <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em]">Valor Capital</span>
                        <p className="text-2xl font-black text-white tracking-widest tabular-nums">
                          <span className="text-[10px] font-black text-zinc-500 mr-1 uppercase">R$</span>
                          {(order.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleWhatsApp(order);
                          }}
                          className="w-12 h-12 flex items-center justify-center bg-emerald-500/10 text-emerald-500 rounded-2xl hover:bg-emerald-500 hover:text-black transition-all border border-emerald-500/20 shadow-xl"
                        >
                          <MessageCircle className="w-5 h-5" />
                        </button>
                        <button className="w-12 h-12 flex items-center justify-center bg-white/5 text-zinc-500 rounded-2xl hover:bg-admin-gold hover:text-black transition-all border border-white/5 shadow-xl">
                          <Eye className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Support Section */}
        <div className="animate-in fade-in slide-in-from-bottom-10 duration-700">
          <SupportBanners onNavigate={onNavigate} />
        </div>

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


    </div>
  );
}
