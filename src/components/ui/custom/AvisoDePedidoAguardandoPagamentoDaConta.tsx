import type { View } from "@/types";
import { Suspense, lazy } from "react";

// Sob demanda: a vitrine não carrega o aviso (nem a consulta) para quem não
// entrou na conta — visitante não paga online (P6), então não tem pedido
// esperando pagamento. Para a cliente logada o pedaço chega depois do
// primeiro desenho do Início, e a consulta roda só então.
const AvisoDePedidoAguardandoPagamento = lazy(() =>
  import("@/components/ui/custom/AvisoDePedidoAguardandoPagamento").then(
    (m) => ({ default: m.AvisoDePedidoAguardandoPagamento }),
  ),
);

/**
 * A porta do aviso "pedido aguardando pagamento" (Início e carrinho vazio):
 * só a cliente logada a atravessa. Quem monta passa o id da conta (o Início o
 * recebe do App; esta porta não importa a autenticação, para a Home não
 * arrastar o cliente do banco). A `key` com o id desmonta tudo na troca de
 * conta — nada do que foi lido para uma aparece para a outra.
 */
export function AvisoDePedidoAguardandoPagamentoDaConta({
  userId,
  onNavigate,
  ativo = true,
  className,
}: Readonly<{
  userId: string | null | undefined;
  onNavigate: (view: View, id?: string) => void;
  ativo?: boolean;
  className?: string;
}>) {
  if (!userId) return null;
  return (
    <Suspense fallback={null}>
      <AvisoDePedidoAguardandoPagamento
        key={userId}
        userId={userId}
        onNavigate={onNavigate}
        ativo={ativo}
        className={className}
      />
    </Suspense>
  );
}
