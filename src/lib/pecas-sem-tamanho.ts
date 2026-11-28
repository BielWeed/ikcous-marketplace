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
  // Duas origens (20261642000000 e 20261653000000): vendida antes de o produto
  // ganhar tamanhos, ou num tamanho que a lojista desligou depois. A tela não
  // sabe qual das duas; a frase vale para as duas.
  const origem =
    numeros.length === 0
      ? n === 1
        ? "vendida sem tamanho ou num tamanho hoje desligado"
        : "vendidas sem tamanho ou em tamanhos hoje desligados"
      : numeros.length === 1
        ? `pedido ${listaDePedidos(numeros)}, vendido sem tamanho ou num tamanho hoje desligado`
        : `pedidos ${listaDePedidos(numeros)}, vendidos sem tamanho ou em tamanhos hoje desligados`;
  if (n === 1)
    return {
      titulo: `1 peça deste produto voltou e espera você escolher o tamanho (${origem}). Ela não está à venda.`,
      pergunta: "Em qual tamanho ela entra?",
    };
  const primeira = pecas[0]?.orderId;
  return {
    titulo: `${n} peças deste produto voltaram e esperam você escolher o tamanho (${origem}). Elas não estão à venda.`,
    pergunta: primeira
      ? `Em qual tamanho entra a do pedido #${numeroDoPedido(primeira)}?`
      : "Em qual tamanho entra a primeira delas?",
  };
}

/**
 * A peça que voltou (pedido desfeito ou devolução) e espera o tamanho: o que
 * os avisos de pedido e de devolução dizem no lugar de "voltou ao estoque".
 * Vale para a peça vendida sem tamanho e para a de um tamanho que hoje está
 * desligado (20261653000000): as duas esperam a lojista escolher onde entram.
 */
export function fraseDasPecasSemTamanho(quantidade: number): string {
  return quantidade === 1
    ? "1 peça ficou esperando você escolher o tamanho dela na tela do produto para ela voltar à venda."
    : `${quantidade} peças ficaram esperando você escolher o tamanho delas na tela do produto para elas voltarem à venda.`;
}

/** O item da devolução que voltou e espera o tamanho (ficha e conferência). */
export const TEXTO_ITEM_ESPERANDO_TAMANHO =
  "voltou sem tamanho: escolha o tamanho na tela do produto";

/**
 * Quais itens de uma devolução deixaram peça esperando o tamanho.
 *
 * `porItem` (20261653000000, `pecas_sem_tamanho_da_devolucao`): os itens que o
 * banco gravou NA HORA da conclusão — vale para o item sem variação e para o de
 * um tamanho que estava desligado, e religar o tamanho depois não muda o que
 * aconteceu. `porProdutoSemVariacao` (loja só com a 20261642000000): a lista
 * antiga só diz o produto, e ali só o item SEM variação vai para o cantinho.
 */
export type PecasQueEsperamNaDevolucao =
  | { readonly porItem: ReadonlySet<string> }
  | { readonly porProdutoSemVariacao: ReadonlySet<string> };

/** As linhas de `pecas_sem_tamanho_da_devolucao`; `null` = forma torta (não sei). */
export function lerItensQueEsperamTamanho(data: unknown): string[] | null {
  if (!Array.isArray(data)) return null;
  const itens: string[] = [];
  for (const linha of data) {
    if (typeof linha !== "object" || linha === null) return null;
    const id = (linha as Record<string, unknown>).devolucao_item_id;
    if (!texto(id)) return null;
    itens.push(id);
  }
  return itens;
}

/** O item da devolução voltou e espera o tamanho? `null` (não sei) = não: a ficha diz o de sempre. */
export function itemEsperaTamanho(
  item: {
    readonly id: string;
    readonly reestocado_em: string | null;
    readonly variant_id: string | null;
    readonly product_id: string | null;
  },
  pecas: PecasQueEsperamNaDevolucao | null,
): boolean {
  if (item.reestocado_em == null || !pecas) return false;
  if ("porItem" in pecas) return pecas.porItem.has(item.id);
  return (
    !item.variant_id &&
    item.product_id != null &&
    pecas.porProdutoSemVariacao.has(item.product_id)
  );
}

/**
 * Nenhuma variação LIGADA e GRAVADA: a RPC só aceita essas, e o Salvar do
 * produto leva para a lista (o tamanho novo só aparece ao abrir de novo).
 */
export function textoSemTamanhoLigado(): string {
  return "Nenhum tamanho deste produto está ligado na loja. Para a peça voltar à venda, ligue ou crie o tamanho dela em Variações, salve o produto e abra-o de novo: o tamanho aparece aqui. Se você não tem mais a peça, toque em “Não tenho essa peça”.";
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
