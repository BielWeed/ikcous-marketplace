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

export type TipoDeAviso = "pedido" | "pergunta" | "avaliacao" | "estoque";

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

const ORDEM_DE_URGENCIA: TipoDeAviso[] = [
  "pedido",
  "pergunta",
  "avaliacao",
  "estoque",
];

function maisRecentePrimeiro(a: Aviso, b: Aviso): number {
  return b.quando.localeCompare(a.quando);
}

function formatarReais(valor: number | null): string {
  return `R$ ${(valor ?? 0).toFixed(2).replace(".", ",")}`;
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
