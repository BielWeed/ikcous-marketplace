// @vitest-environment jsdom
//
// Relato do Gabriel (12/09): "esse botão de escolha (...) tem vários bugs,
// como por exemplo um deles é quando é expandido, o card do lado fica com
// essa parte branca" -- e, na mesma mensagem, o pedido de conserto:
// "acho melhor expandir a opção de escolha DENTRO do card (...) seria
// praticamente um card interativo".
//
// A tentativa anterior (lote A, 12/09) atacou o SINTOMA tirando `h-full
// flex-1` do wrapper raiz -- e isso tinha uma regressão MEDIDA no navegador:
// sem `h-full`, o rodapé de TODOS os cards desalinhava na grade de 2
// colunas (28-45px de diferença entre linhas do carrossel/vitrine).
//
// A correção desta tarefa ataca a CAUSA: o painel "Escolha as opções" sai do
// FLUXO do card (vira uma camada `absolute` sobreposta à faixa foto+meta,
// ver ProductCard.tsx) -- abrir o painel deixa de mudar a altura de
// conteúdo do card. Sendo a altura constante, `h-full`/`flex-1` VOLTAM ao
// wrapper raiz: a grade pode esticar o card com segurança, porque não existe
// mais evento nenhum (abrir o painel) que muda essa altura no meio da vida
// do card. É por isso que os dois primeiros casos abaixo agora EXIGEM
// `h-full`/`flex-1` -- o INVERSO do que este arquivo verificava antes desta
// tarefa.
//
// jsdom NÃO calcula layout (não existe `getBoundingClientRect` de verdade
// aqui) -- os testes deste arquivo prova comportamento e estrutura (classe,
// posição no DOM, o que fecha o quê), nunca a medida em pixel. A medida real
// (altura do card fechado == aberto, em pixel, na grade e no carrossel) foi
// feita no navegador e está colada no relatório da tarefa, não neste arquivo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// Periferia: framer-motion vira passthrough burro (mesmo dublê de
// barra-de-rota-fica-montada-para-o-exit.test.tsx e
// produto-a-produto-nao-carrega-lixo-do-anterior.test.tsx) -- a suíte deste
// repositório não testa a ANIMAÇÃO do `AnimatePresence`, testa o que ela
// carrega. Sem o dublê, o `exit` real adia o desmonte do painel além do
// `act()` síncrono e "fechou" (DOM) e "fechado" (estado) ficariam
// dessincronizados neste arquivo, que testa ESTADO/estrutura, não a
// transição visual (essa é prova de navegador, colada no relatório da
// tarefa).
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const PROPS_DE_ANIMACAO = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "custom",
    "layout",
    "layoutId",
    "whileTap",
    "whileHover",
    "whileInView",
    "whileDrag",
    "drag",
    "dragConstraints",
    "dragElastic",
    "onDragEnd",
    "onAnimationComplete",
    "onAnimationStart",
  ]);
  const criar = (tag: string) =>
    function DubleDeMotion({ children, ...resto }: Record<string, unknown>) {
      const limpo = Object.fromEntries(
        Object.entries(resto).filter(
          ([chave]) => !PROPS_DE_ANIMACAO.has(chave),
        ),
      );
      return React.createElement(tag, limpo, children as React.ReactNode);
    };
  const cache = new Map<string, unknown>();
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_alvo, tag) => {
      if (typeof tag !== "string") return undefined;
      if (!cache.has(tag)) cache.set(tag, criar(tag));
      return cache.get(tag);
    },
  });
  function AnimatePresence({ children }: { readonly children?: unknown }) {
    return React.createElement(
      React.Fragment,
      null,
      children as React.ReactNode,
    );
  }
  return { motion, AnimatePresence, useReducedMotion: () => true };
});

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function criarVariantes(): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: true,
    },
    {
      id: "var-m",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "M",
      stockIncrement: 3,
      priceOverride: 65,
      active: true,
    },
  ];
}

/** Muitos grupos, muitos valores cada -- a armadilha que o painel tem de
 * resolver por ROLAGEM interna, sem o card crescer. */
function criarMuitasVariantes(): ProductVariant[] {
  const cores = ["Azul", "Vermelho", "Verde", "Preto", "Branco", "Rosa"];
  const tamanhos = ["PP", "P", "M", "G", "GG", "XG"];
  const sabores = ["Morango", "Chocolate", "Baunilha", "Limão"];
  const variantes: ProductVariant[] = [];
  cores.forEach((valor, i) =>
    variantes.push({
      id: `cor-${i}`,
      productId: "prod-muitas-opcoes",
      name: "Cor",
      value: valor,
      stockIncrement: 5,
      active: true,
    }),
  );
  tamanhos.forEach((valor, i) =>
    variantes.push({
      id: `tam-${i}`,
      productId: "prod-muitas-opcoes",
      name: "Tamanho",
      value: valor,
      stockIncrement: 5,
      active: true,
    }),
  );
  sabores.forEach((valor, i) =>
    variantes.push({
      id: `sab-${i}`,
      productId: "prod-muitas-opcoes",
      name: "Sabor",
      value: valor,
      stockIncrement: 5,
      active: true,
    }),
  );
  return variantes;
}

function criarVariantesTodasSemEstoque(): ProductVariant[] {
  return [
    {
      id: "var-p-zero",
      productId: "prod-sem-estoque",
      name: "Tamanho",
      value: "P",
      stockIncrement: 0,
      active: true,
    },
    {
      id: "var-m-zero",
      productId: "prod-sem-estoque",
      name: "Tamanho",
      value: "M",
      stockIncrement: 0,
      active: true,
    },
  ];
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-caderno",
    name: "Caderno Bom",
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "papelaria",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 12,
    ...overrides,
  };
}

describe("ProductCard -- painel de opções não empurra o card, e o card volta a poder ser esticado pela grade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarCard(overrides: Partial<Product> = {}) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={criarProduto({ variants: criarVariantes(), ...overrides })}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={vi.fn()}
          showRating={false}
          onAddToCartWithVariants={vi.fn()}
        />,
      );
    });
  }

  const raizDoCard = () => hospedeiro.firstElementChild as HTMLDivElement;

  const botaoAcao = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;

  const painel = () =>
    hospedeiro.querySelector<HTMLDivElement>(
      '[data-testid="product-card-options-panel"]',
    );

  const fecharBtn = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Fechar opções"]',
    )!;

  async function abrirPainel() {
    await act(async () => {
      botaoAcao().click();
    });
  }

  it("o wrapper raiz carrega h-full e flex-1 -- pode ser esticado pela grade com segurança, porque abrir o painel não muda a altura de conteúdo", async () => {
    await renderizarCard();

    const classes = raizDoCard().className;
    expect(classes).toMatch(/(^|\s)h-full(\s|$)/);
    expect(classes).toMatch(/(^|\s)flex-1(\s|$)/);
  });

  it("expandir o painel de opções NÃO muda as classes de altura do wrapper raiz (continua com h-full/flex-1)", async () => {
    await renderizarCard();
    await abrirPainel();

    expect(hospedeiro.textContent).toContain("Escolha as opções");
    const classes = raizDoCard().className;
    expect(classes).toMatch(/(^|\s)h-full(\s|$)/);
    expect(classes).toMatch(/(^|\s)flex-1(\s|$)/);
  });

  it("o painel é uma camada FORA do fluxo (absolute) -- não um filho que cresce no meio do conteúdo", async () => {
    await renderizarCard();
    await abrirPainel();

    const painelEl = painel();
    expect(painelEl).not.toBeNull();
    expect(painelEl!.className).toMatch(/(^|\s)absolute(\s|$)/);
  });

  it("o painel aparece no DOM logo depois da foto -- antes do preço e do botão de ação (ordem de leitura/Tab bate com a ordem visual)", async () => {
    await renderizarCard();
    await abrirPainel();

    const painelEl = painel()!;
    const botao = botaoAcao();
    const posicao = painelEl.compareDocumentPosition(botao);
    // DOCUMENT_POSITION_FOLLOWING (4): o botão vem DEPOIS do painel no DOM.
    expect(posicao & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("o botão de ação continua visível e clicável com o painel aberto (senão ninguém consegue adicionar ao carrinho)", async () => {
    await renderizarCard();
    await abrirPainel();

    const botao = botaoAcao();
    expect(botao).not.toBeNull();
    expect(botao.disabled).toBe(false);
    expect(hospedeiro.textContent).toContain("Escolha acima");
  });

  it("clicar no botão do produto FORA do painel (área de fundo do card) FECHA o painel em vez de navegar", async () => {
    const onClick = vi.fn();
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={criarProduto({ variants: criarVariantes() })}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={onClick}
          showRating={false}
          onAddToCartWithVariants={vi.fn()}
        />,
      );
    });
    await abrirPainel();
    expect(painel()).not.toBeNull();

    await act(async () => {
      raizDoCard().click();
    });

    expect(painel()).toBeNull();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("Escape, com o foco dentro do painel, fecha o painel", async () => {
    await renderizarCard();
    await abrirPainel();
    expect(painel()).not.toBeNull();

    await act(async () => {
      painel()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(painel()).toBeNull();
  });

  it("a miniatura da imagem atual continua visível dentro do painel (a promessa de `onAddToCartWithVariants` -- preço e imagem reagem à escolha -- não desaparece atrás do painel)", async () => {
    await renderizarCard();
    await abrirPainel();

    const painelEl = painel()!;
    const img = painelEl.querySelector("img");
    expect(img).not.toBeNull();
  });

  it("muitos grupos de variante: o painel rola por dentro (overflow-y-auto), o card não ganha um novo bloco no fluxo", async () => {
    await renderizarCard({
      id: "prod-muitas-opcoes",
      variants: criarMuitasVariantes(),
    });
    await abrirPainel();

    const scroll = hospedeiro.querySelector<HTMLDivElement>(
      '[data-testid="product-card-options-scroll"]',
    );
    expect(scroll).not.toBeNull();
    expect(scroll!.className).toMatch(/overflow-y-auto/);
    // Os três grupos estão todos representados (a rolagem é da CAIXA, não
    // filtro de conteúdo) -- isto prova só GEOMETRIA/estrutura. Não prova
    // (e não afirma) que o carrinho recebe a combinação certa de grupos --
    // isso é ressalva separada, registrada no relatório da tarefa.
    expect(hospedeiro.textContent).toContain("Cor");
    expect(hospedeiro.textContent).toContain("Tamanho");
    expect(hospedeiro.textContent).toContain("Sabor");
  });

  it("todas as variações sem estoque: o painel mostra um estado vazio honesto, em vez de só chips riscados", async () => {
    await renderizarCard({
      id: "prod-sem-estoque",
      variants: criarVariantesTodasSemEstoque(),
    });
    await abrirPainel();

    expect(hospedeiro.textContent).toContain("Sem opções disponíveis");
  });

  // Bloqueador da rodada 1 de revisão (12/09): com o painel aberto, o botão
  // de favoritar e o <button> do nome ficavam cobertos pela camada opaca do
  // painel mas continuavam focáveis e na árvore de acessibilidade -- um
  // Shift+Tab a partir do X do painel chegava neles INVISÍVEIS, e Enter
  // navegava para a página do produto (descartando a escolha) ou favoritava
  // sem feedback visual algum. `inert` tira os dois blocos cobertos (foto e
  // meta) da árvore de foco/leitor de tela enquanto o painel está aberto --
  // nunca o wrapper `relative` do painel em si, que continua totalmente
  // interativo (X e chips).
  it("com o painel aberto, a faixa de foto e a de metadados (favoritar + nome do produto) ficam `inert` -- fechado, nenhuma das duas é inerte", async () => {
    await renderizarCard();

    const faixaFoto = raizDoCard().children[0]!.children[0] as HTMLElement;
    const faixaMeta = raizDoCard().children[0]!.children[1] as HTMLElement;
    const botaoFavoritar = faixaFoto.querySelector("button")!;
    const botaoNome = faixaMeta.querySelector("button")!;

    // Fechado: nada inerte, os dois controles continuam alcançáveis.
    expect(faixaFoto.hasAttribute("inert")).toBe(false);
    expect(faixaMeta.hasAttribute("inert")).toBe(false);
    expect(botaoFavoritar).not.toBeNull();
    expect(botaoNome).not.toBeNull();

    await abrirPainel();

    // Aberto: as duas faixas cobertas pela camada opaca do painel ficam
    // inertes -- e os controles que a revisão apontou vivem DENTRO delas.
    expect(faixaFoto.hasAttribute("inert")).toBe(true);
    expect(faixaMeta.hasAttribute("inert")).toBe(true);
    expect(faixaFoto.contains(botaoFavoritar)).toBe(true);
    expect(faixaMeta.contains(botaoNome)).toBe(true);

    // O wrapper do próprio painel (irmão das duas faixas acima) nunca fica
    // inerte -- inert ali mataria o X e os chips.
    const wrapperRelative = raizDoCard().children[0] as HTMLElement;
    expect(wrapperRelative.hasAttribute("inert")).toBe(false);

    await act(async () => {
      fecharBtn().click();
    });

    // Fechar devolve as duas faixas à árvore de foco.
    expect(faixaFoto.hasAttribute("inert")).toBe(false);
    expect(faixaMeta.hasAttribute("inert")).toBe(false);
  });

  it("opção sem estoque continua riscada e desabilitada", async () => {
    await renderizarCard({
      variants: [
        ...criarVariantes(),
        {
          id: "var-g-zero",
          productId: "prod-caderno",
          name: "Tamanho",
          value: "G",
          stockIncrement: 0,
          active: true,
        },
      ],
    });
    await abrirPainel();

    const botaoG = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent === "G");
    expect(botaoG).toBeDefined();
    expect(botaoG!.disabled).toBe(true);
    expect(botaoG!.className).toMatch(/line-through/);
  });
});
