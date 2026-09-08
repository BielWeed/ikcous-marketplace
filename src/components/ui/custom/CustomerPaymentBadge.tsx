import { paymentStatusKey } from "@/components/admin/orders/OrderStatusBadge";
import { cn } from "@/lib/utils";
import type { OrderStatus, PaymentStatus } from "@/types";
import { memo } from "react";

type Tone = "confirmado" | "aguardando" | "recusado" | "expirado" | "atencao";

interface CustomerPaymentEntry {
  label: string;
  tone: Tone;
}

/**
 * Vocabulário do COMPRADOR — distinto do `paymentStatusConfig` de
 * `OrderStatusBadge.tsx`, que fala a língua do lojista ("fluxo",
 * "reconciliação", "precisa de atenção"). Quem lê esta tela é quem comprou,
 * sem contexto nenhum de reconciliação.
 *
 * `sem_cobranca` (pedido em dinheiro ou PIX combinado à mão, nunca passou
 * por gateway) fica de fora do Record de propósito: não tem entrada aqui, e
 * `customerPaymentStatusEntry` devolve `null` para ele. Afirmar qualquer
 * coisa sobre o pagamento de um pedido que nunca teve cobrança online é o
 * defeito original ("Confirmado via Gateway" fixo) com outra roupa.
 */
const customerPaymentConfig: Record<
  Exclude<ReturnType<typeof paymentStatusKey>, "sem_cobranca">,
  CustomerPaymentEntry
> = {
  pago: { label: "Pagamento confirmado", tone: "confirmado" },
  // Diferente de `pago`: o dinheiro entrou DEPOIS que a reserva venceu (ou
  // depois que o pedido foi cancelado), o estoque já voltou para a
  // prateleira e o pedido está morto — mas o valor está com a loja. Rastreado
  // no SQL (20260810000000_confirmar_pagamento_guarda_status.sql, ~118-120 e
  // ~173-176): `pago_apos_expirar` SEMPRE vem junto de `status='cancelled'`.
  // Continuar verde e igual a `pago` escondia isso do comprador.
  pago_apos_expirar: { label: "Pago após o vencimento", tone: "atencao" },
  aguardando: { label: "Aguardando pagamento", tone: "aguardando" },
  recusado: { label: "Pagamento recusado", tone: "recusado" },
  expirado: { label: "Pagamento expirado", tone: "expirado" },
  estornado: { label: "Pagamento estornado", tone: "recusado" },
  // A loja confirmou que recebeu o pagamento na entrega (dinheiro, PIX ou
  // cartão combinados na hora da entrega) — do ponto de vista do comprador
  // é o mesmo "confirmado" de `pago`, só que fora do gateway.
  recebido_na_entrega: { label: "Pagamento confirmado", tone: "confirmado" },
};

/**
 * O texto do selo é 9px — bem abaixo do limiar de "texto grande" do WCAG —
 * então o mínimo AA é 4,5:1. Medido (Tailwind v3) contra o `bgColor` de cada
 * tom: só o texto mudou de tom aqui (um degrau mais escuro na mesma escala);
 * `bgColor`, `borderColor` e `dot` continuam os mesmos, porque o fundo claro
 * é o que faz a conta fechar.
 *   confirmado (emerald-600/emerald-50): 3,58 → emerald-700: 5,21
 *   aguardando (amber-600/amber-50):     3,07 → yellow-700:  4,75
 *   recusado   (rose-600/rose-50):       4,28 → rose-700:    5,72
 *   expirado   (zinc-500/zinc-100):      4,40 → zinc-600:    7,03
 *   atencao (orange-700/orange-50) já passava (4,88) e não muda.
 *
 * `aguardando` foi para `yellow-700`, não `amber-700`: o primeiro ajuste
 * (achado de revisão) tinha posto os dois tons — `aguardando` e `atencao` —
 * na MESMA família de laranja (amber-700 × orange-700), e a distância de cor
 * (ΔE00) entre eles caiu de 18,4 para 6,9. São justamente os dois estados que
 * este componente existe para separar, e podem aparecer lado a lado em dois
 * cards da mesma lista. `yellow-700` mantém o AA (4,75 sobre `amber-50`, que
 * não muda) e devolve a distância para ΔE00 16,3 — quase o original.
 */
const toneStyles: Record<
  Tone,
  { color: string; bgColor: string; borderColor: string; dot: string }
> = {
  confirmado: {
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-100",
    dot: "bg-emerald-500",
  },
  aguardando: {
    color: "text-yellow-700",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-100",
    dot: "bg-amber-500",
  },
  recusado: {
    color: "text-rose-700",
    bgColor: "bg-rose-50",
    borderColor: "border-rose-100",
    dot: "bg-rose-500",
  },
  expirado: {
    color: "text-zinc-600",
    bgColor: "bg-zinc-100",
    borderColor: "border-zinc-200",
    dot: "bg-zinc-400",
  },
  // Tom próprio, distinto de `confirmado` (verde) e de `recusado` (rosa): o
  // dinheiro entrou, mas fora do fluxo — precisa da atenção do comprador, não
  // é uma boa notícia disfarçada de selo verde.
  atencao: {
    color: "text-orange-700",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
    dot: "bg-orange-600",
  },
};

/**
 * Mesmo conteúdo de `customerPaymentConfig`, como `Map` — a chave vem de uma
 * união fechada de literais e o Record acima já é exaustivo por construção,
 * mas o eslint-plugin-security não distingue isso de um dicionário arbitrário
 * e acusa `detect-object-injection` em toda indexação dinâmica. Mesmo padrão
 * de `OrderStatusBadge.tsx` (`paymentStatusConfigByKey`): gerado a partir do
 * Record em vez de duplicar os rótulos numa segunda fonte.
 */
const customerPaymentConfigByKey = new Map(
  Object.entries(customerPaymentConfig) as [
    Exclude<ReturnType<typeof paymentStatusKey>, "sem_cobranca">,
    CustomerPaymentEntry,
  ][],
);

// Rótulo que sobrepõe `customerPaymentConfig.pago` quando o pedido morreu
// (`status='cancelled'`) com o dinheiro já dentro da loja. Não existe caminho
// de estorno automático neste app — o cliente cancelou um PIX que já pagou,
// o estoque voltou, e o selo verde "confirmado" escondia isso dele.
//
// NÃO se aplica a `pago_apos_expirar`, e a razão mudou depois que este
// rótulo passou a orientar. Uma revisão apontou, com bom argumento, que os
// dois são operacionalmente idênticos (dinheiro na loja, estoque devolvido,
// sem estorno) e que a ficha os trata como UM caso em
// `cancelledDescription` — logo o selo deveria unificar também.
//
// Tentei unificar e MEDI que é pior: a descrição da ficha é genérica
// ("...mas o seu pagamento foi recebido"), então "após o vencimento" não é
// dito em NENHUM outro lugar do app. Unificar o rótulo apagaria a causa das
// duas telas para ganhar uma orientação que o comprador já alcança — na
// ficha pela própria descrição, na lista pelo botão "Ver Detalhes".
//
// E não são a mesma decisão duplicada: a DESCRIÇÃO unifica porque a frase
// serve aos dois; o RÓTULO separa porque ele é o único portador da causa.
//
// Rótulo original era "Pago — pedido cancelado" (185,2px): quebra em duas
// linhas a 375px de viewport (180,6px disponíveis no card — faltam 4,6px, e
// o em-dash sozinho custa exatamente isso). "Pago — fale com a loja"
// (171,2px, 9,4px de folga) também ORIENTA — o rótulo antigo só informava —
// e repete o vocabulário que `cancelledDescription` já usa mais abaixo
// ("Fale com a loja para resolver."), então as duas telas dizem a mesma
// coisa.
//
// SE APLICA a `recebido_na_entrega` (Task 3b de
// docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md), diferente
// de `pago_apos_expirar` acima: não existe rótulo próprio para "recebido na
// entrega, cancelado depois" em lugar nenhum do app — sem essa entrada aqui,
// o selo mostraria "Pagamento confirmado" verde para um pedido morto.
// `recebido_na_entrega` fica FORA do Mercado Pago (brief T7): a devolução
// sempre depende da loja, enviado ou não — por isso este rótulo continua
// valendo pra ele em qualquer estado de envio (ver `customerPaymentStatusEntry`).
const PAGO_MAS_CANCELADO: CustomerPaymentEntry = {
  label: "Pago — fale com a loja",
  tone: "atencao",
};

// Rodada 2 (laudo Opus PR#457, BLOQUEIA 1): caso `pago`/`pago_apos_expirar` +
// cancelado + NÃO enviado — desde 07/09/2026 (Task 1 do plano-mãe de estorno
// pelo app) esse cancelamento grava a linha de devolução em `order_refunds`
// na MESMA transação e o cron/edge tocam o Mercado Pago sozinhos. Antes desta
// rodada o selo continuava mostrando `PAGO_MAS_CANCELADO` ("fale com a
// loja") para ESTE caso também, contradizendo a linha nova de devolução
// (`textoDevolucao`, logo abaixo do selo na tela) e a description do card de
// status — as três diziam coisas opostas sobre o mesmo dinheiro. Tom
// `confirmado` (verde), não `atencao` (laranja): o cliente não precisa agir,
// é boa notícia — contraste já medido para este tom (emerald-700/emerald-50:
// 5,21, ver `toneStyles`).
const PAGO_MAS_CANCELADO_DEVOLUCAO_AUTOMATICA: CustomerPaymentEntry = {
  label: "Pago — devolução automática",
  tone: "confirmado",
};

// Caso oposto de `PAGO_MAS_CANCELADO`: o cliente cancelou um PIX que ainda
// NÃO pagou (`payment_status` continua 'aguardando'). `update_order_status_atomic`
// grava `status='cancelled'` e devolve o estoque, mas não toca em
// `payment_status` — rastreado em
// `20260812000000_reconciliar_pedido_cancelado.sql` (linhas 6-17), que
// descreve exatamente esse estado: "o pedido fica 'aguardando' +
// 'cancelled' … Dinheiro parado no MP, app mostrando 'Aguardando
// pagamento'". Sem esta entrada, o selo dinâmico ficava preso ao verbete
// `aguardando` do Record acima e CONVIDAVA o cliente a pagar um pedido morto
// — o QR do PIX continua válido no app do banco dele, e este app não tem
// estorno automático. Tom `atencao` (laranja), não o `aguardando` (âmbar):
// aqui a mensagem é o oposto de "aguarde", é "não pague".
const AGUARDANDO_MAS_CANCELADO: CustomerPaymentEntry = {
  label: "Cancelado — não pague",
  tone: "atencao",
};

/**
 * Traduz `payment_status` (e, quando o pedido morreu com o dinheiro dentro,
 * também `status`) para o texto que o comprador vê. `null` para
 * `sem_cobranca` — quem renderiza não desenha nada nesse caso.
 *
 * `cancelledAfterShipping` só decide algo para `pago` (rodada 2, BLOQUEIA
 * 1): `=== false` (o chamador SABE que o pedido não foi enviado) devolve o
 * rótulo de devolução automática; `undefined` (chamador não tem o pedido) OU
 * `true` (enviado) mantêm `PAGO_MAS_CANCELADO` — o comportamento de antes
 * desta correção, que é o correto para "enviado" e o mais seguro para
 * "não sei".
 */
export function customerPaymentStatusEntry(
  paymentStatus: PaymentStatus | null | undefined,
  orderStatus?: OrderStatus | null,
  cancelledAfterShipping?: boolean,
): CustomerPaymentEntry | null {
  const key = paymentStatusKey(paymentStatus);
  if (key === "sem_cobranca") return null;
  if (key === "recebido_na_entrega" && orderStatus === "cancelled")
    return PAGO_MAS_CANCELADO;
  if (key === "pago" && orderStatus === "cancelled") {
    return cancelledAfterShipping === false
      ? PAGO_MAS_CANCELADO_DEVOLUCAO_AUTOMATICA
      : PAGO_MAS_CANCELADO;
  }
  if (key === "aguardando" && orderStatus === "cancelled")
    return AGUARDANDO_MAS_CANCELADO;
  // `Map.get` não é indexação dinâmica para o eslint, e o Record acima é
  // exaustivo para toda chave que não seja `sem_cobranca` — o `?? null` só
  // existe para o tipo, nunca deveria disparar em runtime.
  return customerPaymentConfigByKey.get(key) ?? null;
}

interface CustomerPaymentBadgeProps {
  paymentStatus: PaymentStatus | null | undefined;
  // Opcional para não quebrar chamador nenhum: sem ela, o comportamento é
  // idêntico ao de antes desta correção.
  orderStatus?: OrderStatus | null;
  // Opcional pelo mesmo motivo — ausência vira `undefined`, que
  // `customerPaymentStatusEntry` trata como "enviado" (mantém "fale com a
  // loja"). Só passe `false` quando o pedido está disponível e comprovadamente
  // NÃO foi enviado.
  cancelledAfterShipping?: boolean;
  className?: string;
}

/**
 * Selo de pagamento para as telas do CLIENTE (`OrderDetailsView`,
 * `OrderList`). Segue a mesma convenção visual dos selos vizinhos nos dois
 * arquivos: pill arredondada com bolinha + texto minúsculo em maiúsculas.
 */
export const CustomerPaymentBadge = memo(function CustomerPaymentBadge({
  paymentStatus,
  orderStatus,
  cancelledAfterShipping,
  className,
}: Readonly<CustomerPaymentBadgeProps>) {
  const entry = customerPaymentStatusEntry(
    paymentStatus,
    orderStatus,
    cancelledAfterShipping,
  );
  if (!entry) return null;
  const styles = toneStyles[entry.tone];

  return (
    <div
      data-testid="customer-payment-badge"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        styles.bgColor,
        styles.borderColor,
        className,
      )}
    >
      <div className={cn("size-1 rounded-full", styles.dot)} />
      <span
        className={cn(
          "text-[9px] font-black uppercase tracking-widest",
          styles.color,
        )}
      >
        {entry.label}
      </span>
    </div>
  );
});
