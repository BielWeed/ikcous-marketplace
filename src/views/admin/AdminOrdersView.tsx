import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Eye,
  MessageCircle,
  Package,
  XCircle,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  DollarSign,
  ShoppingCart,
  ArrowLeft,
  Calendar
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Order, OrderStatus, View } from '@/types';
import { useOrders } from '@/hooks/useOrders';
import { OrderStatusBadge, statusConfig } from '@/components/admin/orders/OrderStatusBadge';
import { OrderDetail } from '@/components/admin/orders/OrderDetail';
import { SupportBanners } from '@/components/admin/dashboard/SupportBanners';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const handleBack = () => onNavigate('admin-dashboard');

  const { orders, fetchOrders, updateOrderStatus, isLoaded } = useOrders(true, true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  });
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 12;

  const toggleSelectOrder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const handleBulkStatusChange = async (status: OrderStatus) => {
    if (selectedIds.size === 0) return;
    try {
      const promises = Array.from(selectedIds).map(id => handleStatusChange(id, status, true));
      await Promise.all(promises);
      setSelectedIds(new Set());
      toast.success(`${selectedIds.size} pedidos atualizados.`);
    } catch (err) {
      console.error('Error in bulk update:', err);
      toast.error('Erro ao atualizar pedidos em massa');
    }
  };

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

    if (order && order.userId && !silent) {
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

    if (selectedOrder && selectedOrder.id === orderId) {
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
      <div className="min-h-screen bg-[var(--admin-bg)] flex items-center justify-center">
        <div className="relative w-20 h-20 mb-6">
          <div className="absolute inset-0 border-4 border-[var(--admin-gold)]/10 rounded-full" />
          <div className="absolute inset-0 border-4 border-t-[var(--admin-gold)] rounded-full animate-spin" />
          <ShoppingCart className="absolute inset-0 m-auto w-8 h-8 text-[var(--admin-gold)] animate-pulse" />
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
    <div className="min-h-screen bg-[var(--admin-bg)] text-white pb-32 font-sans selection:bg-[var(--admin-gold)]/30">

      {/* Header Elite */}
      <div className="admin-glass px-6 py-8 sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button
              onClick={handleBack}
              className="w-12 h-12 flex items-center justify-center bg-zinc-950/50 text-zinc-400 rounded-2xl hover:bg-[var(--admin-gold)] hover:text-black transition-all active:scale-95 border border-white/5 group shadow-2xl"
            >
              <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            </button>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <ShoppingCart className="w-5 h-5 text-[var(--admin-gold)] animate-pulse" />
                <h1 className="text-2xl font-black tracking-tighter uppercase italic bg-gradient-to-r from-white via-zinc-400 to-zinc-600 bg-clip-text text-transparent">
                  Inteligência de Pedidos
                </h1>
              </div>
              <p className="text-[10px] font-bold text-[var(--admin-gold)] uppercase tracking-[0.3em] opacity-80">
                {orders.length === 0 ? 'Limpo' : `${orders.length} Transmissões Ativas`}
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Operações ao Vivo</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 lg:p-8 space-y-12">
        {/* Elite Operational Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: 'Receita Hoje', value: `R$ ${operationalStats.revenueDay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-emerald-500', trend: 'Finanças' },
            { label: 'Ações Pendentes', value: operationalStats.pending, icon: Clock, color: 'text-amber-500', trend: operationalStats.pending > 0 ? 'Urgente' : 'Limpo' },
            { label: 'Ticket Médio', value: `R$ ${operationalStats.avgTicket.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: 'text-[var(--admin-gold)]', trend: 'Rendimento' },
            { label: 'Total Concluído', value: operationalStats.completed, icon: CheckCircle2, color: 'text-sky-500', trend: 'Concluído' },
          ].map((stat) => (
            <div key={stat.label} className="group relative bg-zinc-950/40 backdrop-blur-md border border-white/5 p-6 rounded-[2rem] overflow-hidden hover:border-[var(--admin-gold)]/30 transition-all duration-500">
              <div className="absolute top-0 right-0 w-24 h-24 bg-[var(--admin-gold)]/5 blur-[50px] rounded-full -mr-12 -mt-12 group-hover:bg-[var(--admin-gold)]/10 transition-all" />
              <div className="flex justify-between items-start mb-4 relative z-10">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border border-white/5 bg-zinc-900 group-hover:scale-110 transition-transform duration-500", stat.color)}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <span className={cn(
                  "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border",
                  stat.trend === 'Urgente' ? "bg-rose-500/10 text-rose-500 border-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.1)]" : "bg-white/5 text-zinc-500 border-white/10"
                )}>
                  {stat.trend}
                </span>
              </div>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1 relative z-10">{stat.label}</p>
              <h3 className="text-2xl font-black text-white tracking-tighter relative z-10 group-hover:text-[var(--admin-gold)] transition-colors line-clamp-1">{stat.value}</h3>
            </div>
          ))}
        </div>

        {/* Strategic Filter Panel */}
        <div className="bg-zinc-950/40 backdrop-blur-md p-8 rounded-[3rem] border border-white/5 space-y-8 relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-[var(--admin-gold)]/5 blur-[100px] rounded-full" />

          <div className="flex flex-col lg:flex-row gap-6 relative z-10">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600 group-focus-within:text-[var(--admin-gold)] transition-colors" />
              <Input
                placeholder="Pesquisar protocolo (Nome, ID, WhatsApp)..."
                className="bg-black/40 border-white/5 text-white pl-12 h-16 rounded-2xl focus:ring-[var(--admin-gold)]/50 focus:border-[var(--admin-gold)]/30 transition-all placeholder:text-zinc-700 text-sm font-medium"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-4 md:w-96">
              <div className="relative group">
                <Input
                  type="date"
                  className="bg-black/40 border-white/5 text-white h-16 rounded-2xl focus:ring-[var(--admin-gold)]/50 transition-all [color-scheme:dark] px-6 pt-6 pb-2 text-xs font-bold"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                />
                <span className="absolute top-2 left-6 text-[8px] font-black uppercase text-zinc-600 tracking-widest group-focus-within:text-[var(--admin-gold)]">Início do Arquivo</span>
              </div>
              <div className="relative group">
                <Input
                  type="date"
                  className="bg-black/40 border-white/5 text-white h-16 rounded-2xl focus:ring-[var(--admin-gold)]/50 transition-all [color-scheme:dark] px-6 pt-6 pb-2 text-xs font-bold"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                />
                <span className="absolute top-2 left-6 text-[8px] font-black uppercase text-zinc-600 tracking-widest group-focus-within:text-[var(--admin-gold)]">Fim do Arquivo</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-4 border-t border-white/5 relative z-10">
            <button
              onClick={() => setFilter('all')}
              className={cn(
                "px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border",
                filter === 'all'
                  ? "bg-[var(--admin-gold)] border-[var(--admin-gold)] text-black shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                  : "bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10 hover:text-white"
              )}
            >
              Todos os Ativos
            </button>
            {Object.entries(statusConfig).map(([status, cfg]) => (
              <button
                key={status}
                onClick={() => setFilter(status as OrderStatus)}
                className={cn(
                  "px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border flex items-center gap-3",
                  filter === status
                    ? "bg-[var(--admin-gold)] border-[var(--admin-gold)] text-black shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                    : "bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10 hover:text-white"
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
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-[var(--admin-gold)]/5 blur-[100px] rounded-full" />
              <div className="relative z-10">
                <div className="w-24 h-24 bg-zinc-900/50 rounded-[3rem] flex items-center justify-center mx-auto mb-8 border border-white/5 shadow-2xl">
                  <Package className="w-12 h-12 text-zinc-700" />
                </div>
                <h3 className="text-xl font-black text-white uppercase italic tracking-tighter mb-2">Nenhum Registro Detectado</h3>
                <p className="text-sm font-medium text-zinc-500 uppercase tracking-widest max-w-xs mx-auto mb-8">O sistema de inteligência não localizou tráfego operacional para os parâmetros definidos.</p>
                <Button
                  variant="outline"
                  onClick={() => { setSearchQuery(''); setFilter('all'); setDateRange({ start: '', end: '' }); }}
                  className="border-[var(--admin-gold)]/50 text-[var(--admin-gold)] hover:bg-[var(--admin-gold)] hover:text-black font-black uppercase text-[10px] tracking-widest rounded-xl hover:scale-105 transition-all"
                >
                  Resetar Filtros de Segurança
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {paginatedOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setSelectedOrder(order);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Ver detalhes do pedido ${order.id.slice(-6).toUpperCase()}`}
                  className={cn(
                    "group relative bg-zinc-950/40 backdrop-blur-md border rounded-[3rem] p-8 transition-all duration-500 cursor-pointer hover:shadow-[0_20px_60px_rgba(0,0,0,0.5)] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[var(--admin-gold)] focus:ring-offset-2 focus:ring-offset-zinc-950",
                    selectedIds.has(order.id) ? "border-[var(--admin-gold)]/60 shadow-[0_0_30px_rgba(212,175,55,0.1)]" : "border-white/5 hover:border-[var(--admin-gold)]/30"
                  )}
                >
                  {/* Glow Background */}
                  <div className="absolute inset-0 bg-gradient-to-br from-[var(--admin-gold)]/0 via-transparent to-[var(--admin-gold)]/0 group-hover:from-[var(--admin-gold)]/5 group-hover:to-transparent rounded-[3rem] transition-all duration-700 pointer-events-none" />

                  {/* Multi-select control */}
                  <button
                    type="button"
                    title="Selecionar pedido"
                    className={cn(
                      "absolute top-8 left-8 z-10 w-6 h-6 rounded-lg border flex items-center justify-center transition-all",
                      selectedIds.has(order.id)
                        ? "bg-[var(--admin-gold)] border-[var(--admin-gold)] text-black"
                        : "bg-black/40 border-white/10 group-hover:border-[var(--admin-gold)]/50"
                    )}
                    onClick={(e) => toggleSelectOrder(order.id, e)}
                  >
                    {selectedIds.has(order.id) && <CheckCircle2 className="w-4 h-4 stroke-[4]" />}
                  </button>

                  <div className="flex items-center justify-between mb-8 pl-10 relative z-10">
                    <div>
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] block mb-1 group-hover:text-[var(--admin-gold)] transition-colors">#{order.id.slice(-6).toUpperCase()}</span>
                      <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest flex items-center gap-2">
                        <Calendar className="w-3 h-3" />
                        {new Date(order.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </div>

                  <div className="space-y-6 relative z-10">
                    <div>
                      <h4 className="text-xl font-black text-white group-hover:text-[var(--admin-gold)] transition-colors truncate mb-1">
                        {(() => {
                          const nameParts = (order.customer?.name || 'Cliente').split(' ');
                          return nameParts.length > 1
                            ? `${nameParts[0][0]}. ${nameParts.at(-1)}`
                            : nameParts[0];
                        })()}
                      </h4>
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] font-black text-zinc-500 bg-white/5 px-2 py-0.5 rounded-md border border-white/5 uppercase tracking-widest">{order.items?.length || 0} Produtos</span>
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
                        <button className="w-12 h-12 flex items-center justify-center bg-white/5 text-zinc-500 rounded-2xl hover:bg-[var(--admin-gold)] hover:text-black transition-all border border-white/5 shadow-xl">
                          <Eye className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
              className="w-16 h-16 bg-zinc-950/50 border border-white/5 text-zinc-500 rounded-3xl hover:bg-[var(--admin-gold)] hover:text-black transition-all disabled:opacity-20 group"
            >
              <ChevronLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
            </Button>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-black text-white uppercase tracking-[0.4em]">Perfil do Setor</span>
              <span className="text-[11px] font-bold text-[var(--admin-gold)] tabular-nums uppercase tracking-widest">{currentPage + 1} <span className="text-zinc-700">/</span> {totalPages}</span>
            </div>
            <Button
              variant="ghost"
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
              className="w-16 h-16 bg-zinc-950/50 border border-white/5 text-zinc-500 rounded-3xl hover:bg-[var(--admin-gold)] hover:text-black transition-all disabled:opacity-20 group"
            >
              <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        )}
      </div>

      {/* Bulk Elite Control */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-20 fade-in duration-500 w-full max-w-2xl px-6">
          <div className="bg-zinc-950/90 backdrop-blur-3xl border border-[var(--admin-gold)]/30 text-white p-6 rounded-[3rem] shadow-[0_40px_100px_rgba(0,0,0,0.8)] flex items-center justify-between">
            <div className="flex items-center gap-6 border-r border-white/10 pr-8">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-[var(--admin-gold)] text-black flex items-center justify-center font-black text-xl shadow-[0_0_20px_rgba(212,175,55,0.4)]">
                  {selectedIds.size}
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full animate-ping opacity-75" />
              </div>
              <div>
                <span className="block text-[9px] font-black uppercase tracking-[0.3em] text-[var(--admin-gold)] mb-1">Operação em Lote</span>
                <span className="block text-sm font-black uppercase italic tracking-tighter">Ações Sincronizadas</span>
              </div>
            </div>

            <div className="flex items-center gap-4 flex-1 justify-center px-4">
              <Button
                onClick={() => handleBulkStatusChange('processing')}
                className="h-14 px-8 bg-zinc-900 hover:bg-zinc-800 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl border border-white/10 transition-all flex-1"
              >
                Em Processamento
              </Button>
              <Button
                onClick={() => handleBulkStatusChange('shipping')}
                className="h-14 px-8 bg-[var(--admin-gold)] hover:bg-white text-black text-[10px] font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl flex-1"
              >
                Enviar Pedidos
              </Button>
            </div>

            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-4 text-zinc-600 hover:text-white transition-colors bg-white/5 rounded-2xl hover:bg-red-500 transition-all duration-300"
              title="Abort Batch"
            >
              <XCircle className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
