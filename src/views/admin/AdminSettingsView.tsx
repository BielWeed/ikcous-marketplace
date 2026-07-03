import { useState, useEffect, memo } from 'react';
import { Save, Ticket, Image as ImageIcon, Truck, Headset, Boxes, Bell, Settings, HelpCircle, ChevronDown, MessageSquare, Tag, Sparkles, Megaphone, MessageCircle, Clock, Share2, Info, Plus, Minus, Star } from 'lucide-react';

import { useStore } from '@/contexts/StoreContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

import type { View } from '@/types';

interface AdminSettingsViewProps {
    onNavigate: (view: View) => void;
    active?: boolean;
}

export const AdminSettingsView = memo(function AdminSettingsView({ onNavigate, active }: Readonly<AdminSettingsViewProps>) {
    const { config, isLoaded, updateConfig, refresh } = useStore();
    const [formData, setFormData] = useState(config);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        logistics: true, // Opened by default
        support: false,
        modules: false,
        notifications: false,
        shortcuts: false
    });

    const toggleSection = (section: string) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    useEffect(() => {
        if (isLoaded && config) {
            setFormData(config);
        }
    }, [config, isLoaded]);

    useEffect(() => {
        if (active) {
            refresh();
        }
    }, [active, refresh]);

    const handleSubmit = async () => {
        // Basic validation
        if (!formData.whatsappNumber) {
            toast.error('WhatsApp é obrigatório');
            return;
        }

        let cleanWhatsApp = formData.whatsappNumber.replaceAll(/\D/g, '');
        if (cleanWhatsApp.length < 10) {
            toast.error('WhatsApp inválido');
            return;
        }

        if (cleanWhatsApp.length === 10 || cleanWhatsApp.length === 11) {
            cleanWhatsApp = '55' + cleanWhatsApp;
        }

        const sanitizedFormData = {
            ...formData,
            whatsappNumber: cleanWhatsApp,
            freeShippingMin: Math.max(0, formData.freeShippingMin || 0),
            shippingFee: Math.max(0, formData.shippingFee || 0)
        };

        await updateConfig(sanitizedFormData);
    };

    if (!isLoaded) return <div className="p-10 text-center">Carregando...</div>;

    return (
        <div className="min-h-screen bg-admin-bg pb-20 animate-in fade-in duration-700">
            {/* Elite Header */}
            <div className="px-6 pt-6 pb-2">
                <div className="flex items-center justify-between max-w-4xl mx-auto w-full gap-4">
                    <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase leading-none select-none flex items-center gap-3 shrink-0">
                        <span className="flex items-baseline flex-nowrap whitespace-nowrap">
                            <span className="italic text-white">Ajustes</span>
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowHelpModal(true)}
                            className="w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                            title="Guia de Configurações e Ajuda"
                        >
                            <HelpCircle className="w-4.5 h-4.5" />
                        </button>
                    </h1>
                    <button
                        onClick={handleSubmit}
                        className="h-11 px-4 sm:px-6 bg-admin-gold text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-[0_0_30px_rgba(212,175,55,0.2)] hover:shadow-[0_0_40px_rgba(212,175,55,0.3)] hover:bg-admin-gold/90 transition-all active:scale-95 flex items-center gap-2 sm:gap-3 shrink-0"
                    >
                        <Save className="w-4 h-4" />
                        <span>Salvar<span className="hidden sm:inline"> Alterações</span></span>
                    </button>
                </div>
            </div>

            <div className="px-4 mt-6 space-y-6 max-w-2xl mx-auto pb-10">
                {/* Entregas Section */}
                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={() => toggleSection('logistics')}
                        className="w-full flex items-center justify-between p-2 rounded-2xl hover:bg-white/5 transition-all text-left group select-none"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)] group-hover:scale-105 transition-all">
                                <Truck className="w-5 h-5 text-emerald-500" strokeWidth={2.5} />
                            </div>
                            <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Logística & Entregas</h2>
                        </div>
                        <ChevronDown
                            className={`w-5 h-5 text-zinc-500 group-hover:text-white transition-all duration-300 ${
                                expandedSections.logistics ? 'rotate-180 text-admin-gold' : ''
                            }`}
                        />
                    </button>

                    <div
                        className={`grid transition-all duration-300 ease-in-out ${
                            expandedSections.logistics ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                        }`}
                    >
                        <div className="overflow-hidden">
                            <div className="pt-2">
                                <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-4 sm:p-6 shadow-2xl relative overflow-hidden group">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Card 1: Frete Grátis Inteligente */}
                                        <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex flex-col gap-4 ${
                                            formData.freeShippingMin > 0 
                                                ? 'bg-emerald-500/5 border-emerald-500/20 shadow-[0_0_25px_rgba(16,185,129,0.04)]' 
                                                : 'bg-white/5 border-white/5 hover:border-white/10'
                                        }`}>
                                            {/* Header */}
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-300 ${
                                                        formData.freeShippingMin > 0
                                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                                                            : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                                    }`}>
                                                        <Truck className="w-5 h-5 text-emerald-500" strokeWidth={2.5} />
                                                    </div>
                                                    <div className="text-left">
                                                        <span className="text-[10px] font-black text-white uppercase tracking-wider block">Frete Grátis</span>
                                                        <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest leading-none block mt-0.5">
                                                            Valor Mínimo
                                                        </span>
                                                    </div>
                                                </div>
                                                <Switch
                                                    checked={formData.freeShippingMin > 0}
                                                    onCheckedChange={(checked) => {
                                                        setFormData({
                                                            ...formData,
                                                            freeShippingMin: checked ? 100 : 0
                                                        });
                                                    }}
                                                    className="data-[state=checked]:bg-emerald-500"
                                                />
                                            </div>

                                            {/* Body */}
                                            <div className={`transition-all duration-300 space-y-4 ${
                                                formData.freeShippingMin > 0 ? 'opacity-100' : 'opacity-40 pointer-events-none'
                                            }`}>
                                                <p className="text-[10.5px] text-zinc-400 text-left leading-normal">
                                                    Ativa a barra de progresso no carrinho. Pedidos acima deste valor terão a taxa de entrega anulada.
                                                </p>

                                                {/* Stepper Input */}
                                                <div className="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-2xl p-2 h-16">
                                                    <button
                                                        type="button"
                                                        disabled={formData.freeShippingMin <= 0}
                                                        onClick={() => {
                                                            const newVal = Math.max(0, formData.freeShippingMin - 10);
                                                            setFormData({ ...formData, freeShippingMin: newVal });
                                                        }}
                                                        className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-900 border border-white/5 text-white hover:bg-zinc-800 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all text-lg font-bold select-none shrink-0"
                                                    >
                                                        <Minus className="w-4 h-4 text-zinc-400" />
                                                    </button>

                                                    <div className="flex-1 flex items-center justify-center gap-1.5 min-w-0">
                                                        <span className="text-zinc-500 font-black text-sm text-admin-gold">R$</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="1"
                                                            value={formData.freeShippingMin === 0 ? '' : formData.freeShippingMin}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                setFormData({ ...formData, freeShippingMin: val === '' ? 0 : Number(val) });
                                                            }}
                                                            className="w-20 bg-transparent border-0 p-0 text-center font-black text-xl text-white focus:outline-none focus:ring-0 focus:border-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                            autoComplete="off"
                                                        />
                                                    </div>

                                                    <button
                                                        type="button"
                                                        disabled={formData.freeShippingMin === 0}
                                                        onClick={() => {
                                                            const newVal = formData.freeShippingMin + 10;
                                                            setFormData({ ...formData, freeShippingMin: newVal });
                                                        }}
                                                        className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-900 border border-white/5 text-white hover:bg-zinc-800 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all text-lg font-bold select-none shrink-0"
                                                    >
                                                        <Plus className="w-4 h-4 text-zinc-400" />
                                                    </button>
                                                </div>

                                                {/* Preset Chips */}
                                                <div className="flex flex-wrap gap-1.5 justify-start">
                                                    {[50, 100, 150, 200, 250].map((preset) => (
                                                        <button
                                                            key={preset}
                                                            type="button"
                                                            disabled={formData.freeShippingMin === 0}
                                                            onClick={() => setFormData({ ...formData, freeShippingMin: preset })}
                                                            className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border transition-all duration-200 select-none ${
                                                                formData.freeShippingMin === preset
                                                                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
                                                                    : 'bg-zinc-900/60 border-white/5 text-zinc-400 hover:text-white hover:border-white/10'
                                                            }`}
                                                        >
                                                            R$ {preset}
                                                        </button>
                                                    ))}
                                                </div>

                                                {/* Interactive simulated progress bar */}
                                                <div className="pt-4 border-t border-white/5 space-y-2">
                                                    <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                                        <span>Simulação no PWA</span>
                                                        <span className="text-emerald-500 font-bold">R$ {formData.freeShippingMin}</span>
                                                    </div>
                                                    <div className="h-2 w-full bg-zinc-950 rounded-full border border-white/5 overflow-hidden p-[2px]">
                                                        <div 
                                                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                                                            style={{ width: formData.freeShippingMin > 0 ? '70%' : '0%' }}
                                                        />
                                                    </div>
                                                    <p className="text-[9.5px] text-zinc-500 italic text-left">
                                                        {formData.freeShippingMin > 0 
                                                            ? `Exemplo: Se a compra for de R$ ${(formData.freeShippingMin * 0.7).toFixed(0)}, faltará R$ ${(formData.freeShippingMin * 0.3).toFixed(0)} para frete grátis.`
                                                            : "Frete grátis desativado por padrão."}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Card 2: Taxa de Entrega Padrão */}
                                        <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex flex-col gap-4 ${
                                            formData.shippingFee > 0 
                                                ? 'bg-admin-gold/5 border-admin-gold/20 shadow-[0_0_25px_rgba(212,175,55,0.04)]' 
                                                : 'bg-white/5 border-white/5 hover:border-white/10'
                                        }`}>
                                            {/* Header */}
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-300 ${
                                                        formData.shippingFee > 0
                                                            ? 'bg-admin-gold/10 border-admin-gold/30 text-admin-gold shadow-[0_0_15px_rgba(212,175,55,0.15)]'
                                                            : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                                    }`}>
                                                        <Settings className="w-5 h-5 text-admin-gold" />
                                                    </div>
                                                    <div className="text-left">
                                                        <span className="text-[10px] font-black text-white uppercase tracking-wider block">Taxa de Entrega</span>
                                                        <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest leading-none block mt-0.5">
                                                            Cobrança Padrão
                                                        </span>
                                                    </div>
                                                </div>
                                                <Switch
                                                    checked={formData.shippingFee > 0}
                                                    onCheckedChange={(checked) => {
                                                        setFormData({
                                                            ...formData,
                                                            shippingFee: checked ? 15 : 0
                                                        });
                                                    }}
                                                    className="data-[state=checked]:bg-admin-gold"
                                                />
                                            </div>

                                            {/* Body */}
                                            <div className={`transition-all duration-300 space-y-4 ${
                                                formData.shippingFee > 0 ? 'opacity-100' : 'opacity-40 pointer-events-none'
                                            }`}>
                                                <p className="text-[10.5px] text-zinc-400 text-left leading-normal">
                                                    Insira o valor fixo cobrado por padrão para entregas caso o pedido não atinja a regra de frete grátis.
                                                </p>

                                                {/* Stepper Input */}
                                                <div className="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-2xl p-2 h-16">
                                                    <button
                                                        type="button"
                                                        disabled={formData.shippingFee <= 0}
                                                        onClick={() => {
                                                            const newVal = Math.max(0, formData.shippingFee - 1);
                                                            setFormData({ ...formData, shippingFee: newVal });
                                                        }}
                                                        className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-900 border border-white/5 text-white hover:bg-zinc-800 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all text-lg font-bold select-none shrink-0"
                                                    >
                                                        <Minus className="w-4 h-4 text-zinc-400" />
                                                    </button>

                                                    <div className="flex-1 flex items-center justify-center gap-1.5 min-w-0">
                                                        <span className="text-zinc-500 font-black text-sm text-admin-gold">R$</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={formData.shippingFee === 0 ? '' : formData.shippingFee}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                setFormData({ ...formData, shippingFee: val === '' ? 0 : Number(val) });
                                                            }}
                                                            className="w-20 bg-transparent border-0 p-0 text-center font-black text-xl text-white focus:outline-none focus:ring-0 focus:border-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                            autoComplete="off"
                                                        />
                                                    </div>

                                                    <button
                                                        type="button"
                                                        disabled={formData.shippingFee === 0}
                                                        onClick={() => {
                                                            const newVal = formData.shippingFee + 1;
                                                            setFormData({ ...formData, shippingFee: newVal });
                                                        }}
                                                        className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-900 border border-white/5 text-white hover:bg-zinc-800 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all text-lg font-bold select-none shrink-0"
                                                    >
                                                        <Plus className="w-4 h-4 text-zinc-400" />
                                                    </button>
                                                </div>

                                                {/* Preset Chips */}
                                                <div className="flex flex-wrap gap-1.5 justify-start">
                                                    {[5, 10, 12, 15, 20].map((preset) => (
                                                        <button
                                                            key={preset}
                                                            type="button"
                                                            disabled={formData.shippingFee === 0}
                                                            onClick={() => setFormData({ ...formData, shippingFee: preset })}
                                                            className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border transition-all duration-200 select-none ${
                                                                formData.shippingFee === preset
                                                                    ? 'bg-admin-gold/10 border-admin-gold/40 text-admin-gold shadow-[0_0_12px_rgba(212,175,55,0.1)]'
                                                                    : 'bg-zinc-900/60 border-white/5 text-zinc-400 hover:text-white hover:border-white/10'
                                                            }`}
                                                        >
                                                            R$ {preset}
                                                        </button>
                                                    ))}
                                                </div>

                                                {/* Custom delivery indicator */}
                                                <div className="pt-4 border-t border-white/5 space-y-1">
                                                    <div className="flex items-center gap-1.5 text-[8.5px] font-black text-zinc-500 uppercase tracking-widest">
                                                        <Info className="w-3.5 h-3.5 text-admin-gold" />
                                                        <span>Resumo da Regra</span>
                                                    </div>
                                                    <p className="text-[10px] text-zinc-400 leading-normal text-left">
                                                        Se o cliente comprar menos que <span className="text-white font-bold">R$ {formData.freeShippingMin}</span>, o valor da entrega será <span className="text-admin-gold font-bold">R$ {formData.shippingFee}</span>.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Decoration */}
                                    <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-emerald-500/5 blur-[80px] rounded-full" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Contato Section */}
                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={() => toggleSection('support')}
                        className="w-full flex items-center justify-between p-2 rounded-2xl hover:bg-white/5 transition-all text-left group select-none"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-admin-gold/10 flex items-center justify-center border border-admin-gold/20 shadow-[0_0_15px_rgba(212,175,55,0.1)] group-hover:scale-105 transition-all">
                                <Headset className="w-5 h-5 text-admin-gold" strokeWidth={2.5} />
                            </div>
                            <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Canais de Atendimento</h2>
                        </div>
                        <ChevronDown
                            className={`w-5 h-5 text-zinc-500 group-hover:text-white transition-all duration-300 ${
                                expandedSections.support ? 'rotate-180 text-admin-gold' : ''
                            }`}
                        />
                    </button>

                    <div
                        className={`grid transition-all duration-300 ease-in-out ${
                            expandedSections.support ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                        }`}
                    >
                        <div className="overflow-hidden">
                            <div className="pt-2">
                                <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-4 sm:p-8 shadow-2xl space-y-8 relative overflow-hidden">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        {/* WhatsApp Field */}
                                        <div className="space-y-3 flex-grow">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] ml-1">
                                                    WhatsApp da Operação
                                                </Label>
                                                <span className="text-[8px] font-black text-[#25d366] bg-[#25d366]/10 px-2 py-0.5 rounded-full uppercase tracking-wider border border-[#25d366]/20">
                                                    Atendimento & Vendas
                                                </span>
                                            </div>
                                            <p className="text-[10.5px] text-zinc-500 leading-normal ml-1">
                                                Número que receberá contatos diretos de clientes interessados em produtos ou buscando suporte de pedidos.
                                            </p>
                                            <div className="relative group">
                                                <div className="absolute left-5 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none border-r border-white/10 pr-3">
                                                    <MessageCircle className="w-4 h-4 text-[#25d366]" />
                                                    <span className="text-xs font-black text-zinc-500">+55</span>
                                                </div>
                                                <Input
                                                    value={formData.whatsappNumber}
                                                    onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                                                    placeholder="Ex: 34999999999"
                                                    className="h-14 pl-20 bg-black/40 border-white/10 rounded-2xl focus:ring-admin-gold/50 focus:bg-black/60 transition-all font-bold text-white placeholder:text-zinc-700"
                                                    autoComplete="tel"
                                                />
                                            </div>
                                            <div className="p-3 bg-zinc-950/40 border border-white/5 rounded-xl space-y-1">
                                                <div className="flex items-center gap-1.5 text-[8.5px] font-black text-zinc-500 uppercase tracking-widest">
                                                    <Info className="w-3.5 h-3.5 text-admin-gold" />
                                                    <span>Formato e Protocolo</span>
                                                </div>
                                                <p className="text-[10px] text-zinc-400 leading-relaxed">
                                                    Informe apenas o DDD e o número (ex: <code className="text-admin-gold font-mono font-bold">34999999999</code>). O código do país <code className="text-zinc-300 font-mono">55</code> será adicionado de forma automatizada ao salvar.
                                                </p>
                                            </div>
                                        </div>

                                        {/* Business Hours Field */}
                                        <div className="space-y-3 flex-grow">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] ml-1">
                                                    Horário de Funcionamento
                                                </Label>
                                                <span className="text-[8px] font-black text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider border border-blue-500/20">
                                                    Expediente
                                                </span>
                                            </div>
                                            <p className="text-[10.5px] text-zinc-500 leading-normal ml-1">
                                                Informa aos clientes no PWA o horário em que a operação está ativa para responder dúvidas e enviar pedidos.
                                            </p>
                                            <div className="relative group">
                                                <div className="absolute left-5 top-1/2 -translate-y-1/2 flex items-center border-r border-white/10 pr-3 pointer-events-none">
                                                    <Clock className="w-4 h-4 text-admin-gold" />
                                                </div>
                                                <Input
                                                    value={formData.businessHours}
                                                    onChange={(e) => setFormData({ ...formData, businessHours: e.target.value })}
                                                    placeholder="Ex: Seg-Sáb: 9h às 18h"
                                                    className="h-14 pl-14 bg-black/40 border-white/10 rounded-2xl focus:ring-admin-gold/50 focus:bg-black/60 transition-all font-bold text-white placeholder:text-zinc-700"
                                                    autoComplete="off"
                                                />
                                            </div>
                                            <div className="p-3 bg-zinc-950/40 border border-white/5 rounded-xl space-y-1">
                                                <div className="flex items-center gap-1.5 text-[8.5px] font-black text-zinc-500 uppercase tracking-widest">
                                                    <Clock className="w-3.5 h-3.5 text-zinc-500" />
                                                    <span>Exemplos recomendados</span>
                                                </div>
                                                <p className="text-[10px] text-zinc-400 leading-relaxed">
                                                    • <code className="text-zinc-300 font-mono">Seg-Sáb: 9h às 18h</code><br />
                                                    • <code className="text-zinc-300 font-mono">Seg a Sex: 8h às 18h | Sáb: 8h às 12h</code>
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Share Text Section */}
                                    <div className="space-y-4 pt-4 border-t border-white/5">
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] ml-1">
                                                    Mensagem de Compartilhamento de Produtos
                                                </Label>
                                                <span className="text-[8px] font-black text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider border border-purple-500/20">
                                                    Divulgação
                                                </span>
                                            </div>
                                            <p className="text-[10.5px] text-zinc-500 leading-normal ml-1">
                                                Texto de introdução anexado à mensagem quando um usuário compartilha um produto. O nome do produto, o preço e o link serão adicionados logo abaixo.
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                                            <div className="space-y-3">
                                                <div className="relative">
                                                    <div className="absolute left-5 top-5 pointer-events-none">
                                                        <Share2 className="w-4 h-4 text-zinc-500" />
                                                    </div>
                                                    <Textarea
                                                        value={formData.shareText}
                                                        onChange={(e) => setFormData({ ...formData, shareText: e.target.value })}
                                                        placeholder="Ex: Confira este produto incrível que encontrei!"
                                                        className="min-h-[130px] pl-14 bg-black/40 border-white/10 rounded-2xl focus:ring-admin-gold/50 focus:bg-black/60 transition-all font-medium text-white resize-none p-5 text-sm leading-relaxed placeholder:text-zinc-700"
                                                    />
                                                </div>
                                            </div>

                                            {/* WhatsApp Message Preview Simulator */}
                                            <div className="space-y-2">
                                                <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.25em] ml-1">
                                                    Visualização da Mensagem no WhatsApp
                                                </span>
                                                <div className="bg-[#0b141a] rounded-2xl border border-emerald-500/10 p-4 relative overflow-hidden shadow-inner min-h-[130px] flex flex-col justify-end">
                                                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#25d366_1.5px,transparent_1.5px)] [background-size:16px_16px]" />
                                                    
                                                    <div className="bg-[#0b141a] border border-white/10 text-white rounded-2xl rounded-tr-none p-3.5 max-w-[85%] self-end relative shadow-lg space-y-1.5 z-10">
                                                        <p className="text-xs text-emerald-400 font-semibold break-words">
                                                            {formData.shareText || 'Confira os produtos da Ikous!'}
                                                        </p>
                                                        
                                                        <div className="bg-black/40 border border-white/5 rounded-xl p-2.5 space-y-1 text-[10px]">
                                                            <div className="flex gap-2">
                                                                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-[10px] font-black text-admin-gold shrink-0 border border-white/5">
                                                                    IMG
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="font-bold text-zinc-200 truncate">Fone de Ouvido Bluetooth</p>
                                                                    <p className="text-zinc-400 text-[9px] mt-0.5">R$ 189,90</p>
                                                                </div>
                                                            </div>
                                                            <p className="text-[9px] text-[#00a884] font-medium truncate pt-1 border-t border-white/5">
                                                                ikcous.com/produto/fone-de-ouvido-bluetooth
                                                            </p>
                                                        </div>
                                                        
                                                        <div className="flex items-center justify-end gap-1 text-[8px] text-zinc-500 mt-1">
                                                            <span>12:00</span>
                                                            <span className="flex text-[#53bdeb]">✓✓</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {/* Decoration */}
                                    <div className="absolute -top-10 -right-10 w-32 h-32 bg-admin-gold/5 blur-[80px] rounded-full" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>


                {/* Funcionalidades Section */}
                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={() => toggleSection('modules')}
                        className="w-full flex items-center justify-between p-2 rounded-2xl hover:bg-white/5 transition-all text-left group select-none"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)] group-hover:scale-105 transition-all">
                                <Boxes className="w-5 h-5 text-blue-400" strokeWidth={2.5} />
                            </div>
                            <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Módulos de Sistema</h2>
                        </div>
                        <ChevronDown
                            className={`w-5 h-5 text-zinc-500 group-hover:text-white transition-all duration-300 ${
                                expandedSections.modules ? 'rotate-180 text-admin-gold' : ''
                            }`}
                        />
                    </button>

                    <div
                        className={`grid transition-all duration-300 ease-in-out ${
                            expandedSections.modules ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                        }`}
                    >
                        <div className="overflow-hidden">
                            <div className="pt-2">
                                <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-4 sm:p-8 shadow-2xl space-y-4">
                                    {/* Avaliações de Usuário */}
                                    <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex items-start gap-4 ${
                                        formData.enableReviews 
                                            ? 'bg-blue-500/5 border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.05)]' 
                                            : 'bg-white/5 border-white/5 hover:border-white/10'
                                    }`}>
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                            formData.enableReviews 
                                                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
                                                : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                        }`}>
                                            <MessageSquare className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 space-y-2 text-left">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs font-black text-white uppercase tracking-wider">Avaliações de Usuário</span>
                                                <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                                    formData.enableReviews 
                                                        ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' 
                                                        : 'bg-zinc-900 border-white/5 text-zinc-500'
                                                }`}>
                                                    Prova Social
                                                </span>
                                            </div>
                                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
                                                Permitir feedback social em produtos
                                            </p>
                                            <p className="text-[11px] text-zinc-500 leading-normal">
                                                Habilita comentários e notas com estrelas nas páginas de produtos. Clientes podem compartilhar fotos e experiências reais, incentivando a tomada de decisão de novos compradores.
                                            </p>
                                            <div className="flex items-center gap-1.5 pt-1">
                                                <span className={`w-1.5 h-1.5 rounded-full ${formData.enableReviews ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                                                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                                    {formData.enableReviews ? 'Habilitado e ativo no app' : 'Desativado'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="self-center pl-2">
                                            <Switch
                                                checked={formData.enableReviews}
                                                onCheckedChange={(checked) => setFormData({ ...formData, enableReviews: checked })}
                                                className="data-[state=checked]:bg-blue-500"
                                            />
                                        </div>
                                    </div>

                                    {/* Motor de Cupons */}
                                    <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex items-start gap-4 ${
                                        formData.enableCoupons 
                                            ? 'bg-amber-500/5 border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.05)]' 
                                            : 'bg-white/5 border-white/5 hover:border-white/10'
                                    }`}>
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                            formData.enableCoupons 
                                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.15)]' 
                                                : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                        }`}>
                                            <Tag className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 space-y-2 text-left">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs font-black text-white uppercase tracking-wider">Motor de Cupons</span>
                                                <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                                    formData.enableCoupons 
                                                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' 
                                                        : 'bg-zinc-900 border-white/5 text-zinc-500'
                                                }`}>
                                                    Conversão e Vendas
                                                </span>
                                            </div>
                                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">
                                                Ativar validação de descontos no checkout
                                            </p>
                                            <p className="text-[11px] text-zinc-500 leading-normal">
                                                Habilita o campo de cupom no carrinho e checkout. Permite validar e aplicar descontos percentuais ou fixos definidos em suas campanhas ativas no painel administrativo.
                                            </p>
                                            <div className="flex items-center gap-1.5 pt-1">
                                                <span className={`w-1.5 h-1.5 rounded-full ${formData.enableCoupons ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                                                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                                    {formData.enableCoupons ? 'Habilitado e ativo no app' : 'Desativado'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="self-center pl-2">
                                            <Switch
                                                checked={formData.enableCoupons}
                                                onCheckedChange={(checked) => setFormData({ ...formData, enableCoupons: checked })}
                                                className="data-[state=checked]:bg-admin-gold"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Push Center Section */}
                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={() => toggleSection('notifications')}
                        className="w-full flex items-center justify-between p-2 rounded-2xl hover:bg-white/5 transition-all text-left group select-none"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.1)] group-hover:scale-105 transition-all">
                                <Bell className="w-5 h-5 text-purple-400" strokeWidth={2.5} />
                            </div>
                            <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Inteligência de Notificação</h2>
                        </div>
                        <ChevronDown
                            className={`w-5 h-5 text-zinc-500 group-hover:text-white transition-all duration-300 ${
                                expandedSections.notifications ? 'rotate-180 text-admin-gold' : ''
                            }`}
                        />
                    </button>

                    <div
                        className={`grid transition-all duration-300 ease-in-out ${
                            expandedSections.notifications ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                        }`}
                    >
                        <div className="overflow-hidden">
                            <div className="pt-2">
                                <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-4 sm:p-8 shadow-2xl space-y-4 relative overflow-hidden">
                                    {/* Alertas de Venda Ativa */}
                                    <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex items-start gap-4 ${
                                        formData.realTimeSalesAlerts 
                                            ? 'bg-emerald-500/5 border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.05)]' 
                                            : 'bg-white/5 border-white/5 hover:border-white/10'
                                    }`}>
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                            formData.realTimeSalesAlerts 
                                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]' 
                                                : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                        }`}>
                                            <Sparkles className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 space-y-2 text-left">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs font-black text-white uppercase tracking-wider">Alertas de Venda Ativa</span>
                                                <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                                    formData.realTimeSalesAlerts 
                                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                                                        : 'bg-zinc-900 border-white/5 text-zinc-500'
                                                }`}>
                                                    Gatilho de Urgência
                                                </span>
                                            </div>
                                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">
                                                Feedback visual imediato para novos pedidos
                                            </p>
                                            <p className="text-[11px] text-zinc-500 leading-normal">
                                                Exibe popups discretos no site informando sobre compras recentes de outros usuários (Ex: "Fulano de São Paulo acabou de comprar este item"). Estimula o gatilho da escassez e da prova social em tempo real.
                                            </p>
                                            <div className="flex items-center gap-1.5 pt-1">
                                                <span className={`w-1.5 h-1.5 rounded-full ${formData.realTimeSalesAlerts ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                                                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                                    {formData.realTimeSalesAlerts ? 'Habilitado e ativo no app' : 'Desativado'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="self-center pl-2">
                                            <Switch
                                                checked={formData.realTimeSalesAlerts}
                                                onCheckedChange={(checked) => setFormData({ ...formData, realTimeSalesAlerts: checked })}
                                                className="data-[state=checked]:bg-emerald-500"
                                            />
                                        </div>
                                    </div>

                                    {/* Push Marketing Automation */}
                                    <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex items-start gap-4 ${
                                        formData.pushMarketingEnabled 
                                            ? 'bg-purple-500/5 border-purple-500/20 shadow-[0_0_20px_rgba(168,85,247,0.05)]' 
                                            : 'bg-white/5 border-white/5 hover:border-white/10'
                                    }`}>
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                            formData.pushMarketingEnabled 
                                                ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.15)]' 
                                                : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                        }`}>
                                            <Megaphone className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 space-y-2 text-left">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs font-black text-white uppercase tracking-wider">Push Marketing Automation</span>
                                                <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                                    formData.pushMarketingEnabled 
                                                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' 
                                                        : 'bg-zinc-900 border-white/5 text-zinc-500'
                                                }`}>
                                                    Retenção & Engajamento
                                                </span>
                                            </div>
                                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">
                                                Broadcast de ofertas via sistema
                                            </p>
                                            <p className="text-[11px] text-zinc-500 leading-normal">
                                                Dispara automaticamente ofertas personalizadas, avisos de promoções exclusivas e lembretes de carrinhos abandonados diretamente no navegador ou celular dos clientes que aceitaram notificações.
                                            </p>
                                            <div className="flex items-center gap-1.5 pt-1">
                                                <span className={`w-1.5 h-1.5 rounded-full ${formData.pushMarketingEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                                                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                                    {formData.pushMarketingEnabled ? 'Habilitado e ativo no app' : 'Desativado'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="self-center pl-2">
                                            <Switch
                                                checked={formData.pushMarketingEnabled}
                                                onCheckedChange={(checked) => setFormData({ ...formData, pushMarketingEnabled: checked })}
                                                className="data-[state=checked]:bg-purple-500"
                                            />
                                        </div>
                                    </div>
                                    {/* Decoration */}
                                    <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/5 blur-[80px] rounded-full" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {/* Gestão & Atalhos Section */}
                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={() => toggleSection('shortcuts')}
                        className="w-full flex items-center justify-between p-2 rounded-2xl hover:bg-white/5 transition-all text-left group select-none"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-admin-gold/10 flex items-center justify-center border border-admin-gold/20 shadow-[0_0_15px_rgba(212,175,55,0.1)] group-hover:scale-105 transition-all">
                                <Settings className="w-5 h-5 text-admin-gold" strokeWidth={2.5} />
                            </div>
                            <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Gestão & Atalhos</h2>
                        </div>
                        <ChevronDown
                            className={`w-5 h-5 text-zinc-500 group-hover:text-white transition-all duration-300 ${
                                expandedSections.shortcuts ? 'rotate-180 text-admin-gold' : ''
                            }`}
                        />
                    </button>

                    <div
                        className={`grid transition-all duration-300 ease-in-out ${
                            expandedSections.shortcuts ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                        }`}
                    >
                        <div className="overflow-hidden">
                            <div className="pt-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <button
                                        onClick={() => onNavigate('admin-coupons')}
                                        className="admin-glass group flex items-center gap-4 p-5 rounded-[2rem] border border-white/5 hover:border-admin-gold/30 hover:bg-white/5 transition-all active:scale-95 text-left"
                                    >
                                        <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-500 group-hover:text-admin-gold group-hover:border-admin-gold/20 transition-all shadow-xl">
                                            <Ticket className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <span className="block text-sm font-bold text-white group-hover:text-admin-gold transition-colors">Campanhas</span>
                                            <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mt-1">Gerir Cupons</span>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => onNavigate('admin-banners')}
                                        className="admin-glass group flex items-center gap-4 p-5 rounded-[2rem] border border-white/5 hover:border-admin-gold/30 hover:bg-white/5 transition-all active:scale-95 text-left"
                                    >
                                        <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-500 group-hover:text-admin-gold group-hover:border-admin-gold/20 transition-all shadow-xl">
                                            <ImageIcon className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <span className="block text-sm font-bold text-white group-hover:text-admin-gold transition-colors">Vitrine</span>
                                            <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mt-1">Gerir Banners</span>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => onNavigate('admin-reviews')}
                                        className="admin-glass group flex items-center gap-4 p-5 rounded-[2rem] border border-white/5 hover:border-admin-gold/30 hover:bg-white/5 transition-all active:scale-95 text-left"
                                    >
                                        <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-500 group-hover:text-admin-gold group-hover:border-admin-gold/20 transition-all shadow-xl">
                                            <Star className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <span className="block text-sm font-bold text-white group-hover:text-admin-gold transition-colors">Avaliações</span>
                                            <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mt-1">Depoimentos</span>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => onNavigate('admin-qa')}
                                        className="admin-glass group flex items-center gap-4 p-5 rounded-[2rem] border border-white/5 hover:border-admin-gold/30 hover:bg-white/5 transition-all active:scale-95 text-left"
                                    >
                                        <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-500 group-hover:text-admin-gold group-hover:border-admin-gold/20 transition-all shadow-xl">
                                            <MessageSquare className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <span className="block text-sm font-bold text-white group-hover:text-admin-gold transition-colors">Suporte</span>
                                            <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mt-1">Dúvidas & Respostas</span>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal de Ajuda */}
            {showHelpModal && (
              <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300 text-left">
                <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[88vh] sm:max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300 text-zinc-300 text-sm">
                  {/* Header */}
                  <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
                    <h3 className="text-sm font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-admin-gold animate-pulse" />
                      Guia de Configurações do Sistema
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
                        Nesta tela são ajustados os parâmetros gerais e regras de funcionamento do seu marketplace, como fretes, raio de atuação e canais de atendimento.
                      </p>

                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                          Seções de Ajustes
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Truck className="w-4 h-4 text-emerald-500" />
                              Logística & Entregas
                            </div>
                            <p className="text-xs text-zinc-400">
                              Define o preço de frete cobrado por padrão, o tempo de entrega informado ao cliente e a distância máxima (raio) que o marketplace atende.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Headset className="w-4 h-4 text-admin-gold" />
                              Atendimento & WhatsApp
                            </div>
                            <p className="text-xs text-zinc-400">
                              O número de telefone configurado para o WhatsApp da loja. É para onde as mensagens automáticas de confirmação de pedido serão enviadas.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Boxes className="w-4 h-4 text-sky-500" />
                              Contatos Oficiais
                            </div>
                            <p className="text-xs text-zinc-400">
                              Informações institucionais como endereço físico, telefone fixo e e-mail de suporte que aparecem no rodapé do app dos clientes.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Bell className="w-4 h-4 text-purple-500" />
                              Notificações e Ajustes
                            </div>
                            <p className="text-xs text-zinc-400">
                              Controla parâmetros visuais, atalhos rápidos para cupons e banners da loja na base do painel.
                            </p>
                          </div>
                        </div>
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
