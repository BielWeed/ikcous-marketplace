import { CustomerPaymentBadge } from "@/components/ui/custom/CustomerPaymentBadge";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus, PaymentMethod, View } from "@/types";
import { motion } from "framer-motion";
import {
  Banknote,
  Check,
  ChevronRight,
  ClipboardCheck,
  Copy,
  CreditCard,
  MapPin,
  Package,
  PackageCheck,
  PackageOpen,
  QrCode,
  ShieldCheck,
  Truck,
  XCircle,
} from "lucide-react";
import { memo, useState } from "react";
import { toast } from "sonner";

// O `color` roda a 11px sobre o `panel` (a cor `*-50` cheia, sem
// transparência) — abaixo do limiar de "texto grande" do WCAG, então o
// mínimo AA é 4,5:1. Tom 600/700 escolhido por família para fechar a conta
// contra o `*-50` (o mais apertado é blue-600/blue-50, ~4,9).
const statusConfig: Record<
  OrderStatus,
  {
    label: string;
    color: string;
    panel: string;
    bar: string;
    icon: typeof Package;
    desc: string;
  }
> = {
  pending: {
    label: "Pedido Recebido",
    color: "text-blue-600",
    panel: "bg-blue-50 border-blue-100",
    bar: "bg-blue-500",
    icon: ClipboardCheck,
    desc: "A loja já recebeu seu pedido",
  },
  processing: {
    label: "Em Separação",
    color: "text-amber-700",
    panel: "bg-amber-50 border-amber-100",
    bar: "bg-amber-500",
    icon: PackageOpen,
    desc: "Preparando seu envio",
  },
  shipping: {
    label: "Em Trânsito",
    color: "text-indigo-600",
    panel: "bg-indigo-50 border-indigo-100",
    bar: "bg-indigo-500",
    icon: Truck,
    desc: "A caminho do seu endereço",
  },
  delivered: {
    label: "Entregue",
    color: "text-emerald-700",
    panel: "bg-emerald-50 border-emerald-100",
    bar: "bg-emerald-500",
    icon: PackageCheck,
    desc: "Pedido entregue",
  },
  cancelled: {
    label: "Cancelado",
    color: "text-rose-700",
    panel: "bg-rose-50 border-rose-100",
    bar: "bg-rose-500",
    icon: XCircle,
    desc: "Este pedido foi cancelado",
  },
};

const trailSteps = ["Recebido", "Separação", "A caminho", "Entregue"];

// `Map.get` em vez de indexar o Record: mesma escolha de
// CustomerPaymentBadge.tsx, para o lint de injeção de objeto.
const statusStep = new Map<OrderStatus, number>([
  ["pending", 0],
  ["processing", 1],
  ["shipping", 2],
  ["delivered", 3],
  ["cancelled", -1],
]);

const paymentConfig: Record<PaymentMethod, { label: string; icon: any }> = {
  pix: { label: "PIX", icon: QrCode },
  card: { label: "Cartão", icon: CreditCard },
  cash: { label: "Dinheiro", icon: Banknote },
  online: { label: "Pagamento online", icon: CreditCard },
};

// Trilha das 4 etapas com o nome de cada uma embaixo: o cliente vê de relance
// quanto falta. Pedido cancelado não tem trilha — não há etapa a percorrer.
function OrderStatusTrail({
  status,
  config,
}: {
  status: OrderStatus;
  config: (typeof statusConfig)[OrderStatus];
}) {
  const currentStep = statusStep.get(status) ?? 0;
  if (currentStep < 0) return null;

  return (
    <div className="mt-2.5" data-testid="order-status-trail">
      <div className="flex gap-1">
        {trailSteps.map((step, idx) => (
          <span
            key={step}
            className={cn(
              "h-1 flex-1 rounded-full",
              idx <= currentStep ? config.bar : "bg-zinc-200",
              idx === currentStep && status !== "delivered" && "animate-pulse",
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-4 text-[9px] font-bold uppercase tracking-wide">
        {trailSteps.map((step, idx) => (
          <span
            key={step}
            className={cn(
              "truncate",
              idx === 0 && "text-left",
              idx === 1 && "text-center",
              idx === 2 && "text-center",
              idx === 3 && "text-right",
              // zinc-600, não 500: sobre blue-50 e indigo-50 o zinc-500
              // fica em 4,42 e 4,30 (reprova AA a 9px); zinc-600 passa ~7.
              idx === currentStep ? config.color : "text-zinc-600",
            )}
          >
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}

interface OrderListProps {
  orders: Order[];
  isLoadingOrders?: boolean;
  onNavigate: (view: View, id?: string) => void;
  isGuest?: boolean;
  compact?: boolean;
  guestMessage?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export const OrderList = memo(function OrderList({
  orders,
  isLoadingOrders,
  onNavigate,
  isGuest,
  compact,
  guestMessage,
  emptyTitle,
  emptyDescription,
}: Readonly<OrderListProps>) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Brief "o app não mente quando copia" (08/09/2026): copiava sem
  // await/catch e já comemorava ("Copiado!" + toast) mesmo quando a cópia
  // falhava — mesma família do laudo 0109 (A-8) que corrigiu OrderDetail.tsx
  // (painel). `copiarParaClipboard` devolve `false` quando a API recusa, e aí
  // o aviso é de erro, não de sucesso.
  const copyToClipboard = async (orderId: string) => {
    const ok = await copiarParaClipboard(orderId);
    if (!ok) {
      toast.error(
        "Não foi possível copiar. Selecione o texto e copie manualmente.",
      );
      return;
    }
    setCopiedId(orderId);
    toast.success("ID do pedido copiado!");
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  if (orders.length === 0 && !isLoadingOrders) {
    return (
      <div
        className={cn("text-center px-6", compact ? "py-2" : "py-4 xs:py-16")}
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={cn(
            "bg-zinc-50 rounded-full flex items-center justify-center mx-auto border border-zinc-100 shadow-inner overflow-hidden",
            compact ? "w-8 h-8 mb-2" : "w-12 h-12 xs:w-24 xs:h-24 mb-3 xs:mb-8",
          )}
        >
          {isGuest ? (
            <ShieldCheck
              className={cn(
                "text-zinc-300",
                compact ? "w-4 h-4" : "w-6 h-6 xs:w-12 xs:h-12",
              )}
            />
          ) : (
            <Package
              className={cn(
                "text-zinc-300",
                compact ? "w-4 h-4" : "w-6 h-6 xs:w-12 xs:h-12",
              )}
            />
          )}
        </motion.div>
        <h3
          className={cn(
            "font-black italic uppercase tracking-tighter text-zinc-900",
            compact ? "text-sm mb-0.5" : "text-base xs:text-2xl mb-1 xs:mb-3",
          )}
        >
          {emptyTitle || (isGuest ? "Histórico Protegido" : "Nenhum pedido")}
        </h3>
        <p
          className={cn(
            "font-bold text-zinc-400 uppercase tracking-widest leading-relaxed mx-auto",
            compact
              ? "text-[8px] max-w-[200px]"
              : "text-[10px] xs:text-[12px] max-w-[280px]",
          )}
        >
          {emptyDescription ||
            (isGuest
              ? compact
                ? "Acesse para ver seu histórico."
                : guestMessage ||
                  "Seus pedidos são vinculados à sua conta. Acesse para visualizar seu histórico completo."
              : "Seu carrinho de pedidos está vazio. Que tal começar a comprar?")}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {orders.map((order, idx) => {
        const status = statusConfig[order.status] || statusConfig.pending;
        const payment = paymentConfig[order.paymentMethod] || paymentConfig.pix;
        const PaymentIcon = payment.icon;
        const StatusIcon = status.icon;
        const total = order?.total || 0;
        const date = order?.createdAt ? new Date(order.createdAt) : new Date();

        return (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="group"
          >
            {/* O card inteiro abre o pedido: o `after:` do botão "Ver
                Detalhes" se estica sobre o card (padrão "stretched link"),
                então teclado e leitor de tela seguem vendo UM botão só. O
                botão do #id fica acima dele (`relative z-10`) para copiar
                sem abrir. */}
            <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-100 bg-white p-3.5 shadow-sm transition-all duration-300 hover:border-zinc-200 hover:shadow-[0_12px_24px_rgba(0,0,0,0.05)] active:scale-[0.99]">
              {/* Topo: foto, nome e resumo, e o valor. Uma foto só, com o
                  "+N" no canto: fotos lado a lado espremiam o nome e
                  quebravam o resumo em 3 linhas a 375px. */}
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative size-14 flex-shrink-0">
                  <div className="flex size-full items-center justify-center overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50">
                    {order.items[0]?.image ? (
                      <img
                        src={order.items[0].image}
                        alt={order.items[0].name || ""}
                        className="size-full object-cover"
                      />
                    ) : (
                      <Package className="size-6 text-zinc-300" />
                    )}
                  </div>
                  {order.items.length > 1 && (
                    <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-zinc-900 px-1 text-[9px] font-black text-white">
                      +{order.items.length - 1}
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <h4 className="truncate text-[12px] font-black uppercase tracking-tight text-zinc-950">
                    {order.items[0]?.name || "N/A"}
                  </h4>

                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-500">
                    <div className="flex items-center gap-0.5">
                      <Package className="size-3 stroke-[2.5] text-zinc-400" />
                      <span>
                        {order.items.length}{" "}
                        {order.items.length === 1 ? "Item" : "Itens"}
                      </span>
                    </div>

                    <span className="size-0.5 rounded-full bg-zinc-300" />

                    <div className="flex items-center gap-0.5">
                      <PaymentIcon className="size-3 stroke-[2.5] text-zinc-400" />
                      <span>{payment.label}</span>
                    </div>

                    {order.customer.neighborhood && (
                      <>
                        <span className="size-0.5 rounded-full bg-zinc-300" />
                        <div className="flex max-w-[96px] items-center gap-0.5 truncate">
                          <MapPin className="size-3 stroke-[2.5] text-zinc-400" />
                          <span className="truncate">
                            {order.customer.neighborhood}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0 self-center text-right">
                  <span className="mb-0.5 block text-[8px] font-black uppercase tracking-widest text-zinc-500">
                    Total
                  </span>
                  <div className="flex items-baseline justify-end leading-none">
                    <span className="mr-0.5 text-[9px] font-extrabold text-zinc-500">
                      R$
                    </span>
                    <span className="text-base font-black tracking-tight text-zinc-950">
                      {total.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Meio: onde o pedido está — uma frase, a trilha das etapas e
                  o selo de pagamento (que carrega os avisos de "não pague",
                  expirado e recusado, e por isso fica sempre visível aqui). */}
              <div
                data-testid="order-status-panel"
                className={cn(
                  "mt-3 rounded-xl border px-3 py-2.5",
                  status.panel,
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                  <div
                    className={cn(
                      "flex min-w-0 items-center gap-1.5",
                      status.color,
                    )}
                  >
                    <StatusIcon className="size-3.5 flex-shrink-0 stroke-[2.5]" />
                    <span className="truncate text-[11px] font-black uppercase tracking-wide">
                      {status.desc}
                    </span>
                  </div>
                  <CustomerPaymentBadge
                    paymentStatus={order.paymentStatus}
                    orderStatus={order.status}
                  />
                </div>

                <OrderStatusTrail status={order.status} config={status} />

                {/* Rastreio (PEDIDO-060, #105): visível sem abrir o
                    pedido. `trim()` porque o campo do painel é texto
                    livre — apagar deixa "" ou espaço, e um rótulo
                    "Rastreio:" em branco parece envio que não houve. */}
                {order.trackingCode?.trim() && (
                  <div className="mt-2 flex min-w-0 items-center gap-1 text-[10px] text-zinc-600">
                    <Truck className="size-3 flex-shrink-0 stroke-[2.5]" />
                    <span className="truncate font-mono font-semibold tracking-tight">
                      {order.trackingCode.trim()}
                    </span>
                  </div>
                )}
              </div>

              {/* Rodapé: número (toque copia) e data, e o botão */}
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(order?.id || "");
                    }}
                    aria-label="Copiar número do pedido"
                    className={cn(
                      "relative z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-md border transition-all duration-200 group/id",
                      copiedId === order.id
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200/60"
                        : "bg-zinc-50 border-zinc-100 hover:bg-zinc-100 text-zinc-500",
                    )}
                  >
                    {copiedId === order.id ? (
                      <>
                        <span className="text-[9px] font-extrabold uppercase tracking-wider">
                          Copiado!
                        </span>
                        <Check className="size-2.5 text-emerald-500" />
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-[9px] font-bold uppercase tracking-tight">
                          #{order?.id?.slice(0, 8) || "......."}
                        </span>
                        <Copy className="size-2.5 text-zinc-400 transition-colors group-hover/id:text-zinc-500" />
                      </>
                    )}
                  </button>
                  <span className="font-mono text-[10px] font-semibold tracking-tight text-zinc-500">
                    {date.toLocaleDateString("pt-BR")}
                  </span>
                </div>

                <button
                  onClick={() => onNavigate("order-details", order.id)}
                  data-testid="order-card-open"
                  className="group/btn flex h-8 flex-shrink-0 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-[9px] font-black uppercase tracking-widest text-white shadow-sm transition-all after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:opacity-90 active:scale-[0.97]"
                >
                  <span>Ver Detalhes</span>
                  <ChevronRight className="size-3 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
                </button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
});
