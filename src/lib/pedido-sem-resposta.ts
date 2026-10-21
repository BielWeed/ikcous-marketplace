import type { MetodoOnline } from "@/components/checkout/PagamentoOnline";
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
}

const CHAVE = "ikcous-pedido-sem-resposta-v1";
const PRAZO_MS = 30 * 60_000;

export function limparPedidoSemResposta(): void {
  try {
    globalThis.sessionStorage.removeItem(CHAVE);
  } catch {
    // Armazenamento indisponível: o reenvio em memória continua funcionando.
  }
}

export function lerPedidoSemResposta(): PedidoCongelado | null {
  try {
    const cru = globalThis.sessionStorage.getItem(CHAVE);
    if (!cru) return null;
    const { versao, expiraEm, pedido } = JSON.parse(cru);
    if (
      versao === 1 &&
      Number.isFinite(expiraEm) &&
      expiraEm > Date.now() &&
      expiraEm <= Date.now() + PRAZO_MS &&
      pedido?.semConta === true &&
      pedido.contaEsperada === null &&
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
      lerPedidoSemResposta()?.orderData.idempotencyKey ===
      pedido.orderData.idempotencyKey
    )
      return;
    globalThis.sessionStorage.setItem(
      CHAVE,
      JSON.stringify(
        { versao: 1, expiraEm: Date.now() + PRAZO_MS, pedido },
        // Mesmo cuidado do rascunho: CPF não vai para storage, nem aninhado.
        (chave, valor) =>
          chave === "cpf" || chave === "cpfParaRpc" ? undefined : valor,
      ),
    );
  } catch {
    // Best-effort, como o rascunho do checkout.
  }
}
