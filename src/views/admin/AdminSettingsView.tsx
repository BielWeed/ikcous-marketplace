import { useState, useEffect, memo, useCallback, useRef } from 'react';
import { LocalBufferedInput, LocalBufferedTextarea } from '@/components/admin/LocalBufferedInput';
import { Save, Ticket, Image as ImageIcon, Truck, Headset, Boxes, Bell, Settings, HelpCircle, ChevronDown, MessageSquare, Tag, Sparkles, Megaphone, MessageCircle, Clock, Share2, Info, Plus, Minus, RefreshCw, Star, AlertTriangle } from 'lucide-react';

import { useStore } from '@/contexts/StoreContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';

import type { View } from '@/types';

interface AdminSettingsViewProps {
    onNavigate: (view: View) => void;
    active?: boolean;
    onSetDirty?: (dirty: boolean) => void;
}

// ==========================================
// Logistics Section (Memoized)
// ==========================================
const LogisticsSection = memo(function LogisticsSection({
    freeShippingMin,
    shippingFee,
    isOffline,
    onChangeFreeShippingMin,
    onChangeShippingFee
}: {
    freeShippingMin: number;
    shippingFee: number;
    isOffline: boolean;
    onChangeFreeShippingMin: (val: number) => void;
    onChangeShippingFee: (val: number) => void;
}) {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
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
                        isOpen ? 'rotate-180 text-admin-gold' : ''
                    }`}
                />
            </button>

            <div
                className={`grid transition-all duration-300 ease-in-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
            >
                <div className="overflow-hidden">
                    <div className="pt-2">
                        <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-4 sm:p-6 shadow-2xl relative overflow-hidden group">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex flex-col gap-4 ${
                                    freeShippingMin > 0 
                                        ? 'bg-emerald-500/5 border-emerald-500/20 shadow-[0_0_25px_rgba(16,185,129,0.04)]' 
                                        : 'bg-white/5 border-white/5 hover:border-white/10'
                                }`}>
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-300 ${
                                                freeShippingMin > 0
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
                                            checked={freeShippingMin > 0}
                                            onCheckedChange={(checked) => {
                                                onChangeFreeShippingMin(checked ? 100 : 0);
                                            }}
                                            className="data-[state=checked]:bg-emerald-500"
                                            disabled={isOffline}
                                        />
                                    </div>

                                    <div className={`transition-all duration-300 space-y-4 ${
                                        freeShippingMin > 0 ? 'opacity-100' : 'opacity-40 pointer-events-none'
                                    }`}>
                                        <p className="text-[10.5px] text-zinc-400 text-left leading-normal">
                                            Ativa a barra de progresso no carrinho. Pedidos acima deste valor terão a taxa de entrega anulada.
                                        </p>

                                        <div className="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-2xl p-2 h-16">
                                            <button
                                                type="button"
                                                disabled={freeShippingMin <= 0 || isOffline}
                                                onClick={() => {
                                                    onChangeFreeShippingMin(Math.max(0, freeShippingMin - 10));
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
                                                    value={freeShippingMin === 0 ? '' : freeShippingMin}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        onChangeFreeShippingMin(val === '' ? 0 : Number(val));
                                                    }}
                                                    className="w-20 bg-transparent border-0 p-0 text-center font-black text-xl text-white focus:outline-none focus:ring-0 focus:border-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                    autoComplete="off"
                                                    disabled={isOffline}
                                                />
                                            </div>

                                            <button
                                                type="button"
                                                disabled={freeShippingMin === 0 || isOffline}
                                                onClick={() => {
                                                    onChangeFreeShippingMin(freeShippingMin + 10);
                                                }}
                                                className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-900 border border-white/5 text-white hover:bg-zinc-800 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all text-lg font-bold select-none shrink-0"
                                            >
                                                <Plus className="w-4 h-4 text-zinc-400" />
                                            </button>
                                        </div>

                                        <div className="flex flex-wrap gap-1.5 justify-start">
                                            {[50, 100, 150, 200, 250].map((preset) => (
                                                <button
                                                    key={preset}
                                                    type="button"
                                                    disabled={freeShippingMin === 0 || isOffline}
                                                    onClick={() => onChangeFreeShippingMin(preset)}
                                                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border transition-all duration-200 select-none ${
                                                        freeShippingMin === preset
                                                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
                                                            : 'bg-zinc-900/60 border-white/5 text-zinc-400 hover:text-white hover:border-white/10'
                                                    }`}
                                                >
                                                    R$ {preset}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="pt-4 border-t border-white/5 space-y-2">
                                            <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                                <span>Simulação no PWA</span>
                                                <span className="text-emerald-500 font-bold">R$ {freeShippingMin}</span>
                                            </div>
                                            <div className="h-2 w-full bg-zinc-950 rounded-full border border-white/5 overflow-hidden p-[2px]">
                                                <div 
                                                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                                                    style={{ width: freeShippingMin > 0 ? '70%' : '0%' }}
                                                />
                                            </div>
                                            <p className="text-[9.5px] text-zinc-500 italic text-left">
                                                {freeShippingMin > 0 
                                                    ? `Exemplo: Se a compra for de R$ ${(freeShippingMin * 0.7).toFixed(0)}, faltará R$ ${(freeShippingMin * 0.3).toFixed(0)} para frete grátis.`
                                                    : "Frete grátis desativado por padrão."}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex flex-col gap-4 ${
                                    shippingFee > 0 
                                        ? 'bg-admin-gold/5 border-admin-gold/20 shadow-[0_0_25px_rgba(212,175,55,0.04)]' 
                                        : 'bg-white/5 border-white/5 hover:border-white/10'
                                }`}>
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-300 ${
                                                shippingFee > 0
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
                                            checked={shippingFee > 0}
                                            onCheckedChange={(checked) => {
                                                onChangeShippingFee(checked ? 15 : 0);
                                            }}
                                            className="data-[state=checked]:bg-admin-gold"
                                            disabled={isOffline}
                                        />
                                    </div>

                                    <div className={`transition-all duration-300 space-y-4 ${
                                        shippingFee > 0 ? 'opacity-100' : 'opacity-40 pointer-events-none'
                                    }`}>
                                        <p className="text-[10.5px] text-zinc-400 text-left leading-normal">
                                            Insira o valor fixo cobrado por padrão para entregas caso o pedido não atinja a regra de frete grátis.
                                        </p>

                                        <div className="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-2xl p-2 h-16">
                                            <button
                                                type="button"
                                                disabled={shippingFee <= 0 || isOffline}
                                                onClick={() => {
                                                    onChangeShippingFee(Math.max(0, shippingFee - 1));
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
                                                    value={shippingFee === 0 ? '' : shippingFee}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        onChangeShippingFee(val === '' ? 0 : Number(val));
                                                    }}
                                                    className="w-20 bg-transparent border-0 p-0 text-center font-black text-xl text-white focus:outline-none focus:ring-0 focus:border-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                    autoComplete="off"
                                                    disabled={isOffline}
                                                />
                                            </div>

                                            <button
                                                type="button"
                                                disabled={shippingFee === 0 || isOffline}
                                                onClick={() => {
                                                    onChangeShippingFee(shippingFee + 1);
                                                }}
                                                className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-900 border border-white/5 text-white hover:bg-zinc-800 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all text-lg font-bold select-none shrink-0"
                                            >
                                                <Plus className="w-4 h-4 text-zinc-400" />
                                            </button>
                                        </div>

                                        <div className="flex flex-wrap gap-1.5 justify-start">
                                            {[5, 10, 12, 15, 20].map((preset) => (
                                                <button
                                                    key={preset}
                                                    type="button"
                                                    disabled={shippingFee === 0 || isOffline}
                                                    onClick={() => onChangeShippingFee(preset)}
                                                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border transition-all duration-200 select-none ${
                                                        shippingFee === preset
                                                            ? 'bg-admin-gold/10 border-admin-gold/40 text-admin-gold shadow-[0_0_12px_rgba(212,175,55,0.1)]'
                                                            : 'bg-zinc-900/60 border-white/5 text-zinc-400 hover:text-white hover:border-white/10'
                                                    }`}
                                                >
                                                    R$ {preset}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="pt-4 border-t border-white/5 space-y-1">
                                            <div className="flex items-center gap-1.5 text-[8.5px] font-black text-zinc-500 uppercase tracking-widest">
                                                <Info className="w-3.5 h-3.5 text-admin-gold" />
                                                <span>Resumo da Regra</span>
                                            </div>
                                            <p className="text-[10px] text-zinc-400 leading-normal text-left">
                                                Se o cliente comprar menos que <span className="text-white font-bold">R$ {freeShippingMin}</span>, o valor da entrega será <span className="text-admin-gold font-bold">R$ {shippingFee}</span>.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-emerald-500/5 blur-[80px] rounded-full" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

// ==========================================
// Support Section (Memoized)
// ==========================================
const SupportSection = memo(function SupportSection({
    whatsappNumber,
    businessHours,
    shareText,
    isOffline,
    onChangeWhatsappNumber,
    onChangeBusinessHours,
    onChangeShareText
}: {
    whatsappNumber: string;
    businessHours: string;
    shareText: string;
    isOffline: boolean;
    onChangeWhatsappNumber: (val: string) => void;
    onChangeBusinessHours: (val: string) => void;
    onChangeShareText: (val: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
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
                        isOpen ? 'rotate-180 text-admin-gold' : ''
                    }`}
                />
            </button>

            <div
                className={`grid transition-all duration-300 ease-in-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
            >
                <div className="overflow-hidden">
                    <div className="pt-2">
                        <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-4 sm:p-8 shadow-2xl space-y-8 relative overflow-hidden">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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
                                        <LocalBufferedInput
                                            useShadcn
                                            delay={350}
                                            value={whatsappNumber}
                                            onFlush={onChangeWhatsappNumber}
                                            placeholder="Ex: 34999999999"
                                            className="h-14 pl-20 bg-black/40 border-white/10 rounded-2xl focus:ring-admin-gold/50 focus:bg-black/60 transition-all font-bold text-white placeholder:text-zinc-700"
                                            autoComplete="tel"
                                            disabled={isOffline}
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
                                        <LocalBufferedInput
                                            useShadcn
                                            delay={350}
                                            value={businessHours}
                                            onFlush={onChangeBusinessHours}
                                            placeholder="Ex: Seg-Sáb: 9h às 18h"
                                            className="h-14 pl-14 bg-black/40 border-white/10 rounded-2xl focus:ring-admin-gold/50 focus:bg-black/60 transition-all font-bold text-white placeholder:text-zinc-700"
                                            autoComplete="off"
                                            disabled={isOffline}
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
                                            <LocalBufferedTextarea
                                                useShadcn
                                                delay={350}
                                                value={shareText}
                                                onFlush={onChangeShareText}
                                                placeholder="Ex: Confira este produto incrível que encontrei!"
                                                className="min-h-[130px] pl-14 bg-black/40 border-white/10 rounded-2xl focus:ring-admin-gold/50 focus:bg-black/60 transition-all font-medium text-white resize-none p-5 text-sm leading-relaxed placeholder:text-zinc-700"
                                                disabled={isOffline}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.25em] ml-1">
                                            Visualização da Mensagem no WhatsApp
                                        </span>
                                        <div className="bg-[#0b141a] rounded-2xl border border-emerald-500/10 p-4 relative overflow-hidden shadow-inner min-h-[130px] flex flex-col justify-end">
                                            <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#25d366_1.5px,transparent_1.5px)] [background-size:16px_16px]" />
                                            
                                            <div className="bg-[#0b141a] border border-white/10 text-white rounded-2xl rounded-tr-none p-3.5 max-w-[85%] self-end relative shadow-lg space-y-1.5 z-10">
                                                <p className="text-xs text-emerald-400 font-semibold break-words">
                                                    {shareText || 'Confira os produtos da Ikous!'}
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
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

// ==========================================
// Modules Section (Memoized)
// ==========================================
const ModulesSection = memo(function ModulesSection({
    enableReviews,
    enableCoupons,
    isOffline,
    onChangeEnableReviews,
    onChangeEnableCoupons
}: {
    enableReviews: boolean;
    enableCoupons: boolean;
    isOffline: boolean;
    onChangeEnableReviews: (val: boolean) => void;
    onChangeEnableCoupons: (val: boolean) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
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
                        isOpen ? 'rotate-180 text-admin-gold' : ''
                    }`}
                />
            </button>

            <div
                className={`grid transition-all duration-300 ease-in-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
            >
                <div className="overflow-hidden">
                    <div className="pt-2">
                        <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-4 sm:p-8 shadow-2xl space-y-4">
                            <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex items-start gap-4 ${
                                enableReviews 
                                    ? 'bg-blue-500/5 border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.05)]' 
                                    : 'bg-white/5 border-white/5 hover:border-white/10'
                            }`}>
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                    enableReviews 
                                        ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
                                        : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                }`}>
                                    <MessageSquare className="w-5 h-5" />
                                </div>
                                <div className="flex-1 space-y-2 text-left">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-black text-white uppercase tracking-wider">Avaliações de Usuário</span>
                                        <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                            enableReviews 
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
                                        <span className={`w-1.5 h-1.5 rounded-full ${enableReviews ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                            {enableReviews ? 'Habilitado e ativo no app' : 'Desativado'}
                                        </span>
                                    </div>
                                </div>
                                <div className="self-center pl-2">
                                    <Switch
                                        checked={enableReviews}
                                        onCheckedChange={onChangeEnableReviews}
                                        className="data-[state=checked]:bg-blue-500"
                                        disabled={isOffline}
                                    />
                                </div>
                            </div>

                            <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex items-start gap-4 ${
                                enableCoupons 
                                    ? 'bg-amber-500/5 border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.05)]' 
                                    : 'bg-white/5 border-white/5 hover:border-white/10'
                            }`}>
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                    enableCoupons 
                                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.15)]' 
                                        : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                }`}>
                                    <Tag className="w-5 h-5" />
                                </div>
                                <div className="flex-1 space-y-2 text-left">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-black text-white uppercase tracking-wider">Motor de Cupons</span>
                                        <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                            enableCoupons 
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
                                        <span className={`w-1.5 h-1.5 rounded-full ${enableCoupons ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                            {enableCoupons ? 'Habilitado e ativo no app' : 'Desativado'}
                                        </span>
                                    </div>
                                </div>
                                <div className="self-center pl-2">
                                    <Switch
                                        checked={enableCoupons}
                                        onCheckedChange={onChangeEnableCoupons}
                                        className="data-[state=checked]:bg-admin-gold"
                                        disabled={isOffline}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

// ==========================================
// Notifications Section (Memoized)
// ==========================================
const NotificationsSection = memo(function NotificationsSection({
    realTimeSalesAlerts,
    pushMarketingEnabled,
    isOffline,
    onChangeRealTimeSalesAlerts,
    onChangePushMarketingEnabled
}: {
    realTimeSalesAlerts: boolean;
    pushMarketingEnabled: boolean;
    isOffline: boolean;
    onChangeRealTimeSalesAlerts: (val: boolean) => void;
    onChangePushMarketingEnabled: (val: boolean) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
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
                        isOpen ? 'rotate-180 text-admin-gold' : ''
                    }`}
                />
            </button>

            <div
                className={`grid transition-all duration-300 ease-in-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
            >
                <div className="overflow-hidden">
                    <div className="pt-2">
                        <div className="admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 p-4 sm:p-8 shadow-2xl space-y-4 relative overflow-hidden">
                            <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex items-start gap-4 ${
                                realTimeSalesAlerts 
                                    ? 'bg-emerald-500/5 border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.05)]' 
                                    : 'bg-white/5 border-white/5 hover:border-white/10'
                            }`}>
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                    realTimeSalesAlerts 
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]' 
                                        : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                }`}>
                                    <Sparkles className="w-5 h-5" />
                                </div>
                                <div className="flex-1 space-y-2 text-left">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-black text-white uppercase tracking-wider">Alertas de Venda Ativa</span>
                                        <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                            realTimeSalesAlerts 
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
                                        <span className={`w-1.5 h-1.5 rounded-full ${realTimeSalesAlerts ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                            {realTimeSalesAlerts ? 'Habilitado e ativo no app' : 'Desativado'}
                                        </span>
                                    </div>
                                </div>
                                <div className="self-center pl-2">
                                    <Switch
                                        checked={realTimeSalesAlerts}
                                        onCheckedChange={onChangeRealTimeSalesAlerts}
                                        className="data-[state=checked]:bg-emerald-500"
                                        disabled={isOffline}
                                    />
                                </div>
                            </div>

                            <div className={`p-5 rounded-[2rem] border transition-all duration-300 flex items-start gap-4 ${
                                pushMarketingEnabled 
                                    ? 'bg-purple-500/5 border-purple-500/20 shadow-[0_0_20px_rgba(168,85,247,0.05)]' 
                                    : 'bg-white/5 border-white/5 hover:border-white/10'
                            }`}>
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                    pushMarketingEnabled 
                                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.15)]' 
                                        : 'bg-zinc-950/80 border-white/5 text-zinc-500'
                                }`}>
                                    <Megaphone className="w-5 h-5" />
                                </div>
                                <div className="flex-1 space-y-2 text-left">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-black text-white uppercase tracking-wider">Push Marketing Automation</span>
                                        <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                            pushMarketingEnabled 
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
                                        <span className={`w-1.5 h-1.5 rounded-full ${pushMarketingEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                            {pushMarketingEnabled ? 'Habilitado e ativo no app' : 'Desativado'}
                                        </span>
                                    </div>
                                </div>
                                <div className="self-center pl-2">
                                    <Switch
                                        checked={pushMarketingEnabled}
                                        onCheckedChange={onChangePushMarketingEnabled}
                                        className="data-[state=checked]:bg-purple-500"
                                        disabled={isOffline}
                                    />
                                </div>
                            </div>
                            
                            <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/5 blur-[80px] rounded-full" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

// ==========================================
// Shortcuts Section (Memoized)
// ==========================================
const ShortcutsSection = memo(function ShortcutsSection({
    onNavigate
}: {
    onNavigate: (view: View) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
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
                        isOpen ? 'rotate-180 text-admin-gold' : ''
                    }`}
                />
            </button>

            <div
                className={`grid transition-all duration-300 ease-in-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
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
                                    <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mt-1">Gerir Feedbacks</span>
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
                                    <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mt-1">Dúvidas de Clientes</span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export const AdminSettingsView = memo(function AdminSettingsView({ onNavigate, active, onSetDirty }: Readonly<AdminSettingsViewProps>) {
    const { config, isLoaded, updateConfig, refresh } = useStore();
    const isOffline = useOnlineStatus();
    const [formData, setFormData] = useState(config);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const hasInitialSyncRef = useRef(false);

    const onChangeFreeShippingMin = useCallback((val: number) => {
        setFormData(prev => ({ ...prev, freeShippingMin: val }));
    }, []);

    const onChangeShippingFee = useCallback((val: number) => {
        setFormData(prev => ({ ...prev, shippingFee: val }));
    }, []);

    const onChangeWhatsappNumber = useCallback((val: string) => {
        setFormData(prev => ({ ...prev, whatsappNumber: val }));
    }, []);

    const onChangeBusinessHours = useCallback((val: string) => {
        setFormData(prev => ({ ...prev, businessHours: val }));
    }, []);

    const onChangeShareText = useCallback((val: string) => {
        setFormData(prev => ({ ...prev, shareText: val }));
    }, []);

    const onChangeEnableReviews = useCallback((val: boolean) => {
        setFormData(prev => ({ ...prev, enableReviews: val }));
    }, []);

    const onChangeEnableCoupons = useCallback((val: boolean) => {
        setFormData(prev => ({ ...prev, enableCoupons: val }));
    }, []);

    const onChangeRealTimeSalesAlerts = useCallback((val: boolean) => {
        setFormData(prev => ({ ...prev, realTimeSalesAlerts: val }));
    }, []);

    const onChangePushMarketingEnabled = useCallback((val: boolean) => {
        setFormData(prev => ({ ...prev, pushMarketingEnabled: val }));
    }, []);

    useEffect(() => {
        if (isLoaded && config) {
            if (!hasInitialSyncRef.current) {
                setFormData(config);
                hasInitialSyncRef.current = true;
            } else {
                setFormData(prev => {
                    if (!prev) return config;
                    const isFormDirty = Object.keys(config).some(
                        (key) => (config as any)[key] !== (prev as any)[key]
                    );
                    return isFormDirty ? prev : config;
                });
            }
        }
    }, [config, isLoaded]);

    useEffect(() => {
        if (active) {
            refresh({ onlyConfig: true });
        }
    }, [active, refresh]);

    useEffect(() => {
        if (!onSetDirty || !config || !formData) return;
        const isDirty = Object.keys(config).some(
            (key) => (config as any)[key] !== (formData as any)[key]
        );
        onSetDirty(isDirty);
        return () => {
            onSetDirty(false);
        };
    }, [formData, config, onSetDirty]);

    const handleSubmit = async () => {
        if (isOffline) {
            toast.error('Sem conexão com a internet', {
                description: 'Você precisa estar online para salvar as configurações do marketplace.'
            });
            return;
        }
        if (isSaving) return;

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

        setIsSaving(true);
        try {
            await updateConfig(sanitizedFormData);
            onSetDirty?.(false);
        } catch (err) {
            console.error('[AdminSettingsView] Error updating config:', err);
        } finally {
            setIsSaving(false);
        }
    };

    // Removed early return loading block to prevent visual layout shifts

    return (
        <div className="h-auto bg-admin-bg pb-28 lg:pb-8 animate-in fade-in duration-200">
            {/* Elite Header */}
            <div className="sticky top-0 z-30 bg-[#09090b]/90 backdrop-blur-md border-b border-white/5 py-4 px-6 mb-4">
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
                        disabled={!isLoaded || isOffline || isSaving}
                        className="h-11 px-4 sm:px-6 bg-admin-gold text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-[0_0_30px_rgba(212,175,55,0.2)] hover:shadow-[0_0_40px_rgba(212,175,55,0.3)] hover:bg-admin-gold/90 transition-all active:scale-95 flex items-center gap-2 sm:gap-3 shrink-0 disabled:opacity-50 disabled:grayscale disabled:pointer-events-none"
                    >
                        {isSaving ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>Salvando...</span>
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                <span>Salvar<span className="hidden sm:inline"> Alterações</span></span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="px-4 space-y-6 max-w-2xl mx-auto pb-10">
                {isOffline && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-center gap-3 text-xs font-bold uppercase tracking-wider animate-in fade-in slide-in-from-top-2 duration-300 select-none">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 animate-pulse" />
                        <span>Você está offline. O salvamento das configurações está desabilitado até restabelecer a rede.</span>
                    </div>
                )}

                {!isLoaded ? (
                    <div className="space-y-6 animate-pulse mt-4">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="p-6 rounded-[2rem] bg-zinc-900/30 border border-white/5 flex flex-col justify-between h-20">
                                <Skeleton className="h-4 w-1/3 bg-white/5 rounded-md" />
                                <Skeleton className="h-3 w-1/2 bg-white/5 rounded-md" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <>
                        <LogisticsSection
                            freeShippingMin={formData.freeShippingMin}
                            shippingFee={formData.shippingFee}
                            isOffline={isOffline}
                            onChangeFreeShippingMin={onChangeFreeShippingMin}
                            onChangeShippingFee={onChangeShippingFee}
                        />

                        <SupportSection
                            whatsappNumber={formData.whatsappNumber}
                            businessHours={formData.businessHours}
                            shareText={formData.shareText}
                            isOffline={isOffline}
                            onChangeWhatsappNumber={onChangeWhatsappNumber}
                            onChangeBusinessHours={onChangeBusinessHours}
                            onChangeShareText={onChangeShareText}
                        />

                        <ModulesSection
                            enableReviews={formData.enableReviews}
                            enableCoupons={formData.enableCoupons}
                            isOffline={isOffline}
                            onChangeEnableReviews={onChangeEnableReviews}
                            onChangeEnableCoupons={onChangeEnableCoupons}
                        />

                        <NotificationsSection
                            realTimeSalesAlerts={formData.realTimeSalesAlerts ?? true}
                            pushMarketingEnabled={formData.pushMarketingEnabled ?? false}
                            isOffline={isOffline}
                            onChangeRealTimeSalesAlerts={onChangeRealTimeSalesAlerts}
                            onChangePushMarketingEnabled={onChangePushMarketingEnabled}
                        />

                        <ShortcutsSection onNavigate={onNavigate} />
                    </>
                )}
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



