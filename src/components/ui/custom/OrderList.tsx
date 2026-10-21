import { CustomerPaymentBadge } from "@/components/ui/custom/CustomerPaymentBadge";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import {
  ROTULO_SEM_VALOR_A_PAGAR,
  pedidoSemValorAPagar,
} from "@/lib/forma-de-pagamento";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
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
  Store,
  Truck,
  WifiOff,
  XCircle,
} from "lucide-react";
import { memo, useState } from "react";
import { toast } from "sonner";

const statusConfig: Record<
  OrderStatus,
  { icon: typeof Package; desc: string }
> = {
  pending: { icon: ClipboardCheck, desc: "A loja já recebeu seu pedido" },
  processing: { icon: PackageOpen, desc: "Preparando seu envio" },
  shipping: { icon: Truck, desc: "A caminho do seu endereço" },
  delivered: { icon: PackageCheck, desc: "Pedido entregue" },
  cancelled: { icon: XCircle, desc: "Este pedido foi cancelado" },
};

const trailSteps = ["Recebido", "Separação", "A caminho", "Entregue"];
// Retirada na loja: ninguém leva o pedido, a cliente busca (só texto).
const trailStepsRetirada = [
  "Recebido",
  "Separação",
  "Pronto p/ retirar",
  "Entregue",
];

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

// Só a etapa atual ocupa uma pílula: os nomes deixam de cortar no celular.
// Entregue e cancelado não têm mais progresso a percorrer.
function OrderStatusTrail({
  status,
  retiradaNaLoja,
}: {
  status: OrderStatus;
  retiradaNaLoja?: boolean;
}) {
  const passos = retiradaNaLoja ? trailStepsRetirada : trailSteps;
  const currentStep = statusStep.get(status) ?? 0;
  if (currentStep < 0 || status === "delivered") return null;
  const atual = passos[currentStep];
  const proxima = passos[currentStep + 1];

  return (
    <div
      className="mt-3"
      data-testid="order-status-trail"
      role="progressbar"
      aria-label="Andamento do pedido"
      aria-valuemin={1}
      aria-valuemax={4}
      aria-valuenow={currentStep + 1}
      aria-valuetext={`Etapa ${currentStep + 1} de 4: ${atual}. Próxima: ${proxima}`}
    >
      <div className="flex h-7 items-center" aria-hidden="true">
        {passos.map((step, idx) => (
          <div key={step} className="contents">
            {idx > 0 && (
              <span
                className={cn(
                  "h-0.5 min-w-0 flex-1",
                  idx <= currentStep ? "bg-zinc-950" : "bg-zinc-300",
                )}
              />
            )}
            {idx === currentStep ? (
              <span
                className={cn(
                  "flex h-7 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-semibold text-white",
                  retiradaNaLoja && status === "shipping"
                    ? "bg-emerald-700"
                    : "bg-zinc-950",
                )}
              >
                {step}
              </span>
            ) : (
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  idx < currentStep
                    ? "bg-zinc-950 text-white"
                    : "border-[1.5px] border-zinc-500 text-zinc-600",
                )}
              >
                {idx < currentStep ? <Check className="size-3" /> : idx + 1}
              </span>
            )}
          </div>
        ))}
      </div>
      <span className="sr-only">{passos.join(", ")}</span>
    </div>
  );
}

function fraseDoCancelado(paymentStatus: Order["paymentStatus"]) {
  switch (paymentStatus) {
    case "expirado":
      return "O prazo para pagar terminou. Se não pagou, é só comprar de novo.";
    case "aguardando":
      return "Se o pagamento ainda estiver aberto no seu banco, não pague.";
    case "pago":
      return "Seu pagamento foi recebido. Toque para ver o que acontece com ele.";
    case "recebido_na_entrega":
    case "pago_apos_expirar":
      return "Seu pagamento foi recebido. Fale com a loja para resolver.";
    case "recusado":
      return "O pagamento não foi aprovado e o pedido foi cancelado.";
    case "estornado":
      return "O pagamento foi estornado. Fale com a loja.";
    default:
      return "Toque para ver os detalhes do pedido.";
  }
}

function OrderCardSkeleton() {
  return (
    <div
      data-testid="order-card-skeleton"
      aria-hidden="true"
      className="min-h-[278px] rounded-2xl border border-zinc-100 bg-white p-3.5"
    >
      <div className="flex h-14 items-center gap-3">
        <div className="size-14 shrink-0 rounded-xl bg-zinc-100" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-3/4 rounded bg-zinc-100" />
          <div className="h-3 w-1/2 rounded bg-zinc-100" />
        </div>
      </div>
      <div className="mt-3 min-h-[136px] rounded-[14px] border border-zinc-200 bg-zinc-50 p-3">
        <div className="h-[18px] w-3/4 rounded bg-zinc-200" />
        <div className="mt-2 h-6 w-40 rounded-full bg-zinc-200" />
        <div className="mt-3 flex h-7 items-center justify-between">
          <div className="h-7 w-24 rounded-full bg-zinc-200" />
          <div className="size-6 rounded-full bg-zinc-200" />
          <div className="size-6 rounded-full bg-zinc-200" />
          <div className="size-6 rounded-full bg-zinc-200" />
        </div>
        <div className="mt-2 h-3.5 w-1/2 rounded bg-zinc-200" />
      </div>
      <div className="mt-3 flex h-8 items-center justify-between">
        <div className="h-3 w-20 rounded bg-zinc-100" />
        <div className="h-3 w-16 rounded bg-zinc-100" />
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
  /**
   * A consulta dos pedidos FALHOU (rede/servidor) e ainda não foi refeita com
   * sucesso. Falha não é lista vazia: sem pedido nenhum em memória a lista
   * diz que não conseguiu carregar (com "Tentar de novo"); com pedidos em
   * memória mantém tudo e só avisa, sem alarde.
   */
  loadError?: string | null;
  /** Refaz a leitura. Sem ele, o erro aparece sem botão. */
  onRetry?: () => void;
  /**
   * Há pedidos em memória, mesmo que `orders` (a lista da aba já filtrada)
   * esteja vazia. Aba "Em andamento" sem pedidos NÃO é falha de carregamento.
   * Padrão: `orders.length > 0`.
   */
  hasAnyOrders?: boolean;
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
  loadError,
  onRetry,
  hasAnyOrders,
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

  // Falha de carregamento não é lista vazia. O convidado nunca tem erro aqui
  // (a lista dele vem da busca por OTP/WhatsApp, não desta consulta).
  const temPedidosEmMemoria = hasAnyOrders ?? orders.length > 0;
  // A falha continua na tela ENQUANTO a releitura roda (o botão fica montado,
  // desabilitado e dizendo "Carregando…"): se ele sumisse, o foco de quem
  // tocou — teclado, leitor de tela — cairia no corpo da página. Quem decide
  // se a releitura ainda corre é `isLoadingOrders`; o erro só sai quando o
  // hook recebe uma resposta ok.
  const falhou = Boolean(loadError) && !isGuest;
  const relendo = Boolean(isLoadingOrders);
  // Sem internet o conselho é a conexão; com internet (5xx, sessão vencida,
  // servidor fora) mandar "verificar a conexão" seria acusar quem não errou.
  const semInternet =
    typeof navigator !== "undefined" && navigator.onLine === false;
  // `aria-disabled`, não `disabled`: `disabled` tira o foco do botão em alguns
  // navegadores. O clique é ignorado aqui mesmo enquanto relê.
  const tentarDeNovo = () => {
    if (!relendo) onRetry?.();
  };

  if (falhou && !temPedidosEmMemoria && orders.length === 0) {
    return (
      <div
        role="alert"
        className={cn("text-center px-6", compact ? "py-2" : "py-4 xs:py-16")}
      >
        <div
          className={cn(
            "bg-amber-50 rounded-full flex items-center justify-center mx-auto border border-amber-100 overflow-hidden",
            compact ? "w-8 h-8 mb-2" : "w-12 h-12 xs:w-24 xs:h-24 mb-3 xs:mb-8",
          )}
        >
          <WifiOff
            className={cn(
              "text-amber-500",
              compact ? "w-4 h-4" : "w-6 h-6 xs:w-12 xs:h-12",
            )}
          />
        </div>
        <h3
          className={cn(
            "font-black italic uppercase tracking-tighter text-zinc-900",
            compact ? "text-sm mb-0.5" : "text-base xs:text-2xl mb-1 xs:mb-3",
          )}
        >
          {loadError}
        </h3>
        <p
          className={cn(
            "font-bold text-zinc-500 leading-relaxed mx-auto",
            compact
              ? "text-[10px] max-w-[220px]"
              : "text-xs xs:text-sm max-w-[300px]",
          )}
        >
          {semInternet
            ? "Verifique sua conexão e tente de novo."
            : "Tente de novo em instantes."}{" "}
          Se você acabou de pagar, o pedido não sumiu — ele só não apareceu aqui
          ainda.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={tentarDeNovo}
            aria-disabled={relendo}
            className="mt-5 rounded-2xl bg-zinc-900 px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-zinc-800 active:scale-95 aria-disabled:opacity-60"
          >
            {relendo ? "Carregando…" : "Tentar de novo"}
          </button>
        )}
      </div>
    );
  }

  // Pedidos já em memória + recarga que falhou: a lista fica como está e só
  // aparece um aviso discreto (nada de apagar o que a cliente já via).
  const avisoDeFalha =
    falhou && temPedidosEmMemoria ? (
      <div
        role="status"
        className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800"
      >
        <span>
          Não foi possível atualizar agora. Mostrando o que já tínhamos.
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={tentarDeNovo}
            aria-disabled={relendo}
            className="shrink-0 rounded-lg bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-900 active:scale-95 aria-disabled:opacity-60"
          >
            {relendo ? "Carregando…" : "Tentar de novo"}
          </button>
        )}
      </div>
    ) : null;

  if (orders.length === 0 && !isLoadingOrders) {
    return (
      <div
        className={cn("text-center px-6", compact ? "py-2" : "py-4 xs:py-16")}
      >
        {avisoDeFalha}
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
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      aria-busy={isLoadingOrders && orders.length === 0}
    >
      {avisoDeFalha && <div className="col-span-full">{avisoDeFalha}</div>}
      {isLoadingOrders && orders.length === 0 && (
        <>
          <span className="sr-only">Carregando pedidos</span>
          <OrderCardSkeleton />
          <OrderCardSkeleton />
        </>
      )}
      {orders.map((order, idx) => {
        const statusBase = statusConfig[order.status] || statusConfig.pending;
        const status =
          order.retiradaNaLoja === true && order.status === "shipping"
            ? {
                ...statusBase,
                icon: Store,
                desc: "Venha retirar na loja",
              }
            : statusBase;
        const payment = paymentConfig[order.paymentMethod] || paymentConfig.pix;
        const PaymentIcon = payment.icon;
        // Compra que fechou em R$ 0,00 (cupom de 100%): não há forma de
        // pagamento a mostrar. A regra é UMA só (`pedidoSemValorAPagar`).
        const formaDePagamento = pedidoSemValorAPagar(order)
          ? ROTULO_SEM_VALOR_A_PAGAR
          : payment.label;
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
                      <span>{formaDePagamento}</span>
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
                role="group"
                aria-label="Situação do pedido"
                className={cn(
                  "mt-3 rounded-[14px] border border-zinc-200 bg-zinc-50 p-3",
                  order.status === "delivered"
                    ? "min-h-[74px]"
                    : order.status === "cancelled"
                      ? order.paymentStatus
                        ? "min-h-[110px]"
                        : "min-h-[78px]"
                      : order.paymentStatus
                        ? "min-h-[136px]"
                        : "min-h-[104px]",
                )}
              >
                <div className="flex min-w-0 items-start gap-1.5">
                  <StatusIcon
                    aria-hidden="true"
                    className={cn(
                      "mt-px size-4 shrink-0 stroke-[2.5]",
                      order.status === "cancelled"
                        ? "text-rose-700"
                        : order.status === "delivered" ||
                            (order.retiradaNaLoja &&
                              order.status === "shipping")
                          ? "text-emerald-700"
                          : "text-zinc-950",
                    )}
                  />
                  <span className="text-[13px] font-bold leading-[18px] text-zinc-950">
                    {status.desc}
                  </span>
                </div>
                <CustomerPaymentBadge
                  paymentStatus={order.paymentStatus}
                  orderStatus={order.status}
                  variant="lista"
                  className="mt-2"
                />

                <OrderStatusTrail
                  status={order.status}
                  retiradaNaLoja={order.retiradaNaLoja}
                />

                {/* Código livre nunca é cortado; substitui a próxima etapa,
                    sem esconder rastreio já existente no histórico. */}
                {order.trackingCode?.trim() ? (
                  <div className="mt-2 flex min-w-0 items-start gap-1 text-[11px] leading-[14px] text-zinc-700">
                    <Truck
                      aria-hidden="true"
                      className="mt-px size-3 shrink-0"
                    />
                    <span className="break-all font-mono font-semibold">
                      Rastreio {order.trackingCode.trim()}
                    </span>
                  </div>
                ) : order.status !== "cancelled" &&
                  order.status !== "delivered" ? (
                  <p
                    aria-hidden="true"
                    className="mt-2 text-[11px] font-medium leading-[14px] text-zinc-600"
                  >
                    Próxima etapa:{" "}
                    {
                      (order.retiradaNaLoja ? trailStepsRetirada : trailSteps)[
                        (statusStep.get(order.status) ?? 0) + 1
                      ]
                    }
                  </p>
                ) : null}
                {order.status === "cancelled" && (
                  <p className="mt-2 min-h-7 text-[11px] font-medium leading-[14px] text-zinc-700">
                    {fraseDoCancelado(order.paymentStatus)}
                  </p>
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
                          #{numeroDoPedido(order?.id) || "......."}
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
                  className="group/btn flex h-8 flex-shrink-0 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-[9px] font-black uppercase tracking-widest text-primary-foreground shadow-sm transition-all after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:opacity-90 active:scale-[0.97]"
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
