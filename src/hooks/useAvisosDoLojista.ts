import { useCallback, useEffect, useRef, useState } from "react";

import { STATUS_PEDIDOS_COM_ACAO_PENDENTE } from "@/components/layouts/AdminLayout";
import { useProducts } from "@/hooks/useProducts";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types";
import {
  type AvaliacaoSemResposta,
  type Aviso,
  type PedidoPendente,
  type ProdutoComEstoque,
  type TipoDeAviso,
  montarAvisos,
} from "@/utils/avisos-do-lojista";

/**
 * Quantos produtos a tela varre atras de estoque baixo. Nao ha paginacao aqui
 * de proposito: a tela e "o que falta fazer", nao um relatorio de catalogo.
 *
 * O que o teto NAO pode fazer e virar piso silencioso: numa loja com mais
 * produtos que isto, o 201o nunca seria olhado e a tela diria "nenhum produto
 * acabando" sem ter visto. Por isso a leitura devolve `truncou`, e truncar
 * conta como FALHA da fonte de estoque — "nao consegui conferir produtos" e
 * verdade; "tudo em dia" seria mentira.
 */
const TETO_DE_PRODUTOS = 200;

export interface AvisosDoLojista {
  avisos: Aviso[];
  /**
   * Quantos avisos acendem a bolinha do sino. NAO e `avisos.length`: o aviso
   * de estoque entra na lista e fica de fora da contagem, porque estoque
   * baixo so termina se o lojista repuser — e bolinha que nunca zera e
   * bolinha que se para de olhar.
   */
  quantidadeNoCracha: number;
  carregando: boolean;
  /** As fontes que nao responderam nesta rodada. A tela diz isso em voz alta. */
  fontesComFalha: TipoDeAviso[];
  recarregar: () => void;
}

interface AvaliacaoCrua {
  id: string;
  product_id: string;
  rating: number;
  created_at: string;
}

async function buscarPedidosPendentes(): Promise<PedidoPendente[]> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select("id, customer_name, total, created_at")
    .in("status", STATUS_PEDIDOS_COM_ACAO_PENDENTE as unknown as string[]);

  if (error) throw error;
  return (data ?? []) as unknown as PedidoPendente[];
}

async function buscarPerguntasPendentes(): Promise<number> {
  // Mesma RPC que o cracha do AdminLayout ja usa (`p_page_size: 1`, so o
  // total interessa). Duas contagens diferentes para a mesma pergunta seria
  // pior que nenhuma.
  const { data, error } = await (
    supabase.rpc as unknown as (
      nome: string,
      argumentos: Record<string, unknown>,
    ) => Promise<{ data: { total_count?: number } | null; error: unknown }>
  )("get_admin_questions_paged", {
    p_search: "",
    p_filter: "pending",
    p_page: 0,
    p_page_size: 1,
  });

  if (error) throw error;
  // `??` e nao `||`: zero pergunta pendente e uma resposta legitima, e
  // `|| 0` daria o mesmo numero para "zero" e para "veio nulo".
  return data?.total_count ?? 0;
}

// `.is(null)` e nao "null ou string vazia": o SQL do painel trata resposta em
// branco como pendente, mas o app nunca grava uma — as duas telas de resposta
// barram com `if (!replyText.trim()) return` (AdminReviewsView) antes de
// chamar a RPC. Alargar a consulta por um caso que o proprio app nao produz
// custaria um `.or` e nenhuma verdade a mais.
async function buscarAvaliacoesSemResposta(): Promise<AvaliacaoCrua[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("id, product_id, rating, created_at")
    .is("merchant_reply", null);

  if (error) throw error;
  return (data ?? []) as unknown as AvaliacaoCrua[];
}

interface LeituraDeProdutos {
  produtos: ProdutoComEstoque[];
  /** O catalogo era maior que o teto: esta varredura NAO viu tudo. */
  truncou: boolean;
}

async function buscarProdutosComEstoqueBaixo(
  carregar: (
    pagina?: number,
    tamanho?: number,
    filtros?: Record<string, unknown>,
  ) => Promise<{ products: Product[]; total: number } | null>,
): Promise<LeituraDeProdutos> {
  const resultado = await carregar(0, TETO_DE_PRODUTOS, { silent: true });

  // `loadProducts` engole o erro e devolve `null`. `null` NAO e "zero
  // produtos", e "nao sei" — tratar como lista vazia esconderia a falha e a
  // tela diria "nenhum produto acabando" sem ter olhado.
  if (!resultado) throw new Error("nao consegui listar os produtos");

  const produtos = resultado.products
    // Produto desativado nao esta a venda: avisar que ele "esta acabando"
    // e alarme falso sobre uma decisao que o lojista ja tomou.
    .filter((produto) => produto.isActive)
    .map((produto) => ({
      id: produto.id,
      name: produto.name,
      // `stock` ja e o estoque efetivo (soma das variantes ativas quando
      // existem) porque veio do `mapProductFromDB` — a mesma conta do KPI.
      stock: produto.stock,
      estoqueMinimo: produto.estoqueMinimo ?? null,
      created_at: produto.createdAt,
    }));

  // A comparacao e com a lista CRUA, nao com a filtrada: o `.filter` acima e
  // decisao nossa, o teto e limite da consulta.
  return { produtos, truncou: resultado.total > resultado.products.length };
}

/**
 * Junta as quatro fontes de aviso do lojista numa lista so.
 *
 * Falha parcial nao derruba a tela: as quatro consultas correm em
 * `Promise.allSettled`, e a que cair entra em `fontesComFalha` enquanto as
 * outras seguem. Tela em branco por causa de uma consulta e pior que tela
 * incompleta e honesta.
 */
export function useAvisosDoLojista(): AvisosDoLojista {
  const { loadProducts } = useProducts({ autoFetch: false });

  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [fontesComFalha, setFontesComFalha] = useState<TipoDeAviso[]>([]);
  const [carregando, setCarregando] = useState(true);

  const ativoRef = useRef(true);
  // Numero da rodada. Sem ele, quem termina por ultimo vence — e o
  // `loadProducts` garante que a rodada VELHA termine por ultimo e mal: ele
  // aborta a consulta anterior e devolve `null` para ela, que aqui vira
  // "falha da fonte estoque". Resultado sem o token: o lojista toca duas
  // vezes em atualizar (ou o StrictMode monta duas vezes em desenvolvimento)
  // e a tela acende "nao consegui conferir produtos" com a rede saudavel.
  const rodadaRef = useRef(0);

  const buscar = useCallback(async () => {
    const rodada = ++rodadaRef.current;
    setCarregando(true);

    const [rPedidos, rPerguntas, rAvaliacoes, rProdutos] =
      await Promise.allSettled([
        buscarPedidosPendentes(),
        buscarPerguntasPendentes(),
        buscarAvaliacoesSemResposta(),
        buscarProdutosComEstoqueBaixo(
          loadProducts as unknown as Parameters<
            typeof buscarProdutosComEstoqueBaixo
          >[0],
        ),
      ]);

    // Componente desmontado, ou rodada atropelada por outra mais nova: em
    // ambos os casos esta resposta nao tem mais tela para ir.
    if (!ativoRef.current || rodada !== rodadaRef.current) return;

    const falhas: TipoDeAviso[] = [];

    const pedidos = rPedidos.status === "fulfilled" ? rPedidos.value : [];
    if (rPedidos.status === "rejected") falhas.push("pedido");

    const perguntasPendentes =
      rPerguntas.status === "fulfilled" ? rPerguntas.value : 0;
    if (rPerguntas.status === "rejected") falhas.push("pergunta");

    const avaliacoesCruas =
      rAvaliacoes.status === "fulfilled" ? rAvaliacoes.value : [];
    if (rAvaliacoes.status === "rejected") falhas.push("avaliacao");

    const leituraDeProdutos =
      rProdutos.status === "fulfilled" ? rProdutos.value : null;
    const produtos = leituraDeProdutos?.produtos ?? [];
    // Truncar conta como falha: a lista de estoque que veio e verdadeira, mas
    // incompleta, e a tela precisa dizer isso em vez de "tudo em dia".
    if (rProdutos.status === "rejected" || leituraDeProdutos?.truncou) {
      falhas.push("estoque");
    }

    // O nome do produto vem da lista de produtos, nao de um join: se a fonte
    // de produtos caiu, a avaliacao continua aparecendo com o rotulo
    // generico em vez de sumir junto.
    const nomePorId = new Map(produtos.map((p) => [p.id, p.name]));
    const avaliacoes: AvaliacaoSemResposta[] = avaliacoesCruas.map(
      (avaliacao) => ({
        id: avaliacao.id,
        product_id: avaliacao.product_id,
        nomeDoProduto: nomePorId.get(avaliacao.product_id) ?? null,
        rating: avaliacao.rating,
        created_at: avaliacao.created_at,
      }),
    );

    setAvisos(
      montarAvisos({ pedidos, perguntasPendentes, avaliacoes, produtos }),
    );
    setFontesComFalha(falhas);
    setCarregando(false);
  }, [loadProducts]);

  useEffect(() => {
    ativoRef.current = true;
    void buscar();
    return () => {
      ativoRef.current = false;
    };
  }, [buscar]);

  const recarregar = useCallback(() => {
    void buscar();
  }, [buscar]);

  return {
    avisos,
    quantidadeNoCracha: avisos.filter((aviso) => aviso.contaNoCracha).length,
    carregando,
    fontesComFalha,
    recarregar,
  };
}
