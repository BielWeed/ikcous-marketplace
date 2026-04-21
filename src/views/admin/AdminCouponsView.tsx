import { useState } from 'react';
import { Plus, Trash, Edit, ArrowLeft, Ticket, Calendar, Users } from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useCoupons } from '@/hooks/useCoupons';
import type { Coupon, View } from '@/types';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
    const [formData, setFormData] = useState<Partial<Coupon>>({
        code: '',
        type: 'percentage',
        value: 0,
        active: true,
        usageLimit: 0,
        minPurchase: 0
    });

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
        try {
            if (editingCoupon) {
                await updateCoupon(editingCoupon.id, formData);
            } else {
                await addCoupon(formData as Required<Omit<Coupon, 'id' | 'usageCount'>>);
            }
            setIsDialogOpen(false);
        } catch {
            // Error handled in hook
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Tem certeza que deseja excluir este cupom?')) {
            await deleteCoupon(id);
        }
    };

    return (
        <div className="min-h-screen bg-[#09090b] text-zinc-400 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
            {/* Header / Stats Overlay */}
            <div className="sticky top-0 z-50 p-4 pb-0">
                <div className="admin-glass rounded-[2rem] border border-white/5 p-6 shadow-2xl">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="space-y-1">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => onNavigate('admin-dashboard')}
                                    className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-colors group"
                                >
                                    <ArrowLeft className="w-5 h-5 text-zinc-400 group-hover:text-white transition-colors" />
                                </button>
                                <div className="space-y-0.5">
                                    <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                                        Gestão de Cupons
                                        <div className="px-2.5 py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                                            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">{coupons.length}</p>
                                        </div>
                                    </h1>
                                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                        Campanhas e Promoções
                                        <span className="w-1 h-1 rounded-full bg-emerald-500/40 animate-pulse" />
                                        <span className="text-emerald-400/80">Otimize suas conversões</span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => handleOpenDialog()}
                                className="flex items-center gap-2.5 px-6 py-3 bg-white text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all active:scale-95 shadow-xl shadow-white/5"
                            >
                                <Plus className="w-4 h-4" /> Novo Cupom
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-4 lg:p-8">
                <AnimatePresence mode="wait">
                    {loading ? (
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
                            className="flex flex-col items-center justify-center py-32 rounded-[3rem] border-2 border-dashed border-white/5 bg-white/[0.02]"
                        >
                            <div className="w-24 h-24 bg-white/[0.03] rounded-3xl flex items-center justify-center border border-white/5 mb-8 relative">
                                <Ticket className="w-12 h-12 text-zinc-800" />
                                <div className="absolute inset-0 bg-emerald-500/20 blur-2xl rounded-full" />
                            </div>
                            <h3 className="text-xl font-black text-white tracking-tight uppercase">Nenhum cupom ativo</h3>
                            <p className="text-sm font-medium text-zinc-500 mt-2 max-w-xs text-center">Crie cupons promocionais para incentivar as vendas no seu catálogo.</p>
                        </motion.div>
                    ) : (
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
                                    <div className="absolute -inset-px bg-gradient-to-r from-emerald-500/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-[2.5rem]" />
                                    <div className={`relative bg-white/[0.03] rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md hover:bg-white/[0.05] transition-all duration-500 overflow-hidden ${!coupon.active ? 'opacity-40 grayscale' : ''}`}>

                                        {/* Coupon Header */}
                                        <div className="flex items-center justify-between mb-8">
                                            <div className="px-4 py-2 bg-white/[0.05] rounded-2xl border border-white/10 ring-1 ring-white/5">
                                                <span className="font-black text-2xl text-white tracking-tighter uppercase italic">
                                                    {coupon.code}
                                                </span>
                                            </div>
                                            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[8px] font-black uppercase tracking-widest ${coupon.active
                                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                                                }`}>
                                                <div className={`w-1.5 h-1.5 rounded-full ${coupon.active ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                                                {coupon.active ? 'Ativo' : 'Inativo'}
                                            </div>
                                        </div>

                                        {/* Benefits Section */}
                                        <div className="grid grid-cols-2 gap-4 mb-8">
                                            <div className="p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                                                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1 shadow-sm">Desconto</p>
                                                <p className="text-xl font-black text-white italic">
                                                    {coupon.type === 'percentage' ? `${coupon.value}% OFF` : `R$ ${coupon.value.toFixed(2)}`}
                                                </p>
                                            </div>
                                            {coupon.minPurchase !== undefined && coupon.minPurchase > 0 && (
                                                <div className="p-4 bg-white/[0.02] rounded-2xl border border-white/5 text-right">
                                                    <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1 shadow-sm">Mínimo</p>
                                                    <p className="text-xl font-black text-zinc-400">R$ {coupon.minPurchase.toFixed(0)}</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Usage Metrics */}
                                        <div className="space-y-3 mb-8">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Users className="w-3.5 h-3.5 text-zinc-500" />
                                                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Aproveitamento</span>
                                                </div>
                                                <span className="text-[10px] font-black text-white">
                                                    {coupon.usageCount} <span className="text-zinc-600">/ {coupon.usageLimit || '∞'}</span>
                                                </span>
                                            </div>
                                            {coupon.usageLimit !== undefined && coupon.usageLimit > 0 && (
                                                <div className="h-2 w-full bg-white/[0.02] rounded-full overflow-hidden border border-white/5 relative">
                                                    <motion.div
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${Math.min(((coupon.usageCount || 0) / coupon.usageLimit!) * 100, 100)}%` }}
                                                        className="h-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]"
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {/* Action Bar */}
                                        <div className="flex items-center gap-2 pt-6 border-t border-white/5">
                                            <button
                                                onClick={() => handleOpenDialog(coupon)}
                                                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white/[0.03] text-zinc-400 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all border border-white/5 active:scale-95"
                                            >
                                                <Edit className="w-3.5 h-3.5" /> Editar
                                            </button>
                                            <button
                                                onClick={() => handleDelete(coupon.id)}
                                                className="w-12 h-12 flex items-center justify-center bg-red-500/10 text-red-400 rounded-2xl hover:bg-red-500 hover:text-white transition-all duration-300 border border-red-500/10 active:scale-95"
                                            >
                                                <Trash className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="bg-[#09090b] border-white/10 text-white max-w-lg p-0 overflow-hidden rounded-[2.5rem]">
                    <div className="p-8 bg-gradient-to-b from-white/[0.02] to-transparent">
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
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Código Promocional</Label>
                                <Input
                                    value={formData.code}
                                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                    placeholder="EX: VERÃO2026"
                                    className="h-14 bg-white/[0.03] border-white/10 rounded-2xl text-lg font-black tracking-tight focus:ring-emerald-500/20 focus:border-emerald-500/30 transition-all uppercase italic"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Modalidade</Label>
                                    <Select
                                        value={formData.type}
                                        onValueChange={(value: any) => setFormData({ ...formData, type: value })}
                                    >
                                        <SelectTrigger className="h-14 bg-white/[0.03] border-white/10 rounded-2xl font-bold">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-[#121214] border-white/10 text-white">
                                            <SelectItem value="percentage">Porcentagem (%)</SelectItem>
                                            <SelectItem value="fixed">Valor Fixo (R$)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Valor do Desconto</Label>
                                    <Input
                                        type="number"
                                        value={formData.value}
                                        onChange={(e) => setFormData({ ...formData, value: Number(e.target.value) })}
                                        className="h-14 bg-white/[0.03] border-white/10 rounded-2xl text-lg font-black focus:ring-emerald-500/20"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Pedido Mínimo (R$)</Label>
                                    <Input
                                        type="number"
                                        value={formData.minPurchase}
                                        onChange={(e) => setFormData({ ...formData, minPurchase: Number(e.target.value) })}
                                        className="h-14 bg-white/[0.03] border-white/10 rounded-2xl font-bold"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Limite de Uso</Label>
                                    <Input
                                        type="number"
                                        value={formData.usageLimit}
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
                                        value={formData.validUntil ? new Date(formData.validUntil).toISOString().split('T')[0] : ''}
                                        onChange={(e) => setFormData({ ...formData, validUntil: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                                        className="h-14 bg-white/[0.03] border-white/10 rounded-2xl pl-12 font-bold focus:ring-emerald-500/20"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                                <div className="space-y-0.5">
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

            {/* Background Decorative Elements */}
            <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/5 blur-[120px] rounded-full" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#09090b] z-[-2]" />
            </div>
        </div>
    );
}
