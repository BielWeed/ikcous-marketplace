// Seção "cupom" do caixa (tarefa C3.2, plano §5.3). É a camada DE BASE da
// tela — sempre visível enquanto a etapa não é "recibo" — e também é quem
// desenha a folha de "qual combinação?" (etapa "escolha_de_variacao"),
// porque a máquina de C3.1 trata a folha como um dado do CUPOM
// (`estado.escolhaDeVariacao`), não como uma seção separada.
//
// REGRA DE OURO (contexto da tarefa): este arquivo NÃO chama Supabase. Quem
// resolve um código de barras é a VIEW (`AdminPdvView`), que injeta
// `buscarProdutos` para a busca manual — o mesmo caminho de guardas do bipe
// (soma de quantidade, teto de estoque) é a ação `item_adicionado_manualmente`
// da máquina (useVendaPresencial.ts).

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Button } from "@/components/ui/button";
import type {
  AcaoDaVenda,
  EstadoDaVenda,
  ItemDoCupom,
} from "@/hooks/useVendaPresencial";
import { chaveDoItemDoCupom } from "@/hooks/useVendaPresencial";
import {
  type FeedbackDoLeitor,
  criarFeedbackDoLeitor,
} from "@/lib/feedback-do-leitor";
import type { View } from "@/types";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  LockKeyhole,
  Minus,
  PackagePlus,
  PackageX,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
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

export interface PropsDoCupomDaVenda {
  readonly estado: EstadoDaVenda;
  readonly despachar: (acao: AcaoDaVenda) => void;
  readonly subtotal: number;
  /** `pagina` começa em 0. */
  readonly buscarProdutos: (
    termo: string,
    pagina: number,
  ) => Promise<PaginaDeProdutosEncontrados>;
  readonly onNavigate: (view: View) => void;
  /** `useVendaPresencial().limparCupom`: volta o caixa ao zero (itens,
   * desconto, cliente, forma de pagamento e rascunho). Ausente = sem o botão
   * "Cancelar venda" (testes que montam só a lista). */
  readonly limparCupom?: () => void;
  /** Injeção de teste — padrão `criarFeedbackDoLeitor()`. `null` desliga
   * bip/vibração (mesmo padrão de `useLeitorDeCodigo`, opções). */
  readonly feedback?: FeedbackDoLeitor | null;
  /** Injeção de teste do relógio — padrão `Date.now`. */
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

export function CupomDaVenda({
  estado,
  despachar,
  subtotal,
  buscarProdutos,
  onNavigate,
  limparCupom,
  feedback: feedbackProp,
  agora = () => Date.now(),
}: PropsDoCupomDaVenda): ReactElement {
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

  // O AudioContext NASCE PREGUIÇOSO dentro de `criarFeedbackDoLeitor` — não
  // tem custo criar a instância aqui mesmo sem gesto do usuário ainda.
  // Injeção de teste no molde de `useLeitorDeCodigo`: `feedback === null`
  // desliga de propósito; `undefined` cai no padrão de verdade.
  const [feedback] = useState<FeedbackDoLeitor | null>(() =>
    feedbackProp === null ? null : (feedbackProp ?? criarFeedbackDoLeitor()),
  );
  useEffect(() => {
    return () => {
      feedback?.encerrar();
    };
  }, [feedback]);

  // O leitor (C2) não conhece produto, preço nem estoque — os TRÊS avisos
  // que ele não sabe dar ("não cadastrado", "inativo", "esgotado") são desta
  // tela (divergências da tarefa). `estado.aviso` é um objeto NOVO a cada
  // vez que o reducer acende um aviso (mesmo tipo repetido inclui), então a
  // lista de dependências `[estado.aviso]` dispara de novo mesmo para dois
  // avisos iguais em seguida.
  useEffect(() => {
    if (!estado.aviso) return;
    if (
      estado.aviso.tipo === "nao_cadastrado" ||
      estado.aviso.tipo === "inativo" ||
      estado.aviso.tipo === "esgotado"
    ) {
      feedback?.recusar();
    }
  }, [estado.aviso, feedback]);

  // Defesa de RODADA (molde: AdminCustomersView.tsx:156-180) — resposta de
  // uma busca antiga não pode gravar por cima da busca mais nova.
  const rodadaRef = useRef(0);

  // Busca UMA página do termo. Página 0 recomeça a lista; as seguintes
  // ("Mostrar mais") somam à que já está na tela, sem repetir produto (um
  // cadastro novo entre duas páginas empurra a fila e o mesmo produto
  // apareceria de novo).
  async function buscarPagina(termo: string, pagina: number): Promise<void> {
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
  }

  async function aoDigitarBusca(valor: string): Promise<void> {
    setTermoDeBusca(valor);
    const termoLimpo = valor.trim();
    if (termoLimpo.length < 2) {
      // Uma resposta ainda no ar não pode reabrir a lista de um termo que a
      // lojista já apagou.
      rodadaRef.current++;
      setTermoBuscado("");
      setResultadosDaBusca([]);
      setTotalDaBusca(0);
      setPaginaCarregada(0);
      setBuscaRespondeu(false);
      setFalhaDaBusca(null);
      setBuscando(false);
      return;
    }
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

  const escolha = estado.escolhaDeVariacao;

  // "Cancelar venda": só há o que cancelar quando o cupom guarda ALGUMA coisa
  // da venda (item, desconto, cliente ou forma de pagamento — os dois últimos
  // sobreviviam à desistência e iam para a venda seguinte).
  const temVendaParaCancelar =
    estado.itens.length > 0 ||
    estado.desconto > 0 ||
    estado.cliente.tipo !== "sem_cliente" ||
    estado.pagamento !== null;
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  // O cupom esvaziou por outro caminho (tirou o último item, por exemplo)
  // com a pergunta aberta: ela some junto — senão voltaria sozinha na venda
  // seguinte, perguntando por uma venda que não existe mais.
  // O mesmo vale se a venda começa a ser GRAVADA com a pergunta aberta
  // (foi a "Fechar venda" e "Registrar venda"): o "Sim" zeraria a tela com a
  // venda no ar.
  if (confirmandoCancelamento && (!temVendaParaCancelar || estado.enviando)) {
    setConfirmandoCancelamento(false);
  }
  // O foco cai no "Voltar": o gesto automático de quem toca duas vezes por
  // reflexo não pode apagar a venda — a ação padrão é a segura.
  const voltarDoCancelamentoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmandoCancelamento) voltarDoCancelamentoRef.current?.focus();
  }, [confirmandoCancelamento]);

  return (
    <div className="pdv-flow" data-etapa={estado.etapa}>
      {escolha && (
        <section className="pdv-card pdv-stack" aria-label="Escolher variação">
          <h3 className="pdv-heading">
            <PackagePlus aria-hidden="true" className="pdv-icon pdv-pink" />
            Escolher variação
          </h3>
          <p className="font-bold">
            Qual combinação de "{escolha.produtoNome}"?
          </p>
          {escolha.opcoes.map((opcao) => (
            <button
              key={opcao.variant_id}
              type="button"
              disabled={opcao.estoque <= 0}
              onClick={() =>
                despachar({ tipo: "variacao_escolhida", opcao, em: agora() })
              }
              className="pdv-result"
            >
              <span>
                <strong>
                  {opcao.nome} {opcao.valor}
                </strong>
                <span className="pdv-muted">
                  {opcao.estoque <= 0
                    ? "Esgotado"
                    : `R$ ${reais(opcao.preco)} · ${opcao.estoque} em estoque`}
                </span>
              </span>
              <Plus aria-hidden="true" className="pdv-icon pdv-teal" />
            </button>
          ))}
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => despachar({ tipo: "variacao_cancelada" })}
          >
            Cancelar
          </Button>
        </section>
      )}

      {estado.aviso?.tipo === "nao_cadastrado" && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">
            <AlertTriangle aria-hidden="true" className="pdv-icon pdv-orange" />
            Código não encontrado
          </p>
          <p className="pdv-muted">
            Código {estado.aviso.codigo} não está cadastrado. Confira o código
            ou cadastre o produto.
          </p>
          <p className="pdv-muted">
            O atalho abaixo só abre o cadastro — digitar o código lá é manual
            por enquanto.
          </p>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => onNavigate("admin-product-form")}
          >
            <PackagePlus aria-hidden="true" className="pdv-cyan size-5" />
            Cadastrar produto
          </Button>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => despachar({ tipo: "aviso_limpo" })}
          >
            Fechar
          </Button>
        </div>
      )}
      {estado.aviso?.tipo === "inativo" && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">
            <AlertTriangle aria-hidden="true" className="pdv-icon pdv-pink" />
            Produto inativo
          </p>
          <p className="pdv-muted">
            "{estado.aviso.nome}" está inativo no catálogo. Não foi adicionado
            ao cupom.
          </p>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => despachar({ tipo: "aviso_limpo" })}
          >
            Fechar
          </Button>
        </div>
      )}
      {estado.aviso?.tipo === "esgotado" && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">
            <PackageX aria-hidden="true" className="pdv-icon pdv-red" />
            Produto esgotado
          </p>
          <p className="pdv-muted">
            "{estado.aviso.nome}" está esgotado. Nenhuma unidade adicionada.
          </p>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => despachar({ tipo: "aviso_limpo" })}
          >
            Fechar
          </Button>
        </div>
      )}
      {estado.aviso?.tipo === "ignorado_repetido" && (
        <div role="status" className="pdv-notice">
          <p className="pdv-heading">
            <AlertTriangle aria-hidden="true" className="pdv-icon pdv-orange" />
            Leitura repetida
          </p>
          <p className="pdv-muted">
            Já bipei o código {estado.aviso.codigo} há pouco — bipe de novo se
            for mesmo outra unidade.
          </p>
        </div>
      )}

      <section
        className="pdv-cupom pdv-stack"
        aria-label="Cupom da venda"
        data-resumo={
          estado.etapa === "cliente" || estado.etapa === "fechamento"
        }
      >
        <div className="pdv-heading">
          <ShoppingCart aria-hidden="true" className="pdv-icon pdv-purple" />
          <h3 className="flex-1">Cupom</h3>
          <span className="pdv-muted">{estado.itens.length} itens</span>
          {(estado.etapa === "cliente" || estado.etapa === "fechamento") && (
            <strong className="text-sm">R$ {reais(subtotal)}</strong>
          )}
        </div>
        {estado.itens.length === 0 ? (
          <div className="pdv-card pdv-stack pdv-empty">
            <p className="pdv-heading">Bipe o primeiro produto</p>
            <p className="pdv-muted">Seu cupom está vazio.</p>
          </div>
        ) : (
          <ul>
            {estado.itens.map((item) => {
              const destacado = estado.ultimaEntrada?.chave === item.chave;
              return (
                <li
                  key={item.chave}
                  data-destacado={destacado ? "true" : "false"}
                  className="pdv-item"
                >
                  {item.imagem ? (
                    <img
                      src={item.imagem}
                      alt={item.nome}
                      className="pdv-item-image"
                    />
                  ) : (
                    <div className="pdv-item-image flex items-center justify-center bg-violet-400/15">
                      <PackagePlus
                        aria-hidden="true"
                        className="pdv-purple size-5"
                      />
                    </div>
                  )}
                  <div className="pdv-item-info">
                    <strong>
                      <span className="pdv-resumo-qtd">
                        {item.quantidade} ×{" "}
                      </span>
                      {item.nome}
                    </strong>
                    {item.variacao && (
                      <span className="pdv-muted">{item.variacao} · </span>
                    )}
                    <span className="pdv-muted pdv-unit-price">
                      R$ {reais(item.preco)} / un.
                    </span>
                  </div>
                  <div className="pdv-item-controls">
                    {destacado && (
                      <span className="pdv-added">
                        <Check aria-hidden="true" className="inline size-3" />{" "}
                        Adicionado
                      </span>
                    )}
                    <div className="pdv-quantity">
                      <button
                        type="button"
                        aria-label={`Diminuir quantidade de ${item.nome}`}
                        disabled={estado.enviando}
                        onClick={() =>
                          despachar({
                            tipo: "quantidade_alterada",
                            chave: item.chave,
                            delta: -1,
                          })
                        }
                        className="pdv-touch"
                      >
                        <Minus aria-hidden="true" className="size-5" />
                      </button>
                      <span>{item.quantidade}</span>
                      <button
                        type="button"
                        aria-label={`Aumentar quantidade de ${item.nome}`}
                        disabled={
                          estado.enviando || item.quantidade >= item.estoque
                        }
                        onClick={() =>
                          despachar({
                            tipo: "quantidade_alterada",
                            chave: item.chave,
                            delta: 1,
                          })
                        }
                        className="pdv-touch pdv-teal"
                      >
                        <Plus aria-hidden="true" className="size-5" />
                      </button>
                    </div>
                    <span className="pdv-line-total">
                      R$ {reais(item.preco * item.quantidade)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remover ${item.nome} do cupom`}
                      disabled={estado.enviando}
                      onClick={() =>
                        despachar({ tipo: "item_removido", chave: item.chave })
                      }
                      className="pdv-touch pdv-pink"
                    >
                      <Trash2 aria-hidden="true" className="size-5" />
                    </button>
                    {item.quantidade >= item.estoque && (
                      <p className="pdv-muted pdv-stock-limit w-full">
                        Limite do estoque · {item.estoque} un.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="pdv-actions">
        <Button
          type="button"
          variant="outline"
          className="pdv-secondary"
          onClick={() => despachar({ tipo: "etapa_pedida", etapa: "cliente" })}
        >
          <UserRound aria-hidden="true" className="pdv-blue size-5" />
          {estado.cliente.tipo === "sem_cliente"
            ? "Cliente (opcional)"
            : `Cliente: ${estado.cliente.nome}`}
        </Button>
        {limparCupom && temVendaParaCancelar && !confirmandoCancelamento && (
          <Button
            type="button"
            variant="outline"
            disabled={estado.enviando}
            className="pdv-secondary"
            onClick={() => setConfirmandoCancelamento(true)}
          >
            <XCircle aria-hidden="true" className="pdv-red size-5" />
            Cancelar venda
          </Button>
        )}
      </div>
      {limparCupom && temVendaParaCancelar && confirmandoCancelamento && (
        <div role="group" aria-label="Cancelar venda" className="pdv-notice">
          <p className="pdv-heading">
            <XCircle aria-hidden="true" className="pdv-icon pdv-red" />
            Cancelar venda
          </p>
          <p className="text-xl font-bold">Descartar este cupom?</p>
          <p className="pdv-muted">
            Os itens e o cliente escolhido serão limpos, e o caixa volta ao
            começo.{" "}
            {estado.erro
              ? "Se a venda chegou a ser gravada, ela está em Pedidos."
              : "Nada é registrado."}
          </p>
          <div className="pdv-annul-actions">
            <Button
              ref={voltarDoCancelamentoRef}
              type="button"
              variant="outline"
              className="pdv-secondary"
              onClick={() => setConfirmandoCancelamento(false)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              disabled={estado.enviando}
              className="pdv-danger"
              onClick={() => {
                setConfirmandoCancelamento(false);
                limparCupom();
              }}
            >
              Sim, cancelar venda
            </Button>
          </div>
        </div>
      )}
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
              <p className="pdv-heading">Nenhum produto encontrado</p>
              <p className="pdv-muted">
                Sem resultado para &quot;{termoBuscado}&quot;. Confira o nome ou
                digite menos letras.
              </p>
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
              onClick={() =>
                void buscarPagina(termoBuscado, falhaDaBusca.pagina)
              }
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
                          {ativas.length === 0 && produto.estoque <= 1 && (
                            <span className="pdv-orange">
                              {produto.estoque <= 0
                                ? " · Sem estoque"
                                : " · Só 1 em estoque"}
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
                        <Plus
                          aria-hidden="true"
                          className="pdv-icon pdv-teal"
                        />
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

      <div className="pdv-footer" aria-label="Fechamento do cupom">
        <div className="pdv-total">
          <span className="pdv-muted">Subtotal</span>
          <strong>R$ {reais(subtotal)}</strong>
        </div>
        <Button
          type="button"
          className="pdv-primary bg-admin-gold text-black"
          disabled={estado.itens.length === 0}
          onClick={() =>
            despachar({ tipo: "etapa_pedida", etapa: "fechamento" })
          }
        >
          {estado.itens.length === 0 ? (
            <LockKeyhole aria-hidden="true" className="size-5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-5" />
          )}
          Fechar venda{estado.itens.length > 0 && ` · R$ ${reais(subtotal)}`}
        </Button>
        {estado.itens.length === 0 && (
          <p className="pdv-muted">
            Indisponível: adicione pelo menos um item.
          </p>
        )}
      </div>
    </div>
  );
}
