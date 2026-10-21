import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  type AvaliacaoDaFicha,
  type PerguntaDaFicha,
  VozClienteTab,
} from "@/components/admin/users/VozClienteTab";
import { calcularResumoFicha } from "@/components/admin/users/ficha-resumo";
import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
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
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { abrirWhatsapp } from "@/lib/abrir-whatsapp";
import { mapOrderFromDB, mapProductFromDB } from "@/lib/mappers";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { papel } from "@/lib/papeis-aria-da-tabela";
import { rotuloDoPapel } from "@/lib/papel-da-conta";
import { precoVendido } from "@/lib/preco-vendido";
import { supabase } from "@/lib/supabase";
import { classeDoTexto, tomDoValor } from "@/lib/tons-de-estado";
import { formatCurrency } from "@/lib/utils";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { Address, CartItem, Order, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  HelpCircle,
  MapPin,
  Package,
  ShoppingCart,
  Star,
  Trash2,
  User,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
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
  const [idCarregado, setIdCarregado] = useState<string | null>(null);
  // Troca de cliente, nova tentativa e desmontagem invalidam respostas antigas.
  const consultaFicha = useRef(0);
  const consultaVoz = useRef(0);
  const fichaCarregada = !loading && idCarregado === userId && isAdmin;
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

  /*
    Aba "Voz do Cliente": o que ESTE cliente escreveu — avaliações e
    perguntas.

    De onde vem o dado: leitura DIRETA nas mesmas tabelas dos hooks
    `useReviews`/`useQuestions` (`reviews` e `questions`), sob as MESMAS
    policies de leitura pública (`reviews_select_policy` e
    `questions_select_policy`, ambas `USING (true)` na baseline
    20260806000000). Os hooks não servem aqui porque nenhum filtra por
    autor: `getAllReviews`/`getAllQuestions` são paginados (20/página) para
    a fila de moderação inteira — filtrar um autor no cliente traria lista
    TRUNCADA, e a ficha diria "2 avaliações" sobre quem escreveu 9. O
    `.eq("user_id", ...)` entrega o recorte completo com o mesmo direito de
    leitura que a tela de produto já usa. Nenhuma RPC nova, nenhuma
    migration.

    Falha ≠ vazio: `vozErro` existe porque "não consegui consultar" e
    "ele nunca escreveu" são frases diferentes (mesma lição do `erro` no
    FavoritesContext e do `QAStatsResult` no useQuestions).
  */
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoDaFicha[]>([]);
  const [perguntas, setPerguntas] = useState<PerguntaDaFicha[]>([]);
  const [vozCarregando, setVozCarregando] = useState(true);
  const [vozErro, setVozErro] = useState<string | null>(null);

  const carregarVoz = useCallback(async () => {
    if (!isAdmin) return;
    const consulta = ++consultaVoz.current;
    setVozCarregando(true);
    setVozErro(null);
    setAvaliacoes([]);
    setPerguntas([]);
    try {
      const [resReviews, resQuestions] = await Promise.all([
        supabase
          .from("reviews")
          .select("*, product:produtos(nome)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        supabase
          .from("questions")
          .select("*, product:produtos(nome), answers:answers(*)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
      ]);
      if (consulta !== consultaVoz.current) return;
      if (resReviews.error) throw resReviews.error;
      if (resQuestions.error) throw resQuestions.error;

      setAvaliacoes(
        ((resReviews.data ?? []) as any[]).map((item) => ({
          id: item.id as string,
          productId: item.product_id as string,
          produtoNome: item.product?.nome || "Produto removido",
          rating: item.rating as number,
          comment: (item.comment as string) || "",
          // Item 8 do laudo de 29/08: ausente = publicada (mesma regra do
          // tipo Review e do hook) — dublês e avaliações antigas não têm a
          // coluna populada.
          status: item.status ?? "publicada",
          helpful: item.helpful ?? 0,
          merchantReply: item.merchant_reply ?? null,
          createdAt: item.created_at as string,
        })),
      );

      setPerguntas(
        ((resQuestions.data ?? []) as any[]).map((item) => ({
          id: item.id as string,
          productId: item.product_id as string,
          produtoNome: item.product?.nome || "Produto removido",
          question: item.question as string,
          createdAt: item.created_at as string,
          respostas: ((item.answers ?? []) as any[])
            .map((ans) => ({
              id: ans.id as string,
              answer: ans.answer as string,
              createdAt: ans.created_at as string,
            }))
            .sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
            ),
        })),
      );
    } catch (err) {
      if (consulta !== consultaVoz.current) return;
      console.error("[AdminUserDetail] Erro ao carregar voz do cliente:", err);
      setVozErro("Não foi possível carregar o que este cliente escreveu.");
    } finally {
      if (consulta === consultaVoz.current) setVozCarregando(false);
    }
  }, [userId, isAdmin]);

  useEffect(() => {
    const controle = consultaVoz;
    carregarVoz();
    return () => {
      controle.current++;
    };
  }, [carregarVoz]);

  const handleCopy = (text: string, field: "id" | "email" | "whatsapp") => {
    haptic.light();
    const label =
      field === "id" ? "ID" : field === "email" ? "E-mail" : "Telefone";
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedField(field);
        toast.success(`${label} copiado com sucesso!`);
        setTimeout(() => setCopiedField(null), 2000);
      })
      .catch(() => {
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
    const consulta = ++consultaFicha.current;
    setLoading(true);
    setLoadFailed(false);
    setIdCarregado(null);
    setProfile(null);
    setOrders([]);
    setAddresses([]);
    setCartItems([]);
    setCartItemToRemove(null);
    setIsClearingCart(false);
    setCopiedField(null);
    try {
      const { data, error } = await supabase.rpc("get_admin_user_detail", {
        p_user_id: userId,
      });

      if (consulta !== consultaFicha.current) return;
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

        if (consulta !== consultaFicha.current) return;
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
      setIdCarregado(userId);
    } catch (err) {
      if (consulta !== consultaFicha.current) return;
      console.error("[AdminUserDetail] Error fetching data:", err);
      toast.error("Erro ao carregar dados do usuário");
      setLoadFailed(true);
    } finally {
      if (consulta === consultaFicha.current) setLoading(false);
    }
  }, [userId, isAdmin]);

  useEffect(() => {
    const controle = consultaFicha;
    fetchUserData();
    return () => {
      controle.current++;
    };
  }, [fetchUserData]);

  const handleRemoveCartItem = (productId: string, variantId?: string) => {
    if (!fichaCarregada) return;
    setCartItemToRemove({ productId, variantId });
  };

  const confirmRemoveCartItem = async () => {
    if (!cartItemToRemove || !fichaCarregada || !idCarregado) return;
    const consulta = consultaFicha.current;
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
        .eq("user_id", idCarregado)
        .eq("product_id", productId);

      if (variantId) {
        query = query.eq("variant_id", variantId);
      } else {
        query = query.is("variant_id", null);
      }

      const { data, error } = await query;

      if (consulta !== consultaFicha.current) return;
      if (error) throw error;

      // A policy de DELETE de `cart_items` ganhou o ramo de admin na
      // migration 20261067000000 (laudo 0109, A-2): `auth.uid() = user_id OR
      // is_admin()` — a lojista AGORA apaga o carrinho de outra pessoa de
      // verdade. A guarda abaixo continua valendo como fileira de defesa:
      // se a policy voltar a mudar, o zero-linhas reaparece aqui em vez de
      // a tela comemorar uma remoção que não aconteceu.
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
      if (consulta !== consultaFicha.current) return;
      console.error("Error removing cart item:", err);
      toast.error("Erro ao remover item do carrinho");
    } finally {
      if (consulta === consultaFicha.current) setCartItemToRemove(null);
    }
  };

  const handleClearUserCart = () => {
    if (!fichaCarregada) return;
    setIsClearingCart(true);
  };

  const confirmClearUserCart = async () => {
    if (!fichaCarregada || !idCarregado) return;
    const consulta = consultaFicha.current;
    if (isOffline) {
      toast.error("Operação negada: Você está offline.");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("cart_items")
        .delete()
        .select("id")
        .eq("user_id", idCarregado);

      if (consulta !== consultaFicha.current) return;
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
      if (consulta !== consultaFicha.current) return;
      console.error("Error clearing user cart:", err);
      toast.error("Erro ao limpar carrinho");
    } finally {
      if (consulta === consultaFicha.current) setIsClearingCart(false);
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
    Os quatro números do resumo (total já comprado, nº de pedidos, última
    compra e valor médio por venda) nascem de UM lugar: `calcularResumoFicha`
    (src/components/admin/users/ficha-resumo.ts), que carrega as regras e a
    história delas:

    - Pedido CANCELADO (ou devolvido) NÃO entra na contagem nem no total
      gasto — mesma regra do servidor na lista de Clientes
      (`status NOT IN ('cancelled','returned')`);
    - Dinheiro só com cobrança reconhecida: 'pago', 'pago_apos_expirar' e
      'recebido_na_entrega' (migrations 20260823000000 e 20261021000000);
      nulo, 'aguardando', 'recusado', 'expirado' e 'estornado' ficam fora;
    - Última compra e contagem NÃO filtram cobrança (mesma regra do
      `last_order_date`/`orders_count` do servidor);
    - Valor médio por venda = total gasto ÷ pedidos COM dinheiro reconhecido — a
      fórmula do `get_admin_analytics_v2` aplicada ao recorte do cliente.

    A ABA de pedidos continua mostrando o histórico inteiro de propósito:
    é o número de linhas que a tabela abaixo dela lista.
  */
  const resumo = calcularResumoFicha(orders);
  const { pedidosQueContam, pedidosDescartados } = resumo;
  // Número sem DDD+telefone (menos de 10 dígitos) não abre conversa: o botão
  // "Contato Direto" fica desabilitado em vez de abrir um link quebrado.
  const linkWhatsapp = linkWhatsappDoCliente(profile?.whatsapp);
  // Botão desabilitado sem explicação confunde: diz o porquê (só quando o
  // motivo é o cadastro; offline já tem o seu aviso na barra do painel).
  let avisoDoWhatsapp: string | undefined;
  if (!profile?.whatsapp) avisoDoWhatsapp = "Cliente sem WhatsApp cadastrado";
  else if (!linkWhatsapp)
    avisoDoWhatsapp = "Número sem DDD — corrija o cadastro";

  const renderContentSkeleton = () => (
    <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left Column: Profile Card Skeleton */}
      <div className="space-y-6 rounded-3xl border border-admin-border bg-zinc-900/40 p-6 backdrop-blur-3xl lg:col-span-4">
        <div className="flex flex-col items-center space-y-3">
          <Skeleton className="size-20 animate-pulse rounded-full bg-white/5" />
          <Skeleton className="h-5 w-40 animate-pulse rounded bg-white/5" />
          <Skeleton className="h-4 w-28 animate-pulse rounded bg-white/5" />
        </div>
        <div className="space-y-4 border-t border-admin-border pt-4">
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
              className="space-y-2 rounded-2xl border border-admin-border bg-zinc-900/40 p-4"
            >
              <Skeleton className="h-3 w-12 animate-pulse rounded bg-white/5" />
              <Skeleton className="h-6 w-20 animate-pulse rounded bg-white/5" />
            </div>
          ))}
        </div>
        <div className="space-y-4 rounded-3xl border border-admin-border bg-zinc-900/40 p-6">
          <Skeleton className="h-4.5 w-32 animate-pulse rounded bg-white/5" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-admin-border py-2 last:border-0"
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
    <div className="pb-admin mx-auto max-w-7xl space-y-6 px-4 duration-200 animate-in fade-in md:px-0 lg:pb-12">
      {/* Header / Actions */}
      <div className="mt-6 flex min-w-0 items-center gap-4">
        <div className="w-full min-w-0">
          {/* Reforma visual (03/09, frente ficha do cliente): o título tinha
              fórmula própria (text-xl sm:text-2xl) — agora nasce do
              AdminPageHeader, igual ao resto do painel (PR #413). O botão de
              ajuda continua dentro da linha do título, como em Cupons. */}
          <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-user-detail"]}>
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full active:scale-95"
              title="Guia da ficha do cliente e ajuda"
            >
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full border border-admin-border bg-admin-surface text-zinc-500 transition-all duration-300 group-hover:border-admin-border-strong group-hover:text-white"
              >
                <HelpCircle className="size-4.5" />
              </span>
            </button>
          </AdminPageHeader>
        </div>
      </div>

      {loadFailed && !loading ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center bg-admin-bg text-white">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-red-400">
            Não foi possível carregar os dados deste cliente
          </p>
          <button
            onClick={() => fetchUserData()}
            className="mt-4 min-h-11 rounded-lg border border-admin-border bg-white/5 px-4 text-[11px] font-black uppercase tracking-widest text-white hover:border-amber-500/30"
          >
            Tentar novamente
          </button>
        </div>
      ) : !fichaCarregada ? (
        renderContentSkeleton()
      ) : (
        <div className="relative grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Left Column: Profile Card */}
          <Card className="relative h-fit min-w-0 gap-0 overflow-hidden rounded-3xl border border-admin-border bg-admin-surface py-0 shadow-sm lg:col-span-4">
            <CardHeader className="relative flex flex-row flex-wrap items-center gap-x-4 gap-y-5 space-y-0 px-4 pb-0 pt-6">
              <div className="relative shrink-0 rounded-full">
                <Avatar className="size-16 rounded-full border border-admin-border">
                  <AvatarImage
                    src={profile?.avatar_url || undefined}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-zinc-800 text-xl font-bold text-zinc-300">
                    {profile?.full_name?.substring(0, 2).toUpperCase() || "CX"}
                  </AvatarFallback>
                </Avatar>
              </div>

              <div className="flex min-w-0 flex-1 flex-col items-start">
                <CardTitle className="break-words text-lg font-bold tracking-tight text-white">
                  {profile?.full_name || "Usuário Não-Nomeado"}
                </CardTitle>
                <p className="mt-1 text-xs text-zinc-400">
                  Cliente desde{" "}
                  {profile?.created_at
                    ? format(
                        new Date(profile.created_at),
                        "dd 'de' MMM, yyyy",
                        {
                          locale: ptBR,
                        },
                      )
                    : "N/A"}
                </p>
                <Badge className="mt-2 rounded-full border border-admin-border bg-admin-surface px-2 py-0.5 text-[11px] font-semibold text-zinc-400">
                  {rotuloDoPapel(profile?.role)}
                </Badge>
              </div>

              {/* Direct WhatsApp Call CTA */}
              <div className="w-full">
                <Button
                  variant="outline"
                  className="h-11 w-full gap-2 rounded-full border border-solid border-admin-border bg-admin-surface px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40"
                  disabled={!linkWhatsapp || isOffline}
                  title={avisoDoWhatsapp}
                  onClick={() => {
                    if (!linkWhatsapp || isOffline) return;
                    abrirWhatsapp(linkWhatsapp);
                  }}
                >
                  <IconeWhatsapp className="size-5 shrink-0 text-[#25D366]" />
                  Conversar no WhatsApp
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 px-4 py-5">
              {/* Info List */}
              <div className="divide-y divide-admin-border border-t border-admin-border">
                {/* Email row */}
                <div className="group/item flex items-center justify-between gap-3 py-2 text-xs transition-colors hover:bg-zinc-900/20">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                        Email
                      </span>
                      <span className="break-all font-semibold text-zinc-300">
                        {profile?.email || "N/A"}
                      </span>
                    </div>
                  </div>
                  {profile?.email && (
                    <button
                      type="button"
                      aria-label="Copiar e-mail"
                      onClick={() => handleCopy(profile.email!, "email")}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md p-1.5 text-zinc-500 opacity-100 transition-all hover:bg-zinc-800 hover:text-white hover-hover:opacity-0 hover-hover:group-hover/item:opacity-100"
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
                <div className="group/item flex items-center justify-between gap-3 py-2 text-xs transition-colors hover:bg-zinc-900/20">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                        Telefone / WhatsApp
                      </span>
                      <span className="break-all font-semibold text-zinc-300">
                        {profile?.whatsapp || "N/A"}
                      </span>
                    </div>
                  </div>
                  {profile?.whatsapp && (
                    <button
                      type="button"
                      aria-label="Copiar telefone"
                      onClick={() => handleCopy(profile.whatsapp!, "whatsapp")}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md p-1.5 text-zinc-500 opacity-100 transition-all hover:bg-zinc-800 hover:text-white hover-hover:opacity-0 hover-hover:group-hover/item:opacity-100"
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

                <div className="flex min-w-0 items-center justify-between gap-3 py-2 text-xs">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                      ID do cliente
                    </span>
                    <button
                      onClick={() => handleCopy(userId, "id")}
                      className="flex min-h-11 min-w-0 items-center gap-3 text-left font-mono text-[11px] text-zinc-300"
                      aria-label="Copiar ID do cliente"
                    >
                      <span className="break-all">{userId}</span>
                      {copiedField === "id" ? (
                        <Check className="size-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <Copy className="size-3.5 shrink-0 text-zinc-500" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Right Column: LTV, Financials and Tabs */}
          <div className="min-w-0 space-y-5 lg:col-span-8">
            {/* Quick Stats Grid — o resumo responde "quem é este cliente" sem
                abrir aba: quanto gastou, quantas vezes, qual o tíquete médio e
                quando foi a última vez (frente ficha do cliente, 03/09). */}
            <div className="grid min-w-0 grid-cols-3 overflow-hidden rounded-3xl border border-admin-border bg-admin-surface p-4 shadow-sm">
              {/* Cartão do "total gasto" do resumo. O rótulo é "Total já
                  comprado": o mesmo nome deste número na lista de Clientes,
                  e os testes vivos da tela leem o cartão por este rótulo. */}
              <div className="col-span-2 flex min-w-0 items-center justify-between pb-5">
                <div className="flex min-w-0 flex-col">
                  <span className="mb-1 text-[11px] font-semibold text-zinc-500">
                    Total já comprado
                  </span>
                  <span
                    className={`break-words text-3xl font-bold tracking-tight sm:text-4xl ${classeDoTexto(tomDoValor(resumo.totalGasto))}`}
                  >
                    {formatCurrency(resumo.totalGasto)}
                  </span>
                </div>
              </div>

              {/* Total Orders Widget */}
              <div className="flex min-w-0 items-center justify-end pb-5 text-right">
                <div className="flex min-w-0 flex-col">
                  <span className="mb-1 text-[11px] font-semibold text-zinc-500">
                    Pedidos feitos
                  </span>
                  <span className="break-words text-sm font-bold tracking-tight text-white sm:text-base">
                    {pedidosQueContam.length}
                  </span>
                  {pedidosDescartados > 0 && (
                    <span className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
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
              </div>

              {/* Ticket Médio Widget — total gasto ÷ pedidos COM dinheiro
                  reconhecido (a fórmula do `get_admin_analytics_v2` no recorte
                  deste cliente; a regra completa vive em
                  `ficha-resumo.ts`, regra 4). Zero pedido pago mostra R$ 0,00
                  porque foi MEDIDO (o `ELSE 0` do servidor), não inventado. */}
              <div className="flex min-w-0 items-start border-t border-admin-border pr-2 pt-4">
                <div className="flex min-w-0 flex-col">
                  <span className="mb-1 text-[11px] font-semibold text-zinc-500">
                    Valor médio por venda
                  </span>
                  <span className="break-words text-sm font-bold tracking-tight text-white sm:text-base">
                    {formatCurrency(resumo.ticketMedio)}
                  </span>
                </div>
              </div>

              {/* Última Compra Widget — data do pedido que conta mais recente
                  (não cancelado/devolvido, SEM filtro de cobrança: mesma
                  regra do `last_order_date` do servidor; um PIX aguardando
                  feito ontem prova que o cliente está ativo). Sem pedido que
                  conta, "—" — nunca data inventada. */}
              <div className="flex min-w-0 items-start border-t border-admin-border px-2 pt-4">
                <div className="flex min-w-0 flex-col">
                  <span className="mb-1 text-[11px] font-semibold text-zinc-500">
                    Última Compra
                  </span>
                  <span className="break-words text-sm font-bold tracking-tight text-white sm:text-base">
                    {resumo.ultimaCompra
                      ? format(resumo.ultimaCompra, "dd MMM yy", {
                          locale: ptBR,
                        })
                      : "—"}
                  </span>
                </div>
              </div>

              {/* Resumo do carrinho: conta PRODUTOS diferentes (as linhas do
                  carrinho), a mesma conta do selo e da aba — três números
                  diferentes para a mesma coisa (4 itens / 3 produtos / 4)
                  faziam a lojista desconfiar de todos. */}
              <div className="flex min-w-0 items-start border-t border-admin-border pl-2 pt-4">
                <div className="flex min-w-0 flex-col">
                  <span className="mb-1 text-[11px] font-semibold text-zinc-500">
                    Carrinho do cliente
                  </span>
                  <span className="break-words text-sm font-bold tracking-tight text-white sm:text-base">
                    {cartItems.length}{" "}
                    <span className="text-[11px] font-semibold text-zinc-500">
                      {cartItems.length === 1 ? "produto" : "produtos"}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* Operational Tabs */}
            <div className="min-w-0 space-y-4">
              <Tabs defaultValue="orders" className="w-full">
                <TabsList className="mb-4 grid h-auto w-full grid-cols-4 gap-1 rounded-3xl border border-admin-border bg-admin-surface p-1">
                  <TabsTrigger
                    value="orders"
                    className="relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0 py-2.5 text-[11px] font-semibold text-zinc-500 transition-all data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
                  >
                    <Package className="size-3.5" />
                    <span>Pedidos</span>
                    <span className="absolute right-0 top-0 rounded-full bg-admin-surface px-1 text-[11px] text-zinc-400 sm:right-2">
                      ({orders.length})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="cart"
                    className="relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0 py-2.5 text-[11px] font-semibold text-zinc-500 transition-all data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
                  >
                    <ShoppingCart className="size-3.5" />
                    <span>Carrinho</span>
                    <span className="absolute right-0 top-0 rounded-full bg-admin-surface px-1 text-[11px] text-zinc-400 sm:right-2">
                      ({cartItems.length})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="addresses"
                    className="relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0 py-2.5 text-[11px] font-semibold text-zinc-500 transition-all data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
                  >
                    <MapPin className="size-3.5" />
                    <span>Endereços</span>
                    <span className="absolute right-0 top-0 rounded-full bg-admin-surface px-1 text-[11px] text-zinc-400 sm:right-2">
                      ({addresses.length})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="voz"
                    className="relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0 py-2.5 text-[11px] font-semibold text-zinc-500 transition-all data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
                  >
                    <Star className="size-3.5" />
                    <span>
                      Voz<span className="hidden sm:inline"> do Cliente</span>
                    </span>
                    <span className="absolute right-0 top-0 rounded-full bg-admin-surface px-1 text-[11px] text-zinc-400 sm:right-2">
                      ({avaliacoes.length + perguntas.length})
                    </span>
                  </TabsTrigger>
                </TabsList>

                {/* Orders Matrix */}
                <TabsContent value="orders" className="mt-0 outline-none">
                  <div className="min-w-0">
                    <div className="pb-3 pt-1">
                      <h2 className="text-base font-bold tracking-tight text-white">
                        Extrato Histórico
                      </h2>
                    </div>
                    <div className="p-0">
                      {orders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-admin-border bg-zinc-900 shadow-inner">
                            <Package className="size-6 text-zinc-700" />
                          </div>
                          <p className="text-sm font-bold text-zinc-500">
                            Nenhum pedido ainda
                          </p>
                          <p className="mt-1 text-xs text-zinc-600">
                            Quando este cliente comprar, os pedidos aparecem
                            aqui.
                          </p>
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <Table {...papel("table")} className="block sm:table">
                            <TableHeader
                              {...papel("rowgroup")}
                              className="sr-only border-b border-admin-border bg-admin-surface sm:not-sr-only sm:table-header-group"
                            >
                              <TableRow
                                {...papel("row")}
                                className="border-none hover:bg-transparent"
                              >
                                <TableHead
                                  {...papel("columnheader")}
                                  className="px-6 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
                                >
                                  Registro
                                </TableHead>
                                <TableHead
                                  {...papel("columnheader")}
                                  className="py-4 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
                                >
                                  Timeline
                                </TableHead>
                                <TableHead
                                  {...papel("columnheader")}
                                  className="max-w-[120px] py-4 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
                                >
                                  Situação
                                </TableHead>
                                <TableHead
                                  {...papel("columnheader")}
                                  className="py-4 text-right text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
                                >
                                  Volume
                                </TableHead>
                                <TableHead
                                  {...papel("columnheader")}
                                  className="px-6 py-4"
                                />
                              </TableRow>
                            </TableHeader>
                            <TableBody
                              {...papel("rowgroup")}
                              className="block space-y-2 sm:table-row-group sm:space-y-0"
                            >
                              {orders.map((order) => (
                                <TableRow
                                  key={order.id}
                                  {...papel("row")}
                                  className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-x-1 rounded-3xl border border-admin-border bg-admin-surface p-3 transition-colors hover:bg-zinc-800/40 sm:table-row sm:rounded-none sm:p-0"
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
                                  <TableCell
                                    {...papel("cell")}
                                    className="col-start-1 row-start-1 min-w-0 whitespace-normal break-words p-0 text-xs font-bold text-zinc-300 sm:px-6 sm:py-4"
                                  >
                                    <span className="sm:hidden">Pedido </span>
                                    <span className="mr-1 text-zinc-600">
                                      #
                                    </span>
                                    {numeroDoPedido(order.id)}
                                  </TableCell>
                                  <TableCell
                                    {...papel("cell")}
                                    className="col-start-1 row-start-2 min-w-0 whitespace-normal p-0 text-[11px] font-medium text-zinc-400 sm:p-2 sm:py-4"
                                  >
                                    {format(
                                      new Date(order.createdAt),
                                      "dd MMMM, yy",
                                      { locale: ptBR },
                                    )}
                                  </TableCell>
                                  <TableCell
                                    {...papel("cell")}
                                    className="col-start-2 row-start-2 p-0 text-right sm:p-2 sm:py-4 sm:text-left"
                                  >
                                    <div className="origin-right scale-90 sm:origin-left">
                                      {getStatusBadge(order.status)}
                                    </div>
                                  </TableCell>
                                  <TableCell
                                    {...papel("cell")}
                                    className="col-start-2 row-start-1 p-0 text-right text-sm font-bold tracking-tight text-white sm:p-2 sm:py-4"
                                  >
                                    {formatCurrency(order.total)}
                                  </TableCell>
                                  <TableCell
                                    {...papel("cell")}
                                    className="col-start-3 row-span-2 row-start-1 p-0 text-right sm:px-6 sm:py-4"
                                  >
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Abrir o pedido ${numeroDoPedido(order.id)}`}
                                      className="size-11 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-white"
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

                    <div className="relative z-10 flex flex-col justify-between gap-3 border-b border-admin-border bg-admin-surface p-5 sm:flex-row sm:items-center">
                      <div>
                        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-white">
                          Carrinho do cliente
                          <span className="relative ml-1 flex size-2">
                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                          </span>
                        </h2>
                        <p className="mt-1 text-[11px] uppercase tracking-widest text-zinc-500">
                          O que está no carrinho agora
                        </p>
                        {cartItems.length > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <Badge className="border-none bg-green-500 text-[11px] font-black text-black shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                              {cartItems.length}{" "}
                              {cartItems.length === 1 ? "produto" : "produtos"}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleClearUserCart}
                              disabled={isOffline || !fichaCarregada}
                              className="min-h-11 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 text-[11px] font-black uppercase tracking-widest text-red-500 shadow-sm transition-all hover:bg-red-500/20 disabled:pointer-events-none disabled:opacity-40"
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
                          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-admin-border bg-zinc-900 shadow-inner">
                            <ShoppingCart className="size-6 text-zinc-700" />
                          </div>
                          <p className="text-sm font-bold text-zinc-500">
                            Carrinho vazio
                          </p>
                          <p className="mt-1 text-xs text-zinc-600">
                            Este cliente não tem nada no carrinho agora.
                          </p>
                        </div>
                      ) : (
                        <div className="sm:overflow-x-auto">
                          {/* J2-D (celular): abaixo de `sm:` cada item do
                              carrinho é um BLOCO (produto e lixeira em cima;
                              quantidade e preço embaixo, com o total à
                              direita) e a tabela não rola na lateral; de
                              `sm:` para cima volta a ser tabela. Mesmo molde
                              do histórico de consultas de frete (J5):
                              `display: block` tira a semântica de tabela do
                              leitor de tela, por isso os papéis ARIA estão
                              escritos, e os títulos das colunas ficam só para
                              leitor de tela (`sr-only`) no celular, onde cada
                              valor traz o próprio rótulo. */}
                          <table
                            {...papel("table")}
                            className="block w-full text-left text-sm sm:table"
                          >
                            <thead
                              {...papel("rowgroup")}
                              className="sr-only border-b border-admin-border bg-zinc-950/60 sm:not-sr-only sm:table-header-group"
                            >
                              <tr {...papel("row")} className="sm:table-row">
                                <th
                                  {...papel("columnheader")}
                                  className="px-6 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
                                >
                                  Produto
                                </th>
                                <th
                                  {...papel("columnheader")}
                                  className="py-4 text-center text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
                                >
                                  Quantidade
                                </th>
                                <th
                                  {...papel("columnheader")}
                                  className="py-4 text-left text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
                                >
                                  Preço
                                </th>
                                <th
                                  {...papel("columnheader")}
                                  className="px-6 py-4 text-right text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
                                >
                                  Total
                                </th>
                                <th
                                  {...papel("columnheader")}
                                  className="px-6 py-4"
                                >
                                  <span className="sr-only">Remover</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody
                              {...papel("rowgroup")}
                              className="block sm:table-row-group sm:divide-y sm:divide-zinc-800/30"
                            >
                              {cartItems.map((item, idx) => {
                                const hasVariantId = !!item.variantId;
                                const variant = hasVariantId
                                  ? item.product.variants?.find(
                                      (v) => v.id === item.variantId,
                                    )
                                  : null;
                                const isVariantMissing =
                                  hasVariantId && !variant;
                                // Laudo 31/08 (menor E): `||` tratava o
                                // override ZERO como ausência e exibia o
                                // preço cheio de uma variação-brinde.
                                const unitPrice = precoVendido(
                                  item.product,
                                  variant,
                                );

                                return (
                                  <tr
                                    key={idx}
                                    {...papel("row")}
                                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-zinc-800/30 px-4 py-3 transition-colors first:border-t-0 hover:bg-zinc-800/40 sm:table-row sm:border-t-0 sm:p-0"
                                  >
                                    <td
                                      {...papel("cell")}
                                      className="col-start-1 row-start-1 block min-w-0 sm:table-cell sm:px-6 sm:py-3"
                                    >
                                      <div className="flex min-w-0 items-center gap-3">
                                        <Avatar className="size-10 shrink-0 rounded-lg border border-admin-border shadow-xl">
                                          <AvatarImage
                                            src={item.product.images[0]}
                                            className="object-cover"
                                          />
                                          <AvatarFallback className="bg-zinc-900 font-black text-zinc-600">
                                            ?
                                          </AvatarFallback>
                                        </Avatar>
                                        <div className="flex min-w-0 flex-1 flex-col sm:flex-none">
                                          <span className="truncate text-xs font-bold leading-tight text-white sm:w-[220px]">
                                            {item.product.name}
                                          </span>
                                          {variant && (
                                            <span className="mt-0.5 w-fit rounded bg-admin-gold/10 px-1 py-0.5 text-[11px] font-black uppercase tracking-widest text-admin-gold">
                                              {variant.name}: {variant.value}
                                            </span>
                                          )}
                                          {isVariantMissing && (
                                            <>
                                              <span
                                                title={`Código da variação: ${item.variantId}`}
                                                className="mt-0.5 w-fit rounded border border-red-500/20 bg-red-500/10 px-1 py-0.5 text-[11px] font-black uppercase tracking-widest text-red-500"
                                              >
                                                Esta variação não existe mais
                                              </span>
                                              {/* O `title` não aparece no
                                                  celular: o código fica à vista
                                                  para a lojista passar ao
                                                  suporte. */}
                                              <span className="mt-0.5 break-all text-[11px] text-zinc-500">
                                                Código: {item.variantId}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td
                                      {...papel("cell")}
                                      className="col-start-1 row-start-2 block text-xs text-zinc-400 sm:table-cell sm:py-3 sm:text-center"
                                    >
                                      <span className="sm:hidden">
                                        Quantidade:{" "}
                                      </span>
                                      <span className="font-black text-zinc-300 sm:inline-flex sm:size-7 sm:items-center sm:justify-center sm:rounded sm:border sm:border-admin-border sm:bg-zinc-950">
                                        {item.quantity}
                                      </span>
                                    </td>
                                    <td
                                      {...papel("cell")}
                                      className="col-start-1 row-start-3 block text-xs font-bold text-zinc-400 sm:table-cell sm:py-3"
                                    >
                                      <span className="font-normal sm:hidden">
                                        Preço:{" "}
                                      </span>
                                      {formatCurrency(unitPrice)}
                                    </td>
                                    <td
                                      {...papel("cell")}
                                      className="col-start-2 row-span-2 row-start-2 block self-center text-right text-xs font-black tracking-tight text-green-500 sm:table-cell sm:px-6 sm:py-3"
                                    >
                                      <span className="block text-[11px] font-bold uppercase tracking-wide text-zinc-400 sm:hidden">
                                        Total
                                      </span>
                                      {formatCurrency(
                                        unitPrice * item.quantity,
                                      )}
                                    </td>
                                    <td
                                      {...papel("cell")}
                                      className="col-start-2 row-start-1 block text-right sm:table-cell sm:px-6 sm:py-3"
                                    >
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() =>
                                          handleRemoveCartItem(
                                            item.product.id,
                                            item.variantId,
                                          )
                                        }
                                        disabled={isOffline || !fichaCarregada}
                                        className="size-11 rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-40"
                                        title="Remover do Carrinho"
                                      >
                                        <Trash2 className="size-4" />
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                              <tr
                                {...papel("row")}
                                className="flex items-center justify-between gap-3 border-t border-green-500/20 bg-gradient-to-r from-transparent via-green-500/5 to-green-500/10 p-4 sm:table-row sm:p-0"
                              >
                                <td
                                  {...papel("cell")}
                                  colSpan={4}
                                  className="block text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400 sm:table-cell sm:py-4 sm:text-right"
                                >
                                  Total estimado
                                </td>
                                <td
                                  {...papel("cell")}
                                  className="block bg-gradient-to-r from-green-400 to-green-600 bg-clip-text text-right text-lg font-black tracking-tighter text-transparent sm:table-cell sm:px-6 sm:py-4"
                                >
                                  {formatCurrency(
                                    cartItems.reduce((acc, item) => {
                                      const variant = item.variantId
                                        ? item.product.variants?.find(
                                            (v) => v.id === item.variantId,
                                          )
                                        : null;
                                      return (
                                        acc +
                                        precoVendido(item.product, variant) *
                                          item.quantity
                                      );
                                    }, 0),
                                  )}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>

                {/* Addresses Matrix */}
                <TabsContent value="addresses" className="mt-0 outline-none">
                  <div className="overflow-hidden rounded-[1.2rem] bg-zinc-900/20">
                    <div className="border-b border-admin-border bg-admin-surface p-4">
                      <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-white">
                        <MapPin className="size-3.5 text-admin-gold" />
                        Destinos de Entrega
                      </h2>
                    </div>
                    <div className="p-4">
                      {addresses.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-admin-border bg-zinc-900 shadow-inner">
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
                              className="group relative overflow-hidden rounded-xl border border-admin-border bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 shadow-inner transition-colors hover:border-zinc-700"
                            >
                              {addr.is_default && (
                                <div className="pointer-events-none absolute right-0 top-0 size-12 overflow-hidden before:absolute before:-right-2 before:-top-2 before:border-[16px] before:border-transparent before:border-r-admin-gold/20 before:border-t-admin-gold/20 before:content-['']" />
                              )}
                              <div className="mb-2 flex items-center justify-between font-black text-white">
                                <span className="truncate pr-2 text-xs">
                                  {addr.name}
                                </span>
                                {addr.is_default && (
                                  <Badge className="h-4 border-none bg-admin-gold px-1.5 text-[11px] font-black uppercase tracking-widest text-black shadow-[0_0_10px_rgba(255,191,0,0.3)]">
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
                                  <span className="font-mono text-[11px] text-zinc-500">
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

                {/* PENDÊNCIA REGISTRADA (frente ficha do cliente, 03/09) — a
                    aba "Favoritos" NÃO existe de propósito.

                    O favorito mora no SERVIDOR (tabela `favorites`,
                    FavoritesContext.tsx), e a ÚNICA policy de leitura dela é
                    a `favorites_all_policy` (baseline
                    20260806000000_baseline_do_schema_vivo.sql, l. 5512):

                        USING (auth.uid() = user_id)

                    Sem ramo `is_admin()` — diferente de `cart_items`, que
                    ganhou o ramo de admin na migration 20261067000000. Ou
                    seja: consultando aqui, o PostgREST devolveria as ZERO
                    linhas que A LOJISTA pode ver — não as do cliente. Mostrar
                    "0 favoritos" mentiria sobre uma lista que pode ter dez; e
                    consertar isso exige migration de RLS, que está FORA do
                    escopo desta frente (proibido por ordem do dono). Quando a
                    policy ganhar o ramo de admin, a aba nasce da mesma forma
                    das outras: consulta `.eq("user_id", userId)` em
                    `favorites` + join em produtos para preço/imagem. */}
                {/* Voz do Cliente Matrix */}
                <TabsContent value="voz" className="mt-0 outline-none">
                  <div className="overflow-hidden rounded-[1.2rem] bg-zinc-900/20">
                    <div className="border-b border-admin-border bg-admin-surface p-4">
                      <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-white">
                        <Star className="size-3.5 text-admin-gold" />O Que Este
                        Cliente Escreveu
                      </h2>
                      <p className="mt-1 text-[11px] uppercase tracking-widest text-zinc-500">
                        Avaliações e perguntas feitas pelo cliente
                      </p>
                    </div>
                    <VozClienteTab
                      carregando={vozCarregando}
                      erro={vozErro}
                      avaliacoes={avaliacoes}
                      perguntas={perguntas}
                      onTentarDeNovo={carregarVoz}
                    />
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
        title="Como ler a ficha do cliente"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Esta tela detalha o perfil individual de um cliente, incluindo o
            resumo de compras no topo, histórico completo de pedidos, o que o
            cliente escreveu (avaliações e perguntas), endereços de entrega
            cadastrados e itens retidos no carrinho de compras.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Seções do Perfil
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <CreditCard className="size-4 text-admin-gold" />
                  Resumo do Topo
                </div>
                <p className="text-xs text-zinc-400">
                  Total já comprado, número de pedidos, valor médio por venda e
                  última compra. Pedido cancelado ou devolvido não entra na
                  conta; o total só soma cobrança confirmada (paga, paga após
                  expirar ou recebida na entrega).
                </p>
              </div>
              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <MapPin className="size-4 text-emerald-500" />
                  Endereços de Entrega
                </div>
                <p className="text-xs text-zinc-400">
                  Os locais cadastrados pelo cliente para recebimento das
                  entregas das compras efetuadas.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <ShoppingCart className="size-4 text-admin-gold" />
                  Histórico de Pedidos
                </div>
                <p className="text-xs text-zinc-400">
                  Relação de todas as transações feitas pelo cliente na loja,
                  incluindo valores, formas de pagamento e status dos envios.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
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

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
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

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Star className="size-4 text-admin-gold" />
                  Voz do Cliente
                </div>
                <p className="text-xs text-zinc-400">
                  As avaliações e perguntas que este cliente já escreveu na
                  loja, com o status de aprovação de cada avaliação. A moderação
                  continua nas telas de Avaliações e Perguntas.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>

      {/* Diálogo de Confirmação de Remoção de Item do Carrinho */}
      <AlertDialog
        open={fichaCarregada && cartItemToRemove !== null}
        onOpenChange={(open) => !open && setCartItemToRemove(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-admin-border bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
              Remover Item?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Tem certeza que deseja remover este item do carrinho do cliente?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="rounded-xl border border-0 border-admin-border bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveCartItem}
              disabled={isOffline || !fichaCarregada}
              className="bg-rose-650 rounded-xl border-0 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
            >
              Remover Item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de Confirmação de Limpeza de Carrinho */}
      <AlertDialog
        open={fichaCarregada && isClearingCart}
        onOpenChange={(open) => !open && setIsClearingCart(false)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-admin-border bg-zinc-950">
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
            <AlertDialogCancel className="rounded-xl border border-0 border-admin-border bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClearUserCart}
              disabled={isOffline || !fichaCarregada}
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
