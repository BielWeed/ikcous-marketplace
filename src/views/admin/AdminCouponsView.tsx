import { useState, useMemo } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Trash, Edit, ArrowLeft, Ticket, Calendar, Users, HelpCircle, TrendingUp, Sparkles, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useCoupons } from '@/hooks/useCoupons';
import type { Coupon, View } from '@/types';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

import { AdminKpiCarousel, type KpiCardConfig } from '@/components/admin/AdminKpiCarousel';

const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100, damping: 15 } }
};

interface AdminCouponsViewProps {
    onNavigate: (view: View) => void;
}

export function AdminCouponsView({ onNavigate }: AdminCouponsViewProps) {
    const { coupons, loading, addCoupon, updateCoupon, deleteCoupon } = useCoupons(true);
    const isOffline = useOnlineStatus();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
    const [copiedCode, setCopiedCode] = useState<string | null>(null);
    const [couponToDelete, setCouponToDelete] = useState<string | null>(null);

    const [formData, setFormData] = useState<Partial<Coupon>>({
        code: '',
        type: 'percentage',
        value: 0,
        active: true,
        usageLimit: 0,
        minPurchase: 0
    });

    const handleCopyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        setCopiedCode(code);
        toast.success(`Código "${code}" copiado!`);
        setTimeout(() => setCopiedCode(null), 2000);
    };

    const handleOpenDialog = (coupon?: Coupon) => {
        if (coupon) {
            setEditingCoupon(coupon);
            setFormData({ ...coupon });
        } else {
            setEditingCoupon(null);
            setFormData({
                code: '',
                type: 'percentage',
                value: 0,
                active: true,
                usageLimit: 0,
                minPurchase: 0
            });
        }
        setIsDialogOpen(true);
    };

    const handleSubmit = async () => {
        if (isOffline) {
            toast.error('Sem conexão com a internet', {
                description: 'Você precisa estar online para salvar ou alterar cupons.'
            });
            return;
        }
        if (!formData.code || !formData.code.trim()) {
            toast.error('O código do cupom é obrigatório.');
            return;
        }

        const value = formData.value ?? 0;
        const minPurchase = formData.minPurchase ?? 0;
        const usageLimit = formData.usageLimit ?? 0;

        if (value <= 0) {
            toast.error('O valor do desconto deve ser maior que zero.');
            return;
        }

        if (formData.type === 'percentage' && value > 100) {
            toast.error('O valor do desconto em porcentagem não pode ser maior que 100%.');
            return;
        }

        if (minPurchase < 0) {
            toast.error('O valor mínimo de compra não pode ser negativo.');
            return;
        }

        if (usageLimit < 0) {
            toast.error('O limite de uso não pode ser negativo.');
            return;
        }

        try {
            if (editingCoupon) {
                await updateCoupon(editingCoupon.id, formData);
            } else {
                await addCoupon(formData as Required<Omit<Coupon, 'id' | 'usageCount'>>);
            }
            setIsDialogOpen(false);
        } catch (error) {
            console.error('Erro ao salvar cupom:', error);
            toast.error('Erro ao salvar o cupom. Revise as regras de preenchimento.');
        }
    };

    const handleDelete = (id: string) => {
        if (isOffline) {
            toast.error('Sem conexão com a internet', {
                description: 'Você precisa estar online para excluir cupons.'
            });
            return;
        }
        setCouponToDelete(id);
    };

    const confirmDeleteCoupon = async () => {
        if (!couponToDelete) return;
        try {
            await deleteCoupon(couponToDelete);
        } catch (error) {
            console.error('Error deleting coupon:', error);
            toast.error('Erro ao excluir o cupom.');
        } finally {
            setCouponToDelete(null);
        }
    };

    // Dynamic stats computation
    const totalCoupons = coupons.length;
    const activeCoupons = coupons.filter(c => c.active).length;
    const totalUsage = coupons.reduce((sum, c) => sum + (c.usageCount || 0), 0);
    const averageDiscount = (() => {
        const percentageCoupons = coupons.filter(c => c.type === 'percentage');
        if (percentageCoupons.length === 0) return 0;
        const sum = percentageCoupons.reduce((acc, c) => acc + (c.value || 0), 0);
        return Math.round(sum / percentageCoupons.length);
    })();

    const kpiCards = useMemo<readonly KpiCardConfig[]>(() => [
        {
            id: 'ativos',
            label: 'Cupons Ativos',
            icon: Ticket,
            iconClass: "text-emerald-400 animate-pulse",
            iconBg: "bg-emerald-500/10 border-emerald-500/20",
            hoverBorder: "hover:border-emerald-500/30 hover:shadow-[0_0_30px_rgba(16,185,129,0.05)]",
            value: activeCoupons,
            accent: 'text-emerald-400',
            subValue: `/ ${totalCoupons} total`,
            footer: "Disponíveis para uso"
        },
        {
            id: 'uso',
            label: 'Uso Total',
            icon: Users,
            iconClass: "text-sky-400",
            iconBg: "bg-zinc-900 border-white/5",
            hoverBorder: "hover:border-sky-500/30 hover:shadow-[0_0_30px_rgba(14,165,233,0.05)]",
            value: totalUsage,
            accent: 'text-sky-400',
            footer: "Utilizações acumuladas"
        },
        {
            id: 'desconto',
            label: 'Desconto Médio',
            icon: TrendingUp,
            iconClass: "text-amber-400",
            iconBg: "bg-amber-500/10 border-amber-500/20",
            hoverBorder: "hover:border-amber-500/30 hover:shadow-[0_0_30px_rgba(245,158,11,0.05)]",
            value: `${averageDiscount}%`,
            accent: 'text-amber-400',
            subValue: "OFF",
            footer: "Em ofertas percentuais"
        }
    ], [activeCoupons, totalCoupons, totalUsage, averageDiscount]);

    return (
        <div className="h-auto bg-[#09090b] text-zinc-400 font-sans selection:bg-emerald-500/30 selection:text-emerald-200 relative pb-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="sticky top-0 z-50 p-4 pb-0">
                <div className="admin-glass rounded-[2rem] border border-white/5 p-4 sm:p-5 shadow-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => onNavigate('admin-settings')}
                            className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-colors group"
                            title="Voltar ao Painel"
                        >
                            <ArrowLeft className="w-5 h-5 text-zinc-400 group-hover:text-white transition-colors" />
                        </button>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2 uppercase select-none">
                                    <span className="flex items-baseline flex-nowrap whitespace-nowrap">
                                        <span className="italic text-white">Cupons</span>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowHelpModal(true)}
                                        className="w-7 h-7 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                                        title="Guia de Cupons e Ajuda"
                                    >
                                        <HelpCircle className="w-3.5 h-3.5" />
                                    </button>
                                </h1>
                            </div>
                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.15em] flex items-center gap-1.5 mt-0.5">
                                Campanhas
                                <span className="w-1 h-1 rounded-full bg-emerald-500/50 animate-pulse" />
                                <span className="text-emerald-400">Otimizar Conversões</span>
                            </p>
                        </div>
                    </div>

                    {coupons.length > 0 && (
                        <button
                            onClick={() => handleOpenDialog()}
                            disabled={isOffline}
                            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl text-[9px] font-black uppercase tracking-wider hover:scale-[1.02] transition-all active:scale-95 shadow-lg shadow-white/5 border border-white/10 w-full sm:w-auto disabled:opacity-50 disabled:grayscale disabled:pointer-events-none"
                        >
                            <Plus className="w-3.5 h-3.5" /> Novo Cupom
                        </button>
                    )}
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-4 lg:p-8">
                {/* Stats Carousel Row */}
                {coupons.length > 0 && (
                    <div className="space-y-4 mb-8">
                        <AdminKpiCarousel cards={kpiCards} title="Métricas de Campanhas" />
                    </div>
                )}

                <AnimatePresence mode="wait">
                    {loading && coupons.length === 0 ? (
                        <motion.div
                            key="loading"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-col items-center justify-center py-32"
                        >
                            <div className="relative">
                                <div className="w-16 h-16 border-2 border-zinc-800 border-t-emerald-500 rounded-full animate-spin" />
                                <Ticket className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-emerald-500 animate-pulse" />
                            </div>
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mt-6">Sincronizando ofertas...</p>
                        </motion.div>
                    ) : coupons.length === 0 ? (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="flex flex-col items-center justify-center py-20 px-6 rounded-[3rem] border border-white/5 bg-zinc-900/10 backdrop-blur-md relative overflow-hidden"
                        >
                            {/* Ambient radial glow background */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-emerald-500/5 blur-[100px] rounded-full pointer-events-none" />

                            {/* Premium Ticket Graphic */}
                            <div className="relative w-28 h-28 flex items-center justify-center mb-6">
                                {/* Ambient glow */}
                                <div className="absolute inset-0 bg-emerald-500/10 blur-xl rounded-full animate-pulse" />
                                
                                {/* Floating decorative stars */}
                                <motion.div 
                                    animate={{ 
                                        y: [0, -4, 0],
                                        rotate: [0, 10, 0]
                                    }}
                                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                                    className="absolute top-0 right-0 text-emerald-400/80"
                                >
                                    <Sparkles className="w-4 h-4" />
                                </motion.div>
                                <motion.div 
                                    animate={{ 
                                        y: [0, 4, 0],
                                        rotate: [0, -10, 0]
                                    }}
                                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                                    className="absolute bottom-0 left-0 text-emerald-500/40"
                                >
                                    <Sparkles className="w-3 h-3" />
                                </motion.div>

                                {/* Main Floating Ticket Container */}
                                <motion.div
                                    animate={{ y: [0, -6, 0] }}
                                    transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                                    className="w-20 h-14 bg-zinc-950 bg-gradient-to-br from-zinc-900 to-zinc-950 border border-white/10 rounded-xl flex items-center justify-center shadow-[0_8px_30px_rgb(0,0,0,0.5)] relative overflow-hidden"
                                >
                                    {/* Ticket Cutouts (Notches) */}
                                    <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#09090b] border border-white/10 z-10" />
                                    <div className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#09090b] border border-white/10 z-10" />
                                    
                                    {/* Ticket Perforation */}
                                    <div className="absolute top-0 bottom-0 left-1/2 border-l border-dashed border-white/10" />
                                    
                                    <Ticket className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.4)]" />
                                </motion.div>
                            </div>

                            <h3 className="text-xl font-black text-white tracking-tight uppercase">Nenhum cupom ativo</h3>
                            <p className="text-xs font-semibold text-zinc-500 mt-2 max-w-sm text-center leading-relaxed">
                                Crie cupons promocionais para incentivar as vendas no seu catálogo e aumentar suas conversões.
                            </p>

                            <button
                                onClick={() => handleOpenDialog()}
                                disabled={isOffline}
                                className="mt-8 flex items-center gap-2 px-6 py-3.5 bg-white hover:bg-zinc-200 text-black rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-white/5 disabled:opacity-50 disabled:grayscale disabled:pointer-events-none"
                            >
                                <Plus className="w-4 h-4" /> Criar Primeiro Cupom
                            </button>
                        </motion.div>
                    ) : (
                        <div className={cn("transition-opacity duration-300", loading && "opacity-50 pointer-events-none")}>
                        <motion.div
                            variants={containerVariants}
                            initial="hidden"
                            animate="visible"
                            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                        >
                            {coupons.map((coupon) => (
                                <motion.div
                                    key={coupon.id}
                                    variants={itemVariants}
                                    layout
                                    className="group relative"
                                >
                                    {/* Glass Ticket Design */}
                                    <div className={`relative bg-zinc-900/60 rounded-[2.5rem] border border-white/5 p-7 backdrop-blur-md hover:bg-zinc-900/80 transition-all duration-500 overflow-hidden flex flex-col justify-between min-h-[320px] shadow-xl hover:shadow-2xl hover:border-white/10 ${!coupon.active ? 'opacity-45 grayscale' : ''}`}>
                                        
                                        {/* Left Notch */}
                                        <div className="absolute -left-3.5 top-[40%] -translate-y-1/2 w-7 h-7 rounded-full bg-[#09090b] border border-white/5 z-10 pointer-events-none" />
                                        
                                        {/* Right Notch */}
                                        <div className="absolute -right-3.5 top-[40%] -translate-y-1/2 w-7 h-7 rounded-full bg-[#09090b] border border-white/5 z-10 pointer-events-none" />
                                        
                                        {/* Perforated Dashed Line */}
                                        <div className="absolute left-4 right-4 top-[40%] border-t-2 border-dashed border-white/10 -translate-y-1/2 pointer-events-none" />

                                        {/* Upper Section */}
                                        <div className="pb-4">
                                            <div className="flex items-center justify-between gap-4 mb-2">
                                                <button
                                                    onClick={() => handleCopyCode(coupon.code)}
                                                    className="group/code flex items-center gap-2 px-3.5 py-2 bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 rounded-2xl border border-white/10 transition-all text-left max-w-[70%]"
                                                    title="Copiar Código"
                                                >
                                                    <span className="font-mono font-black text-lg text-white tracking-tighter uppercase italic truncate">
                                                        {coupon.code}
                                                    </span>
                                                    {copiedCode === coupon.code ? (
                                                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                                    ) : (
                                                        <Copy className="w-3.5 h-3.5 text-zinc-500 group-hover/code:text-white transition-colors shrink-0" />
                                                    )}
                                                </button>

                                                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[8px] font-black uppercase tracking-widest ${coupon.active
                                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                    : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                                                    }`}>
                                                    <div className={`w-1 h-1 rounded-full ${coupon.active ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                                                    {coupon.active ? 'Ativo' : 'Inativo'}
                                                </div>
                                            </div>
                                            
                                            <div className="text-[8px] font-extrabold tracking-widest text-zinc-500 uppercase flex items-center gap-1.5 mt-2">
                                                <Sparkles className="w-3 h-3 text-amber-500" />
                                                {coupon.type === 'percentage' ? 'Desconto Percentual' : 'Desconto Fixo'}
                                            </div>
                                        </div>

                                        {/* Lower Section */}
                                        <div className="pt-6 mt-4 flex-1 flex flex-col justify-between">
                                            <div>
                                                <div className="grid grid-cols-2 gap-4 mb-4">
                                                    <div className="p-3.5 bg-white/[0.02] rounded-2xl border border-white/5">
                                                        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Desconto</p>
                                                        <p className="text-xl font-black text-white italic">
                                                            {coupon.type === 'percentage' ? `${coupon.value ?? 0}% OFF` : `R$ ${Number(coupon.value ?? 0).toFixed(2)}`}
                                                        </p>
                                                    </div>
                                                    <div className="p-3.5 bg-white/[0.02] rounded-2xl border border-white/5 text-right">
                                                        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Mínimo Compra</p>
                                                        <p className="text-xl font-black text-zinc-400">
                                                            {coupon.minPurchase && coupon.minPurchase > 0 ? `R$ ${Number(coupon.minPurchase).toFixed(0)}` : 'R$ 0'}
                                                        </p>
                                                    </div>
                                                </div>

                                                {coupon.validUntil && (
                                                    <div className="flex items-center gap-2 mb-4 px-1">
                                                        <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                                                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                                                            Expira em: <span className="text-zinc-300 font-extrabold">{new Date(coupon.validUntil).toLocaleDateString('pt-BR')}</span>
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Progress / Utilization */}
                                            <div className="space-y-2 mb-6">
                                                <div className="flex items-center justify-between px-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <Users className="w-3.5 h-3.5 text-zinc-500" />
                                                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Aproveitamento</span>
                                                    </div>
                                                    <span className="text-[9px] font-black text-white">
                                                        {coupon.usageCount} <span className="text-zinc-600">/ {coupon.usageLimit || '∞'} usos</span>
                                                    </span>
                                                </div>
                                                {coupon.usageLimit && coupon.usageLimit > 0 ? (
                                                    <div className="h-1.5 w-full bg-white/[0.02] rounded-full overflow-hidden border border-white/5 relative">
                                                        <motion.div
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${Math.min(((coupon.usageCount || 0) / coupon.usageLimit) * 100, 100)}%` }}
                                                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="h-1.5 w-full bg-white/[0.02] rounded-full overflow-hidden border border-white/5 relative">
                                                        <div className="h-full w-[35%] bg-zinc-800 rounded-full animate-[pulse_2s_infinite]" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="flex items-center gap-2 pt-4 border-t border-white/5">
                                                <button
                                                    onClick={() => handleOpenDialog(coupon)}
                                                    disabled={isOffline}
                                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white/[0.03] text-zinc-400 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all border border-white/5 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                                                >
                                                    <Edit className="w-3.5 h-3.5" /> Editar
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(coupon.id)}
                                                    disabled={isOffline}
                                                    className="w-10 h-10 flex items-center justify-center bg-red-500/10 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-all duration-300 border border-red-500/10 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                                                >
                                                    <Trash className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </motion.div>
                        </div>
                    )}
                </AnimatePresence>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="bg-[#09090b] border-white/10 text-white sm:max-w-xl p-0 overflow-y-auto max-h-[92vh] rounded-[2.5rem] custom-scrollbar">
                    <div className="p-8 sm:p-10 bg-gradient-to-b from-white/[0.02] to-transparent w-full">
                        <DialogHeader className="mb-8">
                            <div className="flex items-center gap-4 mb-2">
                                <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                                    <Ticket className="w-6 h-6 text-emerald-400" />
                                </div>
                                <div className="text-left">
                                    <DialogTitle className="text-2xl font-black tracking-tight">{editingCoupon ? 'Editar Campanha' : 'Nova Campanha'}</DialogTitle>
                                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Configure os detalhes do seu cupom</p>
                                </div>
                            </div>
                        </DialogHeader>

                        <div className="space-y-6">
                            {/* Live Preview Block */}
                            <div className="space-y-2 border-b border-white/5 pb-6">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">PRÉ-VISUALIZAÇÃO EM TEMPO REAL</Label>
                                
                                <div className="relative bg-zinc-900/40 rounded-[2rem] border border-white/5 p-6 overflow-hidden min-h-[150px] flex flex-col justify-between shadow-xl">
                                    {/* Preview Left Notch */}
                                    <div className="absolute -left-3 top-[48%] -translate-y-1/2 w-6 h-6 rounded-full bg-[#09090b] border border-white/5 z-10 pointer-events-none" />
                                    {/* Preview Right Notch */}
                                    <div className="absolute -right-3 top-[48%] -translate-y-1/2 w-6 h-6 rounded-full bg-[#09090b] border border-white/5 z-10 pointer-events-none" />
                                    {/* Preview Dashed Line */}
                                    <div className="absolute left-3 right-3 top-[48%] border-t-2 border-dashed border-white/10 -translate-y-1/2 pointer-events-none" />

                                    {/* Preview Upper Section */}
                                    <div className="flex items-center justify-between pb-3">
                                        <div className="px-3.5 py-1.5 bg-white/[0.03] rounded-xl border border-white/10 max-w-[65%]">
                                            <span className="font-mono font-black text-sm text-white tracking-tighter uppercase italic truncate block">
                                                {formData.code || 'EX: CAMPANHA10'}
                                            </span>
                                        </div>
                                        <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[7px] font-black uppercase tracking-widest ${formData.active
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                                            }`}>
                                            {formData.active ? 'Ativo' : 'Inativo'}
                                        </div>
                                    </div>

                                    {/* Preview Lower Section */}
                                    <div className="flex items-end justify-between pt-3">
                                        <div>
                                            <p className="text-[7px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Desconto</p>
                                            <p className="text-xl font-black text-white italic">
                                                {formData.type === 'percentage' 
                                                    ? `${formData.value || 0}% OFF` 
                                                    : `R$ ${Number(formData.value || 0).toFixed(2)}`}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[7px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Mínimo Compra</p>
                                            <p className="text-sm font-bold text-zinc-400">
                                                R$ {Number(formData.minPurchase || 0).toFixed(0)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2 w-full">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Código Promocional</Label>
                                <Input
                                    value={formData.code}
                                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                    placeholder="EX: VERÃO2026"
                                    className="h-14 bg-white/[0.03] border-white/10 rounded-2xl text-lg font-black tracking-tight focus:ring-emerald-500/20 focus:border-emerald-500/30 transition-all uppercase italic w-full"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Modalidade</Label>
                                    <div className="flex bg-white/[0.03] border border-white/10 p-1 rounded-2xl h-14 relative w-full overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, type: 'percentage' })}
                                            className={`flex-1 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all relative z-10 ${formData.type === 'percentage' ? 'text-black font-extrabold' : 'text-zinc-400 hover:text-white font-bold'}`}
                                        >
                                            Porcentagem (%)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, type: 'fixed' })}
                                            className={`flex-1 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all relative z-10 ${formData.type === 'fixed' ? 'text-black font-extrabold' : 'text-zinc-400 hover:text-white font-bold'}`}
                                        >
                                            Valor Fixo (R$)
                                        </button>
                                        
                                        {/* Animated Pill Background */}
                                        <motion.div
                                            layoutId="modalidade-pill"
                                            className="absolute top-1 bottom-1 bg-white rounded-xl"
                                            animate={{
                                                left: formData.type === 'percentage' ? '4px' : '50%',
                                                right: formData.type === 'percentage' ? '50%' : '4px',
                                            }}
                                            transition={{ type: "spring", stiffness: 320, damping: 28 }}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Valor do Desconto</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={formData.type === 'percentage' ? 100 : undefined}
                                        value={formData.value || ''}
                                        onChange={(e) => setFormData({ ...formData, value: Number(e.target.value) })}
                                        className="h-14 bg-white/[0.03] border-white/10 rounded-2xl text-lg font-black focus:ring-emerald-500/20"
                                        placeholder="EX: 15"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Pedido Mínimo (R$)</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={formData.minPurchase || ''}
                                        onChange={(e) => setFormData({ ...formData, minPurchase: Number(e.target.value) })}
                                        className="h-14 bg-white/[0.03] border-white/10 rounded-2xl font-bold"
                                        placeholder="EX: 50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Limite de Uso</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={formData.usageLimit || ''}
                                        onChange={(e) => setFormData({ ...formData, usageLimit: Number(e.target.value) })}
                                        placeholder="0 = Ilimitado"
                                        className="h-14 bg-white/[0.03] border-white/10 rounded-2xl font-bold"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Data de Expiração (Opcional)</Label>
                                <div className="relative">
                                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                                    <Input
                                        type="date"
                                        value={(() => {
                                            if (!formData.validUntil) return '';
                                            const d = new Date(formData.validUntil);
                                            return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '';
                                        })()}
                                        onChange={(e) => {
                                            if (!e.target.value) {
                                                setFormData({ ...formData, validUntil: undefined });
                                                return;
                                            }
                                            const d = new Date(e.target.value);
                                            if (!isNaN(d.getTime())) {
                                                setFormData({ ...formData, validUntil: d.toISOString() });
                                            }
                                        }}
                                        className="h-14 bg-white/[0.03] border-white/10 rounded-2xl pl-12 font-bold focus:ring-emerald-500/20"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                                <div className="space-y-0.5 text-left">
                                    <Label className="text-xs font-black uppercase tracking-tight text-white italic">Status da Oferta</Label>
                                    <p className="text-[9px] font-medium text-zinc-500 tracking-wide uppercase">Tornar este cupom disponível para uso</p>
                                </div>
                                <Switch
                                    checked={formData.active}
                                    onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                                    className="data-[state=checked]:bg-emerald-500"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 mt-10">
                            <Button
                                variant="outline"
                                onClick={() => setIsDialogOpen(false)}
                                className="flex-1 h-14 bg-white/5 border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 text-zinc-400"
                            >
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                className="flex-[2] h-14 bg-white text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all shadow-xl shadow-white/5 active:scale-95"
                            >
                                Salvar Campanha
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Help Modal */}
            {showHelpModal && (
                <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
                    <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2.5rem] w-full max-w-2xl p-6 sm:p-8 flex flex-col max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300 text-left">
                        {/* Help Header */}
                        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
                            <h3 className="text-xs font-black text-white uppercase tracking-[0.2em] flex items-center gap-2.5">
                                <HelpCircle className="w-5 h-5 text-emerald-400 animate-pulse" />
                                Guia de Campanhas Promocionais
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowHelpModal(false)}
                                className="w-8 h-8 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all flex items-center justify-center font-bold text-sm"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Help Content */}
                        <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-6 custom-scrollbar text-zinc-300 text-sm">
                            <div className="space-y-4">
                                <p className="text-xs text-zinc-400 leading-relaxed">
                                    Nesta tela você pode criar e gerenciar cupons de desconto para campanhas de marketing e promoções especiais da sua loja.
                                </p>

                                <div className="space-y-3">
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-emerald-500 pl-2">
                                        Configurações dos Cupons
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                                                <Ticket className="w-4 h-4 text-emerald-500" />
                                                Código do Cupom
                                            </div>
                                            <p className="text-xs text-zinc-400">
                                                O texto digitado pelo cliente no checkout (ex: COMPRA10). Deve ser curto, sem espaços e em letras maiúsculas.
                                            </p>
                                        </div>

                                        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                                                <Users className="w-4 h-4 text-sky-400" />
                                                Limite de Uso & Mínimos
                                            </div>
                                            <p className="text-xs text-zinc-400">
                                                Configure o valor mínimo de compra para ativação e o limite total de usos permitidos (para evitar prejuízos).
                                            </p>
                                        </div>

                                        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                                                <Calendar className="w-4 h-4 text-amber-500" />
                                                Validade
                                            </div>
                                            <p className="text-xs text-zinc-400">
                                                Defina uma data limite. Após esse prazo, o cupom é desativado automaticamente pelo sistema.
                                            </p>
                                        </div>

                                        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                                                <Sparkles className="w-4 h-4 text-indigo-400" />
                                                Tipos de Desconto
                                            </div>
                                            <p className="text-xs text-zinc-400">
                                                <strong className="text-white">Fixo:</strong> Subtrai um valor em reais (ex: R$ 10). <strong className="text-white">Percentual:</strong> Subtrai uma porcentagem (ex: 10%).
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Help Footer */}
                        <div className="pt-4 border-t border-white/5 flex justify-end shrink-0">
                            <button
                                type="button"
                                onClick={() => setShowHelpModal(false)}
                                className="px-5 py-2.5 rounded-xl bg-white text-black text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-all"
                            >
                                Entendi
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Decorative Elements */}
            <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/5 blur-[120px] rounded-full" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#09090b] z-[-2]" />
            </div>

      {/* Diálogo de Confirmação de Exclusão de Cupom */}
      <AlertDialog open={couponToDelete !== null} onOpenChange={(open) => !open && setCouponToDelete(null)}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10 rounded-3xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-black text-lg uppercase tracking-tight">Excluir Cupom?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs">
              Tem certeza que deseja excluir este cupom? Esta ação não pode ser desfeita e invalidará o código para os clientes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteCoupon} className="bg-rose-650 hover:bg-rose-700 text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Excluir Cupom
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </div>
    );
}
