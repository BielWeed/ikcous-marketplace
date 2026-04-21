import { ArrowLeft, Package, Users, DollarSign, Printer, QrCode, MessageCircle } from 'lucide-react';
import type { Order, OrderStatus } from '@/types';
import { statusConfig } from './OrderStatusBadge';
import { OrderReceipt } from './OrderReceipt';
import { Button } from '@/components/ui/button';


const statusFlow: OrderStatus[] = ['pending', 'processing', 'shipping', 'delivered'];

interface OrderDetailProps {
    order: Order;
    onBack: () => void;
    onStatusChange: (orderId: string, status: OrderStatus) => void;
    onWhatsApp: (order: Order) => void;
}

export function OrderDetail({ order, onBack, onStatusChange, onWhatsApp }: Readonly<OrderDetailProps>) {
    const status = statusConfig[order.status] || statusConfig.pending;
    const StatusIcon = status.icon;

    const getNextStatus = (current: OrderStatus): OrderStatus | null => {
        const currentIndex = statusFlow.indexOf(current);
        if (currentIndex < statusFlow.length - 1) {
            return statusFlow[currentIndex + 1];
        }
        return null;
    };

    const nextStatus = getNextStatus(order.status);

    return (
        <div className="min-h-screen bg-admin-bg pb-12 animate-in fade-in duration-500">
            {/* Elite Sticky Header */}
            <div className="admin-glass sticky top-0 z-[60] border-b border-white/5 backdrop-blur-3xl shadow-2xl">
                <div className="px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-5">
                        <Button
                            variant="ghost"
                            onClick={onBack}
                            className="w-11 h-11 bg-white/5 border border-white/5 text-white rounded-xl hover:bg-white/10 active:scale-95 transition-all p-0"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="flex flex-col">
                            <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] leading-none mb-1.5 flex items-center gap-2">
                                GESTÃO OPERACIONAL
                                <div className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            </h2>
                            <h1 className="text-xl font-bold text-white tracking-tighter">
                                Pedido <span className="text-admin-gold">#{order.id.slice(-6)}</span>
                            </h1>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            onClick={() => globalThis.print()}
                            className="w-11 h-11 bg-white/5 border border-white/5 text-white rounded-xl hover:bg-white/10 active:scale-95 transition-all p-0"
                        >
                            <Printer className="w-5 h-5" />
                        </Button>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">

                {/* 2-Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Main Flow Column */}
                    <div className="lg:col-span-2 space-y-6">

                        {/* Status Spotlight */}
                        <div className={`p-8 rounded-3xl border ${status.borderColor} ${status.bgColor} relative overflow-hidden group shadow-2xl`}>
                            <div className="flex items-center gap-6 relative z-10">
                                <div className="w-20 h-20 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center shadow-xl group-hover:scale-105 transition-transform">
                                    <StatusIcon className={`w-10 h-10 ${status.color}`} />
                                </div>
                                <div className="space-y-1">
                                    <p className={`text-[11px] font-black uppercase tracking-[0.2em] ${status.color} opacity-60`}>Status da Operação</p>
                                    <p className={`text-3xl font-black uppercase tracking-tighter ${status.color}`}>{status.label}</p>
                                    <p className="text-zinc-400 text-xs font-medium italic">
                                        Atualizado {order.updatedAt ? `em ${new Date(order.updatedAt).toLocaleDateString('pt-BR')} às ${new Date(order.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Recentemente'}
                                    </p>
                                </div>
                            </div>

                            {/* Animated Background Element */}
                            <div className={`absolute -right-10 -bottom-10 w-48 h-48 rounded-full blur-[80px] opacity-20 ${status.color.replace('text-', 'bg-')}`} />
                        </div>

                        {/* Customer & Logistics Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
                            {/* Customer Card */}
                            <div className="admin-glass p-6 rounded-3xl border border-white/5 space-y-6">
                                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Dados do Cliente</h3>
                                    <Users className="w-4 h-4 text-zinc-600" />
                                </div>
                                <div className="space-y-5">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-zinc-400">
                                            <Users className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <p className="text-lg font-bold text-white leading-tight">{order.customer.name}</p>
                                            <p className="text-xs text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                Portfólio Ativo
                                            </p>
                                        </div>
                                    </div>
                                    <div className="space-y-4 pt-2">
                                        <div>
                                            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Contato Operacional</p>
                                            <p className="font-mono text-sm text-white">{order.customer.whatsapp}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1 text-zinc-500">Endereço de Entrega</p>
                                            <p className="text-xs text-zinc-300 leading-relaxed uppercase">
                                                {order.customer.address}, {order.customer.number}<br />
                                                {order.customer.neighborhood} • {order.customer.reference}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* Order Items Assets */}
                        <div className="admin-glass p-6 rounded-[2.5rem] border border-white/5 space-y-6">
                            <div className="flex items-center justify-between border-b border-white/5 pb-4">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Dados do Pedido</h3>
                                <Package className="w-4 h-4 text-zinc-600" />
                            </div>
                            <div className="space-y-5">
                                {order.items.map((item) => (
                                    <div key={`${item.productId}-${item.variantId || 'default'}`} className="flex items-center gap-5 group/item">
                                        <div className="w-20 h-20 rounded-2xl overflow-hidden border border-white/10 shadow-2xl relative">
                                            <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover/item:scale-110 transition-transform duration-500" />
                                            <div className="absolute top-1 right-1 bg-black/80 text-white text-[9px] font-black px-1.5 py-0.5 rounded-lg border border-white/10">
                                                {item.quantity}X
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-white group-hover/item:text-admin-gold transition-colors truncate">{item.name}</p>
                                            <div className="flex items-center gap-3 mt-1.5">
                                                <span className="text-[10px] font-bold text-zinc-500 border border-white/5 bg-white/5 px-2 py-0.5 rounded uppercase tracking-tighter">
                                                    UN: R$ {item.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-black text-white tabular-nums">
                                                R$ {((item.price || 0) * (item.quantity || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Financial Summary Column */}
                    <div className="space-y-6">
                        {/* High-Performance Finance Card */}
                        <div className="bg-zinc-950 rounded-[2.5rem] p-8 text-white shadow-2xl border border-white/10 relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-8">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Consolidado Financeiro</h3>
                                <DollarSign className="w-5 h-5 text-admin-gold" />
                            </div>

                            <div className="space-y-5 relative z-10">
                                <div className="flex justify-between text-xs font-bold text-zinc-400">
                                    <span className="uppercase tracking-widest">Subtotal Bruto</span>
                                    <span className="font-mono">R$ {(order?.subtotal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between text-xs font-bold text-emerald-400">
                                    <span className="uppercase tracking-widest">Taxa Logística</span>
                                    <span className="font-mono">{(order?.shipping || 0) === 0 ? 'BONIFICADO' : `R$ ${(order?.shipping || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}</span>
                                </div>

                                <div className="pt-6 border-t border-white/10 mt-6">
                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] block mb-2">Montante Final</span>
                                            <span className="text-4xl font-black tracking-tighter text-white">
                                                <span className="text-xl text-admin-gold mr-1">R$</span>
                                                {(order?.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 p-4 bg-white/5 rounded-2xl border border-white/10">
                                        <div className="p-2 bg-emerald-500/20 rounded-lg">
                                            <QrCode className="w-5 h-5 text-emerald-400" />
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Liquidação</p>
                                            <p className="text-sm font-bold uppercase tracking-tight text-white">
                                                {(() => {
                                                    if (order.paymentMethod === 'pix') return 'Rede PIX';
                                                    if (order.paymentMethod === 'card') return 'Rede Crédito';
                                                    return 'Dinheiro Espécie';
                                                })()}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Decorative Background Glow */}
                            <div className="absolute top-0 right-0 w-32 h-32 bg-admin-gold opacity-5 blur-[100px]" />
                        </div>

                        {/* Action Intelligence Card */}
                        <div className="admin-glass p-8 rounded-[2.5rem] border border-white/5 space-y-6">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2">Comandos de Execução</h3>

                            <div className="space-y-3">
                                <Button
                                    onClick={() => onWhatsApp(order)}
                                    className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 text-black font-black uppercase tracking-widest text-[10px] rounded-2xl transition-all shadow-xl shadow-emerald-500/10 flex items-center justify-center gap-3"
                                >
                                    <MessageCircle className="w-5 h-5 fill-current" />
                                    Acionamento WhatsApp
                                </Button>

                                {nextStatus && (
                                    <Button
                                        onClick={() => onStatusChange(order.id, nextStatus)}
                                        className="w-full h-14 bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-widest text-[10px] rounded-2xl border border-white/10 transition-all shadow-xl"
                                    >
                                        Avançar: {statusConfig[nextStatus].label}
                                    </Button>
                                )}

                                {order.status !== 'cancelled' && order.status !== 'delivered' && (
                                    <Button
                                        onClick={() => onStatusChange(order.id, 'cancelled')}
                                        variant="ghost"
                                        className="w-full h-14 text-red-400/60 hover:text-red-400 hover:bg-red-400/5 font-black uppercase tracking-widest text-[10px] rounded-2xl transition-all"
                                    >
                                        Abortar Operação
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Operative Notes */}
                        {order.notes && (
                            <div className="p-6 bg-amber-500/5 border border-amber-500/10 rounded-3xl space-y-3">
                                <div className="flex items-center gap-3">
                                    <MessageCircle className="w-4 h-4 text-amber-500" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Notas Operacionais</p>
                                </div>
                                <p className="text-xs font-semibold text-amber-200 leading-relaxed italic">"{order.notes}"</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Order Receipt for Printing */}
            <OrderReceipt order={order} />
        </div>
    );
}
