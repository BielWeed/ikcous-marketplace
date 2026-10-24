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
  Check,
  Copy,
  Package,
  ShieldCheck,
  Truck,
  WifiOff,
} from "lucide-react";
import { type ReactNode, memo, useState } from "react";
import { toast } from "sonner";

// Cada situação é uma frase; o ponto colorido do cartão faz o papel do ícone.
const statusConfig: Record<OrderStatus, { desc: string }> = {
  pending: { desc: "A loja já recebeu seu pedido" },
  processing: { desc: "Preparando seu envio" },
  shipping: { desc: "A caminho do seu endereço" },
  delivered: { desc: "Pedido entregue" },
  cancelled: { desc: "Este pedido foi cancelado" },
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

const paymentConfig: Record<PaymentMethod, string> = {
  pix: "PIX",
  card: "Cartão",
  cash: "Dinheiro",
  online: "Pagamento online",
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
  // eslint-disable-next-line security/detect-object-injection -- índice numérico vindo de statusStep (Map fixo), nunca de entrada externa
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
                  idx <= currentStep
                    ? "bg-foreground"
                    : "bg-muted-foreground/40",
                )}
              />
            )}
            {idx === currentStep ? (
              <span
                className={cn(
                  "flex h-7 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-semibold",
                  retiradaNaLoja && status === "shipping"
                    ? "bg-emerald-700 text-white"
                    : "bg-foreground text-background",
                )}
              >
                {step}
              </span>
            ) : (
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  idx < currentStep
                    ? "bg-foreground text-background"
                    : "border-[1.5px] border-muted-foreground text-muted-foreground",
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
      className="min-h-[278px] rounded-[18px] border border-border bg-background p-4"
    >
      <div className="flex h-14 items-center gap-3">
        <div className="size-14 shrink-0 rounded-xl bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-3/4 rounded bg-muted" />
          <div className="h-3 w-1/2 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-3 min-h-[136px] border-t border-border pt-3">
        <div className="h-[18px] w-3/4 rounded bg-muted" />
        <div className="mt-2 h-6 w-40 rounded-full bg-muted" />
        <div className="mt-3 flex h-7 items-center justify-between">
          <div className="h-7 w-24 rounded-full bg-muted" />
          <div className="size-6 rounded-full bg-muted" />
          <div className="size-6 rounded-full bg-muted" />
          <div className="size-6 rounded-full bg-muted" />
        </div>
        <div className="mt-2 h-3.5 w-1/2 rounded bg-muted" />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-11 w-28 rounded-2xl bg-muted" />
      </div>
    </div>
  );
}

// Estado sem lista (vazio, convidado, falha): o mesmo desenho — ladrilho com o
// glifo, título, frase e, se houver, a ação. `compacto` é o uso dentro de
// painéis estreitos.
function EstadoDaLista({
  compacto,
  alerta,
  glifo,
  titulo,
  children,
  aviso,
}: Readonly<{
  compacto?: boolean;
  alerta?: boolean;
  glifo: ReactNode;
  titulo: string;
  children: ReactNode;
  aviso?: ReactNode;
}>) {
  return (
    <div
      role={alerta ? "alert" : undefined}
      className={cn("text-center px-6", compacto ? "py-2" : "py-8 xs:py-16")}
    >
      {aviso}
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          "mx-auto flex items-center justify-center bg-muted/40 text-muted-foreground",
          compacto
            ? "mb-2 size-10 rounded-[14px]"
            : "mb-6 size-20 rounded-[22px]",
        )}
      >
        {glifo}
      </motion.div>
      <h3
        className={cn(
          "font-bold tracking-tight text-foreground",
          compacto ? "mb-1 text-base" : "mb-2 text-[22px] leading-7",
        )}
      >
        {titulo}
      </h3>
      <p
        className={cn(
          "mx-auto leading-relaxed text-muted-foreground",
          compacto ? "max-w-[220px] text-xs" : "max-w-[300px] text-base",
        )}
      >
        {children}
      </p>
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
  const tamanhoDoGlifo = compact ? "size-5" : "size-9";

  if (falhou && !temPedidosEmMemoria && orders.length === 0) {
    return (
      <EstadoDaLista
        alerta
        compacto={compact}
        glifo={
          <WifiOff
            className={cn(tamanhoDoGlifo, "text-amber-700 dark:text-amber-400")}
          />
        }
        titulo={loadError ?? ""}
      >
        {semInternet
          ? "Verifique sua conexão e tente de novo."
          : "Tente de novo em instantes."}{" "}
        Se você acabou de pagar, o pedido não sumiu — ele só não apareceu aqui
        ainda.
        {onRetry && (
          <span className="mt-5 block">
            <button
              type="button"
              onClick={tentarDeNovo}
              aria-disabled={relendo}
              className="h-[52px] rounded-2xl bg-foreground px-6 text-[15px] font-semibold text-background transition-opacity active:scale-[0.98] aria-disabled:opacity-60"
            >
              {relendo ? "Carregando…" : "Tentar de novo"}
            </button>
          </span>
        )}
      </EstadoDaLista>
    );
  }

  // Pedidos já em memória + recarga que falhou: a lista fica como está e só
  // aparece um aviso discreto (nada de apagar o que a cliente já via).
  const avisoDeFalha =
    falhou && temPedidosEmMemoria ? (
      <div
        role="status"
        className="mb-3 flex items-center justify-between gap-3 rounded-[14px] border border-border px-3 py-2 text-left text-xs font-medium text-amber-700 dark:text-amber-400"
      >
        <span>
          Não foi possível atualizar agora. Mostrando o que já tínhamos.
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={tentarDeNovo}
            aria-disabled={relendo}
            className="min-h-11 shrink-0 rounded-xl border border-solid border-border px-3 text-xs font-semibold text-foreground active:scale-95 aria-disabled:opacity-60"
          >
            {relendo ? "Carregando…" : "Tentar de novo"}
          </button>
        )}
      </div>
    ) : null;

  if (orders.length === 0 && !isLoadingOrders) {
    return (
      <EstadoDaLista
        compacto={compact}
        aviso={avisoDeFalha}
        glifo={
          isGuest ? (
            <ShieldCheck className={tamanhoDoGlifo} />
          ) : (
            <Package className={tamanhoDoGlifo} />
          )
        }
        titulo={
          emptyTitle || (isGuest ? "Histórico Protegido" : "Nenhum pedido")
        }
      >
        {emptyDescription ||
          (isGuest
            ? compact
              ? "Acesse para ver seu histórico."
              : guestMessage ||
                "Seus pedidos são vinculados à sua conta. Acesse para visualizar seu histórico completo."
            : "Seu carrinho de pedidos está vazio. Que tal começar a comprar?")}
        {!isGuest && !compact && (
          <span className="mt-6 block">
            <button
              type="button"
              onClick={() => onNavigate("home")}
              className="h-12 rounded-2xl border border-solid border-border px-6 text-[15px] font-semibold text-foreground transition-colors hover:bg-muted/40 active:scale-[0.98]"
            >
              Ver produtos
            </button>
          </span>
        )}
      </EstadoDaLista>
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
        const retirada =
          order.retiradaNaLoja === true && order.status === "shipping";
        const desc = retirada ? "Venha retirar na loja" : statusBase.desc;
        const formaBase =
          paymentConfig[order.paymentMethod] || paymentConfig.pix;
        // Compra que fechou em R$ 0,00 (cupom de 100%): não há forma de
        // pagamento a mostrar. A regra é UMA só (`pedidoSemValorAPagar`).
        const formaDePagamento = pedidoSemValorAPagar(order)
          ? ROTULO_SEM_VALOR_A_PAGAR
          : formaBase;
        const total = order?.total || 0;
        const date = order?.createdAt ? new Date(order.createdAt) : new Date();
        // Cor só com significado: vermelho = cancelado, verde = entregue ou
        // pronto para retirar; o resto é tinta.
        const tom =
          order.status === "cancelled"
            ? {
                ponto: "bg-red-600 dark:bg-red-400",
                texto: "text-red-600 dark:text-red-400",
              }
            : order.status === "delivered" || retirada
              ? {
                  ponto: "bg-emerald-600 dark:bg-emerald-400",
                  texto: "text-emerald-700 dark:text-emerald-400",
                }
              : { ponto: "bg-foreground", texto: "text-foreground" };

        return (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="group"
          >
            {/* O card inteiro abre o pedido: o `after:` do botão "Ver
                detalhes" se estica sobre o card (padrão "stretched link"),
                então teclado e leitor de tela seguem vendo UM botão só. O
                botão do #id fica acima dele (`relative z-10`) para copiar
                sem abrir. */}
            <div className="relative flex h-full flex-col overflow-hidden rounded-[18px] border border-border bg-background p-4 transition-colors duration-300 hover:border-foreground/30 active:scale-[0.99]">
              {/* Topo: foto, nome e resumo, e o valor. Uma foto só, com o
                  "+N" no canto: fotos lado a lado espremiam o nome e
                  quebravam o resumo em 3 linhas a 375px. */}
              <div className="flex min-w-0 items-start gap-3">
                <div className="relative size-14 flex-shrink-0">
                  <div className="flex size-full items-center justify-center overflow-hidden rounded-xl bg-muted">
                    {order.items[0]?.image ? (
                      <img
                        src={order.items[0].image}
                        alt={order.items[0].name || ""}
                        className="size-full object-cover"
                      />
                    ) : (
                      <Package className="size-6 text-muted-foreground" />
                    )}
                  </div>
                  {order.items.length > 1 && (
                    <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-foreground px-1 text-xs font-bold text-background">
                      +{order.items.length - 1}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h4 className="line-clamp-2 break-words text-base font-semibold leading-5 text-foreground">
                    {order.items[0]?.name || "N/A"}
                  </h4>
                  <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                    {order.items.length}{" "}
                    {order.items.length === 1 ? "item" : "itens"} ·{" "}
                    {formaDePagamento}
                    {order.customer.neighborhood
                      ? ` · ${order.customer.neighborhood}`
                      : ""}
                  </p>
                </div>

                <div className="flex-shrink-0 text-right">
                  <span className="block font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    Total
                  </span>
                  <span className="mt-0.5 block text-lg font-bold leading-6 tracking-tight text-foreground">
                    R${" "}
                    {total.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
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
                  "mt-3 border-t border-border py-3",
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
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("size-2.5 shrink-0 rounded-full", tom.ponto)}
                  />
                  <span
                    className={cn(
                      "text-base font-semibold leading-6",
                      tom.texto,
                    )}
                  >
                    {desc}
                  </span>
                </div>
                <CustomerPaymentBadge
                  paymentStatus={order.paymentStatus}
                  orderStatus={order.status}
                  variant="perfil"
                  className="mt-2"
                />

                <OrderStatusTrail
                  status={order.status}
                  retiradaNaLoja={order.retiradaNaLoja}
                />

                {/* Código livre nunca é cortado; substitui a próxima etapa,
                    sem esconder rastreio já existente no histórico. */}
                {order.trackingCode?.trim() ? (
                  <div className="mt-2 flex min-w-0 items-start gap-1 text-xs leading-4 text-muted-foreground">
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
                    className="mt-2 text-xs leading-4 text-muted-foreground"
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
                  <p className="mt-2 min-h-7 text-[15px] leading-5 text-muted-foreground">
                    {fraseDoCancelado(order.paymentStatus)}
                  </p>
                )}
              </div>

              {/* Rodapé: número (toque copia) e data, e o botão */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3">
                <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(order?.id || "");
                    }}
                    aria-label="Copiar número do pedido"
                    className={cn(
                      "relative z-10 -ml-1 flex min-h-11 items-center gap-1 rounded-lg px-1 transition-colors",
                      copiedId === order.id
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "hover:text-foreground",
                    )}
                  >
                    {copiedId === order.id ? (
                      <>
                        <span className="text-xs font-semibold">Copiado!</span>
                        <Check className="size-3" />
                      </>
                    ) : (
                      <>
                        <span className="uppercase">
                          #{numeroDoPedido(order?.id) || "......."}
                        </span>
                        <Copy className="size-3" />
                      </>
                    )}
                  </button>
                  <span aria-hidden="true">·</span>
                  <span>{date.toLocaleDateString("pt-BR")}</span>
                </div>

                <button
                  onClick={() => onNavigate("order-details", order.id)}
                  data-testid="order-card-open"
                  className="ml-auto flex h-11 flex-shrink-0 items-center justify-center rounded-2xl bg-foreground px-5 text-[15px] font-semibold text-background transition-opacity after:absolute after:inset-0 after:rounded-[18px] after:content-[''] hover:opacity-90 active:scale-[0.97]"
                >
                  Ver detalhes
                </button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
});
