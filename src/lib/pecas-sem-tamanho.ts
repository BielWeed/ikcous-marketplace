import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { PrazoEsgotado } from "@/utils/com-prazo";

/**
 * A peça que volta sem tamanho (migration 20261642000000).
 *
 * Um produto vendido SEM tamanho que, depois, ganhou a grade: quando o pedido
 * antigo é desfeito (Pix vencido, cancelado) ou devolvido com "voltar ao
 * estoque", o banco não credita mais o estoque do produto (que a compra não
 * vende quando há variação ligada). Cada unidade vira uma linha que espera a
 * lojista escolher o tamanho, ou dizer que não tem a peça.
 */
export interface PecaSemTamanho {
  readonly id: string;
  readonly produtoId: string;
  /** `null` quando o pedido de origem foi apagado depois. */
  readonly orderId: string | null;
  readonly origem: "pedido_desfeito" | "devolucao";
  readonly criadaEm: string;
}

export interface ResolucaoDaPeca {
  readonly id: string;
  readonly resolucao: "reposta" | "descartada";
  readonly variantId: string | null;
  /** A peça já estava resolvida (outro toque, outra aba): nada foi somado agora. */
  readonly jaResolvida: boolean;
  /** Quantas peças do produto ainda esperam. */
  readonly pendentes: number;
}

const texto = (v: unknown): v is string => typeof v === "string" && v !== "";

/** As linhas de `pecas_sem_tamanho_pendentes`; `null` = forma torta (não sei). */
export function lerPecasSemTamanho(data: unknown): PecaSemTamanho[] | null {
  if (!Array.isArray(data)) return null;
  const pecas: PecaSemTamanho[] = [];
  for (const linha of data) {
    if (typeof linha !== "object" || linha === null) return null;
    const l = linha as Record<string, unknown>;
    if (
      !texto(l.id) ||
      !texto(l.produto_id) ||
      !(l.order_id === null || texto(l.order_id)) ||
      (l.origem !== "pedido_desfeito" && l.origem !== "devolucao") ||
      !texto(l.criada_em)
    )
      return null;
    pecas.push({
      id: l.id,
      produtoId: l.produto_id,
      orderId: l.order_id as string | null,
      origem: l.origem,
      criadaEm: l.criada_em,
    });
  }
  return pecas;
}

export function contarPorProduto(
  pecas: readonly PecaSemTamanho[],
): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const p of pecas)
    contagem.set(p.produtoId, (contagem.get(p.produtoId) ?? 0) + 1);
  return contagem;
}

export function textoDoSelo(quantidade: number): string {
  return quantidade === 1
    ? "1 peça sem tamanho"
    : `${quantidade} peças sem tamanho`;
}

const PEDIDOS_CITADOS = 3;

function listaDePedidos(numeros: readonly string[]): string {
  const citados = numeros.slice(0, PEDIDOS_CITADOS).map((n) => `#${n}`);
  const resto = numeros.length - citados.length;
  if (resto > 0) return `${citados.join(", ")} e mais ${resto}`;
  if (citados.length === 1) return citados[0];
  return `${citados.slice(0, -1).join(", ")} e ${citados[citados.length - 1]}`;
}

/** O aviso no topo da tela do produto; a pergunta é sobre a PRIMEIRA peça. */
export function textoDoAviso(pecas: readonly PecaSemTamanho[]): {
  titulo: string;
  pergunta: string;
} {
  const n = pecas.length;
  const numeros = [
    ...new Set(
      pecas.flatMap((p) => (p.orderId ? [numeroDoPedido(p.orderId)] : [])),
    ),
  ];
  const origem =
    numeros.length === 0
      ? n === 1
        ? "vendida antes de você criar os tamanhos"
        : "vendidas antes de você criar os tamanhos"
      : numeros.length === 1
        ? `pedido ${listaDePedidos(numeros)}, vendido antes de você criar os tamanhos`
        : `pedidos ${listaDePedidos(numeros)}, vendidos antes de você criar os tamanhos`;
  if (n === 1)
    return {
      titulo: `1 peça deste produto voltou sem tamanho (${origem}). Ela não está à venda.`,
      pergunta: "Em qual tamanho ela entra?",
    };
  const primeira = pecas[0]?.orderId;
  return {
    titulo: `${n} peças deste produto voltaram sem tamanho (${origem}). Elas não estão à venda.`,
    pergunta: primeira
      ? `Em qual tamanho entra a do pedido #${numeroDoPedido(primeira)}?`
      : "Em qual tamanho entra a primeira delas?",
  };
}

export function textoDoSucesso(tamanho: string): string {
  return `Peça somada ao tamanho ${tamanho}. Já está à venda.`;
}

export function textoDoDescarte(): string {
  return "Pronto: a peça saiu do aviso e o estoque não mudou.";
}

/** Segundo toque, outra aba ou outro aparelho: a RPC devolve a decisão que já existia. */
export function textoJaResolvida(): string {
  return "Essa peça já tinha sido decidida em outra aba ou aparelho. Nada foi somado agora.";
}

/** A resposta de `resolver_peca_sem_tamanho`; `null` = forma torta. */
export function lerResolucao(data: unknown): ResolucaoDaPeca | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (
    !texto(d.id) ||
    (d.resolucao !== "reposta" && d.resolucao !== "descartada") ||
    !(d.variant_id === null || texto(d.variant_id)) ||
    typeof d.ja_resolvida !== "boolean" ||
    typeof d.pendentes !== "number"
  )
    return null;
  return {
    id: d.id,
    resolucao: d.resolucao,
    variantId: d.variant_id as string | null,
    jaResolvida: d.ja_resolvida,
    pendentes: d.pendentes,
  };
}

export function mensagemDoErroAoResolver(erro: unknown): string {
  if (erro instanceof PrazoEsgotado)
    return "Não tive resposta. Confira a conexão e toque de novo: tocar duas vezes não soma a peça duas vezes.";
  const e = (erro ?? {}) as { code?: unknown; message?: unknown };
  if (e.code === "42501")
    return "Sua conta não tem permissão para mexer no estoque desta loja.";
  if (e.code === "P0002")
    return "Essa peça não está mais no aviso. Atualizei a lista.";
  // O 22023 da RPC já é escrito para a lojista ("Esse tamanho está desligado…").
  if (e.code === "22023" && texto(e.message)) return e.message;
  return "Não consegui salvar a escolha. Tente de novo.";
}
