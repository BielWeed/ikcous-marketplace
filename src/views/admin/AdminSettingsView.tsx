import { useState, useEffect } from 'react';
import { Save, Ticket, Image as ImageIcon, Truck, Headset, Boxes, Bell, Settings } from 'lucide-react';

import { useStore } from '@/hooks/useStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

import type { View } from '@/types';

interface AdminSettingsViewProps {
    onNavigate: (view: View) => void;
}

export function AdminSettingsView({ onNavigate }: Readonly<AdminSettingsViewProps>) {
    const { config, isLoaded, updateConfig } = useStore();
    const [formData, setFormData] = useState(config);

    useEffect(() => {
        if (isLoaded && config && !formData) {
            setFormData(config);
        }
    }, [config, isLoaded, formData]);

    const handleSubmit = async () => {
        // Basic validation
        if (!formData.whatsappNumber) {
            toast.error('WhatsApp é obrigatório');
            return;
        }

        const cleanWhatsApp = formData.whatsappNumber.replaceAll(/\D/g, '');
        if (cleanWhatsApp.length < 10) {
            toast.error('WhatsApp inválido');
            return;
        }

        const sanitizedFormData = {
            ...formData,
            freeShippingMin: Math.max(0, formData.freeShippingMin || 0),
            shippingFee: Math.max(0, formData.shippingFee || 0)
        };

        await updateConfig(sanitizedFormData);
    };

    if (!isLoaded) return <div className="p-10 text-center">Carregando...</div>;

    return (
        <div className="min-h-screen bg-[var(--admin-bg)] pb-20 animate-in fade-in duration-700">
            {/* Elite Header */}
            <div className="px-6 pt-6 pb-2">
                <div className="flex items-center justify-between max-w-4xl mx-auto w-full">
                    <div className="flex items-center gap-5">
                        <div className="flex flex-col">
                            <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] leading-none mb-1.5 flex items-center gap-2">
                                SISTEMA GLOBAL
                                <div className="w-1 h-1 rounded-full bg-[var(--admin-gold)] shadow-[0_0_8px_rgba(212,175,55,0.5)]" />
                            </h2>
                            <h1 className="text-xl font-bold text-white tracking-tighter">Configurações</h1>
                        </div>
                    </div>
                    <button
                        onClick={handleSubmit}
                        className="h-11 px-6 bg-[var(--admin-gold)] text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-[0_0_30px_rgba(212,175,55,0.2)] hover:shadow-[0_0_40px_rgba(212,175,55,0.3)] hover:bg-[var(--admin-gold)]/90 transition-all active:scale-95 flex items-center gap-3"
                    >
                        <Save className="w-4 h-4" />
                        Salvar Alterações
                    </button>
                </div>
            </div>

            <div className="px-4 mt-6 space-y-12 max-w-2xl mx-auto pb-10">
                {/* Entregas Section */}
                <div className="space-y-6">
                    <div className="flex items-center gap-4 px-2">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                            <Truck className="w-5 h-5 text-emerald-500" strokeWidth={2.5} />
                        </div>
                        <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Logística & Entregas</h2>
                    </div>

                    <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-6 sm:p-8 shadow-2xl space-y-8 relative overflow-hidden group">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Valor Mínimo para Frete Grátis (R$)</Label>
                                <div className="relative">
                                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 font-black text-sm text-[var(--admin-gold)]">R$</span>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={formData.freeShippingMin === 0 ? '' : formData.freeShippingMin}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setFormData({ ...formData, freeShippingMin: val === '' ? 0 : Number(val) });
                                        }}
                                        className="h-14 pl-12 bg-black/40 border-white/10 rounded-2xl focus:ring-[var(--admin-gold)]/50 focus:bg-black/60 transition-all font-bold text-white placeholder:text-zinc-700"
                                        autoComplete="off"
                                    />
                                </div>
                                <p className="text-[9px] font-bold text-emerald-500/60 uppercase tracking-widest ml-1">Configurado: R$ {formData.freeShippingMin}</p>
                            </div>
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Taxa de Entrega Padrão</Label>
                                <div className="relative">
                                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 font-black text-sm text-[var(--admin-gold)]">R$</span>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={formData.shippingFee === 0 ? '' : formData.shippingFee}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setFormData({ ...formData, shippingFee: val === '' ? 0 : Number(val) });
                                        }}
                                        className="h-14 pl-12 bg-black/40 border-white/10 rounded-2xl focus:ring-[var(--admin-gold)]/50 focus:bg-black/60 transition-all font-bold text-white placeholder:text-zinc-700"
                                        autoComplete="off"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Decoration */}
                        <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-emerald-500/5 blur-[80px] rounded-full" />
                    </div>
                </div>

                {/* Contato Section */}
                <div className="space-y-6">
                    <div className="flex items-center gap-4 px-2">
                        <div className="w-10 h-10 rounded-xl bg-[var(--admin-gold)]/10 flex items-center justify-center border border-[var(--admin-gold)]/20 shadow-[0_0_15px_rgba(212,175,55,0.1)]">
                            <Headset className="w-5 h-5 text-[var(--admin-gold)]" strokeWidth={2.5} />
                        </div>
                        <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Canais de Atendimento</h2>
                    </div>

                    <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-6 sm:p-8 shadow-2xl space-y-8 relative overflow-hidden">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">WhatsApp da Operação</Label>
                                <Input
                                    value={formData.whatsappNumber}
                                    onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                                    placeholder="5534999999999"
                                    className="h-14 bg-black/40 border-white/10 rounded-2xl focus:ring-[var(--admin-gold)]/50 focus:bg-black/60 transition-all font-bold text-white"
                                    autoComplete="tel"
                                />
                                <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest ml-1 italic">Protocolo: 55 + DDD + Terminal</p>
                            </div>
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Horário de Ativo</Label>
                                <Input
                                    value={formData.businessHours}
                                    onChange={(e) => setFormData({ ...formData, businessHours: e.target.value })}
                                    className="h-14 bg-black/40 border-white/10 rounded-2xl focus:ring-[var(--admin-gold)]/50 focus:bg-black/60 transition-all font-bold text-white"
                                    autoComplete="off"
                                />
                            </div>
                        </div>
                        <div className="space-y-3">
                            <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Script de Compartilhamento</Label>
                            <Textarea
                                value={formData.shareText}
                                onChange={(e) => setFormData({ ...formData, shareText: e.target.value })}
                                className="min-h-[120px] bg-black/40 border-white/10 rounded-2xl focus:ring-[var(--admin-gold)]/50 focus:bg-black/60 transition-all font-medium text-white resize-none p-5 text-sm leading-relaxed"
                            />
                        </div>
                        {/* Decoration */}
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-[var(--admin-gold)]/5 blur-[80px] rounded-full" />
                    </div>
                </div>


                {/* Funcionalidades Section */}
                <div className="space-y-6">
                    <div className="flex items-center gap-4 px-2">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                            <Boxes className="w-5 h-5 text-blue-400" strokeWidth={2.5} />
                        </div>
                        <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Módulos de Sistema</h2>
                    </div>

                    <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-6 sm:p-8 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between p-5 bg-white/5 rounded-[2rem] border border-white/5 hover:border-white/10 transition-colors">
                            <div className="space-y-1">
                                <Label className="text-[11px] font-bold text-white uppercase tracking-tight">Avaliações de Usuário</Label>
                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none">Permitir feedback social em produtos</p>
                            </div>
                            <Switch
                                checked={formData.enableReviews}
                                onCheckedChange={(checked) => setFormData({ ...formData, enableReviews: checked })}
                                className="data-[state=checked]:bg-admin-gold"
                            />
                        </div>
                        <div className="flex items-center justify-between p-5 bg-white/5 rounded-[2rem] border border-white/5 hover:border-white/10 transition-colors">
                            <div className="space-y-1">
                                <Label className="text-[11px] font-bold text-white uppercase tracking-tight">Motor de Cupons</Label>
                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none">Ativar validação de descontos no checkout</p>
                            </div>
                            <Switch
                                checked={formData.enableCoupons}
                                onCheckedChange={(checked) => setFormData({ ...formData, enableCoupons: checked })}
                                className="data-[state=checked]:bg-admin-gold"
                            />
                        </div>
                    </div>
                </div>

                {/* Push Center Section */}
                <div className="space-y-6">
                    <div className="flex items-center gap-4 px-2">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.1)]">
                            <Bell className="w-5 h-5 text-purple-400" strokeWidth={2.5} />
                        </div>
                        <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Inteligência de Notificação</h2>
                    </div>

                    <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-6 sm:p-8 shadow-2xl space-y-4 relative overflow-hidden">
                        <div className="flex items-center justify-between p-5 bg-white/5 rounded-[2rem] border border-white/5 hover:border-white/10 transition-colors">
                            <div className="space-y-1">
                                <Label className="text-[11px] font-bold text-white uppercase tracking-tight">Alertas de Venda Ativa</Label>
                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none">Feedback visual imediato para novos pedidos</p>
                            </div>
                            <Switch
                                checked={formData.realTimeSalesAlerts}
                                onCheckedChange={(checked) => setFormData({ ...formData, realTimeSalesAlerts: checked })}
                                className="data-[state=checked]:bg-emerald-500"
                            />
                        </div>
                        <div className="flex items-center justify-between p-5 bg-white/5 rounded-[2rem] border border-white/5 hover:border-white/10 transition-colors">
                            <div className="space-y-1">
                                <Label className="text-[11px] font-bold text-white uppercase tracking-tight">Push Marketing Automation</Label>
                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none">Broadcast de ofertas via sistema</p>
                            </div>
                            <Switch
                                checked={formData.pushMarketingEnabled}
                                onCheckedChange={(checked) => setFormData({ ...formData, pushMarketingEnabled: checked })}
                                className="data-[state=checked]:bg-admin-gold"
                            />
                        </div>
                        {/* Decoration */}
                        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/5 blur-[80px] rounded-full" />
                    </div>
                </div>
                {/* Gestão & Atalhos Section */}
                <div className="space-y-6">
                    <div className="flex items-center gap-4 px-2">
                        <div className="w-10 h-10 rounded-xl bg-[var(--admin-gold)]/10 flex items-center justify-center border border-[var(--admin-gold)]/20 shadow-[0_0_15px_rgba(212,175,55,0.1)]">
                            <Settings className="w-5 h-5 text-[var(--admin-gold)]" strokeWidth={2.5} />
                        </div>
                        <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Gestão & Atalhos</h2>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button
                            onClick={() => onNavigate('admin-coupons')}
                            className="admin-glass group flex items-center gap-4 p-5 rounded-[2rem] border border-white/5 hover:border-[var(--admin-gold)]/30 hover:bg-white/5 transition-all active:scale-95 text-left"
                        >
                            <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-500 group-hover:text-[var(--admin-gold)] group-hover:border-[var(--admin-gold)]/20 transition-all shadow-xl">
                                <Ticket className="w-6 h-6" />
                            </div>
                            <div>
                                <span className="block text-sm font-bold text-white group-hover:text-[var(--admin-gold)] transition-colors">Campanhas</span>
                                <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mt-1">Gerir Cupons</span>
                            </div>
                        </button>

                        <button
                            onClick={() => onNavigate('admin-banners')}
                            className="admin-glass group flex items-center gap-4 p-5 rounded-[2rem] border border-white/5 hover:border-[var(--admin-gold)]/30 hover:bg-white/5 transition-all active:scale-95 text-left"
                        >
                            <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-500 group-hover:text-[var(--admin-gold)] group-hover:border-[var(--admin-gold)]/20 transition-all shadow-xl">
                                <ImageIcon className="w-6 h-6" />
                            </div>
                            <div>
                                <span className="block text-sm font-bold text-white group-hover:text-[var(--admin-gold)] transition-colors">Vitrine</span>
                                <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mt-1">Gerir Banners</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
