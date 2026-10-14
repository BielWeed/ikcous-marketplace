import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { formatCurrency } from "@/lib/utils";
import type { View } from "@/types";

/**
 * O limiar de estoque baixo do projeto quando o produto nao tem um proprio.
 *
 * NAO e' um numero escolhido aqui: vem de `COALESCE(estoque_minimo, 5)` em
 * `supabase/migrations/20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql`,
 * que e' o mesmo limiar do KPI "Estoque Baixo" do painel. Dois numeros
 * diferentes para a mesma pergunta e' pior que nenhum.
 */
export const LIMIAR_PADRAO_DE_ESTOQUE = 5;

export type TipoDeAviso =
  | "pedido"
  | "cancelamento"
  | "devolucao"
  | "pergunta"
  | "avaliacao"
  | "estoque";

export interface Aviso {
  id: string;
  tipo: TipoDeAviso;
  titulo: string;
  detalhe: string;
  quando: string;
  destino: { view: View; id?: string };
  contaNoCracha: boolean;
}

export interface PedidoPendente {
  id: string;
  customer_name: string | null;
  total: number | null;
  created_at: string;
}

/**
 * Um pedido que o CLIENTE cancelou (14/10/2026): depois de pagar online, ou
 * (desde o mesmo dia) um pedido a pagar na entrega/retirada que a loja ainda
 * nao tinha enviado. Uma linha por EVENTO de cancelamento (`id` e o da linha
 * do historico do pedido), nao por pedido: quem reativou e cancelou de novo
 * gerou outro evento.
 *
 * `situacao` e o que o lojista precisa saber sobre o dinheiro, e cada valor
 * tem a sua frase — nenhuma promete o que o banco nao faz:
 *   - reembolso_automatico: pago e nao enviado, o banco abriu a devolucao e a
 *     rotina de 10 minutos a faz sozinha;
 *   - ja_saiu: o produto ja estava na rua; o reembolso e do lojista, depois
 *     que o produto voltar;
 *   - pago_depois: o pagamento entrou DEPOIS do cancelamento;
 *   - sem_pagamento_online: nao havia pagamento online (dinheiro/cartao na
 *     entrega ou na retirada) e o produto nao tinha saido — nao ha dinheiro
 *     para devolver; o aviso existe para a loja NAO separar nem enviar uma
 *     mercadoria cancelada.
 */
export type SituacaoDoCancelamento =
  | "reembolso_automatico"
  | "ja_saiu"
  | "pago_depois"
  | "sem_pagamento_online";

export interface CancelamentoDoCliente {
  id: string;
  order_id: string;
  customer_name: string | null;
  total: number | null;
  created_at: string;
  situacao: SituacaoDoCancelamento;
}

/** Quanto tempo depois do cancelamento o aviso segue na tela (e no push). */
export const JANELA_DE_CANCELAMENTO_HORAS = 24;

/** O pedido embutido na linha do historico, so com o que a regra le. */
interface PedidoDoCancelamento {
  id: string;
  user_id: string | null;
  customer_name: string | null;
  total: number | null;
  payment_status: string | null;
  status: string | null;
  cancelled_after_shipping: boolean | null;
}

/** A linha de `marketplace_order_history` como a consulta da tela a devolve. */
export interface LinhaDeCancelamento {
  id: string;
  order_id: string;
  old_status: string | null;
  created_by: string | null;
  created_at: string;
  marketplace_orders: PedidoDoCancelamento | PedidoDoCancelamento[] | null;
}

// `estornado` entra: a rotina pode ter devolvido o dinheiro antes de a tela
// abrir, e o cancelamento continua tendo sido do cliente.
const PAGAMENTO_QUE_ENTROU = ["pago", "pago_apos_expirar", "estornado"];

/**
 * Das linhas de cancelamento do historico, fica so o que o CLIENTE cancelou:
 * o autor da linha e o proprio dono do pedido, nao e admin (`admins`: os ids
 * com papel admin entre os autores), nao e re-cancelamento, o pedido segue
 * cancelado e o pagamento entrou — OU o pedido nao tinha pagamento online
 * (`payment_status` nulo ou vazio: dinheiro/cartao na entrega ou retirada, o
 * mesmo "sem cobranca online" de `pedidos-para-preparar`) e o produto ainda
 * nao tinha saido. Pedido com PIX/cartao online ainda nao pago (`aguardando`,
 * `expirado`, `recusado`) continua de fora: ele nunca entrou em "para
 * preparar", entao ninguem na loja esta separando nada.
 *
 * ATENCAO: so o ramo "pago" e' a mesma regra do push da rotina de 10 minutos
 * (supabase/functions/_shared/aviso-de-cancelamento-do-cliente.ts); o ramo
 * "sem pagamento online" existe so na TELA, o push ainda nao o conhece.
 *
 * Autor ausente de `admins` conta como nao-admin: so admin tem papel para
 * cancelar pedido de OUTRA pessoa, e o dono so cancela o que e dele.
 */
export function selecionarCancelamentosDoCliente(
  linhas: readonly LinhaDeCancelamento[],
  admins: ReadonlySet<string>,
): CancelamentoDoCliente[] {
  const escolhidos: CancelamentoDoCliente[] = [];
  for (const linha of linhas) {
    const bruto = linha.marketplace_orders;
    const pedido = Array.isArray(bruto) ? bruto[0] : bruto;
    if (!pedido || !linha.created_by) continue;
    if (linha.old_status === "cancelled") continue;
    if (linha.created_by !== pedido.user_id) continue;
    if (admins.has(linha.created_by)) continue;
    if (pedido.status !== "cancelled") continue;
    const jaSaiu =
      linha.old_status === "shipping" ||
      pedido.cancelled_after_shipping === true;
    // `!payment_status` pega nulo E vazio, os dois "sem cobranca online".
    const semPagamentoOnline = !pedido.payment_status;
    if (semPagamentoOnline) {
      // Sem dinheiro para devolver, o aviso so serve a quem ainda ia separar
      // ou enviar: produto que ja saiu tem outro assunto (o transporte).
      if (jaSaiu) continue;
    } else if (!PAGAMENTO_QUE_ENTROU.includes(pedido.payment_status)) {
      continue;
    }
    escolhidos.push({
      id: linha.id,
      order_id: linha.order_id,
      customer_name: pedido.customer_name,
      total: pedido.total,
      created_at: linha.created_at,
      situacao: semPagamentoOnline
        ? "sem_pagamento_online"
        : jaSaiu
          ? "ja_saiu"
          : pedido.payment_status === "pago_apos_expirar"
            ? "pago_depois"
            : "reembolso_automatico",
    });
  }
  return escolhidos;
}

const FRASE_DO_DINHEIRO: Record<
  Exclude<SituacaoDoCancelamento, "sem_pagamento_online">,
  string
> = {
  reembolso_automatico: "pago, o reembolso é automático",
  ja_saiu: "pago, o produto já saiu: avise o transporte",
  pago_depois: "pago depois do cancelamento: confira o pedido",
};

export interface AvaliacaoSemResposta {
  id: string;
  product_id: string;
  nomeDoProduto: string | null;
  rating: number;
  created_at: string;
}

export interface ProdutoComEstoque {
  id: string;
  name: string;
  stock: number;
  estoqueMinimo: number | null;
  created_at: string;
}

export interface EntradaDeAvisos {
  pedidos: PedidoPendente[];
  perguntasPendentes: number;
  avaliacoes: AvaliacaoSemResposta[];
  produtos: ProdutoComEstoque[];
  /**
   * Pedidos de devolução/troca esperando a resposta da loja (status
   * `solicitada`). Opcional: ausente = a fonte não entrou nesta rodada.
   */
  devolucoesSolicitadas?: number;
  /**
   * Pedidos que o cliente cancelou depois de pagar, nas ultimas 24 h (ja
   * filtrados por `selecionarCancelamentosDoCliente`). Opcional: ausente = a
   * fonte nao entrou nesta rodada.
   */
  cancelamentosDoCliente?: CancelamentoDoCliente[];
}

/**
 * `?? LIMIAR_PADRAO_DE_ESTOQUE`, nunca `||`: um produto com `estoque_minimo`
 * ZERO e' um produto que o lojista marcou como "nao me avise", e `|| 5`
 * transformaria essa escolha em 5.
 */
export function precisaDeReposicao(
  estoque: number,
  estoqueMinimo: number | null,
): boolean {
  return estoque <= (estoqueMinimo ?? LIMIAR_PADRAO_DE_ESTOQUE);
}

// Devolução logo depois de pedido: a resposta da loja tem prazo legal
// correndo (CDC art. 26 §2º I — a reclamação suspende o prazo até a resposta).
const ORDEM_DE_URGENCIA: TipoDeAviso[] = [
  "pedido",
  // Cancelamento logo depois do pedido: e o que impede o lojista de despachar
  // produto cujo dinheiro ja voltou.
  "cancelamento",
  "devolucao",
  "pergunta",
  "avaliacao",
  "estoque",
];

function maisRecentePrimeiro(a: Aviso, b: Aviso): number {
  return b.quando.localeCompare(a.quando);
}

function formatarReais(valor: number | null): string {
  return formatCurrency(valor ?? 0);
}

export function montarAvisos(entrada: EntradaDeAvisos): Aviso[] {
  const avisos: Aviso[] = [];

  for (const pedido of entrada.pedidos) {
    avisos.push({
      id: `pedido:${pedido.id}`,
      tipo: "pedido",
      titulo: `Pedido de ${pedido.customer_name || "cliente"} esperando você`,
      detalhe: formatarReais(pedido.total),
      quando: pedido.created_at,
      destino: { view: "admin-orders", id: pedido.id },
      contaNoCracha: true,
    });
  }

  for (const cancelamento of entrada.cancelamentosDoCliente ?? []) {
    const nome = (cancelamento.customer_name ?? "").trim() || "Cliente";
    const numero = numeroDoPedido(cancelamento.order_id);
    avisos.push({
      id: `cancelamento:${cancelamento.id}`,
      tipo: "cancelamento",
      // Sem pagamento online nao ha "dinheiro" para falar: o recado e' um so,
      // e e' o que impede a loja de separar/enviar mercadoria cancelada.
      titulo:
        cancelamento.situacao === "sem_pagamento_online"
          ? `Pedido #${numero} cancelado pela cliente`
          : `${nome} cancelou o pedido #${numero}`,
      detalhe:
        cancelamento.situacao === "sem_pagamento_online"
          ? "Não precisa separar nem enviar."
          : `${formatarReais(cancelamento.total)} — ${FRASE_DO_DINHEIRO[cancelamento.situacao]}`,
      quando: cancelamento.created_at,
      destino: { view: "admin-orders", id: cancelamento.order_id },
      // NAO conta no cracha, como o estoque: o aviso nao tem "feito" que o
      // faca sumir (fica ate a janela de 24 h acabar), e bolinha que nao zera
      // por ato do lojista e bolinha que se para de olhar. Quem chama a
      // atencao na hora e o push da rotina de 10 minutos.
      contaNoCracha: false,
    });
  }

  const devolucoes = entrada.devolucoesSolicitadas ?? 0;
  if (devolucoes > 0) {
    const uma = devolucoes === 1;
    avisos.push({
      id: "devolucao:solicitadas",
      tipo: "devolucao",
      titulo: uma
        ? "1 devolução esperando sua resposta"
        : `${devolucoes} devoluções esperando sua resposta`,
      detalhe: "Clientes pediram para devolver ou trocar produtos",
      quando: "",
      destino: { view: "admin-devolucoes" },
      contaNoCracha: true,
    });
  }

  if (entrada.perguntasPendentes > 0) {
    const uma = entrada.perguntasPendentes === 1;
    avisos.push({
      id: "pergunta:pendentes",
      tipo: "pergunta",
      titulo: uma
        ? "1 pergunta esperando resposta"
        : `${entrada.perguntasPendentes} perguntas esperando resposta`,
      detalhe: "Clientes perguntaram sobre seus produtos",
      quando: "",
      destino: { view: "admin-qa" },
      contaNoCracha: true,
    });
  }

  for (const avaliacao of entrada.avaliacoes) {
    avisos.push({
      id: `avaliacao:${avaliacao.id}`,
      tipo: "avaliacao",
      titulo: `Avaliação de ${avaliacao.rating} estrela${avaliacao.rating === 1 ? "" : "s"} sem resposta`,
      detalhe: avaliacao.nomeDoProduto || "Produto",
      quando: avaliacao.created_at,
      destino: { view: "admin-reviews" },
      contaNoCracha: true,
    });
  }

  for (const produto of entrada.produtos) {
    if (!precisaDeReposicao(produto.stock, produto.estoqueMinimo)) continue;
    avisos.push({
      id: `estoque:${produto.id}`,
      tipo: "estoque",
      titulo:
        produto.stock === 0
          ? `${produto.name} acabou`
          : `${produto.name} está acabando`,
      detalhe:
        produto.stock === 0
          ? "Sem nenhuma unidade"
          : `${produto.stock} ${produto.stock === 1 ? "unidade" : "unidades"} restantes`,
      quando: produto.created_at,
      destino: { view: "admin-product-form", id: produto.id },
      // NAO conta no cracha, e isso e' deliberado: estoque baixo so' termina
      // se o lojista repuser. Se ele decidir nao repor, o aviso fica para
      // sempre e a bolinha nunca zera — e bolinha que nunca zera e' bolinha
      // que se para de olhar, o que apaga tambem os tres que importam.
      contaNoCracha: false,
    });
  }

  return avisos.sort((a, b) => {
    const posicao =
      ORDEM_DE_URGENCIA.indexOf(a.tipo) - ORDEM_DE_URGENCIA.indexOf(b.tipo);
    return posicao !== 0 ? posicao : maisRecentePrimeiro(a, b);
  });
}
