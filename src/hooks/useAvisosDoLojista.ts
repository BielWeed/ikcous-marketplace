import { useCallback, useEffect, useRef, useState } from "react";

import { useProducts } from "@/hooks/useProducts";
import { FILTRO_POSTGREST_AVALIACAO_PARA_ATENDER } from "@/lib/avaliacoes-para-atender";
import { contagemDe, lerListaAdmin } from "@/lib/devolucao";
import {
  FILTRO_POSTGREST_PARA_PREPARAR,
  STATUS_PARA_PREPARAR,
} from "@/lib/pedidos-para-preparar";
import {
  FILTRO_POSTGREST_PAGAMENTO_NA_ENTREGA,
  TETO_DE_RECEBIMENTOS,
  inicioDaJanelaDoSino,
} from "@/lib/recebimentos-por-marcar";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types";
import {
  type AvaliacaoSemResposta,
  type Aviso,
  type CancelamentoDoCliente,
  JANELA_DE_CANCELAMENTO_HORAS,
  type LinhaDeCancelamento,
  type PedidoPendente,
  type ProdutoComEstoque,
  type RecebimentoPorMarcar,
  type TipoDeAviso,
  montarAvisos,
  selecionarCancelamentosDoCliente,
} from "@/utils/avisos-do-lojista";

/**
 * Quantos produtos COM ESTOQUE BAIXO a tela le por pagina. Quem filtra e o
 * servidor (`stock: "low"`, a mesma conta de `precisaDeReposicao`), entao o
 * tamanho do catalogo nao entra: so a quantidade de produtos acabando.
 */
const TAMANHO_DA_PAGINA_DE_PRODUTOS = 200;

/**
 * Ate quantos produtos acabando a tela junta, lendo pagina por pagina. Loja
 * com mais de 200 acabando nao pode ficar para sempre num "nao consegui
 * conferir" que atualizar nao resolve (10 consultas no maximo). Passando
 * disto a leitura devolve `truncou`, e a tela diz que a lista esta cortada e
 * manda ver o resto no Inicio — nunca "tudo em dia" sem ter visto.
 */
const TETO_DE_SEGURANCA_DE_PRODUTOS = 2000;

/**
 * Quantas avaliacoes sem resposta a lista mostra (as MAIS NOVAS). Sem
 * `.limit`/`.order` o servidor corta sozinho em 1.000, sem criterio. O sino
 * conta todas; a diferenca vira o aviso de lista cortada.
 */
const TETO_DE_AVALIACOES = 100;

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
  /**
   * As listas que responderam, mas vieram CORTADAS (mais itens que o teto).
   * Nao e falha: atualizar nao resolve, entao a tela explica onde ver o resto
   * em vez de oferecer o botao de tentar de novo.
   */
  listasCortadas: TipoDeAviso[];
  recarregar: () => void;
}

interface AvaliacaoCrua {
  id: string;
  product_id: string;
  rating: number;
  created_at: string;
  status: string | null;
}

// A regra unica "para preparar" (onda F, F2b) — a mesma do selo de Pedidos
// e do Inicio. So status nao bastava: o PIX/cartao ainda nao pago virava
// "Pedido de X esperando voce", e quem espera ali e a CLIENTE.
async function buscarPedidosPendentes(): Promise<PedidoPendente[]> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select("id, customer_name, total, created_at")
    .in("status", STATUS_PARA_PREPARAR as unknown as string[])
    .or(FILTRO_POSTGREST_PARA_PREPARAR);

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

// A mesma RPC da tela de Devolucoes (`contagem` vem inteira, qualquer que
// seja o filtro): so `solicitada` acende o sino — e o estado em que a
// resposta e da loja e o prazo legal corre. Forma inesperada e FALHA da
// fonte, nunca "zero devolucao".
async function buscarDevolucoesSolicitadas(): Promise<number> {
  const { data, error } = await supabase.rpc("admin_devolucoes_listar", {
    p_status: "solicitada",
    p_limite: 1,
  });
  if (error) throw error;
  const lista = lerListaAdmin(data);
  if (!lista) throw new Error("resposta inesperada de admin_devolucoes_listar");
  return contagemDe(lista.contagem, "solicitada");
}

// 14/10/2026: pedidos de privacidade (exclusao de conta, correcao de e-mail) que
// a cliente abriu e a loja ainda nao respondeu. So conta (`head`, sem trazer
// linha nenhuma); a RLS deixa o administrador ver os de todas. Resposta sem
// numero e FALHA da fonte, nunca "zero pedido": o prazo legal corre.
async function buscarPedidosDePrivacidadeAbertos(): Promise<number> {
  const { count, error } = await supabase
    .from("pedidos_de_privacidade")
    .select("id", { count: "exact", head: true })
    .eq("situacao", "aberto");
  if (error) throw error;
  if (typeof count !== "number") {
    throw new Error("resposta inesperada de pedidos_de_privacidade");
  }
  return count;
}

// `merchant_reply.is.null` e nao "null ou string vazia": o SQL do painel trata
// resposta em branco como pendente, mas o app nunca grava uma — as duas telas
// de resposta barram com `if (!replyText.trim()) return` (AdminReviewsView)
// antes de chamar a RPC. Alem de "sem resposta" entra a avaliacao `pendente`
// (ainda nao publicada): responder nao a publica, entao ela continua no sino
// ate o Aprovar (`@/lib/avaliacoes-para-atender`, a mesma regra da bolinha).
interface LeituraDeAvaliacoes {
  avaliacoes: AvaliacaoSemResposta[];
  /** Havia mais sem resposta que o teto: esta lista traz so as mais novas. */
  truncou: boolean;
}

async function buscarAvaliacoesSemResposta(): Promise<LeituraDeAvaliacoes> {
  const { data, error, count } = await supabase
    .from("reviews")
    .select("id, product_id, rating, created_at, status", { count: "exact" })
    .or(FILTRO_POSTGREST_AVALIACAO_PARA_ATENDER)
    .order("created_at", { ascending: false })
    .limit(TETO_DE_AVALIACOES);

  if (error) throw error;
  const avaliacoes = (data ?? []) as unknown as AvaliacaoCrua[];

  // O nome vem do id da avaliacao, nao da lista de estoque (que so traz os
  // produtos acabando). Consulta que cai ou produto que nao veio: a avaliacao
  // continua aparecendo com o rotulo generico em vez de sumir junto. O corte em
  // 100 ids guarda o tamanho do endereco da consulta.
  const ids = [...new Set(avaliacoes.map((a) => a.product_id))].slice(0, 100);
  const nomes = new Map<string, string>();
  if (ids.length > 0) {
    const { data: produtos } = await supabase
      .from("vw_produtos_admin")
      .select("id, nome")
      .in("id", ids);
    for (const p of (produtos ?? []) as Array<{ id: string; nome: string }>) {
      nomes.set(p.id, p.nome);
    }
  }
  return {
    avaliacoes: avaliacoes.map((a) => ({
      ...a,
      nomeDoProduto: nomes.get(a.product_id) ?? null,
    })),
    // Sem numero na resposta nao ha como afirmar corte: nao se inventa aviso.
    truncou: typeof count === "number" && count > avaliacoes.length,
  };
}

// 14/10/2026: o cliente cancelou um pedido que ja tinha pago, ou um pedido a
// pagar na entrega/retirada que a loja ainda nao enviou. A fonte e o
// HISTORICO do pedido (a `pedido__mudar_status`, ponto unico do cancelamento,
// grava `created_by` = quem cancelou); o administrador le a linha de todos
// pela politica de SELECT do historico. O papel dos autores vem de
// `profiles`: sem ele nao ha como excluir o admin que cancelou, entao a
// falha dele e falha da FONTE (lanca), nunca "nenhum cancelamento".
async function buscarCancelamentosDoCliente(): Promise<
  CancelamentoDoCliente[]
> {
  const desde = new Date(
    Date.now() - JANELA_DE_CANCELAMENTO_HORAS * 3600 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("marketplace_order_history")
    .select(
      "id, order_id, old_status, created_by, created_at, marketplace_orders(id, user_id, customer_name, total, payment_status, status, cancelled_after_shipping, customer_data->>pickup_address)",
    )
    .eq("new_status", "cancelled")
    .not("created_by", "is", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const linhas = (data ?? []) as unknown as LinhaDeCancelamento[];
  if (linhas.length === 0) return [];

  const autores = [
    ...new Set(
      linhas.map((l) => l.created_by).filter((id): id is string => !!id),
    ),
  ];
  const { data: perfis, error: erroPerfis } = await supabase
    .from("profiles")
    .select("id, role")
    .in("id", autores);
  if (erroPerfis) throw erroPerfis;

  const admins = new Set(
    ((perfis ?? []) as Array<{ id: string; role: string | null }>)
      .filter((perfil) => perfil.role === "admin")
      .map((perfil) => perfil.id),
  );
  return selecionarCancelamentosDoCliente(linhas, admins);
}

// 14/10/2026: pedido ENTREGUE, pago na entrega, em que a lojista ainda nao
// marcou o recebimento — enquanto isso o servidor recusa a devolucao da
// cliente. A regra (e o porque) mora em `@/lib/recebimentos-por-marcar`, lida
// tambem pela bolinha do sino (`AdminLayout`). Falha de leitura LANCA: vira
// falha da FONTE, nunca "nenhum pedido por marcar".
async function buscarRecebimentosPorMarcar(): Promise<RecebimentoPorMarcar[]> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select("id, customer_name, total, updated_at")
    .eq("status", "delivered")
    .or(FILTRO_POSTGREST_PAGAMENTO_NA_ENTREGA)
    .is("payment_status", null)
    .gte("updated_at", await inicioDaJanelaDoSino())
    .order("updated_at", { ascending: false })
    .limit(TETO_DE_RECEBIMENTOS);

  if (error) throw error;
  return (data ?? []) as unknown as RecebimentoPorMarcar[];
}

interface LeituraDeProdutos {
  produtos: ProdutoComEstoque[];
  /** Havia mais produtos acabando que o teto de seguranca: NAO viu tudo. */
  truncou: boolean;
}

async function buscarProdutosComEstoqueBaixo(
  carregar: (
    pagina?: number,
    tamanho?: number,
    filtros?: Record<string, unknown>,
  ) => Promise<{ products: Product[]; total: number } | null>,
): Promise<LeituraDeProdutos> {
  // Por id: o mesmo produto em duas paginas (cadastro mexido no meio da
  // leitura, ou empate de data na fronteira) conta uma vez so, senao a conta
  // fecha com um produto faltando e a tela nao avisa.
  const unicos = new Map<string, Product>();
  let total = 0;
  const maximoDePaginas = Math.ceil(
    TETO_DE_SEGURANCA_DE_PRODUTOS / TAMANHO_DA_PAGINA_DE_PRODUTOS,
  );

  // Pagina por pagina (o `loadProducts` aborta a consulta anterior, entao
  // nada de paralelo) ate cobrir o total do servidor ou bater o teto.
  for (let pagina = 0; pagina < maximoDePaginas; pagina++) {
    const resultado = await carregar(pagina, TAMANHO_DA_PAGINA_DE_PRODUTOS, {
      silent: true,
      // So os ativos com estoque baixo: a conta e a do servidor, igual a
      // `precisaDeReposicao`. O `.filter` abaixo e `montarAvisos` continuam
      // conferindo (a copia de offline do `loadProducts` nao e filtrada).
      stock: "low",
      status: "active",
    });

    // `loadProducts` engole o erro e devolve `null`. `null` NAO e "zero
    // produtos", e "nao sei" — tratar como lista vazia esconderia a falha e a
    // tela diria "nenhum produto acabando" sem ter olhado. Vale para qualquer
    // pagina: com uma do meio faltando a lista nao esta completa.
    if (!resultado) throw new Error("nao consegui listar os produtos");

    for (const produto of resultado.products) unicos.set(produto.id, produto);
    total = resultado.total;
    if (unicos.size >= total) break;
    // Pagina vazia sem ter chegado ao total: o servidor se contradiz. Parar
    // aqui como "falha" evita um laco e nao finge que a lista esta completa.
    if (resultado.products.length === 0) {
      throw new Error("paginas de produtos incompletas");
    }
  }

  const produtos = [...unicos.values()]
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

  // A comparacao e com os produtos LIDOS (unicos), nao com a lista filtrada: o
  // `.filter` acima e decisao nossa, o teto e limite da leitura.
  return { produtos, truncou: total > unicos.size };
}

/**
 * Junta as oito fontes de aviso do lojista numa lista so (a quinta,
 * devolucao, entrou com o plano 2026-09-26; a sexta, cancelamento do cliente,
 * e a setima, pedido de privacidade, e a oitava, recebimento por marcar, em
 * 14/10/2026).
 *
 * Falha parcial nao derruba a tela: as oito consultas correm em
 * `Promise.allSettled`, e a que cair entra em `fontesComFalha` enquanto as
 * outras seguem. Tela em branco por causa de uma consulta e pior que tela
 * incompleta e honesta.
 */
export function useAvisosDoLojista(): AvisosDoLojista {
  const { loadProducts } = useProducts({ autoFetch: false });

  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [fontesComFalha, setFontesComFalha] = useState<TipoDeAviso[]>([]);
  const [listasCortadas, setListasCortadas] = useState<TipoDeAviso[]>([]);
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

    const [
      rPedidos,
      rPerguntas,
      rAvaliacoes,
      rProdutos,
      rDevolucoes,
      rCancelamentos,
      rPrivacidade,
      rRecebimentos,
    ] = await Promise.allSettled([
      buscarPedidosPendentes(),
      buscarPerguntasPendentes(),
      buscarAvaliacoesSemResposta(),
      buscarProdutosComEstoqueBaixo(
        loadProducts as unknown as Parameters<
          typeof buscarProdutosComEstoqueBaixo
        >[0],
      ),
      buscarDevolucoesSolicitadas(),
      buscarCancelamentosDoCliente(),
      buscarPedidosDePrivacidadeAbertos(),
      buscarRecebimentosPorMarcar(),
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

    const devolucoesSolicitadas =
      rDevolucoes.status === "fulfilled" ? rDevolucoes.value : 0;
    if (rDevolucoes.status === "rejected") falhas.push("devolucao");

    const cancelamentosDoCliente =
      rCancelamentos.status === "fulfilled" ? rCancelamentos.value : [];
    if (rCancelamentos.status === "rejected") falhas.push("cancelamento");

    const pedidosDePrivacidadeAbertos =
      rPrivacidade.status === "fulfilled" ? rPrivacidade.value : 0;
    if (rPrivacidade.status === "rejected") falhas.push("privacidade");
    const recebimentosPorMarcar =
      rRecebimentos.status === "fulfilled" ? rRecebimentos.value : [];
    if (rRecebimentos.status === "rejected") falhas.push("recebimento");

    const cortadas: TipoDeAviso[] = [];

    const avaliacoes =
      rAvaliacoes.status === "fulfilled" ? rAvaliacoes.value.avaliacoes : [];
    if (rAvaliacoes.status === "rejected") falhas.push("avaliacao");
    // Lista cortada nao e falha (a rede respondeu): e aviso a parte, sem o
    // botao de atualizar, porque atualizar traria as mesmas.
    if (rAvaliacoes.status === "fulfilled" && rAvaliacoes.value.truncou) {
      cortadas.push("avaliacao");
    }

    const leituraDeProdutos =
      rProdutos.status === "fulfilled" ? rProdutos.value : null;
    const produtos = leituraDeProdutos?.produtos ?? [];
    if (rProdutos.status === "rejected") falhas.push("estoque");
    // Passou do teto de seguranca: a lista que veio e verdadeira, mas
    // incompleta, e a tela precisa dizer isso em vez de "tudo em dia".
    if (leituraDeProdutos?.truncou) cortadas.push("estoque");

    setAvisos(
      montarAvisos({
        pedidos,
        perguntasPendentes,
        avaliacoes,
        produtos,
        devolucoesSolicitadas,
        cancelamentosDoCliente,
        pedidosDePrivacidadeAbertos,
        recebimentosPorMarcar,
      }),
    );
    setFontesComFalha(falhas);
    setListasCortadas(cortadas);
    setCarregando(false);
  }, [loadProducts]);

  useEffect(() => {
    ativoRef.current = true;
    void buscar();
    // A tela fica aberta no balcão: relê quando o foco volta e quando o prazo
    // de devolução muda, os mesmos dois gatilhos do sino da barra. Sem canal
    // em tempo real próprio — a `rodadaRef` já descarta a rodada atropelada.
    const reler = () => {
      void buscar();
    };
    const aoMudarAVisibilidade = () => {
      if (document.visibilityState === "visible") reler();
    };
    document.addEventListener("visibilitychange", aoMudarAVisibilidade);
    window.addEventListener("admin:recontar-avisos", reler);
    return () => {
      ativoRef.current = false;
      document.removeEventListener("visibilitychange", aoMudarAVisibilidade);
      window.removeEventListener("admin:recontar-avisos", reler);
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
    listasCortadas,
    recarregar,
  };
}
