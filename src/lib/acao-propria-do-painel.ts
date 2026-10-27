/**
 * Memória curta das mudanças de status que A PRÓPRIA lojista acabou de pedir.
 *
 * O painel já responde ao clique com "Status atualizado com sucesso"; o aviso
 * do realtime ("Pedido #N atualizado para…") chegava logo depois, repetindo a
 * mesma coisa. A marca é por pedido E por destino, e dura poucos segundos: uma
 * mudança de OUTRA pessoa (outro destino, ou depois da janela) continua
 * avisando. Vive só na memória da aba — nada vai para storage.
 */
export const JANELA_DA_ACAO_PROPRIA_MS = 15_000;

const marcas = new Map<string, { status: string; ate: number }>();

export function marcarAcaoPropriaDoPedido(
  pedidoId: string,
  status: string,
  agora: number = Date.now(),
): void {
  for (const [id, marca] of marcas) {
    if (marca.ate <= agora) marcas.delete(id);
  }
  marcas.set(pedidoId, { status, ate: agora + JANELA_DA_ACAO_PROPRIA_MS });
}

export function esquecerAcaoPropriaDoPedido(pedidoId: string): void {
  marcas.delete(pedidoId);
}

export function eAcaoPropriaDoPedido(
  pedidoId: string,
  status: string,
  agora: number = Date.now(),
): boolean {
  const marca = marcas.get(pedidoId);
  return (
    Boolean(marca) && marca?.status === status && agora < (marca?.ate ?? 0)
  );
}
