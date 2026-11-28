import type { MetodoOnline } from "@/lib/forma-de-pagamento";
import type { CartItem } from "@/types";

/** A mesma compra do envio original, nunca remontada do carrinho reconciliado. */
export interface PedidoCongelado {
  readonly orderData: Record<string, unknown>;
  readonly ehOnline: boolean;
  readonly metodoOnline: MetodoOnline;
  readonly itens: CartItem[];
  readonly valor: number;
  readonly cpfParaRpc: string | undefined;
  readonly contaEsperada: string | null;
  readonly semConta: boolean;
  /** Prazo da cotação enviada, só para a confirmação do pedido. */
  readonly previsaoDeEntrega?: string;
  /** Endereço público da loja escolhido para a retirada; só para exibição. */
  readonly enderecoDaRetirada?: string;
}

const CHAVE = "ikcous-pedido-sem-resposta-v1";
/** Janela da retentativa da mesma compra; a chave do pedido (chave-do-pedido.ts) vale o mesmo. */
export const PRAZO_DA_RETENTATIVA_MS = 30 * 60_000;

export function limparPedidoSemResposta(): void {
  try {
    globalThis.sessionStorage.removeItem(CHAVE);
  } catch {
    // Armazenamento indisponível: o reenvio em memória continua funcionando.
  }
}

/**
 * `contaAtual` é quem está AGORA no checkout (id da conta; `null` = visitante).
 * O registro é da pessoa que enviou (`contaEsperada`, sempre `null` aqui: só
 * compra sem conta é guardada) e só volta para ELA. Outra pessoa na mesma aba
 * — inclusive a conta em que a visitante entrou depois, que a tela não tem
 * como distinguir de um estranho — nunca lê o nome, o WhatsApp nem o
 * endereço da visitante, e o registro é apagado na mesma leitura (27/11/2026).
 */
export function lerPedidoSemResposta(
  contaAtual: string | null,
): PedidoCongelado | null {
  try {
    const cru = globalThis.sessionStorage.getItem(CHAVE);
    if (!cru) return null;
    const { versao, expiraEm, pedido } = JSON.parse(cru);
    if (
      versao === 1 &&
      Number.isFinite(expiraEm) &&
      expiraEm > Date.now() &&
      expiraEm <= Date.now() + PRAZO_DA_RETENTATIVA_MS &&
      pedido?.semConta === true &&
      pedido.contaEsperada === null &&
      pedido.contaEsperada === contaAtual &&
      pedido.ehOnline === false &&
      typeof pedido.orderData?.idempotencyKey === "string" &&
      pedido.orderData.idempotencyKey !== "" &&
      Array.isArray(pedido.orderData.items) &&
      Array.isArray(pedido.itens) &&
      Number.isFinite(pedido.valor)
    ) {
      return pedido as PedidoCongelado;
    }
  } catch {
    // Registro inválido ou storage bloqueado nunca impede abrir o checkout.
  }
  limparPedidoSemResposta();
  return null;
}

export function guardarPedidoSemResposta(pedido: PedidoCongelado): void {
  if (!pedido.semConta || pedido.ehOnline) return;
  try {
    // Retentativa não estende o prazo da compra original.
    if (
      lerPedidoSemResposta(pedido.contaEsperada)?.orderData.idempotencyKey ===
      pedido.orderData.idempotencyKey
    )
      return;
    globalThis.sessionStorage.setItem(
      CHAVE,
      JSON.stringify(
        { versao: 1, expiraEm: Date.now() + PRAZO_DA_RETENTATIVA_MS, pedido },
        // Mesmo cuidado do rascunho: CPF não vai para storage, nem aninhado.
        (chave, valor) =>
          chave === "cpf" || chave === "cpfParaRpc" ? undefined : valor,
      ),
    );
  } catch {
    // Best-effort, como o rascunho do checkout.
  }
}
