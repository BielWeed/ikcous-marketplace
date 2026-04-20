import { useState, useEffect, useCallback } from 'react';
import {
    ArrowLeft,
    Mail,
    Phone,
    Calendar,
    Package,
    ShoppingCart,
    CreditCard,
    MapPin,
    ExternalLink,
    MessageSquare
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { mapOrderFromDB, mapProductFromDB } from '@/lib/mappers';
import type { Order, CartItem, Address, View } from '@/types';
import { toast } from 'sonner';

interface Profile {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    whatsapp: string | null;
    email?: string | null;
    role: string | null;
    created_at: string;
}

interface AdminUserDetailViewProps {
    userId: string;
    onBack: () => void;
    onNavigate: (view: View, id?: string) => void;
}

export function AdminUserDetailView({ userId, onBack, onNavigate }: AdminUserDetailViewProps) {
    const { isAdmin } = useAuth();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [cartItems, setCartItems] = useState<CartItem[]>([]);
    const [addresses, setAddresses] = useState<Address[]>([]);

    useEffect(() => {
        if (!isAdmin) {
            toast.error('Acesso negado');
            onBack();
        }
    }, [isAdmin, onBack]);

    const fetchUserData = useCallback(async () => {
        if (!isAdmin) return;
        setLoading(true);
        try {
            // Parallelize first level of fetching
            const [profileRes, ordersRes, cartRes, addressesRes] = await Promise.all([
                supabase.from('profiles').select('*').eq('id', userId).single(),
                supabase.from('marketplace_orders').select(`*, items:marketplace_order_items(*)`).eq('user_id', userId).order('created_at', { ascending: false }),
                supabase.from('cart_items').select('*').eq('user_id', userId),
                supabase.from('user_addresses').select('*').eq('user_id', userId)
            ]);

            if (profileRes.error) throw profileRes.error;
            if (ordersRes.error) throw ordersRes.error;
            if (cartRes.error) throw cartRes.error;

            setProfile(profileRes.data as Profile);
            setOrders(ordersRes.data?.map(mapOrderFromDB) || []);
            if (!addressesRes.error) setAddresses((addressesRes.data || []) as Address[]);

            // Handle Cart Items fetching products if needed
            if (cartRes.data && cartRes.data.length > 0) {
                const productIds = cartRes.data.map(item => item.product_id);
                const { data: products, error: prodError } = await supabase
                    .from('vw_produtos_public')
                    .select('*')
                    .in('id', productIds);

                if (prodError) throw prodError;

                const reconstructedCart: CartItem[] = (cartRes.data || []).map(dbItem => {
                    const product = products?.find(p => p.id === dbItem.product_id);
                    if (!product) return null;
                    const item: CartItem = {
                        product: mapProductFromDB(product),
                        quantity: dbItem.quantity
                    };
                    if (dbItem.variant_id) item.variantId = dbItem.variant_id;
                    return item;
                }).filter((item): item is CartItem => item !== null);

                setCartItems(reconstructedCart);
            } else {
                setCartItems([]);
            }

        } catch (err) {
            console.error('[AdminUserDetail] Error fetching data:', err);
            toast.error('Erro ao carregar dados do usuário');
        } finally {
            setLoading(false);
        }
    }, [userId, isAdmin]);

    useEffect(() => {
        fetchUserData();
    }, [fetchUserData]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'new': return <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200">Novo</Badge>;
            case 'processing': return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200">Processando</Badge>;
            case 'shipping': return <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200">Enviado</Badge>;
            case 'delivered': return <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-200">Entregue</Badge>;
            case 'cancelled': return <Badge variant="destructive">Cancelado</Badge>;
            default: return <Badge variant="outline">{status}</Badge>;
        }
    };

    if (!isAdmin) return null;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-muted-foreground animate-pulse">Carregando detalhes do cliente...</p>
            </div>
        );
    }

    const totalSpent = orders
        .filter(o => o.status !== 'cancelled')
        .reduce((sum, o) => sum + o.total, 0);

    return (
        <div className="space-y-8 pb-20 max-w-7xl mx-auto px-4 md:px-0">
            {/* Header / Actions */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={onBack} className="rounded-2xl h-12 w-12 bg-zinc-950/80 border border-zinc-800 shadow-inner hover:bg-zinc-800 hover:border-[var(--admin-gold)]/50 transition-all text-zinc-400 hover:text-white">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tighter uppercase mb-1">Perfil do Cliente</h1>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-md">ID</span>
                            <span className="text-[11px] font-mono font-black text-zinc-500 tracking-wider blur-[0.3px] hover:blur-none transition-all">{userId}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        className="flex-1 md:flex-none gap-2 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 text-black font-black uppercase tracking-widest text-[10px] shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] border-none transition-all"
                        disabled={!profile?.whatsapp}
                        onClick={() => {
                            if (!profile?.whatsapp) return;
                            let phone = profile.whatsapp.replace(/\D/g, '');
                            if (phone.length === 11 || phone.length === 10) {
                                phone = '55' + phone;
                            }
                            globalThis.open(`https://wa.me/${phone}`, '_blank');
                        }}
                    >
                        <MessageSquare className="h-4 w-4" />
                        Contato Direto
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 relative">
                {/* Glow Background Global */}
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[600px] bg-[var(--admin-gold)]/5 blur-[120px] pointer-events-none rounded-full" />

                {/* Left Column: Profile Card */}
                <Card className="lg:col-span-4 h-fit border border-zinc-800/80 shadow-2xl bg-zinc-900/40 backdrop-blur-3xl rounded-[2rem] overflow-hidden relative group/card">
                    {/* Header Banner Effect */}
                    <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-zinc-800/60 via-zinc-900/30 to-transparent border-b border-white/5 opacity-50 block z-0" />
                    
                    <CardHeader className="flex flex-col items-center pb-0 relative z-10 pt-10">
                        <div className="relative group">
                            <Avatar className="h-28 w-28 border-4 border-zinc-950 shadow-[0_0_30px_rgba(0,0,0,0.5)] ring-2 ring-zinc-800 group-hover:ring-[var(--admin-gold)]/50 transition-all duration-500 relative z-10">
                                <AvatarImage src={profile?.avatar_url || undefined} className="object-cover" />
                                <AvatarFallback className="text-3xl font-black bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-500 border border-zinc-700/50">
                                    {profile?.full_name?.substring(0, 2).toUpperCase() || 'CX'}
                                </AvatarFallback>
                            </Avatar>
                            <div className="absolute -inset-2 bg-gradient-to-r from-[var(--admin-gold)] to-yellow-600 rounded-full blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500 z-0" />
                            {profile?.whatsapp && (
                                <div className="absolute bottom-1 right-1 w-7 h-7 bg-green-500 rounded-full flex items-center justify-center border-2 border-zinc-950 shadow-[0_0_15px_rgba(34,197,94,0.4)] z-20">
                                    <Phone className="w-3 h-3 text-zinc-950 fill-zinc-950" />
                                </div>
                            )}
                        </div>
                        
                        <div className="mt-5 text-center flex flex-col items-center w-full px-4 pt-2">
                            <CardTitle className="text-xl sm:text-2xl font-black tracking-tight text-white">{profile?.full_name || 'Usuário Não-Nomeado'}</CardTitle>
                            <Badge className={`mt-3 uppercase tracking-[0.2em] font-black text-[9px] px-3 py-1 rounded-md border ${profile?.role === 'admin' ? 'bg-[var(--admin-gold)] text-black border-[var(--admin-gold)]/50' : 'bg-black text-zinc-500 border-zinc-800'}`}>
                                {profile?.role || 'Cliente'}
                            </Badge>
                        </div>
                    </CardHeader>
                    
                    <CardContent className="space-y-6 pt-8 pb-8 relative z-10 px-6">
                        {/* Info List */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-4 text-sm p-4 rounded-2xl bg-zinc-950/50 border border-zinc-800/50 hover:border-zinc-700/80 transition-colors group">
                                <div className="w-10 h-10 shrink-0 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-[var(--admin-gold)] transition-colors shadow-inner">
                                    <Mail className="h-4 w-4" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[9px] text-zinc-600 uppercase font-black tracking-[0.15em]">Email</span>
                                    <span className="font-semibold text-zinc-300 truncate">{profile?.email || 'N/A'}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 text-sm p-4 rounded-2xl bg-zinc-950/50 border border-zinc-800/50 hover:border-zinc-700/80 transition-colors group">
                                <div className="w-10 h-10 shrink-0 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-[var(--admin-gold)] transition-colors shadow-inner">
                                    <Phone className="h-4 w-4" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[9px] text-zinc-600 uppercase font-black tracking-[0.15em]">Telefone / WhatsApp</span>
                                    <span className="font-semibold text-zinc-300">{profile?.whatsapp || 'N/A'}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 text-sm p-4 rounded-2xl bg-zinc-950/50 border border-zinc-800/50 hover:border-zinc-700/80 transition-colors group">
                                <div className="w-10 h-10 shrink-0 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-[var(--admin-gold)] transition-colors shadow-inner">
                                    <Calendar className="h-4 w-4" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[9px] text-zinc-600 uppercase font-black tracking-[0.15em]">Registro Inicial</span>
                                    <span className="font-semibold text-zinc-300">{profile?.created_at ? format(new Date(profile.created_at), "dd 'de' MMMM, yyyy", { locale: ptBR }) : 'N/A'}</span>
                                </div>
                            </div>
                        </div>

                        {/* Addresses Area */}
                        <div className="pt-6 border-t border-zinc-800/50 space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2 pl-1">
                                <MapPin className="h-3.5 w-3.5 text-[var(--admin-gold)]/70" /> Destinos de Entrega
                            </h3>
                            {addresses.length === 0 ? (
                                <div className="p-6 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/30 flex flex-col items-center justify-center">
                                    <MapPin className="w-6 h-6 text-zinc-700 mb-2 opacity-50" />
                                    <p className="text-xs text-zinc-600 font-bold tracking-wider">Nenhum endereço vinculado</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {addresses.map(addr => (
                                        <div key={addr.id} className="p-4 rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 hover:border-zinc-700 transition-colors shadow-inner relative overflow-hidden group">
                                            {addr.is_default && <div className="absolute top-0 right-0 w-12 h-12 overflow-hidden pointer-events-none before:content-[''] before:absolute before:border-[16px] before:border-transparent before:border-t-[var(--admin-gold)]/20 before:border-r-[var(--admin-gold)]/20 before:-top-2 before:-right-2" />}
                                            <div className="font-black text-white flex items-center justify-between mb-2">
                                                <span className="truncate pr-2">{addr.name}</span>
                                                {addr.is_default && <Badge className="bg-[var(--admin-gold)] text-black font-black uppercase tracking-widest text-[8px] h-4 px-1.5 border-none shadow-[0_0_10px_rgba(255,191,0,0.3)]">VIP</Badge>}
                                            </div>
                                            <div className="space-y-0.5 mt-2">
                                                <p className="text-xs text-zinc-400 font-medium">
                                                    {addr.street}, <span className="text-zinc-300 font-bold">{addr.number}</span>{addr.complement ? ` - ${addr.complement}` : ''}
                                                </p>
                                                <p className="text-xs text-zinc-500">{addr.neighborhood}, {addr.city}-{addr.state} <span className="mx-1">•</span> <span className="font-mono text-[10px] text-zinc-600">{addr.cep}</span></p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Right Column: LTV and Financials */}
                <div className="lg:col-span-8 space-y-8">
                    {/* Quick Stats Banner */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* LTV Card */}
                        <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-6 rounded-[2rem] flex flex-col items-center sm:items-start relative overflow-hidden group hover:border-[var(--admin-gold)]/50 transition-colors shadow-inner">
                            <div className="w-12 h-12 rounded-xl bg-zinc-950 border border-[var(--admin-gold)]/20 shadow-[0_0_15px_rgba(212,175,55,0.1)] flex items-center justify-center mb-4 text-[var(--admin-gold)] group-hover:scale-110 transition-transform">
                                <CreditCard className="w-5 h-5" />
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1">LTV Total</p>
                            <div className="text-2xl lg:text-3xl font-black text-white tracking-tighter">
                                {totalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </div>
                        </div>

                        {/* Total Orders Card */}
                        <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-[2rem] flex flex-col items-center sm:items-start relative overflow-hidden group hover:border-zinc-700 transition-colors backdrop-blur-sm">
                            <div className="w-12 h-12 rounded-xl bg-zinc-950 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)] flex items-center justify-center mb-4 text-blue-500 group-hover:scale-110 transition-transform">
                                <Package className="w-5 h-5" />
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1">Cesta / Pedidos</p>
                            <div className="text-2xl lg:text-3xl font-black text-white tracking-tighter">
                                {orders.length}
                            </div>
                        </div>

                        {/* Active Cart Items Card */}
                        <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-[2rem] flex flex-col items-center sm:items-start relative overflow-hidden group hover:border-green-500/50 transition-colors backdrop-blur-sm">
                            <div className="absolute -top-10 -right-10 w-24 h-24 bg-green-500/5 blur-[50px] rounded-full pointer-events-none group-hover:bg-green-500/10 transition-colors" />
                            <div className="w-12 h-12 rounded-xl bg-zinc-950 border border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.1)] flex items-center justify-center mb-4 text-green-500 group-hover:scale-110 transition-transform relative z-10">
                                <ShoppingCart className="w-5 h-5" />
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1">Standby (Carrinho)</p>
                            <div className="text-2xl lg:text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-green-600">
                                {cartItems.reduce((s, i) => s + i.quantity, 0)} <span className="text-xs text-zinc-500 uppercase tracking-widest ml-1">itens</span>
                            </div>
                        </div>
                    </div>

                    {/* Operational Tabs */}
                    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-[2.5rem] p-2 shadow-2xl backdrop-blur-md">
                        <Tabs defaultValue="orders" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 bg-zinc-950/80 p-2 rounded-[2rem] border border-zinc-800/50 mb-4 h-auto shadow-inner">
                                <TabsTrigger value="orders" className="flex items-center gap-2 py-3 sm:py-4 rounded-[1.5rem] text-[10px] sm:text-xs font-black uppercase tracking-widest text-zinc-500 data-[state=active]:bg-zinc-800 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all">
                                    <Package className="h-4 w-4" /> Arquivo de Pedidos
                                </TabsTrigger>
                                <TabsTrigger value="cart" className="flex items-center gap-2 py-3 sm:py-4 rounded-[1.5rem] text-[10px] sm:text-xs font-black uppercase tracking-widest text-zinc-500 data-[state=active]:bg-[var(--admin-gold)]/10 data-[state=active]:text-[var(--admin-gold)] data-[state=active]:border data-[state=active]:border-[var(--admin-gold)]/20 data-[state=active]:shadow-[0_0_15px_rgba(212,175,55,0.1)] transition-all">
                                    <ShoppingCart className="h-4 w-4" /> Status do Carrinho
                                </TabsTrigger>
                            </TabsList>

                            {/* Orders Matrix */}
                            <TabsContent value="orders" className="mt-0 outline-none">
                                <div className="bg-zinc-900/20 rounded-[2rem] overflow-hidden">
                                    <div className="p-6 border-b border-zinc-800/50 bg-zinc-900/50">
                                        <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">Extrato Histórico</h2>
                                    </div>
                                    <div className="p-0">
                                        {orders.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                                                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner mb-4">
                                                    <Package className="h-6 w-6 text-zinc-700" />
                                                </div>
                                                <p className="text-sm font-bold text-zinc-500">Fluxo Zerado</p>
                                                <p className="text-xs text-zinc-600 mt-1">Este cliente ainda não integralizou aquisições.</p>
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <Table>
                                                    <TableHeader className="bg-zinc-950/60 border-b border-zinc-800/80 hover:bg-zinc-950/60">
                                                        <TableRow className="hover:bg-transparent border-none">
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-6 px-6">Registro</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-6">Timeline</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-6 max-w-[120px]">Situação</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-6 text-right">Volume</TableHead>
                                                            <TableHead className="py-6 px-6"></TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody className="divide-y divide-zinc-800/30">
                                                        {orders.map((order) => (
                                                            <TableRow key={order.id} className="cursor-pointer hover:bg-zinc-800/40 border-none transition-colors border-zinc-800" onClick={() => onNavigate('order-details', order.id)}>
                                                                <TableCell className="font-mono text-[11px] font-bold text-zinc-300 py-5 px-6">
                                                                    <span className="text-zinc-600 mr-1">#</span>{order.id.substring(0, 8).toUpperCase()}
                                                                </TableCell>
                                                                <TableCell className="text-xs font-medium text-zinc-400 py-5">
                                                                    {format(new Date(order.createdAt), 'dd MMMM, yy', { locale: ptBR })}
                                                                </TableCell>
                                                                <TableCell className="py-5">
                                                                    <div className="scale-90 origin-left">
                                                                        {getStatusBadge(order.status)}
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-right font-black text-white tracking-tight py-5">
                                                                    {order.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                </TableCell>
                                                                <TableCell className="text-right py-5 px-6">
                                                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-zinc-500 hover:text-[var(--admin-gold)] hover:bg-[var(--admin-gold)]/10">
                                                                        <ExternalLink className="h-4 w-4" />
                                                                    </Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </TabsContent>

                            {/* Cart Matrix */}
                            <TabsContent value="cart" className="mt-0 outline-none">
                                <div className="bg-zinc-900/20 rounded-[2rem] overflow-hidden border border-green-500/10 relative">
                                    <div className="absolute -top-40 -left-40 w-96 h-96 bg-green-500/5 blur-[100px] pointer-events-none rounded-full" />
                                    
                                    <div className="p-6 border-b border-zinc-800/50 bg-zinc-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
                                        <div>
                                            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white flex items-center gap-2">
                                                Auditoria de Carrinho
                                                <span className="relative flex h-2 w-2 ml-1">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                                </span>
                                            </h2>
                                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Produtos retidos na estrutura de checkout</p>
                                        </div>
                                        {cartItems.length > 0 && <Badge className="bg-green-500 border-none text-black font-black shadow-[0_0_15px_rgba(34,197,94,0.3)]">{cartItems.length} Elementos</Badge>}
                                    </div>
                                    <div className="p-0 relative z-10">
                                        {cartItems.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                                                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner mb-4">
                                                    <ShoppingCart className="h-6 w-6 text-zinc-700" />
                                                </div>
                                                <p className="text-sm font-bold text-zinc-500">Funil Vazio</p>
                                                <p className="text-xs text-zinc-600 mt-1">Este cliente não retém ativos pre-checkout.</p>
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <Table>
                                                    <TableHeader className="bg-zinc-950/60 border-b border-zinc-800/80 hover:bg-zinc-950/60">
                                                        <TableRow className="hover:bg-transparent border-none">
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-5 px-6">Identificador do Ativo</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-5 text-center">Densidade</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-5">Precificação Base</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-5 text-right px-6">Estimativa (BRL)</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody className="divide-y divide-zinc-800/30">
                                                        {cartItems.map((item, idx) => {
                                                            const variant = item.variantId ? item.product.variants?.find(v => v.id === item.variantId) : null;
                                                            const unitPrice = variant?.priceOverride || item.product.price;

                                                            return (
                                                                <TableRow key={idx} className="hover:bg-zinc-800/40 border-none transition-colors border-zinc-800">
                                                                    <TableCell className="py-4 px-6">
                                                                        <div className="flex items-center gap-4">
                                                                            <Avatar className="h-12 w-12 rounded-xl border border-zinc-800 shadow-xl">
                                                                                <AvatarImage src={item.product.images[0]} className="object-cover" />
                                                                                <AvatarFallback className="bg-zinc-900 text-zinc-600 font-black">?</AvatarFallback>
                                                                            </Avatar>
                                                                            <div className="flex flex-col min-w-0">
                                                                                <span className="font-bold text-sm text-white truncate w-[150px] sm:w-[250px] leading-tight">{item.product.name}</span>
                                                                                {variant && <span className="text-[9px] text-[var(--admin-gold)] uppercase tracking-widest font-black mt-1 bg-[var(--admin-gold)]/10 px-1.5 py-0.5 rounded w-fit">{variant.name}: {variant.value}</span>}
                                                                            </div>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-center py-4">
                                                                        <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 font-black text-sm text-zinc-300">
                                                                            {item.quantity}
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-xs font-bold text-zinc-400 py-4">
                                                                        {unitPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-black text-green-500 tracking-tight text-sm py-4 px-6">
                                                                        {(unitPrice * item.quantity).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                        <TableRow className="bg-gradient-to-r from-transparent via-green-500/5 to-green-500/10 hover:bg-transparent border-t border-green-500/20">
                                                            <TableCell colSpan={3} className="text-right py-6 font-black uppercase tracking-[0.2em] text-[10px] text-zinc-400">Total Previsível do Retido</TableCell>
                                                            <TableCell className="text-right font-black text-xl lg:text-2xl text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-green-600 px-6 py-6 tracking-tighter">
                                                                {cartItems.reduce((acc, item) => {
                                                                    const variant = item.variantId ? item.product.variants?.find(v => v.id === item.variantId) : null;
                                                                    return acc + (variant?.priceOverride || item.product.price) * item.quantity;
                                                                }, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                            </TableCell>
                                                        </TableRow>
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            </div>
        </div>
    );
}
