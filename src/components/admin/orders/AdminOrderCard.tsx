import { LazyImage } from "@/components/LazyImage";
import { DesfazerRecebimento } from "@/components/admin/orders/DesfazerRecebimento";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
  rotuloDoStatus,
} from "@/components/admin/orders/OrderStatusBadge";
import { podeRegistrarPagamento } from "@/components/admin/orders/podeRegistrarPagamento";
import { AnularVendaDoBalcao } from "@/components/admin/pdv/AnularVendaDoBalcao";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResultadoDaAnulacao } from "@/hooks/useAnularVendaDoBalcao";
import { podeAnularVendaDoBalcao } from "@/lib/anulacao-do-balcao";
import { pedidoSemValorAPagar } from "@/lib/forma-de-pagamento";
import { horarioRelativo } from "@/lib/horario-relativo";
import {
  fraseDeEsperaDoPedido,
  idadeDoPedidoPendente,
} from "@/lib/idade-do-pedido-pendente";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { rotuloDaFormaDePagamento } from "@/lib/pedidos-csv";
import { textoCancelamentoDoPainel } from "@/lib/texto-cancelamento-do-painel";
import { cn } from "@/lib/utils";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { Order, OrderStatus } from "@/types";
import {
  Check,
  ChevronRight,
  CircleDollarSign,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Package,
  Store,
  TriangleAlert,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { memo, useRef, useState } from "react";

interface AdminOrderCardProps {
  readonly order: Order;
  readonly viewMode: "detailed" | "compact";
  readonly onSelect: (order: Order) => void;
  readonly onWhatsApp: (order: Order) => void;
  readonly changeType?: "INSERT" | "UPDATE";
  readonly onRegistrarPagamento: (orderId: string, recebido: boolean) => void;
  readonly registrandoPagamento: boolean;
  readonly onStatusChange?: (
    orderId: string,
    status: OrderStatus,
  ) => Promise<void>;
  /** A mesma gravação da ficha: deve rejeitar para impedir o avanço se falhar. */
  readonly onReceberAntesDeAvancar?: (
    orderId: string,
    recebido: boolean,
  ) => Promise<unknown>;
  readonly onAnularVenda?: (
    orderId: string,
    motivo: string,
  ) => Promise<ResultadoDaAnulacao>;
  readonly isOffline?: boolean;
  readonly destaquePrimario?: boolean;
}

const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";
const SECUNDARIO = `relative z-10 flex min-h-11 items-center justify-center gap-2 whitespace-normal rounded-2xl border border-white/10 bg-[#1E1E24] px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-[#26262E] disabled:cursor-not-allowed disabled:text-zinc-400 ${FOCO}`;
const PRINCIPAL = `${SECUNDARIO} min-h-14 border-[#F6D365]/50 bg-gradient-to-b from-[#F6D365] to-[#E4AD18] text-[#211A05] hover:brightness-105`;
const PERIGO = `${SECUNDARIO} border-red-300/15 bg-red-400/10 text-red-300 hover:bg-red-400/20`;
const ETAPAS: readonly OrderStatus[] = [
  "pending",
  "processing",
  "shipping",
  "delivered",
];

/** Menu e confirmações são apresentação: as escritas continuam nos callbacks da tela. */
export const AdminOrderCard = memo(function AdminOrderCard({
  order,
  viewMode,
  onSelect,
  onWhatsApp,
  changeType,
  onRegistrarPagamento,
  registrandoPagamento,
  onStatusChange,
  onReceberAntesDeAvancar,
  onAnularVenda,
  isOffline = false,
  destaquePrimario = false,
}: AdminOrderCardProps) {
  const [painel, setPainel] = useState<
    "acoes" | "cancelar" | "receber" | "avancar" | "entregar" | null
  >(null);
  const [processando, setProcessando] = useState(false);
  const [destinoConfirmado, setDestinoConfirmado] = useState<OrderStatus>();
  const [anulando, setAnulando] = useState(false);
  const [anulada, setAnulada] = useState(false);
  const emVoo = useRef(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const grande = viewMode === "detailed";
  const itens = order.items ?? [];
  const unidades = itens.reduce((soma, item) => soma + (item.quantity || 1), 0);
  const nome = order.customer?.name || "Cliente";
  const numero = numeroDoPedido(order.id);
  const tempo = horarioRelativo(order.createdAt);
  const data = new Date(order.createdAt);
  const criadoEm = Number.isNaN(data.getTime())
    ? null
    : data.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
  const total = (order.total || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
  });
  const forma = rotuloDaFormaDePagamento(order);
  const linkWhatsapp = linkWhatsappDoCliente(order.customer?.whatsapp);
  const registra = podeRegistrarPagamento(order);
  const faltaReceber = registra && !order.pagamentoRecebidoEm;
  const podeCancelar =
    order.status !== "cancelled" && order.status !== "delivered";
  const proximo =
    order.status === "cancelled"
      ? undefined
      : ETAPAS[ETAPAS.indexOf(order.status) + 1];
  // Mesmos três valores da confirmação da ficha. Expirado não acrescenta regra nova.
  const pagamentoNaoConfirmado = [
    "aguardando",
    "recusado",
    "estornado",
  ].includes(order.paymentStatus ?? "");
  const avisoDeEspera = fraseDeEsperaDoPedido(
    idadeDoPedidoPendente(order.createdAt, order.status),
  );
  const bloqueado = isOffline || processando || registrandoPagamento;
  const resumo =
    itens.length === 0
      ? "Pedido vazio"
      : `${itens[0].name}${itens.length > 1 ? ` + ${itens.length - 1} ${itens.length === 2 ? "item" : "itens"}` : ""}`;
  const aviso =
    order.status === "cancelled"
      ? "Pedido cancelado"
      : order.paymentStatus === "pago_apos_expirar"
        ? "Pago fora do fluxo — precisa de atenção. Confira o pagamento na ficha antes de avançar."
        : order.paymentStatus === "recusado"
          ? "Pagamento recusado · pedido aberto"
          : order.paymentStatus === "estornado"
            ? "Pagamento estornado · pedido aberto"
            : order.paymentStatus === "expirado"
              ? "Pagamento expirado · pagamento não recebido"
              : avisoDeEspera;

  async function executar(status?: OrderStatus, receber = false) {
    if (bloqueado || emVoo.current) return;
    if (status === "cancelled" && !podeCancelar) return;
    if (receber && !registra) return;
    emVoo.current = true;
    setProcessando(true);
    setPainel(null);
    try {
      // Mesma ordem da ficha: dinheiro primeiro; se rejeitar, não muda o status.
      if (receber && status) {
        if (!onReceberAntesDeAvancar) return;
        await onReceberAntesDeAvancar(order.id, true);
      } else if (receber) {
        await onRegistrarPagamento(order.id, true);
      }
      if (status) await onStatusChange?.(order.id, status);
    } catch {
      // O hook já traduziu e mostrou o erro. Não duplicar aviso.
    } finally {
      emVoo.current = false;
      setProcessando(false);
    }
  }

  function avancar() {
    if (!proximo || bloqueado) return;
    setDestinoConfirmado(proximo);
    if (pagamentoNaoConfirmado) {
      setPainel("avancar");
      return;
    }
    if (proximo === "delivered" && faltaReceber && onReceberAntesDeAvancar) {
      if (pedidoSemValorAPagar(order)) {
        void executar(proximo, true);
        return;
      }
      setPainel("entregar");
      return;
    }
    void executar(proximo);
  }

  async function anularComMotivo(motivo: string) {
    if (!onAnularVenda) throw new Error("Anulação indisponível.");
    setAnulando(true);
    try {
      const resultado = await onAnularVenda(order.id, motivo);
      setAnulada(true);
      return resultado;
    } finally {
      setAnulando(false);
    }
  }

  const acaoPrincipal = faltaReceber && !pagamentoNaoConfirmado;
  const pagoForaDoFluxo = order.paymentStatus === "pago_apos_expirar";
  const estiloPrincipal =
    destaquePrimario &&
    !pagamentoNaoConfirmado &&
    order.paymentStatus !== "pago_apos_expirar"
      ? PRINCIPAL
      : `${SECUNDARIO} min-h-14`;
  const abrirFicha = () => onSelect(order);
  const titulo =
    painel === "acoes"
      ? "Ações do pedido"
      : painel === "cancelar"
        ? "Cancelar pedido"
        : painel === "avancar"
          ? "Avançar mesmo assim"
          : "Confirmar recebimento";
  const textoCancelamento = textoCancelamentoDoPainel({
    status: order.status,
    payment_status: order.paymentStatus,
    cancelledAfterShipping: order.cancelledAfterShipping,
    valorEstornado: order.valorEstornado,
  });

  return (
    <article
      data-testid="pedido-card"
      className={cn(
        "relative flex h-full min-w-0 flex-col break-words rounded-[24px] border bg-[#101013] p-3 text-zinc-100",
        changeType
          ? "border-sky-300/60 ring-1 ring-sky-300/30"
          : "border-white/10",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <OrderStatusBadge
              status={order.status}
              retiradaNaLoja={order.retiradaNaLoja}
              tamanho="cartao"
            />
            {order.canal === "presencial" && (
              <span
                data-testid="selo-canal"
                className="flex items-center gap-1 rounded-full bg-pink-400/10 px-2 py-1 text-[11px] font-bold text-pink-300"
              >
                <Store aria-hidden="true" className="size-3" />
                Balcão
              </span>
            )}
          </div>
          <p className="mt-1 text-xs tabular-nums text-zinc-400">
            #{numero}
            {criadoEm ? ` · ${criadoEm}` : ""}
          </p>
        </div>
        <span className="min-w-0 pt-1 text-right text-[11px] text-zinc-400">
          {tempo}
          {changeType === "INSERT"
            ? " · novo"
            : changeType === "UPDATE"
              ? " · atualizado"
              : ""}
        </span>
        <button
          ref={menuRef}
          type="button"
          aria-label={`Ações do pedido #${numero}`}
          onClick={() => setPainel("acoes")}
          className={`${SECUNDARIO} size-11 shrink-0 p-0`}
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </button>
      </div>
      <button
        type="button"
        data-abrir-pedido
        aria-label={`Ver detalhes do pedido #${numero}`}
        onClick={abrirFicha}
        className={`my-1 flex min-h-11 w-full items-center gap-2.5 rounded-xl py-1 text-left after:absolute after:inset-0 after:rounded-[24px] after:content-[''] ${FOCO}`}
      >
        {itens[0]?.image ? (
          <LazyImage
            src={itens[0].image}
            alt={itens[0].name}
            className="size-11 shrink-0 rounded-2xl border border-white/10 object-cover"
          />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-indigo-300/20 bg-indigo-300/10 text-indigo-300">
            <Package aria-hidden="true" className="size-6" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <h4 className="break-words text-base font-bold leading-snug text-white">
            {nome}
          </h4>
          {!grande && (
            <span className="block break-words text-sm leading-snug text-zinc-300">
              {resumo}
            </span>
          )}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 text-zinc-400"
        />
      </button>
      {grande && itens.length > 0 && (
        <ul className="mb-2 space-y-1.5 rounded-2xl border border-white/10 bg-[#17171C] p-3 text-sm text-zinc-200">
          {itens.slice(0, 3).map((item, i) => (
            <li
              key={`${item.productId}-${item.variantId ?? i}`}
              className="flex items-start gap-2"
            >
              <span className="shrink-0 font-semibold">
                {item.quantity || 1}×
              </span>
              <span className="min-w-0 break-words">{item.name}</span>
            </li>
          ))}
          {itens.length > 3 && (
            <li className="text-xs text-zinc-400">e mais {itens.length - 3}</li>
          )}
        </ul>
      )}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[22px] font-bold tabular-nums leading-tight text-white">
          R$ {total}{" "}
          <span className="text-xs font-normal text-zinc-400">
            {unidades} un.
          </span>
        </p>
        <div className="flex max-w-full flex-wrap items-center gap-x-1 text-xs text-zinc-300">
          <span>{forma} ·</span>
          <PaymentStatusBadge
            paymentStatus={order.paymentStatus}
            orderStatus={order.status}
            canal={order.canal}
            tamanho="cartao"
            compact={!grande}
          />
        </div>
      </div>
      {aviso && (
        <p
          className={cn(
            "mb-2 flex items-start gap-1.5 rounded-xl p-2 text-xs leading-relaxed",
            order.status === "cancelled"
              ? "bg-red-400/10 text-red-300"
              : "bg-orange-300/10 text-orange-300",
          )}
        >
          {order.status === "cancelled" ? (
            <XCircle aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          )}
          <span>{aviso}</span>
        </p>
      )}
      {registra && order.pagamentoRecebidoEm && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <span>
            Recebido em{" "}
            {new Date(order.pagamentoRecebidoEm).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <DesfazerRecebimento
            order={order}
            aoDesfazer={() => onRegistrarPagamento(order.id, false)}
            disabled={bloqueado}
            className={SECUNDARIO}
          />
        </div>
      )}
      {isOffline && (
        <p
          role="status"
          className="mb-2 flex items-start gap-2 rounded-xl bg-orange-300/10 p-2 text-xs text-orange-300"
        >
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          <span>
            Sem internet agora. Avançar, cancelar e editar ficam indisponíveis
            até a conexão voltar.
          </span>
        </p>
      )}
      <div className="mt-auto flex items-stretch gap-2">
        <button
          type="button"
          title="WhatsApp"
          aria-label={
            linkWhatsapp
              ? "Chamar o cliente no WhatsApp"
              : "WhatsApp indisponível: sem telefone válido"
          }
          disabled={!linkWhatsapp || isOffline}
          onClick={() => onWhatsApp(order)}
          className={`${SECUNDARIO} min-h-14 w-11 shrink-0 border-emerald-300/15 bg-emerald-400/10 p-0 text-emerald-300`}
        >
          <MessageCircle aria-hidden="true" className="size-5" />
        </button>
        {acaoPrincipal ? (
          <button
            type="button"
            disabled={bloqueado}
            onClick={() => setPainel("receber")}
            className={`${estiloPrincipal} flex-1`}
          >
            {registrandoPagamento || processando
              ? "Registrando..."
              : "Marcar como recebido"}
          </button>
        ) : proximo && onStatusChange && !pagoForaDoFluxo ? (
          <button
            type="button"
            disabled={bloqueado}
            onClick={avancar}
            className={`${estiloPrincipal} flex-1`}
          >
            {processando
              ? "Processando..."
              : pagamentoNaoConfirmado
                ? "Avançar mesmo assim"
                : `Avançar → ${rotuloDoStatus(proximo, order.retiradaNaLoja)}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={abrirFicha}
            className={`${SECUNDARIO} min-h-14 flex-1`}
          >
            Ver detalhes
          </button>
        )}
      </div>
      {(pagamentoNaoConfirmado ||
        order.paymentStatus === "pago_apos_expirar") &&
        podeCancelar &&
        onStatusChange && (
          <button
            type="button"
            disabled={bloqueado}
            onClick={() => setPainel("cancelar")}
            className={`${PERIGO} mt-2 w-full`}
          >
            <XCircle aria-hidden="true" className="size-4" />
            Cancelar pedido
          </button>
        )}
      {!linkWhatsapp && (
        <p className="mt-2 text-xs text-zinc-400">
          WhatsApp indisponível. Este cliente não tem telefone válido. A ficha e
          as outras ações continuam disponíveis.
        </p>
      )}

      <Dialog
        open={painel !== null}
        onOpenChange={(aberto) => {
          if (!aberto && !emVoo.current && !anulando) setPainel(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault();
            menuRef.current?.focus();
          }}
          className="fixed bottom-0 left-1/2 top-auto z-[80] max-h-[90dvh] w-full max-w-full -translate-x-1/2 translate-y-0 gap-5 overflow-y-auto rounded-b-none rounded-t-[28px] border-white/15 bg-[#17171C] p-5 pb-[max(20px,env(safe-area-inset-bottom))] text-zinc-100 sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-[28px]"
        >
          <span
            aria-hidden="true"
            className="mx-auto h-1 w-10 rounded-full bg-zinc-500 sm:hidden"
          />
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-xl font-bold">{titulo}</DialogTitle>
            <button
              type="button"
              aria-label="Fechar ações do pedido"
              disabled={anulando}
              onClick={() => setPainel(null)}
              className={`${SECUNDARIO} size-11 shrink-0 p-0`}
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <DialogDescription className="break-words text-sm text-zinc-400">
            {nome} · #{numero} · R$ {total}
          </DialogDescription>
          {painel === "acoes" ? (
            <div className="space-y-2 border-t border-white/10 pt-2">
              {[
                {
                  label: "Ver detalhes",
                  motivo: "Abre a ficha completa do pedido.",
                  Icone: Package,
                  cor: "text-indigo-300",
                  clicar: abrirFicha,
                  disabled: false,
                },
                {
                  label: "WhatsApp",
                  motivo: !linkWhatsapp
                    ? "Indisponível: sem telefone válido."
                    : isOffline
                      ? "Indisponível: sem conexão."
                      : "Chamar o cliente no WhatsApp.",
                  Icone: MessageCircle,
                  cor: "text-emerald-300",
                  clicar: () => onWhatsApp(order),
                  disabled: !linkWhatsapp || isOffline,
                },
                {
                  label: "Marcar como recebido",
                  motivo:
                    order.status === "cancelled"
                      ? "Indisponível: pedido cancelado."
                      : !registra
                        ? "Indisponível: este pagamento é online."
                        : order.pagamentoRecebidoEm
                          ? "Indisponível: o valor já foi recebido."
                          : isOffline
                            ? "Indisponível: sem conexão."
                            : "Confirme depois de receber o valor.",
                  Icone: CircleDollarSign,
                  cor: "text-emerald-300",
                  clicar: () => setPainel("receber"),
                  disabled: !faltaReceber || bloqueado,
                },
                {
                  label: "Cancelar pedido",
                  motivo: !podeCancelar
                    ? order.status === "delivered"
                      ? "Venda finalizada: use Anular venda quando disponível."
                      : "Indisponível: pedido cancelado."
                    : isOffline
                      ? "Indisponível: sem conexão."
                      : "Pede confirmação e explica o que acontece com o dinheiro.",
                  Icone: XCircle,
                  cor: "text-red-300",
                  clicar: () => setPainel("cancelar"),
                  disabled: !podeCancelar || bloqueado || !onStatusChange,
                },
                ...(acaoPrincipal && proximo && onStatusChange
                  ? [
                      {
                        label: `Avançar → ${rotuloDoStatus(proximo, order.retiradaNaLoja)}`,
                        motivo: "Mantém as confirmações de pagamento da ficha.",
                        Icone: ChevronRight,
                        cor: "text-cyan-300",
                        clicar: avancar,
                        disabled: bloqueado,
                      },
                    ]
                  : []),
              ].map(({ label, motivo, Icone, cor, clicar, disabled }) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  disabled={disabled}
                  onClick={clicar}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-white/5 disabled:text-zinc-400 ${FOCO}`}
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-white/5",
                      disabled ? "text-zinc-400" : cor,
                    )}
                  >
                    <Icone aria-hidden="true" className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-zinc-400">
                      {motivo}
                    </span>
                  </span>
                  {disabled ? (
                    <LockKeyhole
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    />
                  ) : (
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    />
                  )}
                </button>
              ))}
              {(anulada || anulando || podeAnularVendaDoBalcao(order)) &&
              onAnularVenda ? (
                <fieldset
                  disabled={isOffline}
                  className="space-y-2 rounded-2xl border border-white/10 p-3 [&_button]:min-h-11 [&_textarea]:text-sm"
                >
                  {!anulada && !anulando && (
                    <p className="text-xs text-zinc-400">
                      Venda do balcão não se cancela: se foi engano, anule hoje
                      — o estoque volta e o Financeiro desconta.
                    </p>
                  )}
                  <AnularVendaDoBalcao
                    key={order.id}
                    total={order.total}
                    forma={order.paymentMethod}
                    clienteComConta={Boolean(order.userId)}
                    aoAnular={anularComMotivo}
                  />
                </fieldset>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex min-h-16 w-full items-center gap-3 p-2 text-left text-zinc-400"
                >
                  <Store aria-hidden="true" className="size-5 shrink-0" />
                  <span className="flex-1">
                    <span className="block text-sm font-bold">
                      Anular venda
                    </span>
                    <span className="block text-xs">
                      Só para Balcão finalizado e recebido no mesmo dia.
                    </span>
                  </span>
                  <LockKeyhole aria-hidden="true" className="size-4" />
                </button>
              )}
            </div>
          ) : (
            <>
              <h3 className="text-lg font-bold">
                {painel === "cancelar"
                  ? `Cancelar o pedido #${numero}?`
                  : painel === "avancar"
                    ? "Este pedido não está com o pagamento confirmado"
                    : `Recebeu os R$ ${total} deste pedido?`}
              </h3>
              <p
                className={cn(
                  "rounded-2xl border p-4 text-sm leading-relaxed",
                  painel === "cancelar"
                    ? "border-red-300/15 bg-red-400/10 text-red-200"
                    : painel === "avancar"
                      ? "border-orange-300/15 bg-orange-300/10 text-orange-200"
                      : "border-emerald-300/15 bg-emerald-300/10 text-emerald-200",
                )}
              >
                {painel === "cancelar"
                  ? textoCancelamento
                  : painel === "avancar"
                    ? "O dinheiro deste pedido não entrou. Se você avançar, a mercadoria caminha para sair mesmo assim — e, depois de finalizado, não dá mais para cancelar e devolver ao estoque."
                    : "Pedido de pagamento na entrega. Se você já recebeu o dinheiro na mão, confirme abaixo — o registro fica salvo no pedido."}
              </p>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() =>
                    painel === "entregar"
                      ? void executar(destinoConfirmado)
                      : setPainel(null)
                  }
                  className={SECUNDARIO}
                >
                  {painel === "cancelar"
                    ? "Manter pedido"
                    : painel === "avancar"
                      ? "Cancelar"
                      : "Ainda não"}
                </button>
                <button
                  type="button"
                  disabled={
                    bloqueado ||
                    (painel === "cancelar" && !podeCancelar) ||
                    (painel === "receber" && !faltaReceber)
                  }
                  onClick={() =>
                    void executar(
                      painel === "cancelar"
                        ? "cancelled"
                        : painel === "receber"
                          ? undefined
                          : destinoConfirmado,
                      painel === "receber" || painel === "entregar",
                    )
                  }
                  className={
                    painel === "cancelar"
                      ? `${PERIGO} min-h-14`
                      : painel === "avancar"
                        ? `${SECUNDARIO} min-h-14`
                        : PRINCIPAL
                  }
                >
                  {painel === "cancelar" ? (
                    "Cancelar pedido"
                  ) : painel === "avancar" ? (
                    "Avançar mesmo assim"
                  ) : (
                    <>
                      <Check aria-hidden="true" className="size-5" />
                      Recebi
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
});

export function AdminOrderCardSkeleton({
  viewMode,
}: { readonly viewMode: "detailed" | "compact" }) {
  return (
    <div
      aria-hidden="true"
      className="space-y-3 rounded-[24px] border border-white/10 bg-[#101013] p-3"
    >
      <div className="flex justify-between">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="size-11 rounded-2xl" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="size-11 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      {viewMode === "detailed" && <Skeleton className="h-20 rounded-2xl" />}
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-14 w-full rounded-2xl" />
    </div>
  );
}
