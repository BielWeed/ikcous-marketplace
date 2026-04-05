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
    Activity
} from 'lucide-react';
import { Card } from '@/components/ui/card';
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

export function AdminCustomersView({ onNavigate }: AdminCustomersViewProps) {
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
                <div className="w-12 h-12 border-2 border-zinc-800 border-t-[var(--admin-gold)] rounded-full animate-spin mb-6 shadow-[0_0_15px_rgba(255,191,0,0.3)]" />
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] animate-pulse">Sincronizando Base de Clientes...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white selection:bg-[var(--admin-gold)]/30 pb-32">
            {/* Header */}
            <div className="backdrop-blur-xl bg-zinc-900/40 px-4 sm:px-8 py-8 flex flex-col md:flex-row md:items-center justify-between sticky top-0 z-50 border-b border-zinc-800/50 gap-6 shadow-2xl">
                <div>
                    <h1 className="text-2xl font-black text-white tracking-tighter flex items-center gap-3 group">
                        <div className="w-10 h-10 rounded-xl bg-[var(--admin-gold)] flex items-center justify-center shadow-[0_0_20px_rgba(255,191,0,0.3)] group-hover:scale-110 transition-transform">
                            <Users className="w-5 h-5 text-black" />
                        </div>
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-zinc-500">
                            Clientes
                        </span>
                    </h1>
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em] mt-2 pl-[3.25rem]">
                        Gestão da Base <span className="text-[var(--admin-gold)]">({totalCustomers} Perfis)</span>
                    </p>
                </div>

                <div className="flex items-center gap-4 w-full md:w-auto">
                    <Button
                        variant="outline"
                        onClick={() => fetchCustomers()}
                        className="rounded-xl border-zinc-800 bg-zinc-900/50 h-10 px-6 text-[10px] font-black uppercase tracking-widest hover:bg-[var(--admin-gold)] hover:text-black hover:border-[var(--admin-gold)] transition-all"
                    >
                        Sincronizar
                    </Button>
                    <div className="relative group w-full md:w-80">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Search className="h-4 w-4 text-zinc-500 group-focus-within:text-[var(--admin-gold)] transition-colors" />
                        </div>
                        <Input
                            type="text"
                            placeholder="Buscar cliente premium..."
                            className="pl-11 h-11 rounded-2xl border-zinc-800 bg-zinc-900/60 text-white placeholder:text-zinc-600 focus:ring-[var(--admin-gold)]/20 focus:border-[var(--admin-gold)]/50 transition-all font-medium text-sm"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            autoComplete="off"
                        />
                    </div>
                    <Button variant="outline" size="icon" className="h-11 w-11 rounded-2xl border-zinc-800 bg-zinc-900/60 hover:border-[var(--admin-gold)]/50 group transition-all">
                        <Filter className="w-4 h-4 text-zinc-500 group-hover:text-[var(--admin-gold)]" />
                    </Button>
                </div>
            </div>

            <main className="max-w-7xl mx-auto py-10 sm:px-6 space-y-10">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {[
                        { label: 'Total Clientes', value: globalStats?.total_customers || 0, icon: Users, accent: 'var(--admin-gold)' },
                        { label: 'Novos (30d)', value: globalStats?.new_customers_30d || 0, icon: TrendingUp, accent: '#10b981' },
                        { label: 'Ticket Médio', value: `R$ ${((globalStats?.global_ltv || 0) / (globalStats?.total_customers || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Wallet, accent: '#3b82f6' },
                        { label: 'Pedidos Totais', value: globalStats?.global_orders || 0, icon: ShoppingBag, accent: '#f59e0b' }
                    ].map((stat, i) => (
                        <Card key={i} className="sm:rounded-[2.5rem] border-y sm:border-x border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl p-6 sm:p-7 shadow-2xl hover:border-[var(--admin-gold)]/30 transition-all group relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[var(--admin-gold)]/5 to-transparent blur-3xl -mr-16 -mt-16 group-hover:from-[var(--admin-gold)]/10 transition-colors" />

                            <div className="flex items-start justify-between relative z-10">
                                <div className="space-y-4">
                                    <div className="p-3 bg-zinc-900/80 rounded-2xl border border-zinc-800 shadow-inner group-hover:border-[var(--admin-gold)]/50 transition-colors inline-flex">
                                        <stat.icon className="w-5 h-5" style={{ color: stat.accent }} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-1">{stat.label}</p>
                                        <h3 className="text-3xl font-black text-white tracking-tighter group-hover:text-[var(--admin-gold)] transition-colors">
                                            {stat.value}
                                        </h3>
                                    </div>
                                </div>
                                <div className="h-full flex flex-col items-end justify-between py-1">
                                    <Activity className="w-4 h-4 text-zinc-800 group-hover:text-[var(--admin-gold)]/20 transition-colors" />
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
                <div className="bg-zinc-900/40 backdrop-blur-xl border-y sm:border-x border-zinc-800/50 sm:rounded-[3rem] shadow-2xl overflow-hidden relative group/table">
                    {/* Table Glow Decoration */}
                    <div className="absolute -top-24 -left-24 w-48 h-48 bg-[var(--admin-gold)]/5 blur-[100px] pointer-events-none" />

                    <div className="overflow-x-auto relative z-10">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="border-b border-zinc-800/50 bg-zinc-900/60">
                                    <th className="text-left py-5 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 cursor-pointer hover:text-[var(--admin-gold)] transition-colors group/th" onClick={() => handleSort('full_name')}>
                                        <div className="flex items-center gap-2">
                                            Cliente
                                            <ArrowUpDown className="w-3 h-3 group-hover/th:translate-y-0.5 transition-transform" />
                                        </div>
                                    </th>
                                    <th className="text-left py-5 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 cursor-pointer hover:text-[var(--admin-gold)] transition-colors group/th" onClick={() => handleSort('role')}>
                                        <div className="flex items-center gap-2">
                                            Status / Role
                                            <ArrowUpDown className="w-3 h-3 group-hover/th:translate-y-0.5 transition-transform" />
                                        </div>
                                    </th>
                                    <th className="text-left py-5 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 cursor-pointer hover:text-[var(--admin-gold)] transition-colors group/th" onClick={() => handleSort('total_spent')}>
                                        <div className="flex items-center gap-2">
                                            LTV (Total Gasto)
                                            <ArrowUpDown className="w-3 h-3 group-hover/th:translate-y-0.5 transition-transform" />
                                        </div>
                                    </th>
                                    <th className="text-center py-5 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 cursor-pointer hover:text-[var(--admin-gold)] transition-colors group/th" onClick={() => handleSort('orders_count')}>
                                        <div className="flex items-center gap-2 justify-center">
                                            Pedidos
                                            <ArrowUpDown className="w-3 h-3 group-hover/th:translate-y-0.5 transition-transform" />
                                        </div>
                                    </th>
                                    <th className="text-left py-5 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 cursor-pointer hover:text-[var(--admin-gold)] transition-colors group/th" onClick={() => handleSort('last_order_date')}>
                                        <div className="flex items-center gap-2">
                                            Última Atividade
                                            <ArrowUpDown className="w-3 h-3 group-hover/th:translate-y-0.5 transition-transform" />
                                        </div>
                                    </th>
                                    <th className="text-right py-5 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Gestão</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/30">
                                {paginatedCustomers.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="py-24 text-center">
                                            <div className="flex flex-col items-center justify-center text-zinc-600">
                                                <div className="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6 shadow-inner">
                                                    <Users className="w-8 h-8 opacity-20" />
                                                </div>
                                                <p className="text-sm font-bold uppercase tracking-widest text-zinc-500">Nenhum cliente na base de dados</p>
                                                <p className="text-[10px] text-zinc-600 mt-2">Tente ajustar seus filtros ou realizar uma nova busca.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedCustomers.map((customer) => (
                                        <tr
                                            key={customer.id}
                                            className="group hover:bg-zinc-800/30 transition-all cursor-pointer relative overflow-hidden"
                                            onClick={() => onNavigate('admin-user-detail', customer.id)}
                                        >
                                            <td className="py-5 px-8 relative">
                                                <div className="flex items-center gap-4">
                                                    <div className="relative group/avatar">
                                                        <Avatar className="h-12 w-12 border-2 border-zinc-800 group-hover:border-[var(--admin-gold)]/50 transition-all shadow-xl">
                                                            <AvatarImage src={customer.avatar_url} className="object-cover" />
                                                            <AvatarFallback className="bg-zinc-800 text-zinc-400 font-black text-xs">
                                                                {customer.full_name?.substring(0, 2).toUpperCase()}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        {customer.is_push_subscribed && (
                                                            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-[var(--admin-gold)] rounded-full flex items-center justify-center border-2 border-black shadow-[0_0_10px_rgba(255,191,0,0.5)]">
                                                                <Zap className="w-2.5 h-2.5 text-black fill-black" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="text-sm font-black text-white leading-tight group-hover:text-[var(--admin-gold)] transition-colors">{customer.full_name}</p>
                                                        </div>
                                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
                                                            <span className="text-zinc-700">#</span>{customer.id.slice(0, 8)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-5 px-8">
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-400">
                                                        <div className="p-1 rounded-md bg-zinc-900 border border-zinc-800">
                                                            <Mail className="w-3 h-3 text-zinc-500" />
                                                        </div>
                                                        {customer.email}
                                                    </div>
                                                    {customer.phone && (
                                                        <div className="flex items-center gap-2 text-xs font-bold text-zinc-400">
                                                            <div className="p-1 rounded-md bg-zinc-900 border border-zinc-800">
                                                                <Phone className="w-3 h-3 text-zinc-500" />
                                                            </div>
                                                            {customer.phone}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-5 px-8">
                                                <div className="flex flex-col gap-2">
                                                    <Badge className={`w-fit px-3 py-1 rounded-lg text-[9px] font-black tracking-[0.15em] uppercase border ${customer.role === 'admin'
                                                        ? 'bg-[var(--admin-gold)] text-black border-[var(--admin-gold)] shadow-[0_0_10px_rgba(255,191,0,0.2)]'
                                                        : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                                                        }`}>
                                                        {customer.role === 'admin' && <Shield className="w-2.5 h-2.5 mr-1.5" />}
                                                        {customer.role}
                                                    </Badge>
                                                    <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest pl-1">
                                                        Status: Ativo
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-5 px-8">
                                                <div className="flex flex-col items-center gap-1">
                                                    <div className="text-sm font-black text-white tracking-tight group-hover:text-[var(--admin-gold)] transition-colors">
                                                        R$ {Number(customer.total_spent || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </div>
                                                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                                                        LTV TOTAL
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-5 px-8 text-center">
                                                <div className="inline-flex flex-col gap-1 items-center">
                                                    <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-xs font-black text-white shadow-inner group-hover:border-[var(--admin-gold)]/50 transition-all">
                                                        {customer.orders_count || 0}
                                                    </div>
                                                    <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Orders</span>
                                                </div>
                                            </td>
                                            <td className="py-5 px-8">
                                                <div className="flex flex-col items-end gap-1.5">
                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                                                        <Calendar className="w-3 h-3 text-[var(--admin-gold)]/50" />
                                                        {customer.last_order_date ? new Date(customer.last_order_date).toLocaleDateString() : 'Nenhuma'}
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                                                        Desde {new Date(customer.created_at).toLocaleDateString()}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-5 px-8 text-right" onClick={(e) => e.stopPropagation()}>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 hover:border-[var(--admin-gold)]/50 text-zinc-500 hover:text-[var(--admin-gold)] transition-all">
                                                            <MoreHorizontal className="w-5 h-5" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-[180px] rounded-2xl border-zinc-800 bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-2">
                                                        <DropdownMenuLabel className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 p-3">Opções de Gestão</DropdownMenuLabel>
                                                        <DropdownMenuSeparator className="bg-zinc-800/50" />
                                                        <DropdownMenuItem
                                                            className="rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer focus:bg-[var(--admin-gold)] focus:text-black p-3"
                                                            onClick={() => onNavigate('admin-user-detail', customer.id)}
                                                        >
                                                            Ver Perfil Elite
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            className="rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer focus:bg-[var(--admin-gold)] focus:text-black p-3"
                                                            onClick={() => onNavigate('admin-push')}
                                                        >
                                                            Enviar Push
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator className="bg-zinc-800/50" />
                                                        <DropdownMenuItem className="rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer text-red-500 focus:bg-red-500 focus:text-white p-3">
                                                            Congelar Acesso
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between px-8 py-5 border-t border-zinc-800/50 bg-zinc-900/60 relative z-10">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setPage(prev => Math.max(0, prev - 1))}
                                disabled={page === 0}
                                className="h-10 w-10 rounded-xl border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-[var(--admin-gold)]/50 disabled:opacity-30"
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                                Segmento <span className="text-[var(--admin-gold)]">{page + 1}</span> de <span className="text-white">{totalPages}</span>
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setPage(prev => Math.min(totalPages - 1, prev + 1))}
                                disabled={page === totalPages - 1}
                                className="h-10 w-10 rounded-xl border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-[var(--admin-gold)]/50 disabled:opacity-30"
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
