import { useEffect, useMemo } from 'react';
import {
    User,
    Settings,
    LogOut,
    ChevronRight,
    Package,
    MapPin,
    ArrowRight,
    Plus,
    Shield,
    Loader2,
    TrendingUp,
    RefreshCw
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAddresses } from '@/hooks/useAddresses';
import type { View, Product } from '@/types';
import { RecentlyViewedStrip } from '@/components/ui/custom/RecentlyViewedStrip';
import { AddressList } from '@/components/ui/custom/AddressList';
import { Button } from '@/components/ui/button';
import { useOrders } from '@/hooks/useOrders';
import { OrderTimeline } from '@/components/ui/custom/OrderTimeline';
import { ProfileSkeleton } from '@/components/ui/custom/Skeletons';

// Novas importações de refatoração Solo-Ninja

import { useReorder } from '@/hooks/useReorder';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';

interface ProfileViewProps {
    onNavigate: (view: View, id?: string) => void;
    recentlyViewedProducts?: Product[];
    onProductClick?: (productId: string) => void;
}

export function ProfileView({ onNavigate, recentlyViewedProducts = [], onProductClick = () => { } }: ProfileViewProps) {
    const { user, profile, logout, isAdmin, loading: authLoading } = useAuth();
    const { addresses, fetchAddresses, deleteAddress, loading: addressesLoading } = useAddresses();
    const { orders } = useOrders(true, false);
    const { handleReorder, isReordering } = useReorder(); // Solo-ninja hook
    const { performNuclearPurge } = useUpdateCheck();

    useEffect(() => {
        if (user) {
            fetchAddresses();
        } else if (!authLoading) {
            onNavigate('auth');
        }
    }, [user, fetchAddresses, authLoading, onNavigate]);

    const activeOrders = useMemo(() => {
        return orders.filter(o => ['new', 'processing', 'shipping'].includes(o.status));
    }, [orders]);

    if (authLoading) {
        return <ProfileSkeleton />;
    }

    if (!user) {
        return null;
    }

    return (
        <div className="min-h-full pb-24 bg-gradient-to-b from-white to-zinc-50/50">
            <div className="max-w-md mx-auto px-4 py-6 space-y-6">
                {/* Header Info */}
                <div className="flex flex-col items-center justify-center py-4">
                    <div className="relative group">
                        <div className="w-24 h-24 rounded-[24px] flex items-center justify-center mb-4 border-4 shadow-premium overflow-hidden transition-all duration-700 group-hover:scale-105 bg-white border-white">
                            <User className="w-12 h-12 text-zinc-300" />
                        </div>
                    </div>
                    <h1 className="text-3xl font-black tracking-tighter leading-none transition-all duration-500 text-zinc-900">
                        {profile?.full_name || user.user_metadata?.name || user.email?.split('@')[0]}
                    </h1>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] mt-3 transition-colors opacity-60 text-zinc-400">
                        {user.email}
                    </p>


                    {isAdmin && (
                        <div className="mt-6 w-full p-4 rounded-[1.5rem] border animate-in slide-in-from-top-4 duration-1000 bg-zinc-900 text-white border-zinc-800">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/10 text-white">
                                        <Settings className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-white">Modo Admin</p>
                                        <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-tighter">Painel de Controle Ativo</p>
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    onClick={() => onNavigate('admin-dashboard')}
                                    className="rounded-full text-[9px] font-black uppercase tracking-widest px-4 h-9 transition-all active:scale-95 bg-white text-zinc-900 hover:bg-zinc-100"
                                >
                                    Acessar Painel
                                </Button>
                            </div>
                        </div>
                    )}
                </div>


                {/* Recently Viewed Strip */}
                <div className="-mx-4">
                    <RecentlyViewedStrip
                        products={recentlyViewedProducts}
                        onProductClick={onProductClick}
                        onNavigate={onNavigate}
                    />
                </div>

                {/* Account Settings Menu Item */}
                <div className="bg-white rounded-[2.5rem] border border-zinc-100 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <button
                        onClick={() => onNavigate('account-settings')}
                        className="w-full p-6 flex items-center justify-between hover:bg-zinc-50 transition-colors group"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-zinc-900 rounded-2xl flex items-center justify-center shadow-lg shadow-zinc-200 group-hover:bg-black transition-colors">
                                <Shield className="w-5 h-5 text-white" />
                            </div>
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-900">Segurança e Conta</p>
                                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-tighter">Alterar senha e dados pessoais</p>
                            </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>

                {/* Delivery Addresses */}
                <div className="bg-white rounded-[2.5rem] border border-zinc-100 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                    <div className="p-6 border-b border-zinc-50 bg-zinc-50/50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-zinc-400" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Endereços de Entrega</span>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onNavigate('address-form')}
                            className="h-8 rounded-full bg-white hover:bg-zinc-100 text-[9px] font-black uppercase tracking-widest px-4 border border-zinc-100"
                        >
                            <Plus className="w-3 h-3 mr-1" />
                            Novo
                        </Button>
                    </div>
                    <div className="p-6">
                        {addressesLoading ? (
                            <div className="flex justify-center py-4">
                                <Loader2 className="w-6 h-6 animate-spin text-zinc-300" />
                            </div>
                        ) : (
                            <AddressList
                                addresses={addresses}
                                onEdit={(addr) => {
                                    onNavigate('address-form', addr.id);
                                }}
                                onDelete={deleteAddress}
                            />
                        )}
                    </div>
                </div>

                {/* Active Orders */}
                {activeOrders.length > 0 && (
                    <div className="bg-white rounded-[2.5rem] border border-zinc-100 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
                        <div className="p-6 border-b border-zinc-50 bg-zinc-50/50 flex items-center gap-3">
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Pedidos em Andamento</span>
                        </div>
                        <div className="p-6 space-y-6">
                            {activeOrders.map(order => (
                                <div key={order.id} className="space-y-4">
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                                        <span className="text-zinc-900">ID #{order.id.slice(0, 8)}</span>
                                        <span className="text-zinc-400">{new Date(order.createdAt).toLocaleDateString('pt-BR')}</span>
                                    </div>
                                    <OrderTimeline status={order.status} />
                                    <div className="flex gap-2 pt-2">
                                        <Button
                                            variant="outline"
                                            onClick={() => onNavigate('orders')}
                                            className="flex-1 h-12 rounded-2xl border-2 text-[10px] font-black uppercase tracking-widest group"
                                        >
                                            Ver Status
                                            <ArrowRight className="w-3 h-3 ml-2 group-hover:translate-x-1 transition-transform" />
                                        </Button>
                                        <Button
                                            onClick={() => handleReorder(order, onNavigate)}
                                            disabled={isReordering}
                                            className="flex-1 h-12 bg-zinc-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-black transition-all"
                                        >
                                            {isReordering ? (
                                                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                                            ) : (
                                                <TrendingUp className="w-3 h-3 mr-2" />
                                            )}
                                            {isReordering ? 'Processando' : 'Repetir'}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Order History & Menu */}
                <div className="bg-white rounded-[2.5rem] border border-zinc-100 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
                    <button
                        onClick={() => onNavigate('orders')}
                        className="w-full p-6 flex items-center justify-between border-b border-zinc-50 hover:bg-zinc-50 transition-colors group"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-zinc-50 rounded-2xl flex items-center justify-center group-hover:bg-white transition-colors">
                                <Package className="w-5 h-5 text-zinc-400" />
                            </div>
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-900">Histórico de Pedidos</p>
                                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-tighter">Ver todos os seus pedidos</p>
                            </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:translate-x-1 transition-transform" />
                    </button>

                    <button
                        onClick={() => {
                            if (confirm('Deseja limpar o cache e sincronizar a versão mais recente? O app será reiniciado.')) {
                                performNuclearPurge(true);
                            }
                        }}
                        className="w-full p-6 flex items-center justify-between border-b border-zinc-50 hover:bg-emerald-50 transition-colors group"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-emerald-50 rounded-2xl flex items-center justify-center group-hover:bg-white transition-colors">
                                <RefreshCw className="w-5 h-5 text-emerald-500" />
                            </div>
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Sincronizar App</p>
                                <p className="text-[9px] font-bold text-emerald-400 uppercase tracking-tighter">Forçar atualização e limpar cache</p>
                            </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-emerald-200 group-hover:translate-x-1 transition-transform" />
                    </button>

                    <button
                        onClick={logout}
                        className="w-full p-6 flex items-center justify-between hover:bg-red-50 transition-colors group"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-red-50 rounded-2xl flex items-center justify-center group-hover:bg-white transition-colors">
                                <LogOut className="w-5 h-5 text-red-500" />
                            </div>
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Encerrar Sessão</p>
                                <p className="text-[9px] font-bold text-red-400 uppercase tracking-tighter">Sair da sua conta premium</p>
                            </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-red-200 group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
            </div>
        </div>
    );
}

