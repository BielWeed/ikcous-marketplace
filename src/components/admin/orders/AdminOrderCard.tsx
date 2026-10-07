import { LazyImage } from "@/components/LazyImage";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/admin/orders/OrderStatusBadge";
import { podeRegistrarPagamento } from "@/components/admin/orders/podeRegistrarPagamento";
import { horarioRelativo } from "@/lib/horario-relativo";
import { rotuloDaFormaDePagamento } from "@/lib/pedidos-csv";
import { cn } from "@/lib/utils";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { Order, OrderStatus } from "@/types";
import { motion } from "framer-motion";
import { Check, ChevronRight, MessageCircle, Package } from "lucide-react";
import { memo } from "react";

interface AdminOrderCardProps {
  readonly order: Order;
  readonly viewMode: "detailed" | "compact";
  readonly onSelect: (order: Order) => void;
  readonly onWhatsApp: (order: Order) => void;
  readonly changeType?: "INSERT" | "UPDATE";
  /** Task 4 — chama `registrarPagamentoRecebido(orderId, recebido)` do hook. */
  readonly onRegistrarPagamento: (orderId: string, recebido: boolean) => void;
  /** Task 4 — true enquanto ESTE pedido está em voo na RPC (desabilita o botão). */
  readonly registrandoPagamento: boolean;
}

/**
 * Cor do estado do pedido: uma faixa na borda esquerda e um brilho suave que
 * sai dela. O lojista varre a lista pelo estado antes de ler qualquer texto.
 * Mesmas famílias de cor do `statusConfig` (azul novo, âmbar separando,
 * índigo a caminho, verde finalizado, cinza cancelado). As classes ficam
 * escritas por extenso: o Tailwind só gera o que encontra no código.
 */
function corDoStatus(status: OrderStatus | undefined): {
  faixa: string;
  brilho: string;
} {
  switch (status) {
    case "processing":
      return { faixa: "bg-amber-500", brilho: "from-amber-500/[0.08]" };
    case "shipping":
      return { faixa: "bg-indigo-500", brilho: "from-indigo-500/[0.08]" };
    case "delivered":
      return { faixa: "bg-emerald-500", brilho: "from-emerald-500/[0.07]" };
    case "cancelled":
      return { faixa: "bg-zinc-600", brilho: "from-zinc-500/[0.05]" };
    default:
      return { faixa: "bg-blue-500", brilho: "from-blue-500/[0.08]" };
  }
}

function resumoDosItens(order: Order): string {
  const itens = order.items ?? [];
  if (itens.length === 0) return "Pedido vazio";
  if (itens.length === 1) return itens[0].name;
  return `${itens[0].name} e mais ${itens.length - 1}`;
}

/**
 * Card de pedido da lista do painel. Redesenho de 07/10/2026 (relato do
 * Gabriel: "esse card dos pedidos está muito ruim"), refinado na segunda
 * rodada do mesmo dia: o card antigo tinha texto de 8–9px, um rodapé quase
 * vazio e o botão de recebimento solto numa segunda faixa.
 *
 * Leitura de cima para baixo, uma pergunta por faixa:
 *  1. ESTADO — o selo do pedido (e a faixa/brilho colorido na borda), com
 *     número e idade no canto;
 *  2. QUEM, O QUÊ e QUANTO — miniatura, cliente e produto de um lado, valor do
 *     outro (em card estreito o valor desce sozinho);
 *  3. COBRANÇA e AÇÃO — situação do dinheiro à esquerda; WhatsApp e "Marcar
 *     como recebido" à direita, com área de toque de 40px.
 *
 * Os dois modos de visualização (`compact`/`detailed`) usam a mesma estrutura;
 * só a escala muda. O contrato com os testes e o resto do painel não mudou:
 * `data-testid="pedido-card"`, `selo-canal`, e os textos "Marcar como
 * recebido"/"Registrando..."/"Recebido em"/"Desfazer".
 */
export const AdminOrderCard = memo(function AdminOrderCard({
  order,
  viewMode,
  onSelect,
  onWhatsApp,
  changeType,
  onRegistrarPagamento,
  registrandoPagamento,
}: AdminOrderCardProps) {
  const grande = viewMode === "detailed";
  const itens = order.items ?? [];
  const miniatura = itens[0]?.image;
  const unidades = itens.reduce((soma, item) => soma + (item.quantity || 1), 0);
  const nome = order.customer?.name || "Cliente";
  const resumo = resumoDosItens(order);
  const tempo = horarioRelativo(order.createdAt);
  const forma = rotuloDaFormaDePagamento(order.paymentMethod);
  const total = (order.total || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
  });
  const linkWhatsapp = linkWhatsappDoCliente(order.customer?.whatsapp);
  const registra = podeRegistrarPagamento(order);
  const cor = corDoStatus(order.status);
  const tamanhoDaMiniatura = grande ? "size-16" : "size-14";

  return (
    <motion.div
      layout
      onClick={() => onSelect(order)}
      role="button"
      // Âncora estável para teste (achado 6 da rodada de correção do C4.4): a
      // tela tem outros elementos com `role="button"` (os atalhos de
      // Feedback/Dúvidas), então medir a subárvore do card pelo primeiro
      // `[role="button"]` encontrado pega o card errado.
      data-testid="pedido-card"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(order);
        }
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden border bg-gradient-to-b from-zinc-900/70 to-zinc-950/80 backdrop-blur-md transition-all duration-300 transform-gpu animate-in fade-in slide-in-from-bottom-2",
        "hover:border-admin-gold/40 hover:shadow-[0_12px_32px_rgba(0,0,0,0.35)] active:scale-[0.99]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        grande ? "rounded-3xl content-visibility-auto" : "rounded-2xl",
        changeType === "INSERT" &&
          "border-admin-gold shadow-[0_0_20px_rgba(212,175,55,0.3)] animate-pulse",
        changeType === "UPDATE" &&
          "border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)] animate-pulse",
        !changeType && "border-white/10",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-1", cor.faixa)}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-3/5 bg-gradient-to-r to-transparent",
          cor.brilho,
        )}
      />

      <div
        className={cn(
          "relative z-10 flex flex-1 flex-col",
          grande ? "gap-5 p-6 pl-7" : "gap-4 p-4 pl-5",
        )}
      >
        {/* 1. ESTADO: o selo do pedido à frente (é o que o lojista procura
            primeiro) e, no canto, número e idade. `flex-wrap`: em card
            estreito o número desce em vez de espremer o selo. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <OrderStatusBadge status={order.status} tamanho="cartao" />
            {/* C4.4: selo de canal na MESMA fileira do status — um selo a
                mais em coluna esticaria todos os cards vizinhos da fileira.
                `data-testid` ancora a prova no ELEMENTO, não no texto da
                subárvore (que também traz "balcão" minúsculo no rótulo do
                PaymentStatusBadge: "Recebido no balcão"). */}
            {order.canal === "presencial" && (
              <span
                data-testid="selo-canal"
                className="flex items-center rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300"
              >
                Balcão
              </span>
            )}
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-zinc-500">
            <span className="text-zinc-300 transition-colors group-hover:text-admin-gold">
              #{order.id.slice(-6).toUpperCase()}
            </span>
            {tempo ? ` · ${tempo}` : ""}
          </span>
        </div>

        {/* 2. QUEM, O QUÊ e QUANTO numa linha só quando o card é largo; em
            card estreito o valor desce sozinho para baixo do cliente, sem
            ninguém ficar espremido (`flex-wrap` + `basis` mínimo). */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-[13rem] items-center gap-3.5">
            <div className="relative shrink-0">
              {miniatura ? (
                <LazyImage
                  src={miniatura}
                  alt="Produto"
                  className={cn(
                    "shrink-0 rounded-2xl border border-white/10 object-cover shadow-md",
                    tamanhoDaMiniatura,
                  )}
                />
              ) : (
                <div
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900",
                    tamanhoDaMiniatura,
                  )}
                >
                  <Package className="size-6 text-zinc-600" />
                </div>
              )}
              {itens.length > 1 && (
                <div className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full border border-zinc-900 bg-admin-gold px-1 text-[10px] font-black leading-5 text-black shadow-lg">
                  +{itens.length - 1}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4
                title={nome}
                className={cn(
                  "line-clamp-2 font-bold leading-snug text-white transition-colors group-hover:text-admin-gold",
                  grande ? "text-xl" : "text-base",
                )}
              >
                {nome}
              </h4>
              {!grande && (
                <p
                  title={resumo}
                  className="mt-0.5 truncate text-[13px] text-zinc-400"
                >
                  {resumo}
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0">
            <p className="flex items-baseline gap-1 font-black tabular-nums leading-none text-white">
              <span className="text-xs font-bold text-zinc-500">R$</span>
              <span className={grande ? "text-4xl" : "text-[26px]"}>
                {total}
              </span>
            </p>
            <p className="mt-1.5 text-[11px] font-medium text-zinc-500">
              {forma} · {unidades} {unidades === 1 ? "item" : "itens"}
            </p>
          </div>
        </div>

        {/* Só no modo detalhado: o que há dentro do pedido, sem abrir a ficha. */}
        {grande && itens.length > 0 && (
          <ul className="space-y-1.5 rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
            {itens.slice(0, 3).map((item) => (
              <li
                key={`${item.productId}-${item.variantId ?? ""}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 font-semibold tabular-nums text-zinc-500">
                  {item.quantity || 1}×
                </span>
              </li>
            ))}
            {itens.length > 3 && (
              <li className="text-xs text-zinc-500">
                + {itens.length - 3}{" "}
                {itens.length - 3 === 1 ? "outro" : "outros"}
              </li>
            )}
          </ul>
        )}

        {/* 3. COBRANÇA e AÇÃO na mesma faixa: à esquerda a situação do
            dinheiro, à direita o que o lojista pode fazer com ele. Em card
            estreito as ações descem para a linha de baixo e ocupam a largura.
            Laudo 0109 (A-7): sem número válido o toque do WhatsApp não tinha
            efeito — o botão simplesmente não existe. */}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t border-white/10 pt-3.5">
          <PaymentStatusBadge
            paymentStatus={order.paymentStatus}
            orderStatus={order.status}
            canal={order.canal}
            tamanho="cartao"
            // Rótulo CURTO só no modo compacto, onde a frase longa estourava
            // a coluna (relato do Gabriel, 02/09); o detalhado tem folga.
            compact={!grande}
          />

          <div className="ml-auto flex min-w-0 flex-1 basis-[13rem] items-center justify-end gap-2">
            {linkWhatsapp && (
              <button
                type="button"
                title="WhatsApp"
                aria-label="Chamar o cliente no WhatsApp"
                onClick={(e) => {
                  e.stopPropagation();
                  onWhatsApp(order);
                }}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 transition-all hover:bg-emerald-500 hover:text-black active:scale-90"
              >
                <MessageCircle className="size-[18px]" />
              </button>
            )}

            {/* Task 4 do plano recebimento-na-entrega: `podeRegistrarPagamento`
                é a MESMA condição (definida uma vez, em outro módulo) que
                decide se este bloco existe e qual dos dois ramos aparece. */}
            {registra ? (
              order.pagamentoRecebidoEm ? (
                <>
                  <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-xs font-semibold text-emerald-400">
                    <Check className="size-4 shrink-0" />
                    <span className="truncate">
                      Recebido em{" "}
                      {new Date(order.pagamentoRecebidoEm).toLocaleDateString(
                        "pt-BR",
                        { day: "2-digit", month: "short" },
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRegistrarPagamento(order.id, false);
                    }}
                    disabled={registrandoPagamento}
                    className="h-10 shrink-0 rounded-xl border border-zinc-700/60 bg-zinc-800/50 px-3.5 text-xs font-semibold text-zinc-300 transition-all hover:bg-zinc-700 hover:text-white disabled:opacity-50"
                  >
                    Desfazer
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegistrarPagamento(order.id, true);
                  }}
                  disabled={registrandoPagamento}
                  className="flex h-10 min-w-0 max-w-[15rem] flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-300 transition-all hover:bg-emerald-500 hover:text-emerald-950 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
                >
                  <Check className="size-4 shrink-0" />
                  {registrandoPagamento
                    ? "Registrando..."
                    : "Marcar como recebido"}
                </button>
              )
            ) : (
              <span className="flex items-center gap-1 text-xs font-semibold text-zinc-500 transition-colors group-hover:text-admin-gold">
                Ver detalhes
                <ChevronRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});
