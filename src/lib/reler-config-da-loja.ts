/**
 * O FRETE GRÁTIS QUE A TELA GUARDA (27/11/2026).
 *
 * Quem zera a entrega local é a TELA (`precoFinalDaOpcao`, com a
 * configuração guardada no aparelho); a cotação devolve a taxa cheia. Se a
 * lojista muda o frete grátis com o checkout aberto, cotar de novo não basta:
 * a tela seguia mostrando o grátis velho, o servidor (que recalcula pelo
 * `store_config`) recusava com "Os valores do pedido mudaram", e a cliente
 * ficava em laço — cliente e visitante não recebem a configuração ao vivo, e
 * a releitura por foco só roda uma vez por minuto.
 *
 * Esta função relê a configuração AGORA (o mesmo `fetchConfig` do
 * `StoreContext`, pela porta `refresh({ onlyConfig: true })`), com a mesma
 * régua da releitura do carrinho: espera com teto, e falha ou demora nunca
 * prendem a cliente. Sem a porta (dublê de teste, contexto ausente) segue
 * sem reler.
 */
import {
  type DesfechoDaReleitura,
  relerOCarrinhoComTeto,
} from "@/lib/reler-o-carrinho-com-teto";

export type PortaDeReleituraDaConfig = (opcoes?: {
  onlyConfig?: boolean;
}) => Promise<void>;

export function relerAConfigDaLoja(
  refresh: PortaDeReleituraDaConfig | undefined,
  tetoMs?: number,
): Promise<DesfechoDaReleitura> {
  if (typeof refresh !== "function") return Promise.resolve("falhou");
  return relerOCarrinhoComTeto(() => refresh({ onlyConfig: true }), tetoMs);
}
