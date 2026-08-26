import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mapOrderFromDB, mapProductFromDB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import type { Address, CartItem, Order, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Calendar,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  HelpCircle,
  Mail,
  MapPin,
  MessageSquare,
  Package,
  Phone,
  ShoppingCart,
  Trash2,
  User,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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

export const AdminUserDetailView = memo(function AdminUserDetailView({
  userId,
  onBack,
  onNavigate,
}: AdminUserDetailViewProps) {
  const { isAdmin } = useAuth();
  const isOffline = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [cartItemToRemove, setCartItemToRemove] = useState<{
    productId: string;
    variantId?: string;
  } | null>(null);
  const [isClearingCart, setIsClearingCart] = useState(false);
  const [copiedField, setCopiedField] = useState<
    "id" | "email" | "whatsapp" | null
  >(null);

  const handleCopy = (text: string, field: "id" | "email" | "whatsapp") => {
    haptic.light();
    const label = field === "id" ? "ID" : field === "email" ? "E-mail" : "Telefone";
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      toast.success(`${label} copiado com sucesso!`);
      setTimeout(() => setCopiedField(null), 2000);
    }).catch(() => {
      toast.error("Não foi possível copiar. Copie manualmente.");
    });
  };

  useEffect(() => {
    if (!isAdmin) {
      toast.error("Acesso negado");
      onBack();
    }
  }, [isAdmin, onBack]);

  const fetchUserData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const { data, error } = await supabase.rpc("get_admin_user_detail", {
        p_user_id: userId,
      });

      if (error) throw error;

      const payload = data as any;
      setProfile(payload.profile as Profile);
      setOrders(payload.orders?.map(mapOrderFromDB) || []);
      setAddresses(payload.addresses || []);

      // Handle Cart Items fetching products if needed
      if (payload.cart_items && payload.cart_items.length > 0) {
        const productIds = payload.cart_items.map(
          (item: any) => item.product_id,
        );
        const { data: products, error: prodError } = await supabase
          .from("vw_produtos_admin")
          .select("*, product_variants(*)")
          .in("id", productIds);

        if (prodError) throw prodError;

        const reconstructedCart: CartItem[] = (payload.cart_items || []).map(
          (dbItem: any) => {
            const product = products?.find((p) => p.id === dbItem.product_id);
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
                variants: [],
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
              quantity: dbItem.quantity,
            };
            if (dbItem.variant_id) item.variantId = dbItem.variant_id;
            return item;
          },
        );

        setCartItems(reconstructedCart);
      } else {
        setCartItems([]);
      }
    } catch (err) {
      console.error("[AdminUserDetail] Error fetching data:", err);
      toast.error("Erro ao carregar dados do usuário");
      setLoadFailed(true);
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
    if (isOffline) {
      toast.error("Operação negada: Você está offline.");
      return;
    }
    try {
      const { productId, variantId } = cartItemToRemove;

      let query = supabase
        .from("cart_items")
        .delete()
        .select("id")
        .eq("user_id", userId)
        .eq("product_id", productId);

      if (variantId) {
        query = query.eq("variant_id", variantId);
      } else {
        query = query.is("variant_id", null);
      }

      const { data, error } = await query;

      if (error) throw error;

      // A policy de DELETE de `cart_items` não tem `is_admin()` (só
      // `auth.uid() = user_id`), diferente da de SELECT. Quando a lojista
      // apaga o carrinho de outra pessoa, o Postgres descarta todas as
      // linhas e o PostgREST responde sucesso com ZERO linhas — sem
      // `.select()` isso passava batido pelo `if (error) throw` e a tela
      // comemorava uma remoção que não aconteceu.
      if (!data || data.length === 0) {
        // Zero linhas tem DOIS motivos possiveis, e a frase precisa caber
        // nos dois: a policy barrou (carrinho de outra pessoa) OU o item
        // ja tinha saido do carrinho -- que acontece na propria ficha da
        // lojista, onde a policy LIBERA. Afirmar so a permissao mentiria
        // sobre o carrinho dela mesma.
        toast.error(
          "Nada foi removido. O item pode já ter saído do carrinho, ou o app não tem permissão para alterar o carrinho de outra pessoa.",
        );
        // Relê mesmo na falha: no caso "já saiu", é isto que tira da tela a
        // linha fantasma. No caso da policy é uma ida à rede a mais, barata.
        fetchUserData();
        return;
      }

      toast.success("Item removido com sucesso!");
      fetchUserData();
    } catch (err) {
      console.error("Error removing cart item:", err);
      toast.error("Erro ao remover item do carrinho");
    } finally {
      setCartItemToRemove(null);
    }
  };

  const handleClearUserCart = () => {
    setIsClearingCart(true);
  };

  const confirmClearUserCart = async () => {
    if (isOffline) {
      toast.error("Operação negada: Você está offline.");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("cart_items")
        .delete()
        .select("id")
        .eq("user_id", userId);

      if (error) throw error;

      // Mesmo defeito do item único: policy de DELETE sem `is_admin()`
      // descarta as linhas de outro usuário e o PostgREST devolve sucesso
      // com ZERO linhas. `.select()` é o que revela isso.
      if (!data || data.length === 0) {
        // Mesmos dois motivos do item unico -- ver o comentario la em cima.
        toast.error(
          "Nada foi removido. O carrinho pode já estar vazio, ou o app não tem permissão para alterar o carrinho de outra pessoa.",
        );
        fetchUserData();
        return;
      }

      toast.success("Carrinho limpo com sucesso!");
      fetchUserData();
    } catch (err) {
      console.error("Error clearing user cart:", err);
      toast.error("Erro ao limpar carrinho");
    } finally {
      setIsClearingCart(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "new":
        return (
          <Badge
            variant="secondary"
            className="border-blue-200 bg-blue-100 text-blue-800"
          >
            Novo
          </Badge>
        );
      case "pending":
        // Achado 14 da auditoria de 20/08/2026: "pending" é o estado inicial
        // de TODO pedido (create_marketplace_order_v23/v24 gravam isso no
        // INSERT) e caía no `default`, aparecendo cru em inglês. A palavra
        // usada aqui é a mesma que `statusConfig.pending.label`
        // (OrderStatusBadge.tsx) já usa no selo real de todo pedido, em
        // todo o app — inclusive do lado do cliente. "Pendente" seria um
        // segundo nome para o mesmo status.
        return (
          <Badge
            variant="secondary"
            className="border-blue-200 bg-blue-100 text-blue-800"
          >
            Novo Pedido
          </Badge>
        );
      case "processing":
        return (
          <Badge
            variant="secondary"
            className="border-yellow-200 bg-yellow-100 text-yellow-800"
          >
            Processando
          </Badge>
        );
      case "shipping":
        return (
          <Badge
            variant="secondary"
            className="border-blue-200 bg-blue-100 text-blue-800"
          >
            Enviado
          </Badge>
        );
      case "delivered":
        return (
          <Badge
            variant="secondary"
            className="border-green-200 bg-green-100 text-green-800"
          >
            Entregue
          </Badge>
        );
      case "cancelled":
        return <Badge variant="destructive">Cancelado</Badge>;
      default:
        // Com "pending" coberto acima, este `default` só é alcançado por um
        // valor fora dos cinco de `OrderStatus` — hoje, na prática,
        // "returned" (ver o comentário maior logo abaixo sobre
        // `pedidosQueContam`: o tipo não lista esse valor, mas o banco pode
        // gravá-lo). Mostrar o valor cru é feio, mas NÃO some com o dado —
        // trocar por "—" ou string vazia esconderia justamente o status que
        // ninguém tratou ainda. Traduzir "returned" aqui seria alinhar o
        // tipo ao banco, que este mesmo arquivo já registrou como conserto
        // de outro tamanho (mexe em todo `switch` sobre `OrderStatus`) e
        // ficou de fora de propósito.
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (!isAdmin) return null;

  /*
    Um pedido "conta" quando não foi cancelado nem devolvido — a MESMA regra
    que o servidor usa na lista de Clientes (`get_admin_customers_paged`, com
    `status NOT IN ('cancelled','returned')`).

    Até 21/08/2026 esta ficha tinha três contagens que não conversavam: o card
    "Cesta / Pedidos" mostrava `orders.length` (tudo, cancelados incluídos), o
    LTV filtrava só `cancelled` (esquecendo `returned`), e a lista de Clientes
    usava a regra completa. Resultado medido: o mesmo cliente aparecia com
    "Pedidos 6" na lista e "Cesta / Pedidos 16" aqui, sem nada explicando os
    10 de diferença. Com 72 dos 83 pedidos deste banco cancelados, isso valia
    para quase todo cliente com histórico.

    A ABA continua mostrando o histórico inteiro de propósito: é o número de
    linhas que a tabela abaixo dela lista. Trocar por 6 faria a aba mentir
    sobre o próprio conteúdo. O que sai daqui não é o segundo número — é o
    mistério, porque o card passa a dizer quantos ficaram de fora.
  */
  /*
    O `as string` no `returned` não é gambiarra: `OrderStatus` (types/index.ts)
    lista cinco valores e não inclui `returned`, mas o `mappers.ts:247` faz
    `row.status as OrderStatus` — um cast, não uma validação. Se o banco
    devolver `returned`, o valor chega aqui em tempo de execução com o tipo
    mentindo sobre ele, e o TypeScript acha a comparação impossível.

    Hoje nenhum pedido deste banco está nesse estado, então isto é defesa: o
    servidor filtra por `returned` na lista, e as duas contagens têm de
    continuar iguais no dia em que o status aparecer. Alinhar o tipo ao banco
    é conserto de outro tamanho — mexeria em todo `switch` sobre `OrderStatus`
    — e está anotado no relatório da auditoria.
  */
  const pedidosQueContam = orders.filter(
    (o) => o.status !== "cancelled" && (o.status as string) !== "returned",
  );
  const pedidosDescartados = orders.length - pedidosQueContam.length;

  /*
    Achado 17 (auditoria de 20/08/2026): o "LTV Total" contava pedido que
    ninguém pagou. A correção do servidor (migration `20260823000000`, em
    `get_admin_customers_paged`) mexeu SÓ no dinheiro de `total_spent` —
    `orders_count` continua contando pela MESMA regra de sempre (só status).
    Se esta ficha também filtrasse `pedidosQueContam` por pagamento, o card
    "Cesta / Pedidos" voltaria a divergir da coluna "Pedidos" da lista de
    Clientes — reabrindo o achado 5 por outra porta. Por isso o filtro de
    dinheiro é uma SEGUNDA passada, só para a soma do LTV, em cima do mesmo
    `pedidosQueContam` — a contagem de pedidos não muda.

    A regra de "dinheiro reconhecido" é a mesma das migrations
    `20260822000100` e `20260823000000`: `paymentStatus` nulo CONTA (pedido
    pago na entrega, ou histórico sem cobrança online, mesma leitura do
    mapper — ver mappers.ts:244-246); só ficam de fora 'aguardando',
    'recusado', 'expirado' e 'estornado'.
  */
  const pedidosPagos = pedidosQueContam.filter(
    (o) =>
      o.paymentStatus == null ||
      o.paymentStatus === "pago" ||
      o.paymentStatus === "pago_apos_expirar",
  );

  const totalSpent = pedidosPagos.reduce((sum, o) => sum + o.total, 0);

  const renderContentSkeleton = () => (
    <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left Column: Profile Card Skeleton */}
      <div className="space-y-6 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 p-6 backdrop-blur-3xl lg:col-span-4">
        <div className="flex flex-col items-center space-y-3">
          <Skeleton className="size-20 animate-pulse rounded-full bg-white/5" />
          <Skeleton className="h-5 w-40 animate-pulse rounded bg-white/5" />
          <Skeleton className="h-4 w-28 animate-pulse rounded bg-white/5" />
        </div>
        <div className="space-y-4 border-t border-white/5 pt-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-3 w-16 animate-pulse rounded bg-white/5" />
              <Skeleton className="h-3 w-24 animate-pulse rounded bg-white/5" />
            </div>
          ))}
        </div>
      </div>

      {/* Right Column: Details Skeleton */}
      <div className="space-y-6 lg:col-span-8">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="space-y-2 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4"
            >
              <Skeleton className="h-3 w-12 animate-pulse rounded bg-white/5" />
              <Skeleton className="h-6 w-20 animate-pulse rounded bg-white/5" />
            </div>
          ))}
        </div>
        <div className="space-y-4 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 p-6">
          <Skeleton className="h-4.5 w-32 animate-pulse rounded bg-white/5" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-white/5 py-2 last:border-0"
            >
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3 animate-pulse rounded bg-white/5" />
                <Skeleton className="h-2.5 w-1/2 animate-pulse rounded bg-white/5" />
              </div>
              <Skeleton className="h-6 w-16 animate-pulse rounded-full bg-white/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-admin lg:pb-12 duration-200 animate-in fade-in md:px-0">
      {/* Header / Actions */}
      <div className="mt-6 flex items-center gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black uppercase tracking-tighter text-white sm:text-2xl">
            <span>Perfil do Cliente</span>
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
              title="Guia do Perfil do Cliente e Ajuda"
            >
              <HelpCircle className="size-3" />
            </button>
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              ID
            </span>
            <button
              onClick={() => handleCopy(userId, "id")}
              className="group flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 font-mono text-[10px] text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800/80 hover:text-white"
            >
              <span className="blur-[0.3px] transition-all group-hover:blur-none">
                {userId}
              </span>
              {copiedField === "id" ? (
                <Check className="size-3 text-emerald-500 duration-200 animate-in fade-in" />
              ) : (
                <Copy className="size-3 text-zinc-600 transition-colors group-hover:text-zinc-400" />
              )}
            </button>
          </div>
        </div>
      </div>

      {loadFailed && !loading ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#09090b] text-white">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">
            Não foi possível carregar os dados deste cliente
          </p>
          <button
            onClick={() => fetchUserData()}
            className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-amber-500/30"
          >
            Tentar novamente
          </button>
        </div>
      ) : loading ? (
        renderContentSkeleton()
      ) : (
        <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Glow Background Global */}
          <div className="pointer-events-none absolute left-1/2 top-1/3 h-[600px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-admin-gold/5 blur-[120px]" />

          {/* Left Column: Profile Card */}
          <Card className="group/card relative h-fit overflow-hidden rounded-3xl border border-zinc-800/80 bg-zinc-900/40 shadow-2xl backdrop-blur-3xl lg:col-span-4">
            {/* Header Banner Effect */}
            <div className="absolute left-0 top-0 z-0 block h-24 w-full border-b border-white/5 bg-gradient-to-b from-zinc-800/60 via-zinc-900/30 to-transparent opacity-50" />

            <CardHeader className="relative z-10 flex flex-col items-center pb-0 pt-6">
              <div className="group relative">
                <Avatar className="relative z-10 size-20 border-4 border-zinc-950 shadow-[0_0_30px_rgba(0,0,0,0.5)] ring-2 ring-zinc-800 transition-all duration-500 group-hover:ring-admin-gold/50">
                  <AvatarImage
                    src={profile?.avatar_url || undefined}
                    className="object-cover"
                  />
                  <AvatarFallback className="border border-zinc-700/50 bg-gradient-to-br from-zinc-800 to-zinc-950 text-2xl font-black text-zinc-500">
                    {profile?.full_name?.substring(0, 2).toUpperCase() || "CX"}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute -inset-2 z-0 rounded-full bg-gradient-to-r from-admin-gold to-yellow-600 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-20" />
                {profile?.whatsapp && (
                  <div className="absolute bottom-0.5 right-0.5 z-20 flex size-6 items-center justify-center rounded-full border-2 border-zinc-950 bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]">
                    <Phone className="size-2.5 fill-zinc-950 text-zinc-950" />
                  </div>
                )}
              </div>

              <div className="mt-4 flex w-full flex-col items-center px-4 text-center">
                <CardTitle className="text-lg font-black tracking-tight text-white">
                  {profile?.full_name || "Usuário Não-Nomeado"}
                </CardTitle>
                <Badge
                  className={`mt-2 rounded border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.15em] ${profile?.role === "admin" ? "border-admin-gold/50 bg-admin-gold text-black" : "border-zinc-800 bg-black text-zinc-500"}`}
                >
                  {profile?.role || "Cliente"}
                </Badge>
              </div>

              {/* Direct WhatsApp Call CTA */}
              <div className="mt-4 w-full px-2">
                <Button
                  className="h-10 w-full gap-2 rounded-xl border-none bg-gradient-to-br from-green-500 to-green-600 text-[9px] font-black uppercase tracking-widest text-zinc-950 shadow-[0_0_15px_rgba(34,197,94,0.2)] transition-all duration-300 hover:from-green-400 hover:to-green-500 hover:shadow-[0_0_25px_rgba(34,197,94,0.4)] disabled:pointer-events-none disabled:opacity-40"
                  disabled={!profile?.whatsapp || isOffline}
                  onClick={() => {
                    if (!profile?.whatsapp || isOffline) return;
                    let phone = profile.whatsapp.replace(/\D/g, "");
                    if (phone.length === 11 || phone.length === 10) {
                      phone = `55${phone}`;
                    }
                    globalThis.open(`https://wa.me/${phone}`, "_blank");
                  }}
                >
                  <MessageSquare className="size-3.5" />
                  Contato Direto
                </Button>
              </div>
            </CardHeader>

            <CardContent className="relative z-10 space-y-4 px-4 py-5">
              {/* Info List */}
              <div className="space-y-1 divide-y divide-zinc-900/40 overflow-hidden rounded-2xl border border-zinc-800/40 bg-zinc-950/40">
                {/* Email row */}
                <div className="group/item flex items-center justify-between p-3 text-xs transition-colors hover:bg-zinc-900/20">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800/50 bg-zinc-900 text-zinc-500">
                      <Mail className="size-3.5" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">
                        Email
                      </span>
                      <span className="w-[130px] truncate font-semibold text-zinc-300 sm:w-[170px]">
                        {profile?.email || "N/A"}
                      </span>
                    </div>
                  </div>
                  {profile?.email && (
                    <button
                      onClick={() => handleCopy(profile.email!, "email")}
                      className="shrink-0 rounded-md p-1.5 text-zinc-500 opacity-100 transition-all hover:bg-zinc-800 hover:text-white hover-hover:opacity-0 hover-hover:group-hover/item:opacity-100"
                      title="Copiar e-mail"
                    >
                      {copiedField === "email" ? (
                        <Check className="size-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Phone row */}
                <div className="group/item flex items-center justify-between p-3 text-xs transition-colors hover:bg-zinc-900/20">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800/50 bg-zinc-900 text-zinc-500">
                      <Phone className="size-3.5" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">
                        Telefone / WhatsApp
                      </span>
                      <span className="font-semibold text-zinc-300">
                        {profile?.whatsapp || "N/A"}
                      </span>
                    </div>
                  </div>
                  {profile?.whatsapp && (
                    <button
                      onClick={() => handleCopy(profile.whatsapp!, "whatsapp")}
                      className="shrink-0 rounded-md p-1.5 text-zinc-500 opacity-100 transition-all hover:bg-zinc-800 hover:text-white hover-hover:opacity-0 hover-hover:group-hover/item:opacity-100"
                      title="Copiar telefone"
                    >
                      {copiedField === "whatsapp" ? (
                        <Check className="size-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Registered at row */}
                <div className="flex items-center gap-3 p-3 text-xs">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800/50 bg-zinc-900 text-zinc-500">
                    <Calendar className="size-3.5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">
                      Registro Inicial
                    </span>
                    <span className="font-semibold text-zinc-300">
                      {profile?.created_at
                        ? format(
                            new Date(profile.created_at),
                            "dd 'de' MMM, yyyy",
                            { locale: ptBR },
                          )
                        : "N/A"}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Right Column: LTV, Financials and Tabs */}
          <div className="space-y-6 lg:col-span-8">
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* LTV Widget */}
              <div className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 shadow-sm transition-all hover:border-admin-gold/50">
                <div className="flex min-w-0 flex-col">
                  <span className="mb-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500">
                    LTV Total
                  </span>
                  <span className="text-xl font-black tracking-tight text-white sm:text-2xl">
                    {formatCurrency(totalSpent)}
                  </span>
                </div>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-admin-gold/20 bg-zinc-950 text-admin-gold">
                  <CreditCard className="size-4" />
                </div>
              </div>

              {/* Total Orders Widget */}
              <div className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 shadow-sm transition-all hover:border-zinc-700">
                <div className="flex min-w-0 flex-col">
                  <span className="mb-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500">
                    Cesta / Pedidos
                  </span>
                  <span className="text-xl font-black tracking-tight text-white sm:text-2xl">
                    {pedidosQueContam.length}
                  </span>
                  {pedidosDescartados > 0 && (
                    <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                      {/* "fora da conta" e nao "cancelado": `pedidosDescartados`
                          conta cancelado E devolvido, entao dizer "cancelado"
                          rotularia um pedido devolvido de cancelado. Hoje nao ha
                          nenhum `returned` no banco, mas o rotulo mentiria no
                          primeiro que houver — e e' exatamente a familia de
                          defeito que esta auditoria cataloga. */}
                      {pedidosDescartados} fora da conta
                    </span>
                  )}
                </div>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-blue-500/20 bg-zinc-950 text-blue-500">
                  <Package className="size-4" />
                </div>
              </div>

              {/* Cart Standby Widget */}
              <div className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 shadow-sm transition-all hover:border-green-500/50">
                <div className="flex min-w-0 flex-col">
                  <span className="mb-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500">
                    Carrinho (Standby)
                  </span>
                  <span className="text-xl font-black tracking-tight text-green-400 sm:text-2xl">
                    {cartItems.reduce((s, i) => s + i.quantity, 0)}{" "}
                    <span className="ml-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      itens
                    </span>
                  </span>
                </div>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-green-500/20 bg-zinc-950 text-green-500">
                  <ShoppingCart className="size-4" />
                </div>
              </div>
            </div>

            {/* Operational Tabs */}
            <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 p-2 shadow-2xl backdrop-blur-md">
              <Tabs defaultValue="orders" className="w-full">
                <TabsList className="mb-4 grid h-auto w-full grid-cols-3 rounded-2xl border border-zinc-800/50 bg-zinc-950/80 p-1.5 shadow-inner">
                  <TabsTrigger
                    value="orders"
                    className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[9px] font-black uppercase tracking-wider text-zinc-500 transition-all data-[state=active]:bg-zinc-800 data-[state=active]:text-white data-[state=active]:shadow sm:text-xs"
                  >
                    <Package className="size-3.5" />
                    <span className="hidden sm:inline">Pedidos</span>
                    <span className="sm:hidden">Ped.</span>
                    <span className="ml-1 text-[9px] opacity-70">
                      ({orders.length})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="cart"
                    className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[9px] font-black uppercase tracking-wider text-zinc-500 transition-all data-[state=active]:border data-[state=active]:border-admin-gold/20 data-[state=active]:bg-admin-gold/10 data-[state=active]:text-admin-gold sm:text-xs"
                  >
                    <ShoppingCart className="size-3.5" />
                    <span className="hidden sm:inline">Carrinho</span>
                    <span className="sm:hidden">Carr.</span>
                    <span className="ml-1 text-[9px] opacity-70">
                      ({cartItems.reduce((acc, item) => acc + item.quantity, 0)}
                      )
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="addresses"
                    className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[9px] font-black uppercase tracking-wider text-zinc-500 transition-all data-[state=active]:bg-zinc-800 data-[state=active]:text-white data-[state=active]:shadow sm:text-xs"
                  >
                    <MapPin className="size-3.5" />
                    <span className="hidden sm:inline">Endereços</span>
                    <span className="sm:hidden">End.</span>
                    <span className="ml-1 text-[9px] opacity-70">
                      ({addresses.length})
                    </span>
                  </TabsTrigger>
                </TabsList>

                {/* Orders Matrix */}
                <TabsContent value="orders" className="mt-0 outline-none">
                  <div className="overflow-hidden rounded-[1.2rem] bg-zinc-900/20">
                    <div className="border-b border-zinc-800/50 bg-zinc-900/50 p-4">
                      <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white">
                        Extrato Histórico
                      </h2>
                    </div>
                    <div className="p-0">
                      {orders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 shadow-inner">
                            <Package className="size-6 text-zinc-700" />
                          </div>
                          <p className="text-sm font-bold text-zinc-500">
                            Fluxo Zerado
                          </p>
                          <p className="mt-1 text-xs text-zinc-600">
                            Este cliente ainda não integralizou aquisições.
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader className="border-b border-zinc-800/80 bg-zinc-950/60 hover:bg-zinc-950/60">
                              <TableRow className="border-none hover:bg-transparent">
                                <TableHead className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                  Registro
                                </TableHead>
                                <TableHead className="py-4 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                  Timeline
                                </TableHead>
                                <TableHead className="max-w-[120px] py-4 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                  Situação
                                </TableHead>
                                <TableHead className="py-4 text-right text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                  Volume
                                </TableHead>
                                <TableHead className="px-6 py-4" />
                              </TableRow>
                            </TableHeader>
                            <TableBody className="divide-y divide-zinc-800/30">
                              {orders.map((order) => (
                                <TableRow
                                  key={order.id}
                                  className="cursor-pointer border-none border-zinc-800 transition-colors hover:bg-zinc-800/40"
                                  onClick={() =>
                                    // "order-details" é a tela do CLIENTE
                                    // (App.tsx) e busca em `fetchUserOrders()`
                                    // filtrado por `user_id` do usuário
                                    // logado — nunca acha o pedido de outra
                                    // pessoa. O painel abre pedido avulso por
                                    // "admin-orders" (AdminOrdersView), que
                                    // recebe o id como `selectedOrderId` e
                                    // busca em `marketplace_orders` sem esse
                                    // filtro.
                                    onNavigate("admin-orders", order.id)
                                  }
                                >
                                  <TableCell className="px-6 py-4 font-mono text-[11px] font-bold text-zinc-300">
                                    <span className="mr-1 text-zinc-600">
                                      #
                                    </span>
                                    {order.id.substring(0, 8).toUpperCase()}
                                  </TableCell>
                                  <TableCell className="py-4 text-xs font-medium text-zinc-400">
                                    {format(
                                      new Date(order.createdAt),
                                      "dd MMMM, yy",
                                      { locale: ptBR },
                                    )}
                                  </TableCell>
                                  <TableCell className="py-4">
                                    <div className="origin-left scale-90">
                                      {getStatusBadge(order.status)}
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-4 text-right font-black tracking-tight text-white">
                                    {formatCurrency(order.total)}
                                  </TableCell>
                                  <TableCell className="px-6 py-4 text-right">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8 rounded-lg text-zinc-500 hover:bg-admin-gold/10 hover:text-admin-gold"
                                    >
                                      <ExternalLink className="size-4" />
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
                  <div className="relative overflow-hidden rounded-[1.2rem] border border-green-500/10 bg-zinc-900/20">
                    <div className="pointer-events-none absolute -left-40 -top-40 size-96 rounded-full bg-green-500/5 blur-[100px]" />

                    <div className="relative z-10 flex flex-col justify-between gap-3 border-b border-zinc-800/50 bg-zinc-900/50 p-5 sm:flex-row sm:items-center">
                      <div>
                        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-white">
                          Auditoria de Carrinho
                          <span className="relative ml-1 flex size-2">
                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                          </span>
                        </h2>
                        <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-500">
                          Produtos retidos na estrutura de checkout
                        </p>
                        {cartItems.length > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <Badge className="border-none bg-green-500 text-[9px] font-black text-black shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                              {cartItems.length} Elementos
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleClearUserCart}
                              disabled={isOffline}
                              className="h-7 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 text-[8px] font-black uppercase tracking-widest text-red-500 shadow-sm transition-all hover:bg-red-500/20 disabled:pointer-events-none disabled:opacity-40"
                            >
                              Limpar Carrinho
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="relative z-10 p-0">
                      {cartItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 shadow-inner">
                            <ShoppingCart className="size-6 text-zinc-700" />
                          </div>
                          <p className="text-sm font-bold text-zinc-500">
                            Funil Vazio
                          </p>
                          <p className="mt-1 text-xs text-zinc-600">
                            Este cliente não retém ativos pre-checkout.
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader className="border-b border-zinc-800/80 bg-zinc-950/60 hover:bg-zinc-950/60">
                              <TableRow className="border-none hover:bg-transparent">
                                <TableHead className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                  Identificador do Ativo
                                </TableHead>
                                <TableHead className="py-4 text-center text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                  Densidade
                                </TableHead>
                                <TableHead className="py-4 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                  Precificação Base
                                </TableHead>
                                <TableHead className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                  Estimativa (BRL)
                                </TableHead>
                                <TableHead className="px-6 py-4" />
                              </TableRow>
                            </TableHeader>
                            <TableBody className="divide-y divide-zinc-800/30">
                              {cartItems.map((item, idx) => {
                                const hasVariantId = !!item.variantId;
                                const variant = hasVariantId
                                  ? item.product.variants?.find(
                                      (v) => v.id === item.variantId,
                                    )
                                  : null;
                                const isVariantMissing =
                                  hasVariantId && !variant;
                                const unitPrice =
                                  variant?.priceOverride || item.product.price;

                                return (
                                  <TableRow
                                    key={idx}
                                    className="border-none border-zinc-800 transition-colors hover:bg-zinc-800/40"
                                  >
                                    <TableCell className="px-6 py-3">
                                      <div className="flex items-center gap-3">
                                        <Avatar className="size-10 rounded-lg border border-zinc-800 shadow-xl">
                                          <AvatarImage
                                            src={item.product.images[0]}
                                            className="object-cover"
                                          />
                                          <AvatarFallback className="bg-zinc-900 font-black text-zinc-600">
                                            ?
                                          </AvatarFallback>
                                        </Avatar>
                                        <div className="flex min-w-0 flex-col">
                                          <span className="w-[130px] truncate text-xs font-bold leading-tight text-white sm:w-[220px]">
                                            {item.product.name}
                                          </span>
                                          {variant && (
                                            <span className="mt-0.5 w-fit rounded bg-admin-gold/10 px-1 py-0.5 text-[8px] font-black uppercase tracking-widest text-admin-gold">
                                              {variant.name}: {variant.value}
                                            </span>
                                          )}
                                          {isVariantMissing && (
                                            <span className="mt-0.5 w-fit rounded border border-red-500/20 bg-red-500/10 px-1 py-0.5 text-[8px] font-black uppercase tracking-widest text-red-500">
                                              Variante Indisponível (ID:{" "}
                                              {item.variantId})
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 text-center">
                                      <div className="inline-flex size-7 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-xs font-black text-zinc-300">
                                        {item.quantity}
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 text-xs font-bold text-zinc-400">
                                      {formatCurrency(unitPrice)}
                                    </TableCell>
                                    <TableCell className="px-6 py-3 text-right text-xs font-black tracking-tight text-green-500">
                                      {formatCurrency(
                                        unitPrice * item.quantity,
                                      )}
                                    </TableCell>
                                    <TableCell className="px-6 py-3 text-right">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() =>
                                          handleRemoveCartItem(
                                            item.product.id,
                                            item.variantId,
                                          )
                                        }
                                        disabled={isOffline}
                                        className="size-8 rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-40"
                                        title="Remover do Carrinho"
                                      >
                                        <Trash2 className="size-4" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                              <TableRow className="border-t border-green-500/20 bg-gradient-to-r from-transparent via-green-500/5 to-green-500/10 hover:bg-transparent">
                                <TableCell
                                  colSpan={4}
                                  className="py-4 text-right text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400"
                                >
                                  Total Previsível do Retido
                                </TableCell>
                                <TableCell className="bg-gradient-to-r from-green-400 to-green-600 bg-clip-text px-6 py-4 text-right text-lg font-black tracking-tighter text-transparent">
                                  {formatCurrency(
                                    cartItems.reduce((acc, item) => {
                                      const variant = item.variantId
                                        ? item.product.variants?.find(
                                            (v) => v.id === item.variantId,
                                          )
                                        : null;
                                      return (
                                        acc +
                                        (variant?.priceOverride ||
                                          item.product.price) *
                                          item.quantity
                                      );
                                    }, 0),
                                  )}
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
                  <div className="overflow-hidden rounded-[1.2rem] bg-zinc-900/20">
                    <div className="border-b border-zinc-800/50 bg-zinc-900/50 p-4">
                      <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-white">
                        <MapPin className="size-3.5 text-admin-gold" />
                        Destinos de Entrega
                      </h2>
                    </div>
                    <div className="p-4">
                      {addresses.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 shadow-inner">
                            <MapPin className="size-6 text-zinc-700" />
                          </div>
                          <p className="text-sm font-bold text-zinc-500">
                            Nenhum Endereço
                          </p>
                          <p className="mt-1 text-xs text-zinc-600">
                            Este cliente não possui destinos cadastrados.
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {addresses.map((addr) => (
                            <div
                              key={addr.id}
                              className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 shadow-inner transition-colors hover:border-zinc-700"
                            >
                              {addr.is_default && (
                                <div className="pointer-events-none absolute right-0 top-0 size-12 overflow-hidden before:absolute before:-right-2 before:-top-2 before:border-[16px] before:border-transparent before:border-r-admin-gold/20 before:border-t-admin-gold/20 before:content-['']" />
                              )}
                              <div className="mb-2 flex items-center justify-between font-black text-white">
                                <span className="truncate pr-2 text-xs">
                                  {addr.name}
                                </span>
                                {addr.is_default && (
                                  <Badge className="h-4 border-none bg-admin-gold px-1.5 text-[8px] font-black uppercase tracking-widest text-black shadow-[0_0_10px_rgba(255,191,0,0.3)]">
                                    PADRÃO
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-2 space-y-0.5">
                                <p className="text-xs font-medium text-zinc-300">
                                  {addr.street},{" "}
                                  <span className="font-bold text-zinc-200">
                                    {addr.number}
                                  </span>
                                  {addr.complement
                                    ? ` - ${addr.complement}`
                                    : ""}
                                </p>
                                <p className="text-[11px] text-zinc-400">
                                  {addr.neighborhood}, {addr.city}-{addr.state}{" "}
                                  <span className="mx-1 text-zinc-700">•</span>{" "}
                                  <span className="font-mono text-[9px] text-zinc-500">
                                    {addr.cep}
                                  </span>
                                </p>
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
      )}

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Ficha Detalhada do Cliente"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Esta tela detalha o perfil individual de um cliente, incluindo
            histórico completo de compras, endereços de entrega cadastrados e
            itens retidos no carrinho de compras.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Seções do Perfil
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <MapPin className="size-4 text-emerald-500" />
                  Endereços de Entrega
                </div>
                <p className="text-xs text-zinc-400">
                  Os locais cadastrados pelo cliente para recebimento das
                  entregas das compras efetuadas.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <ShoppingCart className="size-4 text-admin-gold" />
                  Histórico de Pedidos
                </div>
                <p className="text-xs text-zinc-400">
                  Relação de todas as transações feitas pelo cliente na loja,
                  incluindo valores, formas de pagamento e status dos envios.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Package className="size-4 text-sky-500" />
                  Carrinho Atual (Abandonado)
                </div>
                <p className="text-xs text-zinc-400">
                  Exibe em tempo real quais itens o cliente adicionou ao
                  carrinho mas ainda não finalizou a compra. Útil para ações de
                  remarketing.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <User className="size-4 text-purple-500" />
                  Funções Administrativas
                </div>
                <p className="text-xs text-zinc-400">
                  Permite ao administrador entrar em contato direto via WhatsApp
                  ou aplicar bloqueios de segurança se for um usuário
                  fraudulento.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>

      {/* Diálogo de Confirmação de Remoção de Item do Carrinho */}
      <AlertDialog
        open={cartItemToRemove !== null}
        onOpenChange={(open) => !open && setCartItemToRemove(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
              Remover Item?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Tem certeza que deseja remover este item do carrinho do cliente?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="rounded-xl border border-0 border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveCartItem}
              className="bg-rose-650 rounded-xl border-0 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
            >
              Remover Item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de Confirmação de Limpeza de Carrinho */}
      <AlertDialog
        open={isClearingCart}
        onOpenChange={(open) => !open && setIsClearingCart(false)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
              Limpar Carrinho?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Tem certeza que deseja limpar completamente o carrinho deste
              cliente? Esta ação removerá todos os produtos adicionados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="rounded-xl border border-0 border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClearUserCart}
              className="bg-rose-650 rounded-xl border-0 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
            >
              Limpar Carrinho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
