// @vitest-environment jsdom
//
// B3 do laudo de acessibilidade da loja (20260905-laudo-acessibilidade-loja.md,
// linha 44), aprovado pelo dono em 08/09: hoje o card inteiro é um
// `role="button"` gigante que CONTÉM outros `<button>` (favoritar,
// comprar/escolher opções) -- ARIA inválido, e o leitor de tela lê o card
// inteiro como nome do botão.
//
// O CONTRATO NOVO (desenho A do brief da hub, sem tocar em classe/visual):
//   - O wrapper (div) deixa de ter role="button"/tabIndex/onKeyDown -- ele
//     continua abrindo o produto por mouse/toque (onClick), sem ser um
//     elemento de teclado.
//   - O nome do produto vira um <button type="button"> -- único alvo
//     focável -- com nome acessível = nome do produto. Ele já herda a
//     ativação por Enter/Espaço de graça, por ser um botão nativo.
//   - Os botões internos (favoritar, ação de carrinho, chips de variação)
//     continuam focáveis e independentes, e nenhum fica aninhado dentro de
//     outro botão.
//   - Para dedo e mouse: NADA muda -- tocar em qualquer ponto do card
//     continua abrindo o produto.
//
// View transition (contrato específico do ProductCard, com
// `isViewTransitionSupported` calculado no import do módulo) tem arquivo
// PRÓPRIO: card-do-produto-view-transition-com-alvo-novo.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function stubGlobaisDeLayout() {
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
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-card-a11y",
    name: "Camiseta Azul Marinho",
    description: "Descrição de teste",
    price: 100,
    images: ["https://example.com/img.png"],
    category: "geral",
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

/** Nenhum <button>/[role=button] pode conter outro dentro (ARIA inválido). */
function afirmarSemBotaoAninhado(raizEl: HTMLElement) {
  const botoes = Array.from(
    raizEl.querySelectorAll<HTMLElement>('button, [role="button"]'),
  );
  expect(
    botoes.length,
    "esperava ao menos um botão renderizado",
  ).toBeGreaterThan(0);
  for (const botao of botoes) {
    const aninhado = botao.querySelector('button, [role="button"]');
    const rotulo = botao.getAttribute("data-testid")
      ? ` data-testid="${botao.getAttribute("data-testid")}"`
      : botao.getAttribute("aria-label")
        ? ` aria-label="${botao.getAttribute("aria-label")}"`
        : ` texto="${botao.textContent?.trim().slice(0, 30)}"`;
    expect(
      aninhado,
      `botão aninhado dentro de <${botao.tagName.toLowerCase()}${rotulo}>`,
    ).toBeNull();
  }
}

/** Acha, entre os botões renderizados, o único cujo texto exato é o nome do produto. */
function botaoDoNome(raizEl: HTMLElement, nome: string): HTMLButtonElement {
  const candidatos = Array.from(
    raizEl.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((b) => b.textContent?.trim() === nome);
  expect(
    candidatos,
    `esperava exatamente 1 <button> com o texto "${nome}", achei ${candidatos.length}`,
  ).toHaveLength(1);
  return candidatos[0];
}

describe("ProductCard — o card não é um botão com botões dentro (B3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarCard(
    props: {
      onClick?: (id: string) => void;
      onToggleFavorite?: (p: Product, e: React.MouseEvent) => void;
      onAddToCartWithVariants?: (
        p: Product,
        variantId: string | undefined,
        variantNames: string,
      ) => void;
      produto?: Product;
    } = {},
  ) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    const produto = props.produto ?? criarProduto();
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={props.onToggleFavorite ?? vi.fn()}
          onClick={props.onClick ?? vi.fn()}
          onAddToCartWithVariants={props.onAddToCartWithVariants}
          showRating={false}
          // `priority` evita o `IntersectionObserver` do LazyImage (ausente
          // no jsdom sem stub) -- mesmo padrão de product-card-gate-avaliacoes.
          priority
        />,
      );
    });
    return produto;
  }

  it("estrutura: nenhum botão contém outro botão (mesmo com o painel de opções aberto)", async () => {
    const produto = await renderizarCard({
      // Precisa da prop nova para o botão de ação EXPANDIR o painel no card
      // em vez de navegar (mesmo contrato de product-card-escolhe-opcoes-no-card).
      onAddToCartWithVariants: vi.fn(),
      produto: criarProduto({
        variants: [
          {
            id: "var-p",
            productId: "prod-card-a11y",
            name: "Tamanho",
            value: "P",
            stockIncrement: 5,
            active: true,
          },
        ],
      }),
    });
    afirmarSemBotaoAninhado(hospedeiro);

    // Abre o painel de opções -- é onde os chips de variação nascem.
    const acao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;
    await act(async () => {
      acao.click();
    });
    expect(hospedeiro.textContent).toContain("P");
    afirmarSemBotaoAninhado(hospedeiro);
    void produto;
  });

  it('o alvo do produto é o nome, é um <button type="button"> (focável, ativa com Enter/Espaço de graça)', async () => {
    const onClick = vi.fn();
    const produto = await renderizarCard({ onClick });
    const botao = botaoDoNome(hospedeiro, produto.name);

    expect(botao.type).toBe("button");
    expect(botao.tabIndex).not.toBe(-1);

    await act(async () => {
      botao.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(produto.id);
  });

  it("clicar no alvo do nome NÃO abre o produto duas vezes (não deixa borbulhar pro wrapper)", async () => {
    const onClick = vi.fn();
    const produto = await renderizarCard({ onClick });
    const botao = botaoDoNome(hospedeiro, produto.name);

    await act(async () => {
      botao.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("clicar numa área vazia do card (o wrapper) ainda abre o produto, uma vez", async () => {
    const onClick = vi.fn();
    const produto = await renderizarCard({ onClick });

    // "Área vazia": o próprio wrapper, fora do alvo do nome e dos botões
    // internos -- ex.: o contêiner da imagem.
    const areaVazia = hospedeiro.querySelector<HTMLElement>(
      ".aspect-\\[4\\/5\\]",
    )!;
    await act(async () => {
      areaVazia.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(produto.id);
  });

  it("os botões internos continuam focáveis: favoritar chama onToggleFavorite e NÃO abre o produto", async () => {
    const onClick = vi.fn();
    const onToggleFavorite = vi.fn();
    await renderizarCard({ onClick, onToggleFavorite });

    const favoritar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Adicionar aos favoritos"]',
    )!;
    expect(favoritar.tabIndex).not.toBe(-1);

    await act(async () => {
      favoritar.click();
    });

    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("o botão de ação (carrinho) continua independente do alvo do produto", async () => {
    const onClick = vi.fn();
    await renderizarCard({ onClick });

    const acao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;
    await act(async () => {
      acao.click();
    });

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("PremiumOffers/HeroOfferCard — o card não é um botão com botões dentro (B3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    stubGlobaisDeLayout();
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

  async function renderizarOferta(
    props: {
      onProductClick?: (id: string) => void;
      onToggleFavorite?: (p: Product) => void;
      onAddToCart?: (p: Product) => void;
      onQuickBuy?: (p: Product) => void;
      produto?: Product;
    } = {},
  ) {
    vi.doMock("@/contexts/StoreContext", () => ({
      useStore: () => ({ config: { enableReviews: true, freeShippingMin: 0 } }),
    }));
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    const produto =
      props.produto ??
      criarProduto({
        id: "prod-oferta-a11y",
        name: "Tênis Corrida Pro",
        originalPrice: 200,
        price: 150,
      });
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produto]}
          favorites={[]}
          onToggleFavorite={props.onToggleFavorite ?? vi.fn()}
          onProductClick={props.onProductClick ?? vi.fn()}
          onAddToCart={props.onAddToCart ?? vi.fn()}
          onQuickBuy={props.onQuickBuy ?? vi.fn()}
        />,
      );
    });
    return produto;
  }

  it("estrutura: nenhum botão contém outro botão", async () => {
    await renderizarOferta();
    afirmarSemBotaoAninhado(hospedeiro);
  });

  it('o alvo do produto é o nome, é um <button type="button"> e abre o produto por clique/ativação', async () => {
    const onProductClick = vi.fn();
    const produto = await renderizarOferta({ onProductClick });
    const botao = botaoDoNome(hospedeiro, produto.name);

    expect(botao.type).toBe("button");
    expect(botao.tabIndex).not.toBe(-1);

    await act(async () => {
      botao.click();
    });

    expect(onProductClick).toHaveBeenCalledTimes(1);
    expect(onProductClick).toHaveBeenCalledWith(produto.id);
  });

  it("clicar no alvo do nome NÃO abre o produto duas vezes", async () => {
    const onProductClick = vi.fn();
    await renderizarOferta({ onProductClick });
    const botao = botaoDoNome(
      hospedeiro,
      criarProduto({ name: "Tênis Corrida Pro" }).name,
    );

    await act(async () => {
      botao.click();
    });

    expect(onProductClick).toHaveBeenCalledTimes(1);
  });

  it("clicar numa área vazia do card (o wrapper) ainda abre o produto, uma vez", async () => {
    const onProductClick = vi.fn();
    const produto = await renderizarOferta({ onProductClick });

    const areaVazia = hospedeiro.querySelector<HTMLElement>(
      ".aspect-\\[4\\/3\\]",
    )!;
    await act(async () => {
      areaVazia.click();
    });

    expect(onProductClick).toHaveBeenCalledTimes(1);
    expect(onProductClick).toHaveBeenCalledWith(produto.id);
  });

  it("favoritar chama onToggleFavorite e NÃO abre o produto", async () => {
    const onProductClick = vi.fn();
    const onToggleFavorite = vi.fn();
    await renderizarOferta({ onProductClick, onToggleFavorite });

    const favoritar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Adicionar aos favoritos"]',
    )!;
    await act(async () => {
      favoritar.click();
    });

    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it("sem variação ativa: 'Adicionar' chama onAddToCart e 'Comprar' chama onQuickBuy -- não abre o produto", async () => {
    const onProductClick = vi.fn();
    const onAddToCart = vi.fn();
    const onQuickBuy = vi.fn();
    const produto = await renderizarOferta({
      onProductClick,
      onAddToCart,
      onQuickBuy,
    });

    const botoes = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    );
    const adicionar = botoes.find((b) => b.textContent?.includes("Adicionar"))!;
    const comprar = botoes.find((b) => b.textContent?.trim() === "Comprar")!;

    await act(async () => {
      adicionar.click();
    });
    expect(onAddToCart).toHaveBeenCalledWith(produto);
    expect(onProductClick).not.toHaveBeenCalled();

    await act(async () => {
      comprar.click();
    });
    expect(onQuickBuy).toHaveBeenCalledWith(produto);
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it("com variação ativa: os dois CTAs abrem o produto (regra que já existia, não muda)", async () => {
    const onProductClick = vi.fn();
    const onAddToCart = vi.fn();
    const onQuickBuy = vi.fn();
    const produto = await renderizarOferta({
      onProductClick,
      onAddToCart,
      onQuickBuy,
      produto: criarProduto({
        id: "prod-oferta-variante",
        name: "Tênis Corrida Pro",
        variants: [
          {
            id: "var-p",
            productId: "prod-oferta-variante",
            name: "Tamanho",
            value: "P",
            stockIncrement: 5,
            active: true,
          },
        ],
      }),
    });

    const botoes = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    );
    const escolherOpcoes = botoes.filter((b) =>
      b.textContent?.includes("Escolher opções"),
    );
    expect(escolherOpcoes).toHaveLength(2);

    await act(async () => {
      escolherOpcoes[0].click();
    });
    expect(onProductClick).toHaveBeenCalledWith(produto.id);
    expect(onAddToCart).not.toHaveBeenCalled();

    await act(async () => {
      escolherOpcoes[1].click();
    });
    expect(onProductClick).toHaveBeenCalledTimes(2);
    expect(onQuickBuy).not.toHaveBeenCalled();
  });
});
