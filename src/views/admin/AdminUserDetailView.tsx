import { useState, useEffect, useCallback } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
    MessageSquare,
    Trash2,
    HelpCircle,
    User,
    Copy,
    Check
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
import { formatCurrency } from '@/lib/utils';

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
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [cartItems, setCartItems] = useState<CartItem[]>([]);
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [cartItemToRemove, setCartItemToRemove] = useState<{ productId: string; variantId?: string } | null>(null);
    const [isClearingCart, setIsClearingCart] = useState(false);
    const [copiedField, setCopiedField] = useState<'id' | 'email' | 'whatsapp' | null>(null);

    const handleCopy = (text: string, field: 'id' | 'email' | 'whatsapp') => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        toast.success(`${field === 'id' ? 'ID' : field === 'email' ? 'E-mail' : 'Telefone'} copiado com sucesso!`);
        setTimeout(() => setCopiedField(null), 2000);
    };

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
            const { data, error } = await supabase.rpc('get_admin_user_detail', { p_user_id: userId });

            if (error) throw error;

            const payload = data as any;
            setProfile(payload.profile as Profile);
            setOrders(payload.orders?.map(mapOrderFromDB) || []);
            setAddresses(payload.addresses || []);

            // Handle Cart Items fetching products if needed
            if (payload.cart_items && payload.cart_items.length > 0) {
                const productIds = payload.cart_items.map((item: any) => item.product_id);
                const { data: products, error: prodError } = await supabase
                    .from('produtos')
                    .select('*, product_variants(*)')
                    .in('id', productIds);

                if (prodError) throw prodError;

                const reconstructedCart: CartItem[] = (payload.cart_items || []).map((dbItem: any) => {
                    const product = products?.find(p => p.id === dbItem.product_id);
                    let itemProduct: any;

                    if (!product) {
                        itemProduct = {
                            id: dbItem.product_id,
                            name: "Produto Indisponível / Deletado",
                            description: "",
                            price: 0,
                            costPrice: 0,
                            images: ["https://placehold.co/600x400?text=Indisponivel"],
                            category: "Desconhecido",
                            stock: 0,
                            sold: 0,
                            isActive: false,
                            isBestseller: false,
                            freeShipping: false,
                            createdAt: new Date().toISOString(),
                            createdTime: Date.now(),
                            rating: 0,
                            reviewCount: 0,
                            tags: [],
                            variants: []
                        };
                    } else {
                        itemProduct = mapProductFromDB(product);
                        let statusSuffix = "";
                        if ((product as any).deleted_at) {
                            statusSuffix = " (Deletado)";
                        } else if (!product.ativo && product.ativo !== undefined) {
                            statusSuffix = " (Inativo)";
                        } else if (itemProduct.isActive === false) {
                            statusSuffix = " (Inativo)";
                        }
                        if (statusSuffix) {
                            itemProduct.name = `${itemProduct.name}${statusSuffix}`;
                        }
                    }

                    const item: CartItem = {
                        product: itemProduct,
                        quantity: dbItem.quantity
                    };
                    if (dbItem.variant_id) item.variantId = dbItem.variant_id;
                    return item;
                });

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

    const handleRemoveCartItem = (productId: string, variantId?: string) => {
        setCartItemToRemove({ productId, variantId });
    };

    const confirmRemoveCartItem = async () => {
        if (!cartItemToRemove) return;
        try {
            const { productId, variantId } = cartItemToRemove;
            
            let query = supabase
                .from('cart_items')
                .delete()
                .eq('user_id', userId)
                .eq('product_id', productId);
                
            if (variantId) {
                query = query.eq('variant_id', variantId);
            } else {
                query = query.is('variant_id', null);
            }

            const { error } = await query;

            if (error) throw error;

            toast.success('Item removido com sucesso!');
            fetchUserData();
        } catch (err) {
            console.error('Error removing cart item:', err);
            toast.error('Erro ao remover item do carrinho');
        } finally {
            setCartItemToRemove(null);
        }
    };

    const handleClearUserCart = () => {
        setIsClearingCart(true);
    };

    const confirmClearUserCart = async () => {
        try {
            const { error } = await supabase
                .from('cart_items')
                .delete()
                .eq('user_id', userId);

            if (error) throw error;

            toast.success('Carrinho limpo com sucesso!');
            fetchUserData();
        } catch (err) {
            console.error('Error clearing user cart:', err);
            toast.error('Erro ao limpar carrinho');
        } finally {
            setIsClearingCart(false);
        }
    };

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
        <div className="space-y-6 pb-20 max-w-7xl mx-auto px-4 md:px-0">
            {/* Header / Actions */}
            <div className="flex items-center gap-4 mt-6">
                <Button variant="ghost" size="icon" onClick={onBack} className="rounded-xl h-10 w-10 bg-zinc-950/80 border border-zinc-800 shadow-inner hover:bg-zinc-800 hover:border-admin-gold/50 transition-all text-zinc-400 hover:text-white shrink-0">
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-xl sm:text-2xl font-black text-white tracking-tighter uppercase flex items-center gap-2">
                        <span>Perfil do Cliente</span>
                        <button
                            type="button"
                            onClick={() => setShowHelpModal(true)}
                            className="w-6 h-6 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                            title="Guia do Perfil do Cliente e Ajuda"
                        >
                            <HelpCircle className="w-3 h-3" />
                        </button>
                    </h1>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">ID</span>
                        <button
                            onClick={() => handleCopy(userId, 'id')}
                            className="group flex items-center gap-1.5 py-0.5 px-2 rounded bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/80 transition-all text-[10px] font-mono text-zinc-400 hover:text-white"
                        >
                            <span className="blur-[0.3px] group-hover:blur-none transition-all">{userId}</span>
                            {copiedField === 'id' ? (
                                <Check className="w-3 h-3 text-emerald-500 animate-in fade-in duration-200" />
                            ) : (
                                <Copy className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                            )}
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative">
                {/* Glow Background Global */}
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[600px] bg-admin-gold/5 blur-[120px] pointer-events-none rounded-full" />

                {/* Left Column: Profile Card */}
                <Card className="lg:col-span-4 h-fit border border-zinc-800/80 shadow-2xl bg-zinc-900/40 backdrop-blur-3xl rounded-[1.5rem] overflow-hidden relative group/card">
                    {/* Header Banner Effect */}
                    <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-zinc-800/60 via-zinc-900/30 to-transparent border-b border-white/5 opacity-50 block z-0" />
                    
                    <CardHeader className="flex flex-col items-center pb-0 relative z-10 pt-6">
                        <div className="relative group">
                            <Avatar className="h-20 w-20 border-4 border-zinc-950 shadow-[0_0_30px_rgba(0,0,0,0.5)] ring-2 ring-zinc-800 group-hover:ring-admin-gold/50 transition-all duration-500 relative z-10">
                                <AvatarImage src={profile?.avatar_url || undefined} className="object-cover" />
                                <AvatarFallback className="text-2xl font-black bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-500 border border-zinc-700/50">
                                    {profile?.full_name?.substring(0, 2).toUpperCase() || 'CX'}
                                </AvatarFallback>
                            </Avatar>
                            <div className="absolute -inset-2 bg-gradient-to-r from-admin-gold to-yellow-600 rounded-full blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500 z-0" />
                            {profile?.whatsapp && (
                                <div className="absolute bottom-0.5 right-0.5 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center border-2 border-zinc-950 shadow-[0_0_15px_rgba(34,197,94,0.4)] z-20">
                                    <Phone className="w-2.5 h-2.5 text-zinc-950 fill-zinc-950" />
                                </div>
                            )}
                        </div>
                        
                        <div className="mt-4 text-center flex flex-col items-center w-full px-4">
                            <CardTitle className="text-lg font-black tracking-tight text-white">{profile?.full_name || 'Usuário Não-Nomeado'}</CardTitle>
                            <Badge className={`mt-2 uppercase tracking-[0.15em] font-black text-[8px] px-2 py-0.5 rounded border ${profile?.role === 'admin' ? 'bg-admin-gold text-black border-admin-gold/50' : 'bg-black text-zinc-500 border-zinc-800'}`}>
                                {profile?.role || 'Cliente'}
                            </Badge>
                        </div>

                        {/* Direct WhatsApp Call CTA */}
                        <div className="w-full mt-4 px-2">
                            <Button
                                className="w-full gap-2 h-10 rounded-xl bg-gradient-to-br from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 text-zinc-950 font-black uppercase tracking-widest text-[9px] shadow-[0_0_15px_rgba(34,197,94,0.2)] hover:shadow-[0_0_25px_rgba(34,197,94,0.4)] border-none transition-all duration-300"
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
                                <MessageSquare className="h-3.5 w-3.5" />
                                Contato Direto
                            </Button>
                        </div>
                    </CardHeader>
                    
                    <CardContent className="space-y-4 pt-5 pb-5 relative z-10 px-4">
                        {/* Info List */}
                        <div className="space-y-1 bg-zinc-950/40 border border-zinc-800/40 rounded-2xl overflow-hidden divide-y divide-zinc-900/40">
                            {/* Email row */}
                            <div className="flex items-center justify-between p-3 text-xs group/item hover:bg-zinc-900/20 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800/50 flex items-center justify-center text-zinc-500 shrink-0">
                                        <Mail className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-[8px] text-zinc-500 uppercase font-bold tracking-widest">Email</span>
                                        <span className="font-semibold text-zinc-300 truncate w-[130px] sm:w-[170px]">{profile?.email || 'N/A'}</span>
                                    </div>
                                </div>
                                {profile?.email && (
                                    <button
                                        onClick={() => handleCopy(profile.email!, 'email')}
                                        className="opacity-0 group-hover/item:opacity-100 p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all shrink-0"
                                        title="Copiar e-mail"
                                    >
                                        {copiedField === 'email' ? (
                                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                                        ) : (
                                            <Copy className="w-3.5 h-3.5" />
                                        )}
                                    </button>
                                )}
                            </div>

                            {/* Phone row */}
                            <div className="flex items-center justify-between p-3 text-xs group/item hover:bg-zinc-900/20 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800/50 flex items-center justify-center text-zinc-500 shrink-0">
                                        <Phone className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-[8px] text-zinc-500 uppercase font-bold tracking-widest">Telefone / WhatsApp</span>
                                        <span className="font-semibold text-zinc-300">{profile?.whatsapp || 'N/A'}</span>
                                    </div>
                                </div>
                                {profile?.whatsapp && (
                                    <button
                                        onClick={() => handleCopy(profile.whatsapp!, 'whatsapp')}
                                        className="opacity-0 group-hover/item:opacity-100 p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all shrink-0"
                                        title="Copiar telefone"
                                    >
                                        {copiedField === 'whatsapp' ? (
                                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                                        ) : (
                                            <Copy className="w-3.5 h-3.5" />
                                        )}
                                    </button>
                                )}
                            </div>

                            {/* Registered at row */}
                            <div className="flex items-center gap-3 p-3 text-xs">
                                <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800/50 flex items-center justify-center text-zinc-500 shrink-0">
                                    <Calendar className="h-3.5 w-3.5" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-zinc-500 uppercase font-bold tracking-widest">Registro Inicial</span>
                                    <span className="font-semibold text-zinc-300">
                                        {profile?.created_at ? format(new Date(profile.created_at), "dd 'de' MMM, yyyy", { locale: ptBR }) : 'N/A'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Right Column: LTV, Financials and Tabs */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Quick Stats Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* LTV Widget */}
                        <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800/80 p-4 rounded-2xl flex items-center justify-between relative overflow-hidden group hover:border-admin-gold/50 transition-all shadow-sm">
                            <div className="flex flex-col min-w-0">
                                <span className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 mb-0.5">LTV Total</span>
                                <span className="text-xl sm:text-2xl font-black text-white tracking-tight">{formatCurrency(totalSpent)}</span>
                            </div>
                            <div className="w-9 h-9 rounded-xl bg-zinc-950 border border-admin-gold/20 flex items-center justify-center text-admin-gold shrink-0">
                                <CreditCard className="w-4 h-4" />
                            </div>
                        </div>

                        {/* Total Orders Widget */}
                        <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800/80 p-4 rounded-2xl flex items-center justify-between relative overflow-hidden group hover:border-zinc-700 transition-all shadow-sm">
                            <div className="flex flex-col min-w-0">
                                <span className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 mb-0.5">Cesta / Pedidos</span>
                                <span className="text-xl sm:text-2xl font-black text-white tracking-tight">{orders.length}</span>
                            </div>
                            <div className="w-9 h-9 rounded-xl bg-zinc-950 border border-blue-500/20 flex items-center justify-center text-blue-500 shrink-0">
                                <Package className="w-4 h-4" />
                            </div>
                        </div>

                        {/* Cart Standby Widget */}
                        <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800/80 p-4 rounded-2xl flex items-center justify-between relative overflow-hidden group hover:border-green-500/50 transition-all shadow-sm">
                            <div className="flex flex-col min-w-0">
                                <span className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 mb-0.5">Carrinho (Standby)</span>
                                <span className="text-xl sm:text-2xl font-black text-green-400 tracking-tight">
                                    {cartItems.reduce((s, i) => s + i.quantity, 0)} <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest ml-0.5">itens</span>
                                </span>
                            </div>
                            <div className="w-9 h-9 rounded-xl bg-zinc-950 border border-green-500/20 flex items-center justify-center text-green-500 shrink-0">
                                <ShoppingCart className="w-4 h-4" />
                            </div>
                        </div>
                    </div>

                    {/* Operational Tabs */}
                    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-[1.5rem] p-2 shadow-2xl backdrop-blur-md">
                        <Tabs defaultValue="orders" className="w-full">
                            <TabsList className="grid w-full grid-cols-3 bg-zinc-950/80 p-1.5 rounded-2xl border border-zinc-800/50 mb-4 h-auto shadow-inner">
                                <TabsTrigger value="orders" className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[9px] sm:text-xs font-black uppercase tracking-wider text-zinc-500 data-[state=active]:bg-zinc-800 data-[state=active]:text-white data-[state=active]:shadow transition-all">
                                    <Package className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Pedidos</span>
                                    <span className="sm:hidden">Ped.</span>
                                    <span className="ml-1 text-[9px] opacity-70">({orders.length})</span>
                                </TabsTrigger>
                                <TabsTrigger value="cart" className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[9px] sm:text-xs font-black uppercase tracking-wider text-zinc-500 data-[state=active]:bg-admin-gold/10 data-[state=active]:text-admin-gold data-[state=active]:border data-[state=active]:border-admin-gold/20 transition-all">
                                    <ShoppingCart className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Carrinho</span>
                                    <span className="sm:hidden">Carr.</span>
                                    <span className="ml-1 text-[9px] opacity-70">({cartItems.reduce((acc, item) => acc + item.quantity, 0)})</span>
                                </TabsTrigger>
                                <TabsTrigger value="addresses" className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[9px] sm:text-xs font-black uppercase tracking-wider text-zinc-500 data-[state=active]:bg-zinc-800 data-[state=active]:text-white data-[state=active]:shadow transition-all">
                                    <MapPin className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Endereços</span>
                                    <span className="sm:hidden">End.</span>
                                    <span className="ml-1 text-[9px] opacity-70">({addresses.length})</span>
                                </TabsTrigger>
                            </TabsList>

                            {/* Orders Matrix */}
                            <TabsContent value="orders" className="mt-0 outline-none">
                                <div className="bg-zinc-900/20 rounded-[1.2rem] overflow-hidden">
                                    <div className="p-4 border-b border-zinc-800/50 bg-zinc-900/50">
                                        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white">Extrato Histórico</h2>
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
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-4 px-6">Registro</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-4">Timeline</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-4 max-w-[120px]">Situação</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-4 text-right">Volume</TableHead>
                                                            <TableHead className="py-4 px-6"></TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody className="divide-y divide-zinc-800/30">
                                                        {orders.map((order) => (
                                                            <TableRow key={order.id} className="cursor-pointer hover:bg-zinc-800/40 border-none transition-colors border-zinc-800" onClick={() => onNavigate('order-details', order.id)}>
                                                                <TableCell className="font-mono text-[11px] font-bold text-zinc-300 py-4 px-6">
                                                                    <span className="text-zinc-600 mr-1">#</span>{order.id.substring(0, 8).toUpperCase()}
                                                                </TableCell>
                                                                <TableCell className="text-xs font-medium text-zinc-400 py-4">
                                                                    {format(new Date(order.createdAt), 'dd MMMM, yy', { locale: ptBR })}
                                                                </TableCell>
                                                                <TableCell className="py-4">
                                                                    <div className="scale-90 origin-left">
                                                                        {getStatusBadge(order.status)}
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-right font-black text-white tracking-tight py-4">
                                                                    {formatCurrency(order.total)}
                                                                </TableCell>
                                                                <TableCell className="text-right py-4 px-6">
                                                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-zinc-500 hover:text-admin-gold hover:bg-admin-gold/10">
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
                                <div className="bg-zinc-900/20 rounded-[1.2rem] overflow-hidden border border-green-500/10 relative">
                                    <div className="absolute -top-40 -left-40 w-96 h-96 bg-green-500/5 blur-[100px] pointer-events-none rounded-full" />
                                    
                                    <div className="p-5 border-b border-zinc-800/50 bg-zinc-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
                                        <div>
                                            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white flex items-center gap-2">
                                                Auditoria de Carrinho
                                                <span className="relative flex h-2 w-2 ml-1">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                                </span>
                                            </h2>
                                            <p className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">Produtos retidos na estrutura de checkout</p>
                                            {cartItems.length > 0 && (
                                                <div className="flex items-center gap-2 mt-2">
                                                    <Badge className="bg-green-500 border-none text-black font-black text-[9px] shadow-[0_0_15px_rgba(34,197,94,0.3)]">{cartItems.length} Elementos</Badge>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={handleClearUserCart}
                                                        className="h-7 px-2.5 text-[8px] font-black uppercase tracking-widest rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all border border-red-500/20 shadow-sm"
                                                    >
                                                        Limpar Carrinho
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
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
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-4 px-6">Identificador do Ativo</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-4 text-center">Densidade</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-4">Precificação Base</TableHead>
                                                            <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 py-4 text-right px-6">Estimativa (BRL)</TableHead>
                                                            <TableHead className="py-4 px-6"></TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody className="divide-y divide-zinc-800/30">
                                                        {cartItems.map((item, idx) => {
                                                            const hasVariantId = !!item.variantId;
                                                            const variant = hasVariantId ? item.product.variants?.find(v => v.id === item.variantId) : null;
                                                            const isVariantMissing = hasVariantId && !variant;
                                                            const unitPrice = variant?.priceOverride || item.product.price;
 
                                                             return (
                                                                <TableRow key={idx} className="hover:bg-zinc-800/40 border-none transition-colors border-zinc-800">
                                                                    <TableCell className="py-3 px-6">
                                                                        <div className="flex items-center gap-3">
                                                                            <Avatar className="h-10 w-10 rounded-lg border border-zinc-800 shadow-xl">
                                                                                <AvatarImage src={item.product.images[0]} className="object-cover" />
                                                                                <AvatarFallback className="bg-zinc-900 text-zinc-600 font-black">?</AvatarFallback>
                                                                            </Avatar>
                                                                            <div className="flex flex-col min-w-0">
                                                                                <span className="font-bold text-xs text-white truncate w-[130px] sm:w-[220px] leading-tight">{item.product.name}</span>
                                                                                {variant && <span className="text-[8px] text-admin-gold uppercase tracking-widest font-black mt-0.5 bg-admin-gold/10 px-1 py-0.5 rounded w-fit">{variant.name}: {variant.value}</span>}
                                                                                {isVariantMissing && (
                                                                                    <span className="text-[8px] text-red-500 uppercase tracking-widest font-black mt-0.5 bg-red-500/10 px-1 py-0.5 rounded w-fit border border-red-500/20">
                                                                                        Variante Indisponível (ID: {item.variantId})
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-center py-3">
                                                                        <div className="inline-flex items-center justify-center w-7 h-7 rounded bg-zinc-950 border border-zinc-800 font-black text-xs text-zinc-300">
                                                                            {item.quantity}
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-xs font-bold text-zinc-400 py-3">
                                                                        {formatCurrency(unitPrice)}
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-black text-green-500 tracking-tight text-xs py-3 px-6">
                                                                        {formatCurrency(unitPrice * item.quantity)}
                                                                    </TableCell>
                                                                    <TableCell className="text-right py-3 px-6">
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            onClick={() => handleRemoveCartItem(item.product.id, item.variantId)}
                                                                            className="h-8 w-8 rounded-lg text-zinc-500 hover:text-red-500 hover:bg-red-500/10"
                                                                            title="Remover do Carrinho"
                                                                        >
                                                                            <Trash2 className="h-4 w-4" />
                                                                        </Button>
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                        <TableRow className="bg-gradient-to-r from-transparent via-green-500/5 to-green-500/10 hover:bg-transparent border-t border-green-500/20">
                                                            <TableCell colSpan={4} className="text-right py-4 font-black uppercase tracking-[0.2em] text-[9px] text-zinc-400">Total Previsível do Retido</TableCell>
                                                            <TableCell className="text-right font-black text-lg text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-green-600 px-6 py-4 tracking-tighter">
                                                                {formatCurrency(cartItems.reduce((acc, item) => {
                                                                    const variant = item.variantId ? item.product.variants?.find(v => v.id === item.variantId) : null;
                                                                    return acc + (variant?.priceOverride || item.product.price) * item.quantity;
                                                                }, 0))}
                                                            </TableCell>
                                                        </TableRow>
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </TabsContent>

                            {/* Addresses Matrix */}
                            <TabsContent value="addresses" className="mt-0 outline-none">
                                <div className="bg-zinc-900/20 rounded-[1.2rem] overflow-hidden">
                                    <div className="p-4 border-b border-zinc-800/50 bg-zinc-900/50">
                                        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white flex items-center gap-1.5">
                                            <MapPin className="h-3.5 w-3.5 text-admin-gold" />
                                            Destinos de Entrega
                                        </h2>
                                    </div>
                                    <div className="p-4">
                                        {addresses.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                                                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner mb-4">
                                                    <MapPin className="h-6 w-6 text-zinc-700" />
                                                </div>
                                                <p className="text-sm font-bold text-zinc-500">Nenhum Endereço</p>
                                                <p className="text-xs text-zinc-600 mt-1">Este cliente não possui destinos cadastrados.</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                {addresses.map(addr => (
                                                    <div key={addr.id} className="p-4 rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 hover:border-zinc-700 transition-colors shadow-inner relative overflow-hidden group">
                                                        {addr.is_default && <div className="absolute top-0 right-0 w-12 h-12 overflow-hidden pointer-events-none before:content-[''] before:absolute before:border-[16px] before:border-transparent before:border-t-admin-gold/20 before:border-r-admin-gold/20 before:-top-2 before:-right-2" />}
                                                        <div className="font-black text-white flex items-center justify-between mb-2">
                                                            <span className="truncate pr-2 text-xs">{addr.name}</span>
                                                            {addr.is_default && <Badge className="bg-admin-gold text-black font-black uppercase tracking-widest text-[8px] h-4 px-1.5 border-none shadow-[0_0_10px_rgba(255,191,0,0.3)]">PADRÃO</Badge>}
                                                        </div>
                                                        <div className="space-y-0.5 mt-2">
                                                            <p className="text-xs text-zinc-300 font-medium">
                                                                {addr.street}, <span className="text-zinc-200 font-bold">{addr.number}</span>{addr.complement ? ` - ${addr.complement}` : ''}
                                                            </p>
                                                            <p className="text-[11px] text-zinc-400">{addr.neighborhood}, {addr.city}-{addr.state} <span className="mx-1 text-zinc-700">•</span> <span className="font-mono text-[9px] text-zinc-500">{addr.cep}</span></p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
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
                      Ficha Detalhada do Cliente
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
                        Esta tela detalha o perfil individual de um cliente, incluindo histórico completo de compras, endereços de entrega cadastrados e itens retidos no carrinho de compras.
                      </p>

                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                          Seções do Perfil
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <MapPin className="w-4 h-4 text-emerald-500" />
                              Endereços de Entrega
                            </div>
                            <p className="text-xs text-zinc-400">
                              Os locais cadastrados pelo cliente para recebimento das entregas das compras efetuadas.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <ShoppingCart className="w-4 h-4 text-admin-gold" />
                              Histórico de Pedidos
                            </div>
                            <p className="text-xs text-zinc-400">
                              Relação de todas as transações feitas pelo cliente na loja, incluindo valores, formas de pagamento e status dos envios.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Package className="w-4 h-4 text-sky-500" />
                              Carrinho Atual (Abandonado)
                            </div>
                            <p className="text-xs text-zinc-400">
                              Exibe em tempo real quais itens o cliente adicionou ao carrinho mas ainda não finalizou a compra. Útil para ações de remarketing.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <User className="w-4 h-4 text-purple-500" />
                              Funções Administrativas
                            </div>
                            <p className="text-xs text-zinc-400">
                              Permite ao administrador entrar em contato direto via WhatsApp ou aplicar bloqueios de segurança se for um usuário fraudulento.
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

      {/* Diálogo de Confirmação de Remoção de Item do Carrinho */}
      <AlertDialog open={cartItemToRemove !== null} onOpenChange={(open) => !open && setCartItemToRemove(null)}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10 rounded-3xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-black text-lg uppercase tracking-tight">Remover Item?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs">
              Tem certeza que deseja remover este item do carrinho do cliente?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveCartItem} className="bg-rose-650 hover:bg-rose-700 text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Remover Item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de Confirmação de Limpeza de Carrinho */}
      <AlertDialog open={isClearingCart} onOpenChange={(open) => !open && setIsClearingCart(false)}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10 rounded-3xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-black text-lg uppercase tracking-tight">Limpar Carrinho?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs">
              Tem certeza que deseja limpar completamente o carrinho deste cliente? Esta ação removerá todos os produtos adicionados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmClearUserCart} className="bg-rose-650 hover:bg-rose-700 text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Limpar Carrinho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </div>
    );
}
