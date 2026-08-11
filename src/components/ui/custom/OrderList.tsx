import { cn } from "@/lib/utils";
import type { Order, OrderStatus, PaymentMethod, View } from "@/types";
import { motion } from "framer-motion";
import {
  Banknote,
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  MapPin,
  Package,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { memo, useState } from "react";
import { toast } from "sonner";

const statusConfig: Record<
  OrderStatus,
  { label: string; color: string; bg: string; dot: string; desc: string }
> = {
  pending: {
    label: "Pedido Recebido",
    color: "text-blue-600",
    bg: "bg-blue-50/50",
    dot: "bg-blue-500",
    desc: "Recebido com sucesso",
  },
  processing: {
    label: "Em Separação",
    color: "text-amber-600",
    bg: "bg-amber-50/50",
    dot: "bg-amber-500",
    desc: "Preparando seu envio",
  },
  shipping: {
    label: "Em Trânsito",
    color: "text-indigo-600",
    bg: "bg-indigo-50/50",
    dot: "bg-indigo-500",
    desc: "A caminho do endereço",
  },
  delivered: {
    label: "Entregue",
    color: "text-emerald-600",
    bg: "bg-emerald-50/50",
    dot: "bg-emerald-500",
    desc: "Entregue com sucesso!",
  },
  cancelled: {
    label: "Cancelado",
    color: "text-rose-600",
    bg: "bg-rose-50/50",
    dot: "bg-rose-500",
    desc: "Pedido cancelado",
  },
};

const paymentConfig: Record<PaymentMethod, { label: string; icon: any }> = {
  pix: { label: "PIX", icon: QrCode },
  card: { label: "Cartão", icon: CreditCard },
  cash: { label: "Dinheiro", icon: Banknote },
  online: { label: "Pagamento online", icon: CreditCard },
};

function OrderSegmentedProgressBar({ status }: { status: OrderStatus }) {
  if (status === "cancelled") {
    return (
      <div className="absolute inset-x-0 bottom-0 h-[3px] rounded-b-2xl bg-rose-500/80" />
    );
  }

  const statusOrder: Record<OrderStatus, number> = {
    pending: 0,
    processing: 1,
    shipping: 2,
    delivered: 3,
    cancelled: -1,
  };

  const currentStep = statusOrder[status] ?? 0;

  return (
    <div className="absolute inset-x-0 bottom-0 flex h-[3px] gap-[2px] overflow-hidden rounded-b-2xl bg-zinc-100/50">
      {[0, 1, 2, 3].map((idx) => {
        const isCompleted = idx < currentStep;
        const isCurrent = idx === currentStep;

        return (
          <div
            key={idx}
            className={cn(
              "flex-1 h-full transition-all duration-500",
              isCompleted
                ? "bg-emerald-500"
                : isCurrent
                  ? "bg-emerald-500/80 animate-pulse shadow-[0_-1px_6px_rgba(16,185,129,0.4)]"
                  : "bg-zinc-200/40",
            )}
          />
        );
      })}
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

  const copyToClipboard = (orderId: string) => {
    navigator.clipboard.writeText(orderId);
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
              : "Sua sacola de pedidos está vazia. Que tal começar a comprar?")}
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
            <div className="relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-zinc-100/80 bg-white p-3.5 shadow-sm transition-all duration-300 hover:border-zinc-200/80 hover:shadow-[0_12px_24px_rgba(0,0,0,0.04)]">
              {/* Soft top gradient bar */}
              <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-zinc-100 via-zinc-200 to-zinc-100 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              {/* Top row: ID, Date and Status Badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(order?.id || "");
                    }}
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded-md border transition-all duration-200 group/id",
                      copiedId === order.id
                        ? "bg-emerald-50 text-emerald-600 border-emerald-200/60"
                        : "bg-zinc-50/50 border-zinc-100/80 hover:bg-zinc-100/50 text-zinc-500",
                    )}
                  >
                    {copiedId === order.id ? (
                      <>
                        <span className="text-[7.5px] font-extrabold uppercase tracking-wider">
                          Copiado!
                        </span>
                        <Check className="size-2 text-emerald-500" />
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-[8px] font-bold uppercase tracking-tight">
                          #{order?.id?.slice(0, 8) || "......."}
                        </span>
                        <Copy className="size-2 text-zinc-300 transition-colors group-hover/id:text-zinc-400" />
                      </>
                    )}
                  </button>
                  <span className="font-mono text-[8.5px] font-semibold tracking-tight text-zinc-400/90">
                    {date.toLocaleDateString("pt-BR")}
                  </span>
                </div>

                <div
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border border-current/10 flex items-center gap-1",
                    status.color,
                    status.bg,
                    // Utiliza dinamicamente a borda baseada na cor do status
                  )}
                >
                  <span
                    className={cn(
                      "w-1 h-1 rounded-full",
                      status.dot,
                      (order.status === "shipping" ||
                        order.status === "pending") &&
                        "animate-pulse",
                    )}
                  />
                  {status.label}
                </div>
              </div>

              {/* Middle: Images Stack, Info Column and Price */}
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {/* Left: Overlapping image stack (technological/straight design) */}
                  <div className="flex flex-shrink-0 -space-x-2.5">
                    {order.items.slice(0, 3).map((item, i) => (
                      <div
                        key={i}
                        className="relative z-[1] size-11 flex-shrink-0 overflow-hidden rounded-xl border border-zinc-100/60 bg-zinc-50 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-300 hover:z-10 hover:scale-105"
                      >
                        <img
                          src={item.image}
                          alt={item.name}
                          className="size-full object-cover"
                        />
                      </div>
                    ))}
                    {order.items.length > 3 && (
                      <div className="relative z-0 flex size-11 flex-shrink-0 items-center justify-center rounded-xl border border-zinc-100/60 bg-zinc-50/80 text-[9px] font-black text-zinc-500 shadow-[0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-sm">
                        +{order.items.length - 3}
                      </div>
                    )}
                  </div>

                  {/* Center: Product Summary & Info */}
                  <div className="flex min-w-0 flex-1 flex-col justify-center">
                    <h4 className="truncate text-[10px] font-black uppercase tracking-tight text-zinc-950">
                      {order.items[0]?.name || "N/A"}
                    </h4>

                    {/* Condensed Metadata Row */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[8px] font-bold uppercase tracking-wide text-zinc-400">
                      <div className="flex items-center gap-0.5">
                        <Package className="size-2.5 stroke-[2.5] text-zinc-300" />
                        <span>
                          {order.items.length}{" "}
                          {order.items.length === 1 ? "Item" : "Itens"}
                        </span>
                      </div>

                      <span className="size-0.5 rounded-full bg-zinc-200" />

                      <div className="flex items-center gap-0.5">
                        <PaymentIcon className="size-2.5 stroke-[2.5] text-zinc-300" />
                        <span>{payment.label}</span>
                      </div>

                      {order.customer.neighborhood && (
                        <>
                          <span className="size-0.5 rounded-full bg-zinc-200" />
                          <div className="flex max-w-[80px] items-center gap-0.5 truncate">
                            <MapPin className="size-2.5 stroke-[2.5] text-zinc-300" />
                            <span>{order.customer.neighborhood}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right side: Price */}
                <div className="flex-shrink-0 self-center text-right">
                  <span className="mb-0.5 block text-[7px] font-black uppercase tracking-widest text-zinc-300">
                    Total
                  </span>
                  <div className="flex items-baseline justify-end leading-none">
                    <span className="mr-0.5 text-[8px] font-extrabold text-zinc-400">
                      R$
                    </span>
                    <span className="text-sm font-black tracking-tight text-zinc-950">
                      {total.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom: Detailed status and Ver Detalhes Button */}
              <div className="mt-auto flex items-center justify-between border-t border-zinc-100/50 pt-2.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0",
                      status.dot,
                    )}
                  />
                  <span className="max-w-[160px] truncate text-[8px] font-bold uppercase tracking-wider text-zinc-400">
                    {status.desc}
                  </span>
                </div>

                <button
                  onClick={() => onNavigate("order-details", order.id)}
                  className="group/btn flex h-[30px] items-center justify-center gap-1 rounded-lg bg-primary px-3 text-[8px] font-black uppercase tracking-widest text-white shadow-sm transition-all hover:opacity-90 active:scale-[0.97]"
                >
                  <span>Ver Detalhes</span>
                  <ChevronRight className="size-2.5 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
                </button>
              </div>

              {/* Absolute edge segmented progress bar */}
              <OrderSegmentedProgressBar status={order.status} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
});
