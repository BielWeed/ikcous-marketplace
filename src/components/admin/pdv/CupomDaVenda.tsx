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
  Minus,
  PackagePlus,
  PackageX,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";

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

export interface PropsDoCupomDaVenda {
  readonly estado: EstadoDaVenda;
  readonly despachar: (acao: AcaoDaVenda) => void;
  readonly subtotal: number;
  readonly buscarProdutos: (
    termo: string,
  ) => Promise<readonly ProdutoEncontradoNaBusca[]>;
  readonly onNavigate: (view: View) => void;
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
  feedback: feedbackProp,
  agora = () => Date.now(),
}: PropsDoCupomDaVenda): ReactElement {
  const [termoDeBusca, setTermoDeBusca] = useState("");
  const [resultadosDaBusca, setResultadosDaBusca] = useState<
    readonly ProdutoEncontradoNaBusca[]
  >([]);
  const [buscando, setBuscando] = useState(false);

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

  async function aoDigitarBusca(valor: string): Promise<void> {
    setTermoDeBusca(valor);
    const termoLimpo = valor.trim();
    if (termoLimpo.length < 2) {
      setResultadosDaBusca([]);
      return;
    }
    const rodada = ++rodadaRef.current;
    setBuscando(true);
    try {
      const resultados = await buscarProdutos(termoLimpo);
      if (rodada !== rodadaRef.current) return;
      setResultadosDaBusca(resultados);
    } catch (erro) {
      if (rodada !== rodadaRef.current) return;
      console.error("Erro ao buscar produto no balcão:", erro);
      setResultadosDaBusca([]);
    } finally {
      if (rodada === rodadaRef.current) setBuscando(false);
    }
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

  return (
    <div className="flex flex-col gap-4">
      {/* A folha de "qual combinação?" — nasce da máquina (C3.1), não é uma
          seção separada: o produto de MODELO com variações abre isto por
          cima do cupom. */}
      {escolha && (
        <div className="flex flex-col gap-3 rounded-2xl border border-admin-gold/40 bg-zinc-950 p-4 text-white">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">
              Qual combinação de "{escolha.produtoNome}"?
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => despachar({ tipo: "variacao_cancelada" })}
            >
              Cancelar
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {escolha.opcoes.map((opcao) => (
              <button
                key={opcao.variant_id}
                type="button"
                disabled={opcao.estoque <= 0}
                onClick={() =>
                  despachar({
                    tipo: "variacao_escolhida",
                    opcao,
                    em: agora(),
                  })
                }
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>
                  {opcao.nome} {opcao.valor}
                </span>
                <span className="text-xs text-zinc-400">
                  {opcao.estoque <= 0
                    ? "Esgotado"
                    : `R$ ${reais(opcao.preco)} · ${opcao.estoque} em estoque`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Os avisos que o leitor não conhece (divergências da tarefa). */}
      {estado.aviso?.tipo === "nao_cadastrado" && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-2xl border border-amber-700/50 bg-amber-950/30 p-4 text-sm text-amber-200"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" />
            Código {estado.aviso.codigo} não está cadastrado.
          </p>
          <p className="text-xs text-amber-200/80">
            {/* Como não há como passar o código pela URL sem entrar nas
                quatro listas de `?id=` (o PDV não abre um registro
                existente — decisão registrada nas divergências da tarefa),
                o atalho só navega: o preenchimento do código no formulário
                é assunto de C5. */}
            O atalho abaixo só abre o cadastro — digitar o código lá é manual
            por enquanto.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="bg-admin-gold text-black hover:bg-admin-gold/90"
              onClick={() => onNavigate("admin-product-form")}
            >
              Cadastrar produto
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => despachar({ tipo: "aviso_limpo" })}
            >
              Fechar
            </Button>
          </div>
        </div>
      )}
      {estado.aviso?.tipo === "inativo" && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-2xl border border-amber-700/50 bg-amber-950/30 p-4 text-sm text-amber-200"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" />"{estado.aviso.nome}" está
            inativo no catálogo.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => despachar({ tipo: "aviso_limpo" })}
          >
            Fechar
          </Button>
        </div>
      )}
      {estado.aviso?.tipo === "esgotado" && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-2xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200"
        >
          <p className="flex items-center gap-2 font-semibold">
            <PackageX className="size-4" />"{estado.aviso.nome}" está esgotado.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => despachar({ tipo: "aviso_limpo" })}
          >
            Fechar
          </Button>
        </div>
      )}
      {estado.aviso?.tipo === "ignorado_repetido" && (
        <p className="text-xs font-semibold text-zinc-500">
          Já bipei o código {estado.aviso.codigo} há pouco — bipe de novo se for
          mesmo outra unidade.
        </p>
      )}

      {/* A lista do cupom. */}
      <div className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
        {estado.itens.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            Bipe o primeiro produto
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {estado.itens.map((item) => {
              const destacado = estado.ultimaEntrada?.chave === item.chave;
              return (
                <li
                  key={item.chave}
                  data-destacado={destacado ? "true" : "false"}
                  className={`flex items-center gap-3 rounded-xl border p-2 transition-colors ${
                    destacado
                      ? "border-admin-gold bg-admin-gold/10"
                      : "border-zinc-800 bg-zinc-900"
                  }`}
                >
                  {item.imagem ? (
                    <img
                      src={item.imagem}
                      alt={item.nome}
                      className="size-12 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-600">
                      <PackagePlus className="size-5" />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-white">
                      {item.nome}
                    </span>
                    {item.variacao && (
                      <span className="text-xs text-zinc-400">
                        {item.variacao}
                      </span>
                    )}
                    <span className="text-xs text-zinc-500">
                      R$ {reais(item.preco)} cada
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={`Diminuir quantidade de ${item.nome}`}
                      onClick={() =>
                        despachar({
                          tipo: "quantidade_alterada",
                          chave: item.chave,
                          delta: -1,
                        })
                      }
                      className="flex size-7 items-center justify-center rounded-full border border-zinc-700 text-zinc-300"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-bold text-white">
                      {item.quantidade}
                    </span>
                    <button
                      type="button"
                      aria-label={`Aumentar quantidade de ${item.nome}`}
                      disabled={item.quantidade >= item.estoque}
                      onClick={() =>
                        despachar({
                          tipo: "quantidade_alterada",
                          chave: item.chave,
                          delta: 1,
                        })
                      }
                      className="flex size-7 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 disabled:opacity-30"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <div className="flex w-20 shrink-0 flex-col items-end">
                    <span className="text-sm font-bold text-white">
                      R$ {reais(item.preco * item.quantidade)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remover ${item.nome} do cupom`}
                      onClick={() =>
                        despachar({ tipo: "item_removido", chave: item.chave })
                      }
                      className="text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between border-t border-zinc-800 pt-3 text-sm font-bold text-white">
          <span>Subtotal</span>
          <span>R$ {reais(subtotal)}</span>
        </div>
      </div>

      {/* Busca manual por nome/SKU — produto sem código de barras. */}
      <div className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
        <label
          htmlFor="busca-manual-de-produto"
          className="flex items-center gap-2 text-xs font-semibold text-zinc-400"
        >
          <Search className="size-3.5" />
          Buscar produto por nome ou SKU (sem código de barras)
        </label>
        <LocalBufferedInput
          id="busca-manual-de-produto"
          value={termoDeBusca}
          onFlush={aoDigitarBusca}
          delay={300}
          placeholder="Ex.: camiseta branca P"
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
        />
        {buscando && <p className="text-xs text-zinc-500">Buscando…</p>}
        {resultadosDaBusca.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {resultadosDaBusca.map((produto) => {
              const ativas = produto.product_variants.filter((v) => v.active);
              const expandido = produtoExpandidoId === produto.id;
              return (
                <li key={produto.id} className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => aoClicarLinhaDeProduto(produto)}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm text-white"
                  >
                    <span className="truncate">{produto.nome}</span>
                    <span className="text-xs text-zinc-400">
                      {ativas.length > 0
                        ? `${ativas.length} variação(ões)`
                        : `R$ ${reais(produto.preco_venda)}`}
                    </span>
                  </button>
                  {expandido && ativas.length > 0 && (
                    <div className="ml-3 flex flex-col gap-1 border-l border-zinc-800 pl-3">
                      {ativas.map((variante) => (
                        <button
                          key={variante.id}
                          type="button"
                          disabled={variante.stock_increment <= 0}
                          onClick={() =>
                            aoEscolherVarianteDaBusca(produto, variante)
                          }
                          className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-left text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span>
                            {variante.name} {variante.value}
                          </span>
                          <span>
                            {variante.stock_increment <= 0
                              ? "Esgotado"
                              : `R$ ${reais(variante.price_override ?? produto.preco_venda)}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Navegação para as próximas camadas. As ações do PDV usam cor
          PRÓPRIA do admin (a mesma do botão Vender) e nunca o tema da loja:
          o Button padrão pinta com `bg-primary` — a cor do TEMA — e com o
          tema escuro do molde virava preto sobre preto, botão invisível
          (relato do dono em teste real no celular, 19/09). */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => despachar({ tipo: "etapa_pedida", etapa: "cliente" })}
        >
          {estado.cliente.tipo === "sem_cliente"
            ? "Cliente (opcional)"
            : `Cliente: ${estado.cliente.nome}`}
        </Button>
        <Button
          type="button"
          className="flex-1 bg-admin-gold text-black hover:bg-admin-gold/90"
          disabled={estado.itens.length === 0}
          onClick={() =>
            despachar({ tipo: "etapa_pedida", etapa: "fechamento" })
          }
        >
          Fechar venda
        </Button>
      </div>
    </div>
  );
}
