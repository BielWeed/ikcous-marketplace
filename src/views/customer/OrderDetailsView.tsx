import { ReviewForm } from "@/components/ui/custom/ReviewForm";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Order, OrderItem, OrderStatus, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import {
  Check,
  CheckCircle,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Star,
  Truck,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

interface OrderDetailsViewProps {
  orderId: string;
  onBack: () => void;
  onNavigate: (view: View) => void;
}

const statusConfig: Record<
  OrderStatus,
  {
    label: string;
    icon: LucideIcon;
    color: string;
    bg: string;
    description: string;
  }
> = {
  pending: {
    label: "Pedido Recebido",
    icon: Package,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    description:
      "Aguardando confirmação de pagamento para iniciar a separação.",
  },
  processing: {
    label: "Em Separação",
    icon: Clock,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    description: "Seu pedido está sendo preparado com todo cuidado e atenção.",
  },
  shipping: {
    label: "Em Trânsito",
    icon: Truck,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    description: "Seu pedido já saiu para entrega e chegará em breve.",
  },
  delivered: {
    label: "Entregue",
    icon: CheckCircle,
    color: "text-green-500",
    bg: "bg-green-500/10",
    description:
      "O pedido foi entregue com sucesso. Aproveite sua experiência!",
  },
  cancelled: {
    label: "Cancelado",
    icon: XCircle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    description: "Este pedido foi cancelado e não seguirá para entrega.",
  },
};

export function OrderDetailsView({
  orderId,
  onBack,
  onNavigate: _onNavigate,
}: OrderDetailsViewProps) {
  const { orders, fetchUserOrders, updateOrderStatus } = useOrders(true, false);
  const { config } = useStore();
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [reviewedProductIds, setReviewedProductIds] = useState<Set<string>>(
    new Set(),
  );
  const [reviewingItem, setReviewingItem] = useState<{
    productId: string;
    productName: string;
  } | null>(null);

  const handleCancelOrder = async () => {
    if (!order) return;
    const confirmCancel = globalThis.confirm(
      "Tem certeza que deseja cancelar este pedido? Esta ação não pode ser desfeita.",
    );
    if (!confirmCancel) return;

    setIsCancelling(true);
    haptic.medium();
    try {
      await updateOrderStatus(order.id, "cancelled");
      setOrder((prev) => (prev ? { ...prev, status: "cancelled" } : null));
    } catch (error) {
      console.error("Failed to cancel order:", error);
    } finally {
      setIsCancelling(false);
    }
  };

  // `orders` fica num ref, e NÃO nas dependências do useCallback abaixo.
  //
  // O que acontecia antes (PEDIDO-040, #84): `loadOrder` dependia de `orders`,
  // o efeito dependia de `loadOrder`, e `fetchUserOrders` trocava a referência
  // de `orders` a cada volta — inclusive devolvendo `[]` para quem nunca
  // comprou. Cada volta recriava o callback, que redisparava o efeito, que
  // fazia outra requisição: loop infinito no Supabase com o spinner girando
  // para sempre. A outra metade da correção está no `setOrders` do
  // `useOrders.ts`, que agora devolve a mesma referência quando nada mudou.
  //
  // O ref é atualizado num efeito, e não durante o render: escrever em ref no
  // meio do render é o que o React desaconselha em modo concorrente. O valor
  // inicial já vem do cache do localStorage (`useOrders.ts:117-133`), que é o
  // que o passo 1 abaixo precisa.
  const ordersRef = useRef(orders);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const loadOrder = useCallback(async () => {
    // 1. Pinta com o que já está em memória (vem do cache do localStorage),
    //    para a tela não ficar branca enquanto a rede responde.
    const emMemoria = ordersRef.current.find((o) => o.id === orderId);
    if (emMemoria) {
      setOrder(emMemoria);
      setLoading(false);
    }

    // 2. Revalida no servidor SEMPRE, uma vez por abertura. Antes, ter cache
    //    fazia a tela pular esta busca e nunca mais conferir o status do
    //    pedido com o banco.
    const doServidor = await fetchUserOrders();
    let encontrado = doServidor.find((o) => o.id === orderId);

    // 3. Convidado que rastreou pedido por OTP não tem linha em
    //    marketplace_orders para o user_id dele; o pedido fica no
    //    sessionStorage.
    if (!encontrado) {
      try {
        const guestCached = sessionStorage.getItem("guest_tracked_orders");
        if (guestCached) {
          const parsed = JSON.parse(guestCached);
          if (Array.isArray(parsed)) {
            encontrado = parsed.find((o) => o.id === orderId);
          }
        }
      } catch (e) {
        console.error("Error loading guest orders from sessionStorage:", e);
      }
    }

    // Se a revalidação não achou nada mas havia algo em memória, mantém o que
    // está na tela: melhor um dado de um segundo atrás do que piscar para
    // "pedido não encontrado" por causa de uma resposta abortada.
    if (encontrado || !emMemoria) setOrder(encontrado || null);
    setLoading(false);
  }, [orderId, fetchUserOrders]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  useEffect(() => {
    if (!user || !order || order.status !== "delivered") return;

    const checkIfReviewed = async () => {
      try {
        const productIds = order.items.map((item) => item.productId);
        const { data, error } = await supabase
          .from("reviews" as any)
          .select("product_id")
          .eq("user_id", user.id)
          .in("product_id", productIds);

        if (!error && data) {
          const reviewedSet = new Set<string>(
            data.map((r: any) => r.product_id),
          );
          setReviewedProductIds(reviewedSet);
        }
      } catch (e) {
        console.error("Failed to check existing reviews:", e);
      }
    };

    checkIfReviewed();
  }, [user, order]);

  const handleCopyId = () => {
    navigator.clipboard.writeText(orderId);
    toast.success("ID do pedido copiado!");
    haptic.light();
  };

  const handleWhatsAppSupport = () => {
    const message = `Olá! Tenho uma dúvida sobre meu pedido #${orderId.slice(0, 8)}.`;
    let phone = (config.whatsappNumber || "").replace(/\D/g, "");
    if (phone.length === 11 || phone.length === 10) {
      phone = `55${phone}`;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    globalThis.open(url, "_blank");
    haptic.light();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center space-y-4 bg-zinc-50/30">
        <div className="size-12 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent" />
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">
          Sincronizando Dados
        </p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white p-8 text-center">
        <div className="mb-6 flex size-20 items-center justify-center rounded-[2.5rem] bg-zinc-100">
          <XCircle className="size-10 text-zinc-300" />
        </div>
        <h2 className="mb-2 text-2xl font-black uppercase italic tracking-tighter">
          Pedido não encontrado
        </h2>
        <p className="mb-8 text-[11px] font-bold uppercase leading-relaxed tracking-widest text-zinc-400">
          Não conseguimos localizar as informações deste pedido em nosso
          sistema.
        </p>
        <button
          onClick={onBack}
          className="h-14 rounded-2xl bg-zinc-900 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all active:scale-95"
        >
          Voltar aos pedidos
        </button>
      </div>
    );
  }

  const currentStatus = statusConfig[order.status as OrderStatus];
  const StatusIcon = currentStatus.icon;

  return (
    <div className="pb-customer min-h-full bg-zinc-50/50">
      {/* Header Area (Not Sticky) */}
      <div className="px-6 pb-2 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex flex-col items-start">
            <span className="mb-1 text-[9px] font-black uppercase leading-none tracking-[0.3em] text-zinc-400">
              Status em Tempo Real
            </span>
            <h1 className="text-xl font-black uppercase tracking-tighter text-zinc-900">
              Detalhes da <span className="text-zinc-400">Entrega</span>
            </h1>
          </div>
          <button
            onClick={handleWhatsAppSupport}
            className="flex size-10 items-center justify-center rounded-xl border border-emerald-100/50 bg-emerald-50 text-emerald-600 transition-all active:scale-90"
          >
            <MessageCircle className="size-5" />
          </button>
        </div>

        {/* Quick Info Bar */}
        <div className="flex items-center justify-between gap-4 rounded-xl bg-zinc-950 p-3 text-white">
          <div className="flex flex-col">
            <span className="text-zinc-505 mb-0.5 text-[8px] font-black uppercase tracking-widest">
              ID do Pedido
            </span>
            <div
              role="button"
              tabIndex={0}
              className="flex cursor-pointer items-center gap-1 rounded transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-white"
              onClick={handleCopyId}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCopyId();
                }
              }}
            >
              <span className="text-[10px] font-black uppercase tracking-widest">
                #{order.id.slice(0, 8)}
              </span>
              <Copy className="size-2.5 text-zinc-550" />
            </div>
          </div>
          <div className="h-6 w-px bg-zinc-800" />
          <div className="flex flex-col items-end">
            <span className="text-zinc-505 mb-0.5 text-[8px] font-black uppercase tracking-widest">
              Data de Realização
            </span>
            <span className="text-[10px] font-black tracking-tight">
              {new Date(order.createdAt).toLocaleDateString("pt-BR")}
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-6 py-4">
        {/* Status Visual Block */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <div
            className={cn(
              "absolute top-0 left-0 w-1.5 h-full",
              currentStatus.color.replace("text-", "bg-"),
            )}
          />

          <div className="mb-4 flex items-center gap-4">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center shadow-md transition-transform hover:scale-105",
                currentStatus.bg,
              )}
            >
              <StatusIcon className={cn("w-5 h-5", currentStatus.color)} />
            </div>
            <div className="flex-1">
              <h3
                className={cn(
                  "text-base font-black uppercase tracking-tighter italic leading-none mb-1",
                  currentStatus.color,
                )}
              >
                {currentStatus.label}
              </h3>
              <p className="text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                {currentStatus.description}
              </p>
            </div>
          </div>

          {/* Progress Visual Mini-Timeline */}
          {order.status !== "cancelled" && (
            <div className="mt-4 flex items-center gap-1">
              {["pending", "processing", "shipping", "delivered"].map(
                (s, i) => {
                  const isPast =
                    ["pending", "processing", "shipping", "delivered"].indexOf(
                      order.status,
                    ) >= i;
                  return (
                    <div key={s} className="flex flex-1 flex-col gap-1.5">
                      <div
                        className={cn(
                          "h-1 rounded-full transition-all duration-1000",
                          isPast
                            ? currentStatus.color.replace("text-", "bg-")
                            : "bg-zinc-100",
                        )}
                      />
                    </div>
                  );
                },
              )}
            </div>
          )}

          {/* Exige sessão: o convidado chega nesta tela pelo fallback de
              sessionStorage do loadOrder, e update_order_status_atomic passou a
              recusar chamador sem auth.uid() (PEDIDO-010, #115). Sem esta
              condição o botão continuaria visível e falharia sempre. */}
          {order.status === "pending" && user && (
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <button
                onClick={handleCancelOrder}
                disabled={isCancelling}
                className="text-red-655 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-red-50 text-[9px] font-black uppercase tracking-widest transition-all hover:bg-red-100 active:scale-[0.98] disabled:bg-zinc-50 disabled:text-zinc-400"
              >
                {isCancelling ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                {isCancelling ? "Processando" : "Cancelar Pedido"}
              </button>
            </div>
          )}
        </motion.div>

        {/* Items List Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="h-4 w-1 rounded-full bg-zinc-900" />
            <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Composição do Pedido
            </h4>
          </div>

          <div className="space-y-4">
            {order.items.map((item: OrderItem, idx: number) => (
              <div key={idx} className="group flex items-center gap-4">
                <div className="relative size-14 flex-shrink-0 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50 shadow-sm">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <h5 className="truncate text-[11px] font-black uppercase leading-none tracking-tight text-zinc-900 transition-colors group-hover:text-zinc-650">
                    {item.name}
                  </h5>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-md border border-zinc-100 bg-zinc-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-zinc-400">
                      {item.quantity}x
                    </span>
                    <span className="text-xs font-black italic tracking-tight text-zinc-900">
                      R$ {item.price.toFixed(2).replace(".", ",")}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {user &&
                    order.status === "delivered" &&
                    (reviewedProductIds.has(item.productId) ? (
                      <span className="flex select-none items-center gap-1 rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-emerald-600 duration-300 animate-in fade-in">
                        <Check className="size-2.5" />
                        Avaliado
                      </span>
                    ) : (
                      <button
                        onClick={() =>
                          setReviewingItem({
                            productId: item.productId,
                            productName: item.name,
                          })
                        }
                        className="flex items-center gap-1 rounded-full border border-zinc-200/60 bg-zinc-50 px-2.5 py-1 text-[8px] font-black uppercase tracking-wider text-zinc-800 shadow-sm transition-all duration-300 hover:bg-zinc-100 hover:text-zinc-950 hover:shadow active:scale-95"
                      >
                        <Star className="size-2.5 fill-amber-400 text-amber-400" />
                        Avaliar
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Finance Detail Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="h-4 w-1 rounded-full bg-zinc-900" />
            <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Resumo da Transação
            </h4>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              <span>Subtotal Bruto</span>
              <span className="text-zinc-900">
                R$ {order.subtotal.toFixed(2).replace(".", ",")}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              <span>Logística e Envio</span>
              <span
                className={cn(
                  order.shipping === 0
                    ? "text-emerald-600 font-extrabold"
                    : "text-zinc-900",
                )}
              >
                {order.shipping > 0
                  ? `R$ ${order.shipping.toFixed(2).replace(".", ",")}`
                  : "Grátis"}
              </span>
            </div>
            {order.discount > 0 && (
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                <span>Benefício / Cupom</span>
                <span>- R$ {order.discount.toFixed(2).replace(".", ",")}</span>
              </div>
            )}
            <div className="my-3 h-px bg-zinc-100" />
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="mb-0.5 text-[8px] font-black uppercase tracking-wider text-zinc-400">
                  Total Consolidado
                </span>
                <span className="text-xl font-black uppercase italic tracking-tight text-zinc-950">
                  R$ {order.total.toFixed(2).replace(".", ",")}
                </span>
              </div>
              <div className="text-emerald-750 inline-flex items-center gap-1.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-1.5">
                <CheckCircle className="size-3.5 text-emerald-600" />
                <span className="text-[8px] font-black uppercase tracking-wider text-emerald-700">
                  Confirmado
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Delivery & Payment Info Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Destino Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-zinc-400" />
                <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-900">
                  Endereço de Entrega
                </h4>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-black uppercase tracking-tight text-zinc-900">
                  {order.customer.name}
                </p>
                <p className="text-[10px] font-bold uppercase leading-relaxed tracking-wider text-zinc-400">
                  {order.customer.address}, {order.customer.number}
                  <br />
                  {order.customer.neighborhood} • Monte Carmelo
                </p>
              </div>
            </div>

            {/* Pagamento Section */}
            <div className="space-y-3 sm:border-l sm:border-zinc-100 sm:pl-6">
              <div className="flex items-center gap-2">
                <CreditCard className="size-4 text-zinc-400" />
                <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-900">
                  Forma de Pagamento
                </h4>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-black uppercase capitalize tracking-tight text-zinc-900">
                  {order.paymentMethod === "card"
                    ? "Cartão de Crédito"
                    : order.paymentMethod}
                </p>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-100 bg-zinc-50 px-2.5 py-1">
                  <div className="size-1 rounded-full bg-zinc-400" />
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                    Confirmado via Gateway
                  </span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {reviewingItem &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm duration-300 animate-in fade-in">
            <div
              className="fixed inset-0"
              onClick={() => setReviewingItem(null)}
              role="button"
              aria-label="Fechar avaliacao"
              tabIndex={-1}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
                  setReviewingItem(null);
                }
              }}
            />
            <div className="relative z-10 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-[2.5rem] bg-zinc-50 p-6 shadow-2xl duration-300 animate-in slide-in-from-bottom">
              {/* Header */}
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    Avaliação do Produto
                  </span>
                  <h3 className="mt-0.5 max-w-[280px] truncate text-base font-extrabold uppercase leading-tight text-zinc-900">
                    {reviewingItem.productName}
                  </h3>
                </div>
                <button
                  onClick={() => setReviewingItem(null)}
                  className="hover:text-zinc-905 flex size-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-650 transition-colors hover:bg-zinc-300"
                >
                  ✕
                </button>
              </div>

              <ReviewForm
                productId={reviewingItem.productId}
                onSuccess={() => {
                  setReviewedProductIds((prev) => {
                    const next = new Set(prev);
                    next.add(reviewingItem.productId);
                    return next;
                  });
                  setReviewingItem(null);
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
