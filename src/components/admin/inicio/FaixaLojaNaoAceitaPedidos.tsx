import { CARTAO_INICIO } from "@/components/admin/inicio/visualDoInicio";
import { useStore } from "@/contexts/StoreContext";
import {
  fatosDoPedidoPossivel,
  lojaAindaNaoRecebePedido,
} from "@/lib/loja-se-preparando";
import { usePagamentoPeloApp } from "@/lib/pagamento-pelo-app-no-painel";
import { AlertCircle } from "lucide-react";

export const FRASE_LOJA_NAO_ACEITA_PEDIDOS =
  "Sua loja ainda não aceita pedidos. Confirme a entrega e o pagamento abaixo.";

/**
 * Topo do Início (28/11/2026, migration 20261655000000): a loja nova que ainda
 * não confirmou o pagamento na entrega ou a entrega na cidade e que, por isso,
 * não tem como receber pedido NENHUM pelo site (a mesma regra do aviso do
 * carrinho, `lojaAindaNaoRecebePedido`). O que destrava está no cartão "Loja
 * pronta", logo abaixo. Config ainda carregando não afirma nada.
 */
export function FaixaLojaNaoAceitaPedidos() {
  const { config, isLoaded } = useStore();
  const pagamentoPeloApp = usePagamentoPeloApp();
  if (
    !isLoaded ||
    !lojaAindaNaoRecebePedido(fatosDoPedidoPossivel(config, pagamentoPeloApp))
  )
    return null;
  return (
    <div role="status" className={`${CARTAO_INICIO} flex items-start gap-3`}>
      <AlertCircle
        className="mt-0.5 size-5 shrink-0 text-amber-400"
        aria-hidden="true"
      />
      <p className="text-base font-semibold text-white">
        {FRASE_LOJA_NAO_ACEITA_PEDIDOS}
      </p>
    </div>
  );
}
