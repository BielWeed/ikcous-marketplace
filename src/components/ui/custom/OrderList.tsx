import { motion } from 'framer-motion';
import { ChevronRight, ShieldCheck, Copy, Calendar, CreditCard, Banknote, QrCode, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Order, OrderStatus, View, PaymentMethod } from '@/types';
import { toast } from 'sonner';

const statusConfig: Record<OrderStatus, { label: string; color: string; bg: string; dot: string }> = {
    pending: { label: 'Pedido Recebido', color: 'text-blue-600', bg: 'bg-blue-50/50', dot: 'bg-blue-500' },
    processing: { label: 'Em Separação', color: 'text-amber-600', bg: 'bg-amber-50/50', dot: 'bg-amber-500' },
    shipping: { label: 'Em Trânsito', color: 'text-indigo-600', bg: 'bg-indigo-50/50', dot: 'bg-indigo-500' },
    delivered: { label: 'Entregue', color: 'text-emerald-600', bg: 'bg-emerald-50/50', dot: 'bg-emerald-500' },
    cancelled: { label: 'Cancelado', color: 'text-rose-600', bg: 'bg-rose-50/50', dot: 'bg-rose-500' }
};

const paymentConfig: Record<PaymentMethod, { label: string; icon: any }> = {
    pix: { label: 'PIX', icon: QrCode },
    card: { label: 'Cartão', icon: CreditCard },
    cash: { label: 'Dinheiro', icon: Banknote }
};

interface OrderListProps {
    orders: Order[];
    isLoadingOrders?: boolean;
    onNavigate: (view: View, id?: string) => void;
    isGuest?: boolean;
    compact?: boolean;
    guestMessage?: string;
}

export function OrderList({ orders, isLoadingOrders, onNavigate, isGuest, compact, guestMessage }: OrderListProps) {
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success("ID do pedido copiado!");
    };

    if (orders.length === 0 && !isLoadingOrders) {
        return (
            <div className={cn(
                "text-center px-6",
                compact ? "py-2" : "py-4 xs:py-16"
            )}>
                <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={cn(
                        "bg-zinc-50 rounded-full flex items-center justify-center mx-auto border border-zinc-100 shadow-inner overflow-hidden",
                        compact ? "w-8 h-8 mb-2" : "w-12 h-12 xs:w-24 xs:h-24 mb-3 xs:mb-8"
                    )}
                >
                    {isGuest ? (
                        <ShieldCheck className={cn("text-zinc-300", compact ? "w-4 h-4" : "w-6 h-6 xs:w-12 xs:h-12")} />
                    ) : (
                        <Package className={cn("text-zinc-300", compact ? "w-4 h-4" : "w-6 h-6 xs:w-12 xs:h-12")} />
                    )}
                </motion.div>
                <h3 className={cn(
                    "font-black italic uppercase tracking-tighter text-zinc-900",
                    compact ? "text-sm mb-0.5" : "text-base xs:text-2xl mb-1 xs:mb-3"
                )}>
                    {isGuest ? "Histórico Protegido" : "Nenhum pedido"}
                </h3>
                <p className={cn(
                    "font-bold text-zinc-400 uppercase tracking-widest leading-relaxed mx-auto",
                    compact ? "text-[8px] max-w-[200px]" : "text-[10px] xs:text-[12px] max-w-[280px]"
                )}>
                    {isGuest
                        ? (compact ? "Acesse para ver seu histórico." : (guestMessage || "Seus pedidos são vinculados à sua conta. Acesse para visualizar seu histórico completo."))
                        : "Sua sacola de pedidos está vazia. Que tal começar a comprar?"}
                </p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {orders.map((order, idx) => {
                const status = statusConfig[order.status] || statusConfig.pending;
                const payment = paymentConfig[order.paymentMethod] || paymentConfig.pix;
                const PaymentIcon = payment.icon;
                const total = order?.total || 0;
                const date = order?.createdAt ? new Date(order.createdAt) : new Date();

                return (
                    <motion.div
                        key={order.id}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="group"
                    >
                        <div className="bg-white rounded-3xl p-5 border border-zinc-100 shadow-sm hover:shadow-xl hover:shadow-zinc-200/40 transition-all duration-500 relative overflow-hidden flex flex-col h-full">
                            {/* Top row: ID and Status */}
                            <div className="flex items-start justify-between mb-5">
                                <button
                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(order?.id || ''); }}
                                    className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-50 rounded-full border border-zinc-100 hover:bg-zinc-100 transition-colors group/id"
                                >
                                    <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">#{order?.id?.slice(0, 8) || '.......'}</span>
                                    <Copy className="w-2.5 h-2.5 text-zinc-300 group-hover/id:text-zinc-500 transition-colors" />
                                </button>

                                <div className={cn(
                                    "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-current/10 flex items-center gap-1.5",
                                    status.color, status.bg
                                )}>
                                    <span className={cn("w-1.5 h-1.5 rounded-full", status.dot, (order.status === 'shipping' || order.status === 'pending') && "animate-pulse")} />
                                    {status.label}
                                </div>
                            </div>

                            {/* Middle: Items Preview, Info Column & Total */}
                            <div className="flex items-center gap-4 mb-6 flex-1 min-w-0">
                                {/* Left: Images Stack */}
                                <div className="flex -space-x-4 flex-shrink-0">
                                    {order.items.slice(0, 3).map((item, i) => (
                                        <div
                                            key={i}
                                            className="relative w-14 h-14 rounded-2xl border-4 border-white shadow-sm overflow-hidden bg-zinc-50 flex-shrink-0 z-[1] transform hover:scale-110 hover:z-10 transition-transform"
                                        >
                                            <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                                        </div>
                                    ))}
                                    {order.items.length > 3 && (
                                        <div className="relative w-14 h-14 rounded-2xl border-4 border-white shadow-sm bg-zinc-100 flex items-center justify-center flex-shrink-0 z-0">
                                            <span className="text-[10px] font-black text-zinc-400">+{order.items.length - 3}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Center: Product Summary & Info (Fills the previous GAP) */}
                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <h4 className="text-[11px] font-black text-zinc-900 uppercase truncate tracking-tight mb-1">
                                        {order.items[0]?.name || 'N/A'}
                                    </h4>
                                    <div className="flex flex-wrap items-center gap-y-1 gap-x-2">
                                        <div className="flex items-center gap-1.5 text-zinc-400">
                                            <Package className="w-2.5 h-2.5" />
                                            <span className="text-[9px] font-bold uppercase tracking-widest">
                                                {order.items.length} {order.items.length === 1 ? 'Item' : 'Itens'}
                                            </span>
                                        </div>
                                        <span className="hidden xs:block w-1 h-1 rounded-full bg-zinc-200" />
                                        {order.customer.neighborhood && (
                                            <div className="flex items-center gap-1 text-[9px] font-bold text-zinc-400 uppercase tracking-widest truncate">
                                                <span className="text-zinc-300">Bairro:</span> {order.customer.neighborhood}
                                            </div>
                                        )}
                                    </div>

                                    {/* Sub-info: Date & Payment (Moved here for better space utilization) */}
                                    <div className="flex items-center gap-3 mt-2 opacity-60">
                                        <div className="flex items-center gap-1 text-zinc-400">
                                            <Calendar className="w-2.5 h-2.5" />
                                            <span className="text-[8px] font-bold tracking-tight">{date.toLocaleDateString('pt-BR')}</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-zinc-400">
                                            <PaymentIcon className="w-2.5 h-2.5" />
                                            <span className="text-[8px] font-bold tracking-tight uppercase">{payment.label}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Right: Total */}
                                <div className="text-right flex-shrink-0">
                                    <div className="text-[9px] font-black text-zinc-300 uppercase tracking-widest mb-1">TOTAL</div>
                                    <div className="flex items-baseline justify-end gap-0.5">
                                        <span className="text-[10px] font-black text-zinc-400">R$</span>
                                        <span className="text-xl font-black text-zinc-900 tracking-tight">
                                            {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Footer Action */}
                            <button
                                onClick={() => onNavigate('order-details', order.id)}
                                className="w-full py-3.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-2xl flex items-center justify-center gap-2 group/btn transition-all active:scale-[0.98] shadow-lg shadow-zinc-900/10"
                            >
                                <span className="text-[10px] font-black uppercase tracking-[0.2em]">Ver Detalhes</span>
                                <ChevronRight className="w-3.5 h-3.5 group-hover/btn:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    </motion.div>
                );
            })}
        </div>
    );
}

