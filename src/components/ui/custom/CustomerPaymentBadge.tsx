import { paymentStatusKey } from "@/components/admin/orders/OrderStatusBadge";
import { cn } from "@/lib/utils";
import type { PaymentStatus } from "@/types";
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
};

const toneStyles: Record<
  Tone,
  { color: string; bgColor: string; borderColor: string; dot: string }
> = {
  confirmado: {
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-100",
    dot: "bg-emerald-500",
  },
  aguardando: {
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-100",
    dot: "bg-amber-500",
  },
  recusado: {
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    borderColor: "border-rose-100",
    dot: "bg-rose-500",
  },
  expirado: {
    color: "text-zinc-500",
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

/**
 * Traduz `payment_status` para o texto que o comprador vê. `null` para
 * `sem_cobranca` — quem renderiza não desenha nada nesse caso.
 */
export function customerPaymentStatusEntry(
  paymentStatus: PaymentStatus | null | undefined,
): CustomerPaymentEntry | null {
  const key = paymentStatusKey(paymentStatus);
  if (key === "sem_cobranca") return null;
  // `Map.get` não é indexação dinâmica para o eslint, e o Record acima é
  // exaustivo para toda chave que não seja `sem_cobranca` — o `?? null` só
  // existe para o tipo, nunca deveria disparar em runtime.
  return customerPaymentConfigByKey.get(key) ?? null;
}

interface CustomerPaymentBadgeProps {
  paymentStatus: PaymentStatus | null | undefined;
  className?: string;
}

/**
 * Selo de pagamento para as telas do CLIENTE (`OrderDetailsView`,
 * `OrderList`). Segue a mesma convenção visual dos selos vizinhos nos dois
 * arquivos: pill arredondada com bolinha + texto minúsculo em maiúsculas.
 */
export const CustomerPaymentBadge = memo(function CustomerPaymentBadge({
  paymentStatus,
  className,
}: Readonly<CustomerPaymentBadgeProps>) {
  const entry = customerPaymentStatusEntry(paymentStatus);
  if (!entry) return null;
  const styles = toneStyles[entry.tone];

  return (
    <div
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
