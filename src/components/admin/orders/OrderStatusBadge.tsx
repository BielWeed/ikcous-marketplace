import type { OrderStatus, PaymentStatus } from "@/types";
import { CheckCircle, Clock, Package, Truck, XCircle } from "lucide-react";
import type React from "react";
import { memo } from "react";

export const statusConfig: Record<
  OrderStatus,
  {
    label: string;
    icon: React.ElementType;
    color: string;
    bgColor: string;
    borderColor: string;
    className?: string;
  }
> = {
  pending: {
    label: "Novo Pedido",
    icon: Package,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    className: "text-blue-400",
  },
  processing: {
    label: "Em Separação",
    icon: Clock,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    className: "text-amber-400",
  },
  shipping: {
    label: "Em Trânsito",
    icon: Truck,
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500/20",
    className: "text-indigo-400",
  },
  delivered: {
    label: "Finalizado",
    icon: CheckCircle,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    className: "text-emerald-400",
  },
  cancelled: {
    label: "Cancelado",
    icon: XCircle,
    color: "text-zinc-500",
    bgColor: "bg-zinc-500/10",
    borderColor: "border-zinc-500/20",
    className: "text-zinc-500",
  },
};

interface OrderStatusBadgeProps {
  status: OrderStatus;
  className?: string;
}

export const OrderStatusBadge = memo(function OrderStatusBadge({
  status,
  className,
}: Readonly<OrderStatusBadgeProps>) {
  const cfg = statusConfig[status || "pending"] || statusConfig.pending;

  return (
    <div
      className={`flex items-center rounded-full px-2 py-0.5 ${cfg.bgColor} ${className}`}
    >
      <span
        className={`text-[9px] font-black uppercase tracking-widest ${cfg.color}`}
      >
        {cfg.label}
      </span>
    </div>
  );
});

/**
 * Chave usada no badge de pagamento: os seis valores da CHECK constraint
 * `marketplace_orders_payment_status_check` mais `sem_cobranca`, que cobre
 * tanto `payment_status IS NULL` (os 64 pedidos históricos) quanto pedidos
 * que nunca passaram pelo gateway (PIX manual, dinheiro).
 */
export type PaymentStatusKey = PaymentStatus | "sem_cobranca";

/**
 * Único lugar que decide "null/undefined vira sem_cobranca". A regra já
 * apareceu duplicada com operadores diferentes (`??` aqui, `!` no filtro do
 * admin) — é assim que uma regra de negócio diverge silenciosamente entre
 * lugares (ver #53, frete grátis escrito em sete lugares).
 */
export function paymentStatusKey(
  paymentStatus: PaymentStatus | null | undefined,
): PaymentStatusKey {
  return paymentStatus ?? "sem_cobranca";
}

interface PaymentStatusEntry {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  needsAttention?: boolean;
}

/**
 * Segue a mesma convenção visual do `statusConfig` acima (pill com cor/bg
 * por valor) em vez de inventar uma segunda. O único acréscimo é
 * `needsAttention`: sinaliza os dois valores que a Task 6 (reconciliação)
 * escreve quando o gateway diverge do que o pedido já tinha — dinheiro que
 * entrou fora do fluxo esperado, e por isso pede o olho do lojista.
 */
export const paymentStatusConfig: Record<PaymentStatusKey, PaymentStatusEntry> =
  {
    aguardando: {
      label: "Aguardando pagamento",
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
    },
    pago: {
      label: "Pago",
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
    },
    recusado: {
      label: "Recusado",
      color: "text-rose-400",
      bgColor: "bg-rose-500/10",
      borderColor: "border-rose-500/20",
    },
    expirado: {
      label: "Expirado",
      color: "text-zinc-400",
      bgColor: "bg-zinc-500/10",
      borderColor: "border-zinc-500/20",
    },
    estornado: {
      label: "Estornado — precisa de atenção",
      color: "text-red-400",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/40",
      needsAttention: true,
    },
    pago_apos_expirar: {
      // "fora do fluxo", não "fora do prazo": desde a migration que faz o
      // ramo 'pago' devolver este mesmo valor também quando o pedido foi
      // CANCELADO pelo app e pago depois (não só quando expirou), o texto
      // falava em prazo na metade dos casos. O valor cobre as duas rotas de
      // propósito — já significa "dinheiro entrou, estoque já voltou,
      // precisa de gente" — só o rótulo não podia continuar prometendo uma
      // causa que às vezes é outra.
      label: "Pago fora do fluxo — precisa de atenção",
      color: "text-red-400",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/40",
      needsAttention: true,
    },
    sem_cobranca: {
      label: "Sem cobrança online",
      color: "text-zinc-500",
      bgColor: "bg-zinc-500/10",
      borderColor: "border-zinc-500/20",
    },
  };

/**
 * Mesmo conteúdo de `paymentStatusConfig`, como `Map` — a chave vem de uma
 * união fechada de literais (`PaymentStatusKey`) e o `Record` acima já é
 * exaustivo por construção, mas o eslint-plugin-security não distingue isso
 * de um dicionário arbitrário e acusa `detect-object-injection` em toda
 * indexação dinâmica. Gerado a partir do Record em vez de duplicar os sete
 * rótulos numa segunda fonte — só existe uma definição para divergir.
 */
const paymentStatusConfigByKey = new Map(
  Object.entries(paymentStatusConfig) as [
    PaymentStatusKey,
    PaymentStatusEntry,
  ][],
);

/**
 * Lookup seguro de `paymentStatusConfig`: `Map.get` não é indexação
 * dinâmica para o eslint, e o fallback para `sem_cobranca` (chave sempre
 * presente no Record acima) cobre qualquer valor que escape do tipo
 * `PaymentStatusKey` em runtime.
 */
export function getPaymentStatusConfig(
  key: PaymentStatusKey,
): PaymentStatusEntry {
  return paymentStatusConfigByKey.get(key) ?? paymentStatusConfig.sem_cobranca;
}

interface PaymentStatusBadgeProps {
  paymentStatus: PaymentStatus | null | undefined;
  // Opcional para não quebrar chamador nenhum: sem ela, o comportamento é
  // idêntico ao de antes desta correção.
  orderStatus?: OrderStatus | null;
  className?: string;
}

/**
 * Rótulo que sobrepõe `paymentStatusConfig.pago` quando o pedido pagou e
 * DEPOIS foi cancelado — produzível hoje pelo botão "Cancelar Pedido" da
 * tela do cliente, que aparece para todo pedido pendente sem olhar o
 * pagamento. Sem isso, o painel mostrava "Pago" verde comum para um pedido
 * em que o dinheiro está com a loja, o estoque já voltou à prateleira e não
 * existe estorno automático em lugar nenhum deste app.
 *
 * Mesma família visual de `pago_apos_expirar` (dinheiro fora do fluxo, cores
 * reaproveitadas dali) — a causa é o espelho uma da outra: aqui o pedido
 * nasceu pago e morreu depois; lá nasceu sem pagar e o dinheiro chegou tarde
 * demais. Vocabulário do LOJISTA, diferente de `PAGO_MAS_CANCELADO` em
 * `CustomerPaymentBadge.tsx`, que fala com quem comprou.
 */
const PAGO_E_CANCELADO: PaymentStatusEntry = {
  label: "Pago e cancelado — precisa de atenção",
  color: paymentStatusConfig.pago_apos_expirar.color,
  bgColor: paymentStatusConfig.pago_apos_expirar.bgColor,
  borderColor: paymentStatusConfig.pago_apos_expirar.borderColor,
  needsAttention: true,
};

/**
 * Badge de `payment_status` para a fila de atenção do admin (Task 9, Fase
 * 3). `null`/`undefined` caem em "Sem cobrança online" — nunca em uma
 * chave inexistente do config, que quebraria a renderização.
 *
 * `orderStatus` é opcional e só muda alguma coisa no único cruzamento que
 * pede atenção hoje: `pago` + `cancelled`. Todo o resto do Record segue
 * exatamente como antes desta correção.
 */
export const PaymentStatusBadge = memo(function PaymentStatusBadge({
  paymentStatus,
  orderStatus,
  className,
}: Readonly<PaymentStatusBadgeProps>) {
  const key = paymentStatusKey(paymentStatus);
  const cfg =
    key === "pago" && orderStatus === "cancelled"
      ? PAGO_E_CANCELADO
      : getPaymentStatusConfig(key);

  return (
    <div
      className={`flex items-center rounded-full border px-2 py-0.5 ${cfg.bgColor} ${cfg.borderColor} ${
        cfg.needsAttention ? "animate-pulse ring-1 ring-red-500/60" : ""
      } ${className || ""}`}
    >
      <span
        className={`text-[9px] font-black uppercase tracking-widest ${cfg.color}`}
      >
        {cfg.label}
      </span>
    </div>
  );
});
