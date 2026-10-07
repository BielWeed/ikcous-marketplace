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
 * Faixa de cor na borda esquerda do card: o lojista varre a lista pelo
 * estado do pedido antes de ler qualquer texto. Mesmas famílias de cor do
 * `statusConfig` (azul novo, âmbar separando, índigo a caminho, verde
 * finalizado, cinza cancelado).
 */
function faixaDoStatus(status: OrderStatus | undefined): string {
  switch (status) {
    case "processing":
      return "bg-amber-500";
    case "shipping":
      return "bg-indigo-500";
    case "delivered":
      return "bg-emerald-500";
    case "cancelled":
      return "bg-zinc-600";
    default:
      return "bg-blue-500";
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
 * Gabriel: "esse card dos pedidos está muito ruim"): o card antigo tinha
 * texto de 8–9px, uma linha de rodapé quase vazia (um ícone e uma seta) e o
 * botão de recebimento solto numa segunda faixa.
 *
 * Leitura de cima para baixo, uma pergunta por faixa:
 *  1. ESTADO — número, há quanto tempo e em que pé está (faixa colorida na
 *     borda + selo do pedido);
 *  2. QUEM e O QUÊ — cliente e produto, com a miniatura;
 *  3. DINHEIRO — valor, como vai pagar e a situação da cobrança;
 *  4. AÇÃO — WhatsApp e "Marcar como recebido" na MESMA linha, com área de
 *     toque de 40px.
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
        "group relative flex cursor-pointer flex-col overflow-hidden border bg-zinc-950/60 backdrop-blur-md transition-all duration-300 transform-gpu animate-in fade-in slide-in-from-bottom-2",
        "hover:border-admin-gold/40 hover:bg-zinc-900/50 active:scale-[0.99]",
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
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          faixaDoStatus(order.status),
        )}
      />

      <div
        className={cn(
          "relative z-10 flex flex-1 flex-col",
          grande ? "gap-5 p-6 pl-7" : "gap-3.5 p-4 pl-5",
        )}
      >
        {/* 1. ESTADO. `flex-wrap`: em card estreito o selo desce para a linha
            de baixo em vez de espremer o número ou estourar a borda. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="text-[11px] font-semibold tabular-nums text-zinc-500">
            <span className="text-zinc-300 transition-colors group-hover:text-admin-gold">
              #{order.id.slice(-6).toUpperCase()}
            </span>
            {tempo ? ` · ${tempo}` : ""}
          </span>
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
        </div>

        {/* 2. QUEM e O QUÊ */}
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            {miniatura ? (
              <LazyImage
                src={miniatura}
                alt="Produto"
                className={cn(
                  "shrink-0 rounded-xl border border-white/10 object-cover",
                  grande ? "size-16" : "size-12",
                )}
              />
            ) : (
              <div
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900",
                  grande ? "size-16" : "size-12",
                )}
              >
                <Package className="size-5 text-zinc-600" />
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
                grande ? "text-lg" : "text-[15px]",
              )}
            >
              {nome}
            </h4>
            {!grande && (
              <p
                title={resumo}
                className="mt-0.5 truncate text-xs text-zinc-400"
              >
                {resumo}
              </p>
            )}
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

        {/* 3. DINHEIRO: valor, como vai pagar e a situação da cobrança. */}
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div>
            <p className="flex items-baseline gap-1 font-black tabular-nums leading-none text-white">
              <span className="text-xs font-bold text-zinc-500">R$</span>
              <span className={grande ? "text-3xl" : "text-[22px]"}>
                {total}
              </span>
            </p>
            <p className="mt-1.5 text-[11px] font-medium text-zinc-500">
              {forma} · {unidades} {unidades === 1 ? "item" : "itens"}
            </p>
          </div>
          <PaymentStatusBadge
            paymentStatus={order.paymentStatus}
            orderStatus={order.status}
            canal={order.canal}
            tamanho="cartao"
            // Rótulo CURTO só no modo compacto, onde a frase longa estourava
            // a coluna (relato do Gabriel, 02/09); o detalhado tem folga.
            compact={!grande}
          />
        </div>

        {/* 4. AÇÃO. Laudo 0109 (A-7): sem número válido o toque do WhatsApp
            não tinha efeito — o botão simplesmente não existe. */}
        <div className="mt-auto flex items-center gap-2 border-t border-white/10 pt-3.5">
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
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-emerald-400">
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
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRegistrarPagamento(order.id, true);
                }}
                disabled={registrandoPagamento}
                className="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-300 transition-all hover:bg-emerald-500 hover:text-emerald-950 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
              >
                <Check className="size-4 shrink-0" />
                {registrandoPagamento
                  ? "Registrando..."
                  : "Marcar como recebido"}
              </button>
            )
          ) : (
            <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-zinc-500 transition-colors group-hover:text-admin-gold">
              Ver detalhes
              <ChevronRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
});
