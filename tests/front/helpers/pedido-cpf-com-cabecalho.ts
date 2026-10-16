import { vi } from "vitest";

type PedidoComCabecalho<T> = Promise<T> & {
  setHeader: (nome: string, valor: string) => PedidoComCabecalho<T>;
};

// Preserva a promessa controlada pelo teste e imita o encadeamento do PostgREST.
export function pedidoCpfComCabecalho<T>(
  resposta: Promise<T>,
): PedidoComCabecalho<T> {
  const pedido: PedidoComCabecalho<T> = Object.assign(resposta, {
    setHeader: vi.fn((_nome: string, _valor: string) => pedido),
  });
  return pedido;
}
