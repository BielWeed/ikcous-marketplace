import type { Order } from "@/types";

const HORA_MS = 60 * 60 * 1000;
const JANELA_MS = 72 * HORA_MS;
export const LIMITE_DE_VAGAS_DE_VISITANTE = 10;

type PedidoParaVaga = Pick<Order, "userId" | "status" | "createdAt"> & {
  paymentMethod: Order["paymentMethod"] | null;
};

function criadoEmMs(criadoEm: string): number {
  // Não interprete datas sem fuso como hora local do aparelho.
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(criadoEm)
    ? Date.parse(criadoEm)
    : Number.NaN;
}

function pendenteDeVisitante(pedido: PedidoParaVaga): boolean {
  // O mapper traduz user_id NULL em undefined; payment_method NULL também
  // passa no IS DISTINCT FROM 'online' da migration 20261399997000.
  return (
    pedido.userId == null &&
    pedido.status === "pending" &&
    pedido.paymentMethod !== "online"
  );
}

// Estimativa: o painel atualiza o relógio do aparelho a cada minuto;
// o banco aplica o corte de 72 horas pelo relógio do servidor.
export function contarVagasDeVisitante(
  pedidos: readonly PedidoParaVaga[],
  agora: number,
): number {
  const corte = agora - JANELA_MS;
  return pedidos.filter(
    (pedido) =>
      pendenteDeVisitante(pedido) && criadoEmMs(pedido.createdAt) > corte,
  ).length;
}

export function avisarVagasDeVisitante(vagas: number): boolean {
  return vagas >= 7;
}

export function primeiraPaginaCobreVagasDeVisitante({
  pedidos,
  total,
  inicio,
  agora,
}: {
  pedidos: readonly Pick<Order, "createdAt">[];
  total: number;
  inicio?: string;
  agora: number;
}): boolean {
  const corte = agora - JANELA_MS;
  if (inicio && !(criadoEmMs(inicio) <= corte)) return false;
  // Sem busca, o servidor pagina do mais novo para o mais antigo. Se a
  // página chegou ao corte estrito, as próximas só contêm pedidos fora dele.
  return (
    pedidos.length === total ||
    pedidos.some((pedido) => criadoEmMs(pedido.createdAt) <= corte)
  );
}

export function tempoSegurandoEstoque(
  pedido: PedidoParaVaga & Pick<Order, "items">,
  agora: number,
): string | null {
  if (
    !pendenteDeVisitante(pedido) ||
    !pedido.items?.some((item) => item.quantity > 0)
  ) {
    return null;
  }
  const idade = agora - criadoEmMs(pedido.createdAt);
  if (!Number.isFinite(idade) || idade < 0) return null;
  const horas = Math.floor(idade / HORA_MS);
  if (horas < 24) return horas === 1 ? "1 hora" : `${horas} horas`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "1 dia" : `${dias} dias`;
}
