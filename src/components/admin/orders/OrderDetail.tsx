import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { 
    ArrowLeft, 
    Package, 
    Users, 
    DollarSign, 
    Printer, 
    QrCode, 
    MessageCircle,
    Copy,
    ExternalLink,
    Edit3,
    Check,
    X,
    Loader2,
    Plus,
    Clock,
    Truck,
    CheckCircle2,
    XCircle,
    MapPin
} from 'lucide-react';
import type { Order, OrderStatus } from '@/types';
import { statusConfig } from './OrderStatusBadge';
import { OrderReceipt } from './OrderReceipt';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const statusFlow: OrderStatus[] = ['pending', 'processing', 'shipping', 'delivered'];

interface OrderDetailProps {
    order: Order;
    onBack: () => void;
    onStatusChange: (orderId: string, status: OrderStatus) => void;
    onWhatsApp: (order: Order) => void;
}

export function OrderDetail({ order, onBack, onStatusChange, onWhatsApp }: Readonly<OrderDetailProps>) {

    // Local state for instant UI update & inline editing
    const [localTrackingCode, setLocalTrackingCode] = useState(order.trackingCode || '');
    const [isEditingTracking, setIsEditingTracking] = useState(false);
    const [trackingValue, setTrackingValue] = useState(order.trackingCode || '');
    const [isSavingTracking, setIsSavingTracking] = useState(false);

    const [localNotes, setLocalNotes] = useState(order.notes || '');
    const [isEditingNotes, setIsEditingNotes] = useState(false);
    const [notesValue, setNotesValue] = useState(order.notes || '');
    const [isSavingNotes, setIsSavingNotes] = useState(false);

    const [skus, setSkus] = useState<Record<string, string>>({});
    const [loadingSkus, setLoadingSkus] = useState(false);

    const [copiedAddress, setCopiedAddress] = useState(false);
    const [copiedTracking, setCopiedTracking] = useState(false);

    // Sync state with order changes (e.g. from realtime update)
    useEffect(() => {
        setLocalTrackingCode(order.trackingCode || '');
        setTrackingValue(order.trackingCode || '');
        setLocalNotes(order.notes || '');
        setNotesValue(order.notes || '');
    }, [order.trackingCode, order.notes]);

    // Load product and variant SKUs
    useEffect(() => {
        const fetchSkus = async () => {
            try {
                setLoadingSkus(true);
                const productIds = order.items.map(item => item.productId);
                
                // Fetch product SKUs
                const { data: productsData } = await supabase
                    .from('produtos')
                    .select('id, codigo')
                    .in('id', productIds);

                const newSkus: Record<string, string> = {};
                productsData?.forEach(p => {
                    if (p.codigo) newSkus[`prod-${p.id}`] = p.codigo;
                });

                // Fetch variant SKUs if any
                const variantIds = order.items
                    .map(item => item.variantId)
                    .filter((id): id is string => !!id);
                if (variantIds.length > 0) {
                    const { data: variantsData } = await supabase
                        .from('product_variants')
                        .select('id, sku')
                        .in('id', variantIds);

                    variantsData?.forEach(v => {
                        if (v.sku) newSkus[`var-${v.id}`] = v.sku;
                    });
                }

                setSkus(newSkus);
            } catch (err) {
                console.error('Error fetching SKUs:', err);
            } finally {
                setLoadingSkus(false);
            }
        };

        fetchSkus();
    }, [order.items]);

    const getNextStatus = (current: OrderStatus): OrderStatus | null => {
        const currentIndex = statusFlow.indexOf(current);
        if (currentIndex < statusFlow.length - 1) {
            return statusFlow[currentIndex + 1];
        }
        return null;
    };

    const nextStatus = getNextStatus(order.status);

    const statusesStepper: { key: OrderStatus; label: string; icon: any }[] = [
        { key: 'pending', label: 'Novo', icon: Package },
        { key: 'processing', label: 'Separação', icon: Clock },
        { key: 'shipping', label: 'Trânsito', icon: Truck },
        { key: 'delivered', label: 'Finalizado', icon: CheckCircle2 }
    ];

    const currentStepperIndex = statusFlow.indexOf(order.status);

    const fullAddress = `${order.customer.address || ''}, ${order.customer.number || ''} - ${order.customer.neighborhood || ''} ${order.customer.reference ? `(${order.customer.reference})` : ''}`.trim();

    const handleCopyAddress = () => {
        navigator.clipboard.writeText(fullAddress);
        setCopiedAddress(true);
        toast.success('Endereço copiado para a área de transferência!');
        setTimeout(() => setCopiedAddress(false), 2000);
    };

    const handleCopyTracking = () => {
        navigator.clipboard.writeText(localTrackingCode);
        setCopiedTracking(true);
        toast.success('Código de rastreamento copiado!');
        setTimeout(() => setCopiedTracking(false), 2000);
    };

    const handleSaveTracking = async () => {
        try {
            setIsSavingTracking(true);
            const { error } = await supabase
                .from('marketplace_orders')
                .update({ tracking_code: trackingValue.trim() || null })
                .eq('id', order.id);

            if (error) throw error;
            setLocalTrackingCode(trackingValue.trim());
            setIsEditingTracking(false);
            toast.success('Código de rastreamento salvo!');
        } catch (err) {
            console.error('Error saving tracking code:', err);
            toast.error('Erro ao salvar código de rastreamento.');
        } finally {
            setIsSavingTracking(false);
        }
    };

    const handleSaveNotes = async () => {
        try {
            setIsSavingNotes(true);
            const { error } = await supabase
                .from('marketplace_orders')
                .update({ notes: notesValue.trim() || null })
                .eq('id', order.id);

            if (error) throw error;
            setLocalNotes(notesValue.trim());
            setIsEditingNotes(false);
            toast.success('Notas operacionais salvas!');
        } catch (err) {
            console.error('Error saving notes:', err);
            toast.error('Erro ao salvar notas operacionais.');
        } finally {
            setIsSavingNotes(false);
        }
    };

    const handleWhatsAppDirect = () => {
        let phone = (order.customer?.whatsapp || '').replace(/\D/g, '');
        if (phone.length === 11 || phone.length === 10) {
            phone = '55' + phone;
        }
        const message = `Olá ${order.customer?.name || 'Cliente'}! Entramos em contato sobre o seu pedido #${order.id.slice(-6)}.`;
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        globalThis.open(url, '_blank');
    };

    return (
        <div className="min-h-screen bg-admin-bg pb-24 animate-in fade-in duration-500">
            {/* Elite Sticky Header */}
            <div className="admin-glass sticky top-0 z-[60] border-b border-white/5 backdrop-blur-3xl shadow-2xl">
                <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            onClick={onBack}
                            className="w-10 h-10 bg-white/5 border border-white/5 text-white rounded-xl hover:bg-white/10 active:scale-95 transition-all p-0"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="flex flex-col">
                            <h2 className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] leading-none mb-1 flex items-center gap-1.5">
                                GESTÃO OPERACIONAL
                                <div className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            </h2>
                            <h1 className="text-lg font-bold text-white tracking-tighter">
                                Pedido <span className="text-admin-gold">#{order.id.slice(-6)}</span>
                            </h1>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            onClick={() => globalThis.print()}
                            className="w-10 h-10 bg-white/5 border border-white/5 text-white rounded-xl hover:bg-white/10 active:scale-95 transition-all p-0"
                        >
                            <Printer className="w-5 h-5" />
                        </Button>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
                
                {/* Cancelled Banner */}
                {order.status === 'cancelled' && (
                    <div className="p-4 bg-red-950/20 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 animate-in slide-in-from-top duration-300">
                        <XCircle className="w-5 h-5 shrink-0" />
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider">Operação Abortada / Cancelada</p>
                            <p className="text-[10px] text-zinc-400 mt-0.5">Este pedido foi cancelado e não pode prosseguir.</p>
                        </div>
                    </div>
                )}

                {/* Status Stepper Pipeline */}
                {order.status !== 'cancelled' && (
                    <div className="admin-glass p-5 md:p-6 rounded-3xl border border-white/5 relative overflow-hidden shadow-2xl">
                        <div className="relative flex items-center justify-between w-full">
                            {/* Connecting Line Background */}
                            <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-[2px] bg-white/5 z-0" />
                            <div 
                                className="absolute left-6 top-1/2 -translate-y-1/2 h-[2px] bg-admin-gold transition-all duration-500 z-0" 
                                style={{ 
                                    width: `${currentStepperIndex >= 0 ? (currentStepperIndex / (statusesStepper.length - 1)) * 90 : 0}%` 
                                }} 
                            />

                            {statusesStepper.map((step, idx) => {
                                const Icon = step.icon;
                                const isCompleted = idx < currentStepperIndex;
                                const isActive = idx === currentStepperIndex;
                                const isFuture = idx > currentStepperIndex;

                                return (
                                    <div key={step.key} className="flex flex-col items-center relative z-10 flex-1">
                                        <div
                                            className={cn(
                                                "w-9 h-9 rounded-full flex items-center justify-center border transition-all duration-300",
                                                isActive && `bg-zinc-950 border-admin-gold text-admin-gold shadow-[0_0_12px_rgba(234,179,8,0.3)] scale-110`,
                                                isCompleted && `bg-admin-gold border-admin-gold text-black`,
                                                isFuture && `bg-zinc-900 border-white/5 text-zinc-500`
                                            )}
                                        >
                                            <Icon className="w-4 h-4" />
                                        </div>
                                        <span className={cn(
                                            "text-[8px] md:text-[9px] font-black uppercase tracking-wider mt-2 text-center",
                                            isActive && "text-admin-gold font-black",
                                            isCompleted && "text-zinc-300 font-bold",
                                            isFuture && "text-zinc-500 font-medium"
                                        )}>
                                            {step.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 2-Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Main Flow Column */}
                    <div className="lg:col-span-2 space-y-6">
                        
                        {/* Customer Card */}
                        <div className="admin-glass p-5 rounded-3xl border border-white/5 space-y-4">
                            <div className="flex items-center justify-between border-b border-white/5 pb-3">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-1.5">
                                    <Users className="w-3.5 h-3.5 text-zinc-500" />
                                    Dados do Cliente
                                </h3>
                                <span className="text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                                    Portfólio Ativo
                                </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Nome Completo</p>
                                    <p className="text-base font-bold text-white leading-tight">{order.customer.name}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Contato Comercial</p>
                                    <div className="flex items-center gap-2">
                                        <p className="font-mono text-sm font-semibold text-white">{order.customer.whatsapp}</p>
                                        <button
                                            onClick={handleWhatsAppDirect}
                                            className="p-1 hover:bg-emerald-500/10 text-emerald-400 hover:text-emerald-300 rounded transition-colors"
                                            title="Conversar no WhatsApp"
                                        >
                                            <MessageCircle className="w-4 h-4 fill-current" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2 pt-2 border-t border-white/5">
                                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Endereço de Entrega</p>
                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 bg-zinc-950/40 p-3 rounded-2xl border border-white/5">
                                    <p className="text-xs text-zinc-300 leading-relaxed uppercase flex-1">
                                        {order.customer.address}, {order.customer.number}<br />
                                        <span className="text-[10px] text-zinc-400 normal-case">
                                            {order.customer.neighborhood} {order.customer.reference ? `• Ref: ${order.customer.reference}` : ''}
                                        </span>
                                    </p>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={handleCopyAddress}
                                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white/5 border border-white/5 hover:bg-white/10 active:scale-95 text-[10px] text-white font-bold uppercase tracking-wider rounded-xl transition-all"
                                            title="Copiar Endereço"
                                        >
                                            {copiedAddress ? (
                                                <>
                                                    <Check className="w-3 h-3 text-emerald-400" />
                                                    Copiado
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="w-3 h-3 text-zinc-400" />
                                                    Copiar
                                                </>
                                            )}
                                        </button>
                                        <a
                                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white/5 border border-white/5 hover:bg-white/10 active:scale-95 text-[10px] text-white font-bold uppercase tracking-wider rounded-xl transition-all"
                                            title="Ver no Google Maps"
                                        >
                                            <MapPin className="w-3 h-3 text-zinc-400" />
                                            Maps
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Order Items Assets */}
                        <div className="admin-glass p-5 rounded-3xl border border-white/5 space-y-4">
                            <div className="flex items-center justify-between border-b border-white/5 pb-3">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5 text-zinc-500" />
                                    Itens do Pedido
                                </h3>
                                <span className="text-[9px] text-zinc-400 font-bold bg-white/5 px-2 py-0.5 rounded-full">
                                    {order.items.reduce((acc, item) => acc + item.quantity, 0)} {order.items.reduce((acc, item) => acc + item.quantity, 0) === 1 ? 'Unidade' : 'Unidades'}
                                </span>
                            </div>
                            <div className="divide-y divide-white/5">
                                {order.items.map((item) => {
                                    const itemSku = item.variantId 
                                        ? skus[`var-${item.variantId}`] || skus[`prod-${item.productId}`]
                                        : skus[`prod-${item.productId}`];

                                    return (
                                        <div key={`${item.productId}-${item.variantId || 'default'}`} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0 group/item">
                                            <div className="w-14 h-14 rounded-xl overflow-hidden border border-white/10 shadow-lg relative shrink-0">
                                                <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover/item:scale-115 transition-transform duration-500" />
                                                <div className="absolute top-0.5 right-0.5 bg-black/85 text-white text-[8px] font-black px-1.5 py-0.5 rounded-md border border-white/10">
                                                    {item.quantity}X
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold text-white group-hover/item:text-admin-gold transition-colors truncate">
                                                    {item.name}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    <span className="text-[9px] font-bold text-zinc-400 border border-white/5 bg-white/5 px-1.5 py-0.5 rounded">
                                                        R$ {item.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </span>
                                                    {loadingSkus ? (
                                                        <span className="text-[8px] font-mono text-zinc-600 animate-pulse">Carregando SKU...</span>
                                                    ) : itemSku ? (
                                                        <span className="text-[8px] font-mono font-black text-admin-gold bg-admin-gold/10 border border-admin-gold/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
                                                            SKU: {itemSku}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[8px] font-mono text-zinc-500 uppercase">
                                                            ID: #{item.productId.slice(-6)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-xs font-black text-white tabular-nums">
                                                    R$ {((item.price || 0) * (item.quantity || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Financial & Logistics Column */}
                    <div className="space-y-6">
                        
                        {/* High-Performance Finance Card */}
                        <div className="bg-zinc-950 rounded-[2rem] p-6 text-white shadow-2xl border border-white/10 relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-1.5">
                                    <DollarSign className="w-4 h-4 text-admin-gold" />
                                    Consolidado Financeiro
                                </h3>
                            </div>

                            <div className="space-y-4 relative z-10">
                                <div className="flex justify-between text-xs font-bold text-zinc-400">
                                    <span className="uppercase tracking-widest">Subtotal Bruto</span>
                                    <span className="font-mono">R$ {(order?.subtotal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                                
                                {(order?.discount > 0 || order?.couponCode) && (
                                    <div className="flex justify-between text-xs font-bold text-amber-500">
                                        <span className="uppercase tracking-widest flex items-center gap-1.5">
                                            Desconto
                                            {order.couponCode && (
                                                <span className="text-[8px] font-black bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
                                                    {order.couponCode}
                                                </span>
                                            )}
                                        </span>
                                        <span className="font-mono">- R$ {(order?.discount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                )}

                                <div className="flex justify-between text-xs font-bold text-emerald-400">
                                    <span className="uppercase tracking-widest">Taxa Logística</span>
                                    <span className="font-mono">{(order?.shipping || 0) === 0 ? 'BONIFICADO' : `R$ ${(order?.shipping || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}</span>
                                </div>

                                <div className="pt-4 border-t border-white/10 mt-4">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] block mb-1">Montante Final</span>
                                            <span className="text-3xl font-black tracking-tighter text-white">
                                                <span className="text-lg text-admin-gold mr-1">R$</span>
                                                {(order?.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 p-3 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="p-2 bg-emerald-500/15 rounded-xl shrink-0">
                                            <QrCode className="w-4 h-4 text-emerald-400" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest leading-none">Liquidação</p>
                                            <p className="text-xs font-bold uppercase tracking-tight text-white mt-1 truncate">
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

                        {/* Logistics & Tracking Card */}
                        <div className="admin-glass p-5 rounded-[2rem] border border-white/5 space-y-4">
                            <div className="flex items-center justify-between border-b border-white/5 pb-3">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-1.5">
                                    <Truck className="w-3.5 h-3.5 text-zinc-500" />
                                    Logística & Rastreio
                                </h3>
                            </div>

                            {isEditingTracking ? (
                                <div className="space-y-3 animate-in fade-in duration-300">
                                    <div className="space-y-1">
                                        <label htmlFor="tracking-input" className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">
                                            Código de Rastreamento
                                        </label>
                                        <Input
                                            id="tracking-input"
                                            value={trackingValue}
                                            onChange={e => setTrackingValue(e.target.value.toUpperCase())}
                                            placeholder="EX: BR123456789BR"
                                            className="h-10 bg-zinc-950 border-white/10 text-white rounded-xl focus:border-admin-gold/30 text-xs font-mono"
                                            disabled={isSavingTracking}
                                        />
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                                setTrackingValue(localTrackingCode);
                                                setIsEditingTracking(false);
                                            }}
                                            className="h-8 rounded-lg px-2.5 text-zinc-400 hover:text-white"
                                            disabled={isSavingTracking}
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={handleSaveTracking}
                                            className="h-8 bg-admin-gold hover:bg-admin-gold/90 text-black font-black uppercase tracking-wider text-[9px] rounded-lg px-3 flex items-center gap-1"
                                            disabled={isSavingTracking}
                                        >
                                            {isSavingTracking ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <Check className="w-3.5 h-3.5" />
                                            )}
                                            Salvar
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {localTrackingCode ? (
                                        <div className="space-y-2">
                                            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Código Cadastrado</p>
                                            <div className="flex items-center justify-between bg-zinc-950/40 p-2.5 rounded-xl border border-white/5">
                                                <span className="font-mono text-xs font-bold text-white tracking-widest select-all">
                                                    {localTrackingCode}
                                                </span>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        onClick={handleCopyTracking}
                                                        className="p-1.5 hover:bg-white/5 text-zinc-400 hover:text-white rounded transition-colors"
                                                        title="Copiar Código"
                                                    >
                                                        {copiedTracking ? (
                                                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                        ) : (
                                                            <Copy className="w-3.5 h-3.5" />
                                                        )}
                                                    </button>
                                                    <a
                                                        href={`https://linkrastreio.com/?codigo=${localTrackingCode}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-1.5 hover:bg-white/5 text-zinc-400 hover:text-white rounded transition-colors"
                                                        title="Rastrear nos Correios"
                                                    >
                                                        <ExternalLink className="w-3.5 h-3.5" />
                                                    </a>
                                                    <button
                                                        onClick={() => setIsEditingTracking(true)}
                                                        className="p-1.5 hover:bg-white/5 text-zinc-400 hover:text-white rounded transition-colors"
                                                        title="Editar Código"
                                                    >
                                                        <Edit3 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center p-4 bg-zinc-950/20 border border-dashed border-white/5 rounded-xl gap-2 text-center">
                                            <p className="text-[10px] text-zinc-500 font-medium">Nenhum código de rastreamento cadastrado.</p>
                                            <Button
                                                onClick={() => setIsEditingTracking(true)}
                                                className="h-8 bg-white/5 border border-white/5 hover:bg-white/10 text-white font-bold text-[9px] uppercase tracking-wider rounded-lg px-3 flex items-center gap-1 active:scale-95 transition-all"
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                                Adicionar Rastreio
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Action Intelligence Card */}
                        <div className="admin-glass p-5 rounded-[2rem] border border-white/5 space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1">Comandos de Execução</h3>

                            <div className="space-y-2">
                                <Button
                                    onClick={() => onWhatsApp(order)}
                                    className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-black font-black uppercase tracking-widest text-[9px] rounded-xl transition-all shadow-xl shadow-emerald-500/10 flex items-center justify-center gap-2 active:scale-95"
                                >
                                    <MessageCircle className="w-4 h-4 fill-current" />
                                    Acionamento WhatsApp
                                </Button>

                                {nextStatus && order.status !== 'cancelled' && (
                                    <Button
                                        onClick={() => onStatusChange(order.id, nextStatus)}
                                        className="w-full h-11 bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-widest text-[9px] rounded-xl border border-white/10 transition-all shadow-xl active:scale-95"
                                    >
                                        Avançar: {statusConfig[nextStatus].label}
                                    </Button>
                                )}

                                {order.status !== 'cancelled' && order.status !== 'delivered' && (
                                    <Button
                                        onClick={() => onStatusChange(order.id, 'cancelled')}
                                        variant="ghost"
                                        className="w-full h-11 text-red-400/60 hover:text-red-400 hover:bg-red-400/5 font-black uppercase tracking-widest text-[9px] rounded-xl transition-all"
                                    >
                                        Abortar Operação
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Operative Notes */}
                        <div className="admin-glass p-5 rounded-[2rem] border border-white/5 space-y-4">
                            <div className="flex items-center justify-between border-b border-white/5 pb-3">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-1.5">
                                    <MessageCircle className="w-3.5 h-3.5 text-zinc-500" />
                                    Notas Operacionais
                                </h3>
                            </div>

                            {isEditingNotes ? (
                                <div className="space-y-3 animate-in fade-in duration-300">
                                    <div className="space-y-1">
                                        <label htmlFor="notes-textarea" className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">
                                            Anotações Internas
                                        </label>
                                        <textarea
                                            id="notes-textarea"
                                            value={notesValue}
                                            onChange={e => setNotesValue(e.target.value)}
                                            placeholder="Ex: Cliente solicitou entrega após as 18h..."
                                            className="w-full h-20 bg-zinc-950 border border-white/10 text-white rounded-xl p-3 focus:outline-none focus:border-admin-gold/30 text-xs resize-none"
                                            disabled={isSavingNotes}
                                        />
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                                setNotesValue(localNotes);
                                                setIsEditingNotes(false);
                                            }}
                                            className="h-8 rounded-lg px-2.5 text-zinc-400 hover:text-white"
                                            disabled={isSavingNotes}
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={handleSaveNotes}
                                            className="h-8 bg-admin-gold hover:bg-admin-gold/90 text-black font-black uppercase tracking-wider text-[9px] rounded-lg px-3 flex items-center gap-1"
                                            disabled={isSavingNotes}
                                        >
                                            {isSavingNotes ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <Check className="w-3.5 h-3.5" />
                                            )}
                                            Salvar
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {localNotes ? (
                                        <div className="space-y-3">
                                            <p className="text-xs font-medium text-amber-200 leading-relaxed italic bg-amber-500/5 p-3 rounded-2xl border border-amber-500/10">
                                                "{localNotes}"
                                            </p>
                                            <div className="flex justify-end">
                                                <Button
                                                    onClick={() => setIsEditingNotes(true)}
                                                    className="h-8 bg-white/5 border border-white/5 hover:bg-white/10 text-white font-bold text-[9px] uppercase tracking-wider rounded-lg px-3 flex items-center gap-1 active:scale-95 transition-all"
                                                >
                                                    <Edit3 className="w-3.5 h-3.5 text-zinc-400" />
                                                    Editar Notas
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center p-4 bg-zinc-950/20 border border-dashed border-white/5 rounded-xl gap-2 text-center">
                                            <p className="text-[10px] text-zinc-500 font-medium">Nenhuma nota cadastrada para este pedido.</p>
                                            <Button
                                                onClick={() => setIsEditingNotes(true)}
                                                className="h-8 bg-white/5 border border-white/5 hover:bg-white/10 text-white font-bold text-[9px] uppercase tracking-wider rounded-lg px-3 flex items-center gap-1 active:scale-95 transition-all"
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                                Adicionar Nota
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Order Receipt for Printing */}
            <OrderReceipt order={order} />
        </div>
    );
}
