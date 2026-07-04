import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
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
    RefreshCw,
    HelpCircle,
    LayoutGrid,
    List,
    Snowflake,
    Loader2
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
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { AdminKpiCarousel, type KpiCardConfig } from '@/components/admin/AdminKpiCarousel';
import { LocalErrorBoundary } from '@/components/ui/custom/LocalErrorBoundary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

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
    active?: boolean;
}

export const AdminCustomersView = memo(function AdminCustomersView({ onNavigate, active }: Readonly<AdminCustomersViewProps>) {
    const isOffline = useOnlineStatus();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 400);
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

    const [viewMode, setViewMode] = useState<'detailed' | 'compact'>(() => {
        const saved = localStorage.getItem('admin_customers_view_mode');
        return (saved === 'detailed' || saved === 'compact') ? saved : 'compact';
    });

    useEffect(() => {
        localStorage.setItem('admin_customers_view_mode', viewMode);
    }, [viewMode]);

    const fetchCustomers = useCallback(async (pageToFetch: number) => {
        try {
            setLoading(true);

            const { data, error } = await (supabase.rpc as any)('get_admin_customers_paged', {
                p_search: debouncedSearchTerm,
                p_sort_field: sortField,
                p_sort_direction: sortDirection,
                p_page: pageToFetch,
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
    }, [debouncedSearchTerm, sortField, sortDirection, PAGE_SIZE]);

    const prevSearch = useRef(debouncedSearchTerm);
    const prevSortField = useRef(sortField);
    const prevSortDirection = useRef(sortDirection);

    useEffect(() => {
        if (!active) return;

        const filtersChanged = 
            prevSearch.current !== debouncedSearchTerm ||
            prevSortField.current !== sortField ||
            prevSortDirection.current !== sortDirection;

        prevSearch.current = debouncedSearchTerm;
        prevSortField.current = sortField;
        prevSortDirection.current = sortDirection;

        let pageToFetch = page;
        if (filtersChanged) {
            pageToFetch = 0;
            if (page !== 0) {
                setPage(0);
                return;
            }
        }

        fetchCustomers(pageToFetch);
    }, [debouncedSearchTerm, sortField, sortDirection, page, active, fetchCustomers]);

    const kpiCards = useMemo<readonly KpiCardConfig[]>(() => [
        { label: 'Total Clientes', value: globalStats?.total_customers || 0, icon: Users, accent: 'text-admin-gold', subValue: 'Base de Clientes' },
        { label: 'Novos (30d)', value: globalStats?.new_customers_30d || 0, icon: TrendingUp, accent: 'text-emerald-500', subValue: 'Crescimento' },
        { label: 'Ticket Médio', value: `R$ ${((globalStats?.global_ltv || 0) / (globalStats?.total_customers || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Wallet, accent: 'text-blue-500', subValue: 'Consumo Médio' },
        { label: 'Pedidos Totais', value: globalStats?.global_orders || 0, icon: ShoppingBag, accent: 'text-amber-500', subValue: 'Pedidos' }
    ], [globalStats]);

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
    const renderDetailedSkeletons = () => {
        return (
            <div className="flex flex-col gap-4 p-4 md:p-0 md:gap-0 divide-y-0 md:divide-y divide-zinc-800/30">
                {Array.from({ length: 10 }).map((_, i) => (
                    <div
                        key={i}
                        className="group bg-zinc-900/30 md:bg-transparent border border-zinc-800/50 md:border-transparent rounded-[1.5rem] md:rounded-none p-5 md:px-8 md:py-6 flex flex-col md:grid md:grid-cols-12 md:items-center gap-5 md:gap-4 animate-pulse relative min-h-[120px]"
                    >
                        <div className="flex items-center gap-4 md:col-span-4 pr-10 md:pr-0">
                            <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-zinc-850 shrink-0" />
                            <div className="flex-1 flex flex-col gap-2 min-w-0">
                                <div className="h-4 w-2/3 bg-zinc-850 rounded" />
                                <div className="h-3 w-1/3 bg-zinc-850 rounded" />
                            </div>
                        </div>
                        <div className="flex flex-col gap-2 md:col-span-3">
                            <div className="h-3.5 w-3/4 bg-zinc-850 rounded" />
                            <div className="h-3.5 w-1/2 bg-zinc-850 rounded" />
                        </div>
                        <div className="grid grid-cols-2 md:col-span-3 md:flex gap-4 md:items-center justify-between md:justify-end">
                            <div className="h-9 w-24 bg-zinc-850 rounded-xl" />
                            <div className="h-10 w-10 bg-zinc-850 rounded-[0.8rem]" />
                        </div>
                        <div className="hidden md:flex flex-col items-end gap-1.5 md:col-span-1">
                            <div className="h-8 w-20 bg-zinc-850 rounded-lg" />
                        </div>
                        <div className="absolute top-4 right-4 md:relative md:top-auto md:right-auto md:col-span-1 flex justify-end">
                            <div className="h-10 w-10 bg-zinc-850 rounded-[0.8rem]" />
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderCompactSkeletons = () => {
        return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-3 sm:p-4 md:p-6">
                {Array.from({ length: 10 }).map((_, i) => (
                    <div
                        key={i}
                        className="group relative bg-zinc-950/40 backdrop-blur-md border border-white/5 rounded-[1.5rem] p-3.5 sm:p-5 min-h-[170px] flex flex-col justify-between animate-pulse"
                    >
                        <div className="flex flex-col w-full h-full">
                            <div className="flex justify-between items-start w-full relative">
                                <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-zinc-850 shrink-0" />
                                <div className="h-11 w-11 bg-zinc-850 rounded-xl" />
                            </div>
                            <div className="mt-3 space-y-2">
                                <div className="h-4 w-3/4 bg-zinc-850 rounded" />
                                <div className="h-3 w-1/2 bg-zinc-850 rounded" />
                            </div>
                            <div className="mt-3 space-y-1">
                                <div className="h-3 w-5/6 bg-zinc-850 rounded" />
                                <div className="h-3 w-2/3 bg-zinc-850 rounded" />
                            </div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between gap-2">
                            <div className="h-3 w-12 bg-zinc-850 rounded" />
                            <div className="h-3 w-8 bg-zinc-850 rounded" />
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="h-auto bg-black text-white selection:bg-admin-gold/30 pb-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="px-6 flex items-center justify-between gap-4 pt-6 pb-2">
                <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase leading-none select-none flex items-center gap-3 shrink-0">
                    <span className="flex items-baseline flex-nowrap whitespace-nowrap">
                        <span className="italic text-white">Clientes</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => setShowHelpModal(true)}
                        className="w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                        title="Guia de Clientes e Ajuda"
                    >
                        <HelpCircle className="w-4.5 h-4.5" />
                    </button>
                </h1>
            </div>
            <main className="max-w-7xl mx-auto mt-6 pb-10 sm:px-6 space-y-10">
                {/* Control Bar para Carrossel/Grid de Métricas */}
                <div className="space-y-4">
                    <LocalErrorBoundary>
                        <AdminKpiCarousel cards={kpiCards} loading={loading} title="Métricas de Clientes" />
                    </LocalErrorBoundary>
                </div>
                {/* Unified Control & Data Block */}
                <div className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/50 sm:rounded-[3rem] shadow-2xl overflow-hidden relative flex flex-col">
                    {/* Control Bar (Topo) */}
                    <div className="p-6 sm:px-8 border-b border-zinc-800/50 flex flex-col md:flex-row md:items-center gap-6 relative z-20 bg-zinc-950/30">
                        <div className="flex items-center gap-4 w-full flex-1">
                            <div className="relative group w-full">
                                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                    {loading || searchTerm !== debouncedSearchTerm ? (
                                        <Loader2 className="h-5 w-5 text-admin-gold animate-spin" />
                                    ) : (
                                        <Search className="h-5 w-5 text-zinc-600 group-focus-within:text-admin-gold transition-colors" />
                                    )}
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
                                onClick={() => setViewMode(prev => prev === 'detailed' ? 'compact' : 'detailed')}
                                className="h-14 w-14 rounded-2xl border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-admin-gold/50 group transition-all shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                                title={viewMode === 'detailed' ? "Visualização Compacta" : "Visualização Detalhada"}
                            >
                                {viewMode === 'detailed' ? (
                                    <LayoutGrid className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                                ) : (
                                    <List className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                                )}
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => !isOffline && fetchCustomers(page)}
                                disabled={loading || isOffline}
                                className="h-14 w-14 rounded-2xl border-zinc-800 bg-zinc-900/50 hover:bg-admin-gold hover:border-admin-gold group transition-all shrink-0 disabled:opacity-40"
                            >
                                <RefreshCw className={cn("w-5 h-5 text-zinc-500 group-hover:text-black transition-colors", loading && "animate-spin text-admin-gold")} />
                            </Button>
                        </div>
                    </div>

                    {/* Data List (Responsive Grid/Cards) */}
                    <LocalErrorBoundary>
                        <div className={cn("relative group/table w-full p-2 sm:p-0 transition-opacity duration-300", loading && paginatedCustomers.length > 0 && "opacity-50 pointer-events-none")}>
                            {/* Glow Decoration */}
                            <div className="absolute -top-24 -left-24 w-48 h-48 bg-admin-gold/5 blur-[100px] pointer-events-none" />

                            <div className="relative z-10 flex flex-col w-full">
                            {loading && paginatedCustomers.length === 0 ? (
                                viewMode === 'detailed' ? renderDetailedSkeletons() : renderCompactSkeletons()
                            ) : paginatedCustomers.length === 0 ? (
                                <div className="py-24 text-center">
                                    <div className="flex flex-col items-center justify-center text-zinc-600">
                                        <div className="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6 shadow-inner">
                                            <Users className="w-8 h-8 opacity-20" />
                                        </div>
                                        <p className="text-sm font-bold uppercase tracking-widest text-zinc-500">Nenhum cliente retornado</p>
                                        <p className="text-[10px] text-zinc-600 mt-2">Revise os filtros ou sua pesquisa.</p>
                                    </div>
                                </div>
                            ) : viewMode === 'detailed' ? (
                                <>
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
                                        {paginatedCustomers.map((customer) => (
                                            <div
                                                key={customer.id}
                                                className="group bg-zinc-900/30 md:bg-transparent border border-zinc-800/50 md:border-transparent rounded-[1.5rem] md:rounded-none p-5 md:px-8 md:py-6 flex flex-col md:grid md:grid-cols-12 md:items-center gap-5 md:gap-4 hover:bg-zinc-800/20 md:hover:bg-zinc-800/30 transition-all cursor-pointer relative overflow-hidden shadow-xl md:shadow-none min-h-[120px] content-visibility-auto"
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
                                                            <DropdownMenuContent align="end" className="w-[200px] rounded-2xl border border-zinc-800/80 bg-zinc-950/95 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-2 z-[100]">
                                                                <DropdownMenuLabel className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 p-3">Gestão de Cliente</DropdownMenuLabel>
                                                                <DropdownMenuSeparator className="bg-zinc-800/60" />
                                                                <DropdownMenuItem
                                                                    className="group rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer text-zinc-200 focus:bg-admin-gold focus:text-black p-3 transition-colors flex items-center gap-1"
                                                                    onClick={() => onNavigate('admin-user-detail', customer.id)}
                                                                >
                                                                    <Shield className="w-4 h-4 mr-2 text-zinc-400 group-focus:text-black transition-colors shrink-0" />
                                                                    Ver Perfil Elite
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                    className="group rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer text-zinc-200 focus:bg-admin-gold focus:text-black p-3 transition-colors flex items-center gap-1"
                                                                    onClick={() => onNavigate('admin-push', customer.id)}
                                                                >
                                                                    <Zap className="w-4 h-4 mr-2 text-zinc-400 group-focus:text-black transition-colors shrink-0" />
                                                                    Notificação Push
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator className="bg-zinc-800/60" />
                                                                <DropdownMenuItem 
                                                                    onClick={() => toast.info('Funcionalidade em desenvolvimento')}
                                                                    className="group rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer text-red-500 focus:bg-red-500/10 focus:text-red-400 p-3 transition-colors flex items-center gap-1 hover:shadow-[0_0_15px_rgba(239,68,68,0.1)]"
                                                                >
                                                                    <Snowflake className="w-4 h-4 mr-2 text-red-500/80 group-focus:text-red-400 transition-colors shrink-0" />
                                                                    Congelar Acesso
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-3 sm:p-4 md:p-6">
                                    {paginatedCustomers.map((customer) => (
                                        <div
                                            key={customer.id}
                                            onClick={() => onNavigate('admin-user-detail', customer.id)}
                                            className="group relative bg-zinc-950/40 backdrop-blur-md border border-white/5 rounded-[1.5rem] p-3.5 sm:p-5 transition-all duration-500 hover:scale-[1.01] hover:shadow-[0_15px_40px_rgba(212,175,55,0.05)] hover:border-admin-gold/30 active:scale-[0.98] cursor-pointer min-h-[160px] flex flex-col justify-between content-visibility-auto"
                                        >
                                            {/* Glow Background */}
                                            <div className="absolute inset-0 bg-gradient-to-br from-admin-gold/0 via-transparent to-admin-gold/0 group-hover:from-admin-gold/5 group-hover:to-transparent rounded-[1.5rem] transition-all duration-700 pointer-events-none z-0" />

                                            <div className="relative z-10 flex flex-col w-full h-full">
                                                {/* Header Row: Avatar and Action Dropdown */}
                                                <div className="flex justify-between items-start w-full relative">
                                                    <div className="relative group-hover:scale-105 transition-transform duration-300 shrink-0">
                                                        <Avatar className="h-10 w-10 sm:h-12 sm:w-12 border border-zinc-800/60 group-hover:border-admin-gold/50 transition-colors shadow-md">
                                                            <AvatarImage src={customer.avatar_url} className="object-cover" />
                                                            <AvatarFallback className="bg-zinc-950 text-zinc-400 font-black text-xs border border-zinc-800/50">
                                                                {customer.full_name?.substring(0, 2).toUpperCase() || 'CX'}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        {customer.is_push_subscribed && (
                                                            <div className="absolute -bottom-0.5 -right-0.5 w-4.5 h-4.5 bg-gradient-to-br from-admin-gold to-yellow-600 rounded-full flex items-center justify-center border border-black shadow-[0_0_10px_rgba(255,191,0,0.4)]">
                                                                <Zap className="w-2.5 h-2.5 text-black fill-black" />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="absolute top-0 right-0" onClick={(e) => e.stopPropagation()}>
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-11 w-11 rounded-xl bg-zinc-950/80 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-900 transition-all shadow-md flex items-center justify-center">
                                                                    <MoreHorizontal className="w-5 h-5 flex-shrink-0" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="w-[180px] rounded-2xl border border-zinc-800/80 bg-zinc-950/95 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-2 z-[100]">
                                                                <DropdownMenuLabel className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 p-2.5">Gestão de Cliente</DropdownMenuLabel>
                                                                <DropdownMenuSeparator className="bg-zinc-800/60" />
                                                                <DropdownMenuItem
                                                                    className="group rounded-xl text-[9px] font-black uppercase tracking-widest cursor-pointer text-zinc-200 focus:bg-admin-gold focus:text-black p-2.5 transition-colors flex items-center gap-1"
                                                                    onClick={() => onNavigate('admin-user-detail', customer.id)}
                                                                >
                                                                    <Shield className="w-3.5 h-3.5 mr-2 text-zinc-400 group-focus:text-black transition-colors shrink-0" />
                                                                    Ver Perfil Elite
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                    className="group rounded-xl text-[9px] font-black uppercase tracking-widest cursor-pointer text-zinc-200 focus:bg-admin-gold focus:text-black p-2.5 transition-colors flex items-center gap-1"
                                                                    onClick={() => onNavigate('admin-push', customer.id)}
                                                                >
                                                                    <Zap className="w-3.5 h-3.5 mr-2 text-zinc-400 group-focus:text-black transition-colors shrink-0" />
                                                                    Notificação Push
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator className="bg-zinc-800/60" />
                                                                <DropdownMenuItem 
                                                                    onClick={() => toast.info('Funcionalidade em desenvolvimento')}
                                                                    className="group rounded-xl text-[9px] font-black uppercase tracking-widest cursor-pointer text-red-500 focus:bg-red-500/10 focus:text-red-400 p-2.5 transition-colors flex items-center gap-1"
                                                                >
                                                                    <Snowflake className="w-3.5 h-3.5 mr-2 text-red-500/80 group-focus:text-red-400 transition-colors shrink-0" />
                                                                    Congelar Acesso
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                </div>

                                                {/* Customer Name and Badges */}
                                                <div className="mt-3 min-w-0 pr-2">
                                                    <h4 className="text-xs sm:text-sm font-black text-white truncate group-hover:text-admin-gold transition-colors leading-none">
                                                        {customer.full_name || 'Usuário'}
                                                    </h4>
                                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                                        <Badge className={cn(
                                                            "px-1.5 py-0.5 rounded-md text-[7px] font-black tracking-widest uppercase border",
                                                            customer.role === 'admin'
                                                                ? 'bg-admin-gold text-black border-admin-gold/50'
                                                                : 'bg-zinc-950 text-zinc-500 border-zinc-800/80 shadow-inner'
                                                        )}>
                                                            {customer.role}
                                                        </Badge>
                                                        <span className="text-[8px] font-mono font-bold text-zinc-600 bg-black/20 px-1 py-0.5 rounded border border-white/5">
                                                            #{customer.id.slice(0, 8).toUpperCase()}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Email & Phone */}
                                                <div className="mt-3 space-y-1 text-[10px] text-zinc-400">
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <Mail className="w-3 h-3 text-zinc-600 shrink-0" />
                                                        <span className="truncate">{customer.email || 'N/A'}</span>
                                                    </div>
                                                    {customer.phone && (
                                                        <div className="flex items-center gap-1.5 truncate">
                                                            <Phone className="w-3 h-3 text-zinc-600 shrink-0" />
                                                            <span className="truncate">{customer.phone}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Bottom KPIs: LTV & Pedidos */}
                                            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between gap-2 relative z-10">
                                                <div className="flex flex-col">
                                                    <span className="text-zinc-600 text-[7px] font-black uppercase tracking-[0.2em]">LTV Total</span>
                                                    <span className="text-xs font-black text-white mt-0.5">
                                                        <span className="text-[9px] text-zinc-500 mr-0.5">R$</span>
                                                        {Number(customer.total_spent || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-zinc-600 text-[7px] font-black uppercase tracking-[0.2em]">Pedidos</span>
                                                    <span className="text-xs font-black text-admin-gold mt-0.5">
                                                        {customer.orders_count || 0}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </LocalErrorBoundary>
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
            {/* Modal de Ajuda */}
            {showHelpModal && (
              <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300 text-left">
                <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[88vh] sm:max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300">
                  {/* Header */}
                  <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
                    <h3 className="text-sm font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-admin-gold animate-pulse" />
                      Guia da Base de Clientes
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
                        Esta tela exibe a base de perfis de consumidores cadastrados. Ela reúne informações consolidadas de compras e histórico financeiro de cada cliente.
                      </p>

                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                          Métricas e Conceitos
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Users className="w-4 h-4 text-emerald-500" />
                              Total de Clientes
                            </div>
                            <p className="text-xs text-zinc-400">
                              O número total de usuários cadastrados que já realizaram login ou criaram perfil na plataforma.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Wallet className="w-4 h-4 text-admin-gold" />
                              LTV (Lifetime Value)
                            </div>
                            <p className="text-xs text-zinc-400">
                              O valor financeiro total gasto por um cliente ao longo de todo o tempo de vida de sua conta na loja.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <ShoppingBag className="w-4 h-4 text-sky-500" />
                              Pedidos Totais
                            </div>
                            <p className="text-xs text-zinc-400">
                              Volume acumulado de compras que o usuário efetuou, independentemente do status atual do pagamento.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <TrendingUp className="w-4 h-4 text-purple-500" />
                              Novos Clientes (30d)
                            </div>
                            <p className="text-xs text-zinc-400">
                              Quantidade de perfis criados ou que realizaram o primeiro acesso nos últimos 30 dias.
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
