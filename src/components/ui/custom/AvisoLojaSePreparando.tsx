import { BotaoWhatsapp } from "@/components/ui/custom/BotaoWhatsapp";
import { useStore } from "@/contexts/StoreContext";
import { abrirWhatsapp } from "@/lib/abrir-whatsapp";
import { pagamentoOnlineLigado } from "@/lib/flags";
import {
  type ItemDoPedidoPeloWhatsapp,
  fatosDoPedidoPossivel,
  linkDoPedidoPeloWhatsapp,
  lojaAindaNaoRecebePedido,
} from "@/lib/loja-se-preparando";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import type { CartItem } from "@/types";

export const FRASE_LOJA_SE_PREPARANDO_PARA_PEDIDOS =
  "Esta loja ainda está se preparando para receber pedidos pelo site.";

/** A variação como o carrinho a mostra (CartItemsList): `variantNames`, senão o par do cadastro. */
function variacaoDaLinha(item: CartItem): string | undefined {
  if (item.variantNames) return item.variantNames;
  const variante = item.variantId
    ? item.product.variants?.find((v) => v.id === item.variantId)
    : undefined;
  return variante ? `${variante.name}: ${variante.value}` : undefined;
}

function itensDoCarrinho(
  cart: readonly CartItem[],
): ItemDoPedidoPeloWhatsapp[] {
  return cart.map((item) => ({
    nome: item.product.name,
    variacao: variacaoDaLinha(item),
    quantidade: item.quantity,
  }));
}

/**
 * Topo do carrinho (28/11/2026, migration 20261655000000): a loja nova que
 * ainda não confirmou o pagamento na entrega ou a entrega na cidade (cartão
 * "Loja pronta") e que, por isso, não tem como receber pedido NENHUM pelo
 * site. Diz isso antes de a cliente ir até o fim do checkout, e com WhatsApp
 * cadastrado oferece o pedido por lá com os itens já escritos.
 */
export function AvisoLojaSePreparando({
  cart,
  className,
}: {
  cart: readonly CartItem[];
  className?: string;
}) {
  const { config } = useStore();
  if (
    !lojaAindaNaoRecebePedido(
      fatosDoPedidoPossivel(config, pagamentoOnlineLigado()),
    )
  )
    return null;
  const temWhatsapp = lojaTemWhatsapp(config.whatsappNumber);
  return (
    <div
      role="status"
      className={
        className ??
        "space-y-2 rounded-xl border border-border bg-muted p-3 text-sm text-foreground"
      }
    >
      <p>{FRASE_LOJA_SE_PREPARANDO_PARA_PEDIDOS}</p>
      {temWhatsapp && (
        <BotaoWhatsapp
          onClick={() =>
            abrirWhatsapp(
              linkDoPedidoPeloWhatsapp(
                config.whatsappNumber,
                itensDoCarrinho(cart),
              ),
            )
          }
        >
          Pedir pelo WhatsApp
        </BotaoWhatsapp>
      )}
    </div>
  );
}
