import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    MapPin,
    CreditCard,
    Package,
    Truck,
    CheckCircle,
    Clock,
    XCircle,
    ChevronLeft,
    Copy,
    MessageCircle,
    TrendingUp
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useOrders } from '@/hooks/useOrders';
import type { Order, OrderItem, OrderStatus, View } from '@/types';
import { cn } from '@/lib/utils';
import { haptic } from '@/utils/haptic';
import { useCart } from '@/hooks/useCart';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';

interface OrderDetailsViewProps {
    orderId: string;
    onBack: () => void;
    onNavigate: (view: View) => void;
}

const statusConfig: Record<OrderStatus, { label: string; icon: LucideIcon; color: string; bg: string; description: string }> = {
    pending: {
        label: 'Pedido Recebido',
        icon: Package,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
        description: 'Aguardando confirmação de pagamento para iniciar a separação.'
    },
    processing: {
        label: 'Em Separação',
        icon: Clock,
        color: 'text-amber-500',
        bg: 'bg-amber-500/10',
        description: 'Sua curadoria está sendo preparada com todo cuidado e atenção.'
    },
    shipping: {
        label: 'Em Trânsito',
        icon: Truck,
        color: 'text-emerald-500',
        bg: 'bg-emerald-500/10',
        description: 'Seu pedido já saiu para entrega e chegará em breve.'
    },
    delivered: {
        label: 'Entregue',
        icon: CheckCircle,
        color: 'text-green-500',
        bg: 'bg-green-500/10',
        description: 'O pedido foi entregue com sucesso. Aproveite sua experiência!'
    },
    cancelled: {
        label: 'Cancelado',
        icon: XCircle,
        color: 'text-red-500',
        bg: 'bg-red-500/10',
        description: 'Este pedido foi cancelado e não seguirá para entrega.'
    }
};

export function OrderDetailsView({ orderId, onBack, onNavigate }: OrderDetailsViewProps) {
    const { orders, fetchUserOrders } = useOrders(true, false);
    const { addToCart } = useCart();
    const { config } = useStore();
    const [order, setOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);

    const loadOrder = useCallback(async () => {
        let currentOrders = orders;
        if (orders.length === 0) {
            currentOrders = await fetchUserOrders();
        }
        const found = currentOrders.find(o => o.id === orderId);
        setOrder(found || null);
        setLoading(false);
    }, [orderId, fetchUserOrders, orders]);

    useEffect(() => {
        loadOrder();
    }, [loadOrder]);

    const handleCopyId = () => {
        navigator.clipboard.writeText(orderId);
        toast.success('ID do pedido copiado!');
        haptic.light();
    };

    const handleWhatsAppSupport = () => {
        const message = `Olá! Tenho uma dúvida sobre meu pedido #${orderId.slice(0, 8)}.`;
        const url = `https://wa.me/55${config.whatsappNumber}?text=${encodeURIComponent(message)}`;
        globalThis.open(url, '_blank');
        haptic.light();
    };

    const handleBuyAgain = useCallback(() => {
        if (!order) return;
        order.items.forEach((item: OrderItem) => {
            addToCart({
                id: item.productId,
                name: item.name,
                price: item.price,
                images: [item.image],
                category: '',
                stock: 99,
                isActive: true,
                description: '',
                sold: 0,
                freeShipping: false,
                createdAt: '',
                isBestseller: false
            }, item.quantity);
        });
        haptic.success();
        toast.success('Itens adicionados ao carrinho!');
        onNavigate('cart');
    }, [order, addToCart, onNavigate]);

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-50/30 flex flex-col items-center justify-center space-y-4">
                <div className="w-12 h-12 border-4 border-zinc-900 border-t-transparent rounded-full animate-spin" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Sincronizando Dados</p>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center">
                <div className="w-20 h-20 bg-zinc-100 rounded-[2.5rem] flex items-center justify-center mb-6">
                    <XCircle className="w-10 h-10 text-zinc-300" />
                </div>
                <h2 className="text-2xl font-black tracking-tighter italic uppercase mb-2">Pedido não encontrado</h2>
                <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed mb-8">
                    Não conseguimos localizar as informações deste pedido em nossa base premium.
                </p>
                <button
                    onClick={onBack}
                    className="h-14 px-8 bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl active:scale-95 transition-all"
                >
                    Voltar aos pedidos
                </button>
            </div>
        );
    }

    const currentStatus = statusConfig[order.status as OrderStatus];
    const StatusIcon = currentStatus.icon;

    return (
        <div className="min-h-full bg-zinc-50/50 pb-24">
            {/* Header Sticky */}
            <div className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-zinc-100 px-6 pt-12 pb-6">
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={() => { haptic.light(); onBack(); }}
                        className="w-11 h-11 flex items-center justify-center bg-zinc-100 rounded-2xl text-zinc-900 active:scale-90 transition-all"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="flex flex-col items-center">
                        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-400 leading-none mb-1">Status em Tempo Real</span>
                        <h1 className="text-lg font-black tracking-tighter text-zinc-900 uppercase">Detalhes da <span className="text-zinc-400">Entrega</span></h1>
                    </div>
                    <button
                        onClick={handleWhatsAppSupport}
                        className="w-11 h-11 flex items-center justify-center bg-emerald-50 text-emerald-600 rounded-2xl active:scale-90 transition-all border border-emerald-100/50"
                    >
                        <MessageCircle className="w-5 h-5" />
                    </button>
                </div>

                {/* Quick Info Bar */}
                <div className="flex items-center justify-between gap-4 p-4 bg-zinc-950 rounded-2xl text-white">
                    <div className="flex flex-col">
                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500 mb-1">ID do Pedido</span>
                        <div className="flex items-center gap-2" onClick={handleCopyId}>
                            <span className="text-[11px] font-black tracking-widest uppercase">#{order.id.slice(0, 8)}</span>
                            <Copy className="w-3 h-3 text-zinc-600" />
                        </div>
                    </div>
                    <div className="h-8 w-px bg-zinc-800" />
                    <div className="flex flex-col items-end">
                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500 mb-1">Data de Realização</span>
                        <span className="text-[11px] font-black tracking-tight">{new Date(order.createdAt).toLocaleDateString('pt-BR')}</span>
                    </div>
                </div>
            </div>

            <div className="px-6 py-8 space-y-8 max-w-2xl mx-auto">
                {/* Status Visual Block */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-[2.5rem] p-8 border border-zinc-100 shadow-sm relative overflow-hidden"
                >
                    <div className={cn("absolute top-0 left-0 w-2 h-full", currentStatus.color.replace('text-', 'bg-'))} />

                    <div className="flex items-center gap-6 mb-6">
                        <div className={cn("w-16 h-16 rounded-[2rem] flex items-center justify-center shadow-lg transition-transform hover:scale-110", currentStatus.bg)}>
                            <StatusIcon className={cn("w-8 h-8", currentStatus.color)} />
                        </div>
                        <div className="flex-1">
                            <h3 className={cn("text-xl font-black uppercase tracking-tighter italic leading-none mb-2", currentStatus.color)}>
                                {currentStatus.label}
                            </h3>
                            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest leading-relaxed">
                                {currentStatus.description}
                            </p>
                        </div>
                    </div>

                    {/* Progress Visual Mini-Timeline */}
                    <div className="flex items-center gap-1">
                        {['pending', 'processing', 'shipping', 'delivered'].map((s, i) => {
                            const isPast = ['pending', 'processing', 'shipping', 'delivered'].indexOf(order.status) >= i;
                            const isCurrent = order.status === s;
                            return (
                                <div key={s} className="flex-1 flex flex-col gap-2">
                                    <div className={cn(
                                        "h-1.5 rounded-full transition-all duration-1000",
                                        isPast ? currentStatus.color.replace('text-', 'bg-') : "bg-zinc-100"
                                    )} />
                                    {isCurrent && (
                                        <div className="h-1 w-full flex justify-center">
                                            <div className={cn("w-1 h-1 rounded-full animate-ping", currentStatus.color.replace('text-', 'bg-'))} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </motion.div>

                {/* Items List Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white rounded-[2.5rem] p-8 border border-zinc-100 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-2 h-6 bg-zinc-900 rounded-full" />
                        <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Composição do Pedido</h4>
                    </div>

                    <div className="space-y-6">
                        {order.items.map((item: OrderItem, idx: number) => (
                            <div key={idx} className="flex gap-6 group">
                                <div className="w-24 h-24 flex-shrink-0 bg-zinc-50 rounded-[2rem] overflow-hidden border border-zinc-100 shadow-sm relative">
                                    <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                                    <div className="absolute top-2 right-2 w-7 h-7 bg-zinc-950 text-white text-[10px] font-black rounded-lg flex items-center justify-center shadow-lg">
                                        {item.quantity}x
                                    </div>
                                </div>
                                <div className="flex-1 flex flex-col justify-center gap-2">
                                    <h5 className="text-[13px] font-black text-zinc-900 leading-snug uppercase tracking-tight group-hover:text-primary transition-colors line-clamp-2">
                                        {item.name}
                                    </h5>
                                    <div className="flex items-center gap-3">
                                        <span className="text-[15px] font-black text-zinc-900 tracking-tighter italic">
                                            R$ {item.price.toFixed(2).replace('.', ',')}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* Finance Detail Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-zinc-950 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden group"
                >
                    {/* Decorative Orb */}
                    <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full translate-x-1/3 -translate-y-1/3 blur-3xl" />

                    <div className="flex items-center gap-3 mb-8 relative z-10">
                        <div className="w-2 h-6 bg-emerald-500 rounded-full" />
                        <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Resumo da Transação</h4>
                    </div>

                    <div className="space-y-4 relative z-10">
                        <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-widest text-zinc-500">
                            <span>Subtotal Bruto</span>
                            <span className="text-zinc-300">R$ {order.subtotal.toFixed(2).replace('.', ',')}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-widest text-zinc-500">
                            <span>Logística e Envio</span>
                            <span className={cn(order.shipping === 0 ? "text-emerald-400" : "text-zinc-300")}>
                                {order.shipping > 0 ? `R$ ${order.shipping.toFixed(2).replace('.', ',')}` : 'Cortesia Premium'}
                            </span>
                        </div>
                        {order.discount > 0 && (
                            <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-widest text-emerald-500">
                                <span>Benefício / Cupom</span>
                                <span>- R$ {order.discount.toFixed(2).replace('.', ',')}</span>
                            </div>
                        )}
                        <div className="h-px bg-white/5 my-6" />
                        <div className="flex justify-between items-end relative z-10">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Total Consolidado</span>
                                <span className="text-3xl font-black tracking-tighter text-white leading-none italic uppercase">
                                    R$ {order.total.toFixed(2).replace('.', ',')}
                                </span>
                            </div>
                            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/10">
                                <CheckCircle className="w-6 h-6 text-emerald-400" />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Delivery & Payment Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 }}
                        className="bg-white rounded-[2.5rem] p-8 border border-zinc-100 shadow-sm"
                    >
                        <div className="flex items-center gap-3 mb-6">
                            <MapPin className="w-5 h-5 text-zinc-400" />
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-900">Destino Premium</h4>
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-[13px] font-black text-zinc-900 uppercase tracking-tight">{order.customer.name}</p>
                            <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
                                {order.customer.address}, {order.customer.number}<br />
                                {order.customer.neighborhood} • Monte Carmelo
                            </p>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.4 }}
                        className="bg-white rounded-[2.5rem] p-8 border border-zinc-100 shadow-sm"
                    >
                        <div className="flex items-center gap-3 mb-6">
                            <CreditCard className="w-5 h-5 text-zinc-400" />
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-900">Pagamento Exclusivo</h4>
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-[13px] font-black text-zinc-900 uppercase tracking-tight capitalize">
                                {order.paymentMethod === 'card' ? 'Cartão de Crédito' : order.paymentMethod}
                            </p>
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-50 rounded-full border border-zinc-100">
                                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full" />
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Confirmado via Gateway</span>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Actions Bar */}
                <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom,0px))] left-0 right-0 z-50 px-6 py-6 md:px-8 md:py-6 bg-white/95 backdrop-blur-xl border-t border-zinc-100 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] md:max-w-screen-md md:mx-auto md:rounded-t-[3rem] md:border-x">
                    <div className="flex gap-4">
                        <button
                            onClick={() => { haptic.light(); onBack(); }}
                            className="flex-1 h-14 bg-zinc-100 text-zinc-900 rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all border border-zinc-200/50 flex items-center justify-center gap-2"
                        >
                            Ver Meus Pedidos
                        </button>
                        <button
                            onClick={handleBuyAgain}
                            className="flex-[1.5] h-14 bg-zinc-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.25em] active:scale-95 transition-all shadow-xl shadow-zinc-200 flex items-center justify-center gap-3 group"
                        >
                            <TrendingUp className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                            Comprar Novamente
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
