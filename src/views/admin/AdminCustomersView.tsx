import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { View } from '@/types';
import {
    Users,
    Search,
    Mail,
    Phone,
    Calendar,
    MoreHorizontal,
    Shield,
    ArrowUpDown,
    Filter,
    ArrowLeft,
    TrendingUp,
    ShoppingBag,
    Wallet,
    Zap,
    RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';

interface Customer {
    id: string;
    email: string | null;
    full_name: string | null;
    phone: string | null;
    role: string;
    created_at: string;
    orders_count?: number;
    total_spent?: number;
    last_order_date?: string;
    avatar_url?: string;
    is_push_subscribed?: boolean;
}

interface AdminCustomersViewProps {
    onNavigate: (view: View, id?: string) => void;
}

export function AdminCustomersView({ onNavigate }: Readonly<AdminCustomersViewProps>) {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortField, setSortField] = useState<keyof Customer>('created_at');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [totalCustomers, setTotalCustomers] = useState(0);
    const [globalStats, setGlobalStats] = useState<{
        total_customers: number;
        global_ltv: number;
        global_orders: number;
        new_customers_30d: number;
    } | null>(null);
    const [page, setPage] = useState(0);
    const PAGE_SIZE = 10;

    const fetchCustomers = useCallback(async () => {
        try {
            setLoading(true);

            const { data, error } = await (supabase.rpc as any)('get_admin_customers_paged', {
                p_search: searchTerm,
                p_sort_field: sortField,
                p_sort_direction: sortDirection,
                p_page: page,
                p_page_size: PAGE_SIZE
            });

            if (error) throw error;

            if (data) {
                setCustomers(data.data || []);
                setTotalCustomers(data.total_count || 0);
                setGlobalStats(data.stats);
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
            toast.error('Erro ao carregar clientes');
        } finally {
            setLoading(false);
        }
    }, [searchTerm, sortField, sortDirection, page]);

    useEffect(() => {
        // Debounce search
        const handler = setTimeout(() => {
            fetchCustomers();
        }, 300);
        return () => clearTimeout(handler);
    }, [fetchCustomers]);


    const totalPages = Math.ceil(totalCustomers / PAGE_SIZE);
    const paginatedCustomers = customers; // Already paginated from server

    const handleSort = (field: keyof Customer) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center p-10">
                <div className="w-12 h-12 border-2 border-zinc-800 border-t-admin-gold rounded-full animate-spin mb-6 shadow-[0_0_15px_rgba(255,191,0,0.3)]" />
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] animate-pulse">Sincronizando Base de Clientes...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white selection:bg-admin-gold/30 pb-32">
            {/* Header */}
            <div className="px-4 sm:px-8 pt-6 pb-2 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-white tracking-tighter flex items-center gap-3 group">
                        <div className="w-10 h-10 rounded-xl bg-zinc-950 flex items-center justify-center shadow-[0_0_20px_rgba(212,175,55,0.15)] border border-white/5 group-hover:scale-110 group-hover:border-admin-gold/50 transition-all">
                            <Users className="w-5 h-5 text-admin-gold" />
                        </div>
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-zinc-500">
                            Clientes
                        </span>
                    </h1>
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em] mt-2 pl-[3.25rem]">
                        Gestão da Base <span className="text-admin-gold">({totalCustomers} Perfis)</span>
                    </p>
                </div>
            </div>
            <main className="max-w-7xl mx-auto mt-6 pb-10 sm:px-6 space-y-10">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                    {[
                        { label: 'Total Clientes', value: globalStats?.total_customers || 0, icon: Users, accent: 'var(--admin-gold)' },
                        { label: 'Novos (30d)', value: globalStats?.new_customers_30d || 0, icon: TrendingUp, accent: '#10b981' },
                        { label: 'Ticket Médio', value: `R$ ${((globalStats?.global_ltv || 0) / (globalStats?.total_customers || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Wallet, accent: '#3b82f6' },
                        { label: 'Pedidos Totais', value: globalStats?.global_orders || 0, icon: ShoppingBag, accent: '#f59e0b' }
                    ].map((stat) => (
                        <div key={stat.label} className="bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] shadow-2xl relative group hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.05)] transition-all duration-500" style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-white/5 shadow-inner bg-zinc-950" style={{ color: stat.accent }}>
                                    <stat.icon className="w-4 h-4 flex-shrink-0" />
                                </div>
                                <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 leading-tight">
                                    {stat.label}
                                </p>
                            </div>
                            <div className="flex items-baseline gap-2 relative z-10">
                                <h3 className="text-xl sm:text-2xl font-black tracking-tighter text-white leading-none whitespace-nowrap">
                                    {stat.value}
                                </h3>
                            </div>
                        </div>
                    ))}
                </div>
                {/* Unified Control & Data Block */}
                <div className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/50 sm:rounded-[3rem] shadow-2xl overflow-hidden relative flex flex-col">
                    {/* Control Bar (Topo) */}
                    <div className="p-6 sm:px-8 border-b border-zinc-800/50 flex flex-col md:flex-row md:items-center gap-6 relative z-20 bg-zinc-950/30">
                        <div className="flex items-center gap-4 w-full flex-1">
                            <div className="relative group w-full">
                                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                    <Search className="h-5 w-5 text-zinc-600 group-focus-within:text-admin-gold transition-colors" />
                                </div>
                                <Input
                                    type="text"
                                    placeholder="Buscar cliente premium..."
                                    className="pl-14 h-14 rounded-2xl border-zinc-800 bg-black/40 text-white placeholder:text-zinc-600 focus:ring-admin-gold/20 focus:border-admin-gold/50 transition-all font-bold text-sm w-full"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    autoComplete="off"
                                />
                            </div>
                            <Button variant="outline" size="icon" className="h-14 w-14 rounded-2xl border-zinc-800 bg-zinc-900/60 hover:border-admin-gold/50 group transition-all shrink-0">
                                <Filter className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => fetchCustomers()}
                                className="h-14 w-14 rounded-2xl border-zinc-800 bg-zinc-900/50 hover:bg-admin-gold hover:border-admin-gold group transition-all shrink-0"
                            >
                                <RefreshCw className="w-5 h-5 text-zinc-500 group-hover:text-black transition-colors" />
                            </Button>
                        </div>
                    </div>

                    {/* Data List (Responsive Grid/Cards) */}
                    <div className="relative group/table w-full p-2 sm:p-0">
                        {/* Glow Decoration */}
                        <div className="absolute -top-24 -left-24 w-48 h-48 bg-admin-gold/5 blur-[100px] pointer-events-none" />

                        <div className="relative z-10 flex flex-col w-full">
                            {/* Desktop Headers */}
                            <div className="hidden md:grid grid-cols-12 gap-4 px-8 py-5 border-b border-zinc-800/50 bg-zinc-900/60 sticky top-0 z-20 shadow-sm">
                                <div className="col-span-4 flex items-center gap-2 cursor-pointer group/th" onClick={() => handleSort('full_name')}>
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 group-hover/th:text-admin-gold transition-colors">Cliente</span>
                                    <ArrowUpDown className="w-3 h-3 text-zinc-600 group-hover/th:text-admin-gold group-hover/th:translate-y-0.5 transition-all" />
                                </div>
                                <div className="col-span-3 flex items-center gap-2 cursor-pointer group/th" onClick={() => handleSort('role')}>
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 group-hover/th:text-admin-gold transition-colors">Contato / Role</span>
                                    <ArrowUpDown className="w-3 h-3 text-zinc-600 group-hover/th:text-admin-gold group-hover/th:translate-y-0.5 transition-all" />
                                </div>
                                <div className="col-span-2 flex items-center gap-2 cursor-pointer group/th justify-end" onClick={() => handleSort('total_spent')}>
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 group-hover/th:text-admin-gold transition-colors">LTV (Gasto)</span>
                                    <ArrowUpDown className="w-3 h-3 text-zinc-600 group-hover/th:text-admin-gold group-hover/th:translate-y-0.5 transition-all" />
                                </div>
                                <div className="col-span-1 flex items-center gap-2 cursor-pointer group/th justify-center" onClick={() => handleSort('orders_count')}>
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 group-hover/th:text-admin-gold transition-colors">Pedidos</span>
                                </div>
                                <div className="col-span-2 flex items-center justify-end">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Gestão</span>
                                </div>
                            </div>

                            {/* Data Rows */}
                            <div className="flex flex-col gap-4 p-4 md:p-0 md:gap-0 divide-y-0 md:divide-y divide-zinc-800/30">
                                {paginatedCustomers.length === 0 ? (
                                    <div className="py-24 text-center">
                                        <div className="flex flex-col items-center justify-center text-zinc-600">
                                            <div className="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6 shadow-inner">
                                                <Users className="w-8 h-8 opacity-20" />
                                            </div>
                                            <p className="text-sm font-bold uppercase tracking-widest text-zinc-500">Nenhum cliente retornado</p>
                                            <p className="text-[10px] text-zinc-600 mt-2">Revise os filtros ou sua pesquisa.</p>
                                        </div>
                                    </div>
                                ) : (
                                    paginatedCustomers.map((customer) => (
                                        <div
                                            key={customer.id}
                                            className="group bg-zinc-900/30 md:bg-transparent border border-zinc-800/50 md:border-transparent rounded-[1.5rem] md:rounded-none p-5 md:px-8 md:py-6 flex flex-col md:grid md:grid-cols-12 md:items-center gap-5 md:gap-4 hover:bg-zinc-800/20 md:hover:bg-zinc-800/30 transition-all cursor-pointer relative overflow-hidden shadow-xl md:shadow-none min-h-[120px]"
                                            onClick={() => onNavigate('admin-user-detail', customer.id)}
                                        >
                                            {/* Column 1: Client Info (md:col-span-4) */}
                                            <div className="flex items-center gap-4 md:col-span-4 pr-10 md:pr-0">
                                                <div className="relative group-hover:scale-105 transition-transform duration-300 shrink-0">
                                                    <Avatar className="h-12 w-12 sm:h-14 sm:w-14 border-2 border-zinc-800/60 group-hover:border-admin-gold/50 transition-colors shadow-2xl">
                                                        <AvatarImage src={customer.avatar_url} className="object-cover" />
                                                        <AvatarFallback className="bg-zinc-950 text-zinc-400 font-black text-xs border border-zinc-800/50">
                                                            {customer.full_name?.substring(0, 2).toUpperCase() || 'CX'}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    {customer.is_push_subscribed && (
                                                        <div className="absolute -bottom-1 -right-1 w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-br from-admin-gold to-yellow-600 rounded-full flex items-center justify-center border-2 border-black shadow-[0_0_15px_rgba(255,191,0,0.4)]">
                                                            <Zap className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-black fill-black" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex flex-col justify-center min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h4 className="text-sm sm:text-base font-black text-white leading-none truncate group-hover:text-admin-gold transition-colors">
                                                            {customer.full_name || 'Usuário'}
                                                        </h4>
                                                        <Badge className={`px-2 py-0.5 rounded-md text-[8px] sm:text-[9px] font-black tracking-widest uppercase border ${customer.role === 'admin'
                                                            ? 'bg-admin-gold text-black border-admin-gold/50'
                                                            : 'bg-zinc-950 text-zinc-500 border-zinc-800/80 shadow-inner'
                                                            }`}>
                                                            {customer.role === 'admin' && <Shield className="w-2.5 h-2.5 mr-1 hidden md:block inline-flex" />}
                                                            {customer.role}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <span className="text-[10px] font-bold text-zinc-600 font-mono tracking-widest bg-black/20 px-1.5 py-0.5 rounded border border-white/5">
                                                            #{customer.id.slice(0, 8).toUpperCase()}
                                                        </span>
                                                        <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest md:hidden whitespace-nowrap overflow-hidden text-ellipsis">
                                                            Desde {new Date(customer.created_at).toLocaleDateString('pt-BR')}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Column 2: Contact Info (md:col-span-3) */}
                                            <div className="flex flex-col gap-2.5 md:col-span-3 overflow-hidden">
                                                <div className="flex items-center gap-3 w-full">
                                                    <div className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded-[0.6rem] bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-center shadow-inner group-hover:border-admin-gold/30 group-hover:text-admin-gold text-zinc-500 transition-colors">
                                                        <Mail className="w-3.5 h-3.5" />
                                                    </div>
                                                    <span className="text-[11px] sm:text-xs font-semibold text-zinc-300 truncate tracking-wide">
                                                        {customer.email || 'N/A'}
                                                    </span>
                                                </div>
                                                {customer.phone && (
                                                    <div className="flex items-center gap-3 w-full">
                                                        <div className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded-[0.6rem] bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-center shadow-inner group-hover:border-admin-gold/30 group-hover:text-admin-gold text-zinc-500 transition-colors">
                                                            <Phone className="w-3.5 h-3.5" />
                                                        </div>
                                                        <span className="text-[11px] sm:text-xs font-semibold text-zinc-400 truncate tracking-wider">
                                                            {customer.phone}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Quick Mobile Stats Divider */}
                                            <div className="h-px w-full bg-gradient-to-r from-transparent via-zinc-800/80 to-transparent md:hidden mt-1 mb-1" />

                                            {/* Columns 3 & 4: Mobile Grid Stats footer OR Desktop LTV/Orders */}
                                            <div className="grid grid-cols-2 md:col-span-3 md:flex gap-4 md:items-center justify-between md:justify-end">
                                                {/* Desktop: LTV | Mobile: Col 1 */}
                                                <div className="flex flex-col items-start md:items-end gap-1.5 md:w-full">
                                                    <span className="text-zinc-600 text-[8px] font-black uppercase tracking-[0.2em] md:hidden">LTV Total</span>
                                                    <div className="text-sm xl:text-base font-black text-white px-3 py-2 rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800/80 shadow-inner group-hover:border-admin-gold/30 transition-colors flex items-center gap-1.5 min-w-[100px] md:min-w-[0px]">
                                                        <span className="text-[10px] text-zinc-500 leading-none">R$</span>
                                                        <span className="leading-none">{Number(customer.total_spent || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                                    </div>
                                                </div>

                                                {/* Desktop: Orders | Mobile: Col 2 */}
                                                <div className="flex flex-col items-end md:items-center gap-1.5">
                                                    <span className="text-zinc-600 text-[8px] font-black uppercase tracking-[0.2em] md:hidden text-right">Pedidos</span>
                                                    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-[0.8rem] bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800/80 flex items-center justify-center shadow-inner group-hover:border-admin-gold/50 group-hover:text-admin-gold group-hover:bg-black transition-colors shrink-0">
                                                        <span className="text-xs sm:text-sm font-black text-white">{customer.orders_count || 0}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Column 5: Desktop Date (hidden on mobile, inline above) */}
                                            <div className="hidden md:flex flex-col items-end gap-1.5 md:col-span-1">
                                                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest bg-zinc-950/80 px-2.5 py-1.5 flex items-center justify-center rounded-lg border border-zinc-800/80 whitespace-nowrap overflow-hidden text-ellipsis w-full shadow-inner" title={customer.last_order_date ? new Date(customer.last_order_date).toLocaleDateString() : 'Nenhuma'}>
                                                    <Calendar className="w-3 h-3 mr-1.5 text-admin-gold/50 shrink-0" />
                                                    {customer.last_order_date ? new Date(customer.last_order_date).toLocaleDateString() : '--'}
                                                </div>
                                            </div>

                                            {/* Column 6: Management Options */}
                                            <div className="absolute top-4 right-4 md:relative md:top-auto md:right-auto md:col-span-1 flex justify-end">
                                                <div onClick={(e) => e.stopPropagation()}>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-12 sm:w-12 md:h-10 md:w-10 rounded-[0.8rem] bg-zinc-950/80 md:bg-zinc-900/50 backdrop-blur-md border border-zinc-800/80 hover:bg-admin-gold hover:border-admin-gold text-zinc-400 hover:text-white transition-all shadow-xl md:shadow-none group-hover:border-zinc-700">
                                                                <MoreHorizontal className="w-5 h-5 flex-shrink-0" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="w-[200px] rounded-2xl border-zinc-800 bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-2 z-[100]">
                                                            <DropdownMenuLabel className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 p-3">Gestão de Cliente</DropdownMenuLabel>
                                                            <DropdownMenuSeparator className="bg-zinc-800/50" />
                                                            <DropdownMenuItem
                                                                className="rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer focus:bg-admin-gold focus:text-black p-3 transition-colors"
                                                                onClick={() => onNavigate('admin-user-detail', customer.id)}
                                                            >
                                                                <Shield className="w-3.5 h-3.5 mr-2 opacity-70" />
                                                                Ver Perfil Elite
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                className="rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer focus:bg-admin-gold focus:text-black p-3 transition-colors"
                                                                onClick={() => onNavigate('admin-push')}
                                                            >
                                                                <Zap className="w-3.5 h-3.5 mr-2 opacity-70" />
                                                                Notificação Push
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator className="bg-zinc-800/50" />
                                                            <DropdownMenuItem className="rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer text-red-500 focus:bg-red-500 focus:text-white p-3 transition-colors hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]">
                                                                Congelar Acesso
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between px-8 py-5 border-t border-zinc-800/50 bg-zinc-900/60 relative z-10">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setPage(prev => Math.max(0, prev - 1))}
                                disabled={page === 0}
                                className="h-10 w-10 rounded-xl border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-admin-gold/50 disabled:opacity-30"
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                                Segmento <span className="text-admin-gold">{page + 1}</span> de <span className="text-white">{totalPages}</span>
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setPage(prev => Math.min(totalPages - 1, prev + 1))}
                                disabled={page === totalPages - 1}
                                className="h-10 w-10 rounded-xl border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-admin-gold/50 disabled:opacity-30"
                            >
                                <ArrowLeft className="h-4 w-4 rotate-180" />
                            </Button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
