// Busca do modo Buscar: mesmos handlers e paginação antes presentes no cupom.
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Button } from "@/components/ui/button";
import type { AcaoDaVenda, ItemDoCupom } from "@/hooks/useVendaPresencial";
import { chaveDoItemDoCupom } from "@/hooks/useVendaPresencial";
import { ChevronDown, PackagePlus, Plus, Search } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./pdv.css";

/** Uma variação de `product_variants` (baseline:4041-4053) — só os campos
 * que o cupom usa para montar `ItemDoCupom`. */
export interface VarianteEncontradaNaBusca {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly price_override: number | null;
  readonly stock_increment: number;
  readonly active: boolean;
  readonly image_url: string | null;
}

/** Uma linha de `get_admin_products_paged` (baseline:1748-1757): `p.*` MAIS
 * o array `product_variants` — só os campos que o cupom usa. A VIEW monta
 * este objeto a partir do jsonb cru da RPC; este arquivo não sabe de onde
 * ele veio. */
export interface ProdutoEncontradoNaBusca {
  readonly id: string;
  readonly nome: string;
  readonly preco_venda: number;
  readonly estoque: number;
  readonly imagem_url: string | null;
  readonly imagem_urls: readonly string[] | null;
  readonly product_variants: readonly VarianteEncontradaNaBusca[];
}

/** Uma página da busca por nome: os produtos dela e QUANTOS existem no total
 * (o `total_count` que a RPC já devolve) — é o que deixa a tela dizer
 * "mostrando 8 de 22" em vez de fingir que 8 é tudo. */
export interface PaginaDeProdutosEncontrados {
  readonly produtos: readonly ProdutoEncontradoNaBusca[];
  readonly total: number;
}

interface PropsDaBuscaDeProduto {
  readonly despachar: (acao: AcaoDaVenda) => void;
  /** `pagina` começa em 0. */
  readonly buscarProdutos: (
    termo: string,
    pagina: number,
  ) => Promise<PaginaDeProdutosEncontrados>;
  readonly visivel: boolean;
  readonly agora?: () => number;
}

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function imagemDoProduto(produto: ProdutoEncontradoNaBusca): string {
  return produto.imagem_url || produto.imagem_urls?.[0] || "";
}

/** Espelha a soma de `mapProductFromDB` (src/lib/mappers.ts:97-106) e o
 * PASSO 4 de `useVendaPresencial` (`estoqueEfetivo`): produto com variantes
 * ATIVAS é decidido pela SOMA delas, nunca pela coluna `estoque` da linha do
 * produto (a mesma armadilha medida na revisão de C1.2 — a coluna fica
 * desatualizada por desenho quando o produto tem variação). */
function estoqueDoProdutoEncontrado(produto: ProdutoEncontradoNaBusca): number {
  const ativas = produto.product_variants.filter((v) => v.active);
  if (ativas.length === 0) return produto.estoque;
  return ativas.reduce((soma, v) => soma + v.stock_increment, 0);
}

function itemDoProdutoSemVariacao(
  produto: ProdutoEncontradoNaBusca,
): ItemDoCupom {
  return {
    chave: chaveDoItemDoCupom(produto.id, null),
    productId: produto.id,
    variantId: null,
    nome: produto.nome,
    variacao: null,
    preco: produto.preco_venda,
    quantidade: 1,
    estoque: estoqueDoProdutoEncontrado(produto),
    imagem: imagemDoProduto(produto),
  };
}

function itemDaVarianteEncontrada(
  produto: ProdutoEncontradoNaBusca,
  variante: VarianteEncontradaNaBusca,
): ItemDoCupom {
  return {
    chave: chaveDoItemDoCupom(produto.id, variante.id),
    productId: produto.id,
    variantId: variante.id,
    nome: produto.nome,
    variacao: `${variante.name} ${variante.value}`.trim(),
    // MESMA regra de `src/lib/preco-vendido.ts:19-24`: override ZERO é
    // preço legítimo (brinde), só cai no preço do produto quando é NULL —
    // por isso `??`, nunca `||`.
    preco: variante.price_override ?? produto.preco_venda,
    quantidade: 1,
    estoque: variante.stock_increment,
    imagem: variante.image_url || imagemDoProduto(produto),
  };
}

export function BuscaDeProduto({
  despachar,
  buscarProdutos,
  visivel,
  agora = () => Date.now(),
}: PropsDaBuscaDeProduto): ReactElement {
  const [termoDeBusca, setTermoDeBusca] = useState("");
  const [resultadosDaBusca, setResultadosDaBusca] = useState<
    readonly ProdutoEncontradoNaBusca[]
  >([]);
  const [buscando, setBuscando] = useState(false);
  // Quantos produtos o banco tem para o termo (não só os da tela), a última
  // página que chegou, se a busca já respondeu ao menos uma vez e a falha que
  // a lojista precisa ver: calar na falha fazia "a rede caiu" parecer "não
  // existe esse produto".
  const [totalDaBusca, setTotalDaBusca] = useState(0);
  const [paginaCarregada, setPaginaCarregada] = useState(0);
  const [buscaRespondeu, setBuscaRespondeu] = useState(false);
  const [falhaDaBusca, setFalhaDaBusca] = useState<{
    readonly pagina: number;
  } | null>(null);
  const [termoBuscado, setTermoBuscado] = useState("");

  // Defesa de RODADA (molde: AdminCustomersView.tsx:156-180) — resposta de
  // uma busca antiga não pode gravar por cima da busca mais nova.
  const rodadaRef = useRef(0);

  // Busca UMA página do termo. Página 0 recomeça a lista; as seguintes
  // ("Mostrar mais") somam à que já está na tela, sem repetir produto (um
  // cadastro novo entre duas páginas empurra a fila e o mesmo produto
  // apareceria de novo).
  const buscarPagina = useCallback(
    async (termo: string, pagina: number): Promise<void> => {
      const rodada = ++rodadaRef.current;
      setTermoBuscado(termo);
      setBuscando(true);
      setFalhaDaBusca(null);
      try {
        const resposta = await buscarProdutos(termo, pagina);
        if (rodada !== rodadaRef.current) return;
        const jaNaTela = pagina === 0 ? [] : resultadosDaBusca;
        const ids = new Set(jaNaTela.map((p) => p.id));
        const novos = resposta.produtos.filter((p) => !ids.has(p.id));
        const todos = [...jaNaTela, ...novos];
        setResultadosDaBusca(todos);
        // Página seguinte vazia com a lista ainda "incompleta" = o catálogo
        // mudou no meio do caminho: fecha a conta com o que há, em vez de
        // oferecer um "Mostrar mais" que não traz nada.
        setTotalDaBusca(
          pagina > 0 && novos.length === 0
            ? todos.length
            : Math.max(resposta.total, todos.length),
        );
        setPaginaCarregada(pagina);
        setBuscaRespondeu(true);
      } catch (erro) {
        if (rodada !== rodadaRef.current) return;
        console.error("Erro ao buscar produto no balcão:", erro);
        if (pagina === 0) {
          setResultadosDaBusca([]);
          setTotalDaBusca(0);
          setBuscaRespondeu(false);
        }
        setFalhaDaBusca({ pagina });
      } finally {
        if (rodada === rodadaRef.current) setBuscando(false);
      }
    },
    [buscarProdutos, resultadosDaBusca],
  );

  useEffect(() => {
    if (!visivel) return;
    // Só a primeira abertura consulta a lista base. Alternar os modos
    // preserva o termo e as páginas, inclusive com StrictMode.
    if (rodadaRef.current !== 0) return;
    void buscarPagina("", 0);
  }, [visivel, buscarPagina]);

  async function aoDigitarBusca(valor: string): Promise<void> {
    setTermoDeBusca(valor);
    // Menos de duas letras mostra a lista base do banco. Se ela já está
    // na tela (ou a caminho), a guarda abaixo evita repetir a consulta.
    const termoLimpo = valor.trim().length < 2 ? "" : valor.trim();
    // O campo entrega o texto de novo quando PERDE O FOCO. No celular o toque
    // em "Mostrar mais" tira o foco do campo antes do clique: refazer aqui a
    // busca do termo que já está na tela (ou a caminho) travava o botão no
    // meio do toque e o primeiro toque morria. Termo que falhou continua
    // podendo ser buscado de novo.
    if (
      termoLimpo === termoBuscado &&
      (buscaRespondeu || buscando) &&
      !falhaDaBusca
    ) {
      return;
    }
    await buscarPagina(termoLimpo, 0);
  }

  const [produtoExpandidoId, setProdutoExpandidoId] = useState<string | null>(
    null,
  );

  // Produto sem variação ativa entra direto no cupom pelo mesmo caminho de
  // guardas do bipe (soma de quantidade, teto de estoque). Produto COM
  // variações ativas não tem uma "combinação" única a escolher sozinho — o
  // clique só abre/fecha a lista de variações logo abaixo (ver o `.map` de
  // `ativas` no JSX), e quem entra no cupom é a variação, não o produto.
  function aoClicarLinhaDeProduto(produto: ProdutoEncontradoNaBusca): void {
    const ativas = produto.product_variants.filter((v) => v.active);
    if (ativas.length === 0) {
      despachar({
        tipo: "item_adicionado_manualmente",
        item: itemDoProdutoSemVariacao(produto),
        em: agora(),
      });
      return;
    }
    setProdutoExpandidoId((atual) =>
      atual === produto.id ? null : produto.id,
    );
  }

  function aoEscolherVarianteDaBusca(
    produto: ProdutoEncontradoNaBusca,
    variante: VarianteEncontradaNaBusca,
  ): void {
    despachar({
      tipo: "item_adicionado_manualmente",
      item: itemDaVarianteEncontrada(produto, variante),
      em: agora(),
    });
  }

  return (
    <section
      className="pdv-search pdv-stack"
      aria-label="Busca manual de produtos"
    >
      <label htmlFor="busca-manual-de-produto" className="pdv-heading">
        <Search aria-hidden="true" className="pdv-icon pdv-blue" />
        Buscar produto
        <span className="sr-only">
          {" "}
          por nome ou código interno (sem código de barras)
        </span>
      </label>
      <LocalBufferedInput
        id="busca-manual-de-produto"
        value={termoDeBusca}
        onFlush={aoDigitarBusca}
        delay={300}
        aria-describedby="busca-produto-ajuda"
        placeholder="Ex.: camiseta branca P"
        className="pdv-field"
      />
      <p id="busca-produto-ajuda" className="pdv-muted">
        Nome ou código interno · mínimo de 2 letras
      </p>
      {buscando && (
        <p role="status" className="pdv-muted">
          Buscando…
        </p>
      )}
      {!buscando &&
        !falhaDaBusca &&
        buscaRespondeu &&
        resultadosDaBusca.length === 0 && (
          <div role="status" className="pdv-card pdv-stack">
            {termoBuscado === "" ? (
              <p className="pdv-heading">Nenhum produto ativo cadastrado</p>
            ) : (
              <>
                <p className="pdv-heading">Nenhum produto encontrado</p>
                <p className="pdv-muted">
                  Sem resultado para &quot;{termoBuscado}&quot;. Confira o nome
                  ou digite menos letras.
                </p>
              </>
            )}
          </div>
        )}
      {falhaDaBusca && !buscando && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">
            <Search aria-hidden="true" className="pdv-icon pdv-red" />
            Falha na busca de produtos
          </p>
          <p className="pdv-muted">
            Não consegui buscar agora. Confira a internet e tente de novo.
          </p>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => void buscarPagina(termoBuscado, falhaDaBusca.pagina)}
          >
            Tentar de novo
          </Button>
        </div>
      )}
      {resultadosDaBusca.length > 0 && (
        <>
          <div className="pdv-heading">
            <PackagePlus aria-hidden="true" className="pdv-icon pdv-pink" />
            <h3 className="flex-1">Produtos</h3>
            <span className="pdv-muted">
              {resultadosDaBusca.length} de {totalDaBusca}
            </span>
          </div>
          <ul className="pdv-stack">
            {resultadosDaBusca.map((produto) => {
              const ativas = produto.product_variants.filter((v) => v.active);
              const expandido = produtoExpandidoId === produto.id;
              return (
                <li key={produto.id}>
                  <button
                    type="button"
                    onClick={() => aoClicarLinhaDeProduto(produto)}
                    className="pdv-result"
                    aria-expanded={ativas.length > 0 ? expandido : undefined}
                  >
                    {imagemDoProduto(produto) ? (
                      <img
                        src={imagemDoProduto(produto)}
                        alt=""
                        className="pdv-item-image"
                      />
                    ) : (
                      <PackagePlus
                        aria-hidden="true"
                        className="pdv-icon pdv-pink"
                      />
                    )}
                    <span>
                      <strong>{produto.nome}</strong>
                      <span className="pdv-muted">
                        {ativas.length > 0
                          ? `${ativas.length} variação(ões)`
                          : `R$ ${reais(produto.preco_venda)}`}
                        {ativas.length === 0 && (
                          <span
                            className={
                              produto.estoque <= 0 ? "pdv-red" : undefined
                            }
                          >
                            {produto.estoque <= 0
                              ? " · Sem estoque"
                              : ` · ${produto.estoque} em estoque`}
                          </span>
                        )}
                      </span>
                    </span>
                    {ativas.length > 0 ? (
                      <ChevronDown
                        aria-hidden="true"
                        className="pdv-icon pdv-purple"
                      />
                    ) : (
                      <Plus aria-hidden="true" className="pdv-icon pdv-teal" />
                    )}
                  </button>
                  {expandido && ativas.length > 0 && (
                    <div className="pdv-result-variants">
                      {ativas.map((variante) => (
                        <button
                          key={variante.id}
                          type="button"
                          disabled={variante.stock_increment <= 0}
                          onClick={() =>
                            aoEscolherVarianteDaBusca(produto, variante)
                          }
                          className="pdv-result"
                        >
                          <span>
                            <strong>
                              {variante.name} {variante.value}
                            </strong>
                            <span className="pdv-muted">
                              {variante.stock_increment <= 0
                                ? "Esgotado"
                                : `R$ ${reais(variante.price_override ?? produto.preco_venda)} · ${variante.stock_increment} em estoque`}
                            </span>
                          </span>
                          <Plus
                            aria-hidden="true"
                            className="pdv-icon pdv-teal"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {resultadosDaBusca.length > 0 &&
        resultadosDaBusca.length < totalDaBusca &&
        !falhaDaBusca && (
          <div className="pdv-stack">
            <p className="pdv-muted">
              Mostrando {resultadosDaBusca.length} de {totalDaBusca}. Digite
              mais letras para filtrar ou toque em Mostrar mais.
            </p>
            <Button
              type="button"
              variant="outline"
              className="pdv-secondary"
              disabled={buscando}
              onClick={() =>
                void buscarPagina(termoBuscado, paginaCarregada + 1)
              }
            >
              <ChevronDown aria-hidden="true" className="pdv-blue size-5" />
              Mostrar mais
            </Button>
          </div>
        )}
    </section>
  );
}
