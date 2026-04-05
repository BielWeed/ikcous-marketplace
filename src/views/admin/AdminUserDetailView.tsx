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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
        <div className="space-y-6 pb-20 max-w-7xl mx-auto">
            {/* Header / Actions */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Detalhes do Cliente</h1>
                        <p className="text-sm text-muted-foreground">ID: {userId}</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        className="flex-1 md:flex-none gap-2"
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
                        WhatsApp
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Profile Card */}
                <Card className="lg:col-span-1 h-fit border-none shadow-sm bg-gradient-to-br from-white to-slate-50/50">
                    <CardHeader className="flex flex-col items-center pb-2">
                        <Avatar className="h-24 w-24 border-4 border-white shadow-lg">
                            <AvatarImage src={profile?.avatar_url || undefined} />
                            <AvatarFallback className="text-2xl bg-primary/10 text-primary">
                                {profile?.full_name?.substring(0, 2).toUpperCase() || '??'}
                            </AvatarFallback>
                        </Avatar>
                        <CardTitle className="mt-4 text-xl">{profile?.full_name || 'N/A'}</CardTitle>
                        <Badge variant="outline" className="mt-1 capitalize">
                            {profile?.role || 'customer'}
                        </Badge>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 text-sm">
                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                    <Mail className="h-4 w-4" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Email</span>
                                    <span>{profile?.email || 'Sem email'}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 text-sm">
                                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-green-600">
                                    <Phone className="h-4 w-4" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">WhatsApp</span>
                                    <span>{profile?.whatsapp || 'N/A'}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 text-sm">
                                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
                                    <Calendar className="h-4 w-4" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Membro Desde</span>
                                    <span>{profile?.created_at ? format(new Date(profile.created_at), "dd 'de' MMMM, yyyy", { locale: ptBR }) : 'N/A'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t space-y-3">
                            <h3 className="text-sm font-semibold flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-primary" /> Endereços
                            </h3>
                            {addresses.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-2 italic">Nenhum endereço cadastrado</p>
                            ) : (
                                <div className="space-y-2">
                                    {addresses.map(addr => (
                                        <div key={addr.id} className="text-xs p-2 rounded-md bg-white border shadow-sm">
                                            <div className="font-semibold flex items-center justify-between mb-1">
                                                {addr.name}
                                                {addr.is_default && <Badge className="text-[10px] h-4 px-1">Padrão</Badge>}
                                            </div>
                                            <p className="text-muted-foreground">
                                                {addr.street}, {addr.number}{addr.complement ? ` - ${addr.complement}` : ''}
                                            </p>
                                            <p className="text-muted-foreground">{addr.neighborhood}, {addr.city}-{addr.state}</p>
                                            <p className="mt-1 font-mono text-[10px]">{addr.cep}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Right Column: Content Tabs */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Quick Stats Banner */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Card className="bg-primary/5 border-primary/10 overflow-hidden relative">
                            <div className="absolute right-[-10px] top-[-10px] opacity-10">
                                <CreditCard className="h-24 w-24" />
                            </div>
                            <CardContent className="p-4">
                                <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider">Total Gasto</p>
                                <p className="text-2xl font-bold mt-1">
                                    {totalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="border-none shadow-sm bg-white overflow-hidden relative">
                            <div className="absolute right-[-10px] top-[-10px] opacity-10">
                                <Package className="h-24 w-24 text-blue-600" />
                            </div>
                            <CardContent className="p-4">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pedidos</p>
                                <p className="text-2xl font-bold mt-1">{orders.length}</p>
                            </CardContent>
                        </Card>

                        <Card className="border-none shadow-sm bg-white overflow-hidden relative">
                            <div className="absolute right-[-10px] top-[-10px] opacity-10">
                                <ShoppingCart className="h-24 w-24 text-green-600" />
                            </div>
                            <CardContent className="p-4">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">No Carrinho</p>
                                <p className="text-2xl font-bold mt-1 text-green-600">{cartItems.reduce((s, i) => s + i.quantity, 0)} itens</p>
                            </CardContent>
                        </Card>
                    </div>

                    <Tabs defaultValue="orders" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 bg-slate-100 p-1">
                            <TabsTrigger value="orders" className="flex items-center gap-2">
                                <Package className="h-4 w-4" /> Histórico
                            </TabsTrigger>
                            <TabsTrigger value="cart" className="flex items-center gap-2">
                                <ShoppingCart className="h-4 w-4" /> Carrinho Atual
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="orders" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Últimos Pedidos</CardTitle>
                                </CardHeader>
                                <CardContent className="p-0 sm:p-6">
                                    {orders.length === 0 ? (
                                        <div className="text-center py-10 text-muted-foreground">
                                            Nenhum pedido realizado ainda.
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Pedido</TableHead>
                                                        <TableHead>Data</TableHead>
                                                        <TableHead>Status</TableHead>
                                                        <TableHead className="text-right">Total</TableHead>
                                                        <TableHead></TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {orders.map((order) => (
                                                        <TableRow key={order.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onNavigate('order-details', order.id)}>
                                                            <TableCell className="font-medium font-mono text-xs">
                                                                #{order.id.substring(0, 8).toUpperCase()}
                                                            </TableCell>
                                                            <TableCell className="text-xs">
                                                                {format(new Date(order.createdAt), 'dd/MM/yy HH:mm')}
                                                            </TableCell>
                                                            <TableCell>{getStatusBadge(order.status)}</TableCell>
                                                            <TableCell className="text-right font-semibold">
                                                                {order.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                            </TableCell>
                                                            <TableCell>
                                                                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="cart" className="mt-4">
                            <Card className="border-green-100">
                                <CardHeader className="bg-green-50/30">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-green-800">Carrinho em Tempo Real</CardTitle>
                                            <CardDescription>O que este cliente adicionou e ainda não finalizou.</CardDescription>
                                        </div>
                                        {cartItems.length > 0 && <Badge className="bg-green-600">{cartItems.length} Itens</Badge>}
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0 sm:p-6">
                                    {cartItems.length === 0 ? (
                                        <div className="text-center py-12">
                                            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 mb-4">
                                                <ShoppingCart className="h-8 w-8 text-slate-300" />
                                            </div>
                                            <p className="text-muted-foreground">O carrinho está vazio no momento.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Produto</TableHead>
                                                        <TableHead className="text-center">Qtd</TableHead>
                                                        <TableHead>Preço Un.</TableHead>
                                                        <TableHead className="text-right">Total</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {cartItems.map((item, idx) => {
                                                        const variant = item.variantId ? item.product.variants?.find(v => v.id === item.variantId) : null;
                                                        const unitPrice = variant?.priceOverride || item.product.price;

                                                        return (
                                                            <TableRow key={idx}>
                                                                <TableCell>
                                                                    <div className="flex items-center gap-3">
                                                                        <Avatar className="h-10 w-10 rounded-md">
                                                                            <AvatarImage src={item.product.images[0]} className="object-cover" />
                                                                            <AvatarFallback>P</AvatarFallback>
                                                                        </Avatar>
                                                                        <div className="flex flex-col">
                                                                            <span className="font-medium text-sm line-clamp-1">{item.product.name}</span>
                                                                            {variant && <span className="text-[10px] text-muted-foreground italic">{variant.name}: {variant.value}</span>}
                                                                        </div>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-center">{item.quantity}x</TableCell>
                                                                <TableCell className="text-sm">
                                                                    {unitPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                </TableCell>
                                                                <TableCell className="text-right font-semibold text-primary">
                                                                    {(unitPrice * item.quantity).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    })}
                                                    <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                                                        <TableCell colSpan={3} className="text-right font-semibold uppercase tracking-wider text-xs">Valor Estimado do Carrinho:</TableCell>
                                                        <TableCell className="text-right font-bold text-lg text-green-600">
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
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
