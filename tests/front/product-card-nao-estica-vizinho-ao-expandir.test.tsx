// @vitest-environment jsdom
//
// Relato do Gabriel (12/09): "esse botão de escolha (...) tem vários bugs,
// como por exemplo um deles é quando é expandido, o card do lado fica com
// essa parte branca" -- o painel "Escolha as opções" crescia DENTRO do fluxo
// do card e a grade de 2 colunas (align-items: stretch) esticava o VIZINHO.
//
// História da correção, em duas etapas:
//   - 12/09: o painel saiu do FLUXO (virou camada `absolute` sobre a faixa
//     foto+meta) e `h-full`/`flex-1` voltaram ao wrapper raiz.
//   - 13/09 (REDESENHO, direção B): o painel MORRE. A escolha virou uma
//     FOLHA que desliza de baixo (Sheet da casa, Radix side="bottom"),
//     renderizada em PORTAL fora da árvore do card. O contrato deste arquivo
//     fica MAIS forte: agora é estruturalmente impossível a folha mudar a
//     altura do card, porque ela não é descendente dele.
//
// jsdom NÃO calcula layout (não existe `getBoundingClientRect` de verdade
// aqui) -- os testes deste arquivo provam comportamento e estrutura (classe,
// posição no DOM, o que fecha o quê), nunca a medida em pixel.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

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

/** Muitos grupos, muitos valores cada -- a armadilha que a folha tem de
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

describe("ProductCard -- a folha de opções mora em PORTAL, e abrir opções não mexe no card", () => {
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

  // A folha é PORTAL: queries por document, nunca pelo hospedeiro.
  const folha = () =>
    document.querySelector<HTMLDivElement>(
      '[data-testid="product-card-options-sheet"]',
    )!;

  const ctaDaFolha = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-add"]',
    )!;

  // O X da folha: o SheetContent da casa embute o Close do Radix SEM
  // data-testid, SEM aria-label e SEM data-slot -- o único endereço estável
  // que ele oferece hoje é o <span class="sr-only">Close</span> (em inglês;
  // defeito do sheet.tsx registrado fora de escopo no relatório).
  const xDaFolha = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Close",
    )!;

  async function abrirFolha() {
    await act(async () => {
      botaoAcao().click();
    });
  }

  it("o wrapper raiz carrega h-full e flex-1 -- pode ser esticado pela grade com segurança, porque abrir a folha não muda a altura de conteúdo", async () => {
    await renderizarCard();

    const classes = raizDoCard().className;
    expect(classes).toMatch(/(^|\s)h-full(\s|$)/);
    expect(classes).toMatch(/(^|\s)flex-1(\s|$)/);
  });

  it("abrir a folha NÃO muda as classes de altura do wrapper raiz (continua com h-full/flex-1)", async () => {
    await renderizarCard();
    await abrirFolha();

    expect(folha()).not.toBeNull();
    const classes = raizDoCard().className;
    expect(classes).toMatch(/(^|\s)h-full(\s|$)/);
    expect(classes).toMatch(/(^|\s)flex-1(\s|$)/);
  });

  it("a folha é PORTAL: existe fora do hospedeiro, e o card NÃO ganha nenhum filho novo ao abrir", async () => {
    await renderizarCard();
    const filhosFechado = raizDoCard().children.length;

    await abrirFolha();

    const folhaEl = folha();
    expect(folhaEl).not.toBeNull();
    expect(hospedeiro.contains(folhaEl)).toBe(false);
    // Nada entrou na árvore do card -- foi assim que o vizinho esticado
    // morreu de vez (o painel de 12/09 era descendente do card).
    expect(raizDoCard().children.length).toBe(filhosFechado);
  });

  it("a folha é camada FIXA fora do fluxo (fixed, colada embaixo) -- nunca um nó dentro do card", async () => {
    await renderizarCard();
    await abrirFolha();

    expect(folha().className).toMatch(/(^|\s)fixed(\s|$)/);
  });

  it("o CTA de adicionar está visível e habilitado na folha; o botão do card segue 'Escolher opções' (o literal 'Escolha acima' morreu com o painel)", async () => {
    await renderizarCard();
    await abrirFolha();

    expect(ctaDaFolha()).not.toBeNull();
    expect(ctaDaFolha().disabled).toBe(false);
    expect(botaoAcao().textContent).toContain("Escolher opções");
    expect(hospedeiro.textContent + document.body.textContent).not.toContain(
      "Escolha acima",
    );
  });

  it("clique fora da folha (overlay) FECHA a folha em vez de navegar para o produto", async () => {
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
    await abrirFolha();
    expect(folha()).not.toBeNull();

    // O overlay do Radix (fora do conteúdo) é o que recebe o toque fora --
    // o wrapper do card nem é alcançável com a folha aberta (a camada opaca
    // está por cima). Radix fecha por `pointerdown` fora do conteúdo.
    await act(async () => {
      document
        .querySelector('[data-slot="sheet-overlay"]')!
        .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });

    expect(folha()).toBeNull();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("o X da folha fecha a folha", async () => {
    await renderizarCard();
    await abrirFolha();
    expect(folha()).not.toBeNull();

    await act(async () => {
      xDaFolha().click();
    });

    expect(folha()).toBeNull();
  });

  it("Escape, com a folha aberta, fecha a folha", async () => {
    await renderizarCard();
    await abrirFolha();
    expect(folha()).not.toBeNull();

    await act(async () => {
      folha().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(folha()).toBeNull();
  });

  it("a faixa de FOTO da folha reflete a escolha (promessa de `onAddToCartWithVariants`: imagem e preço reagem) -- e o card atrás continua na sua", async () => {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={criarProduto({
            variants: [
              ...criarVariantes(),
              {
                id: "var-m-foto",
                productId: "prod-caderno",
                name: "Tamanho",
                value: "MM",
                stockIncrement: 3,
                imageUrl: "https://example.com/foto-da-escolha.png",
                active: true,
              },
            ],
          })}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={vi.fn()}
          showRating={false}
          onAddToCartWithVariants={vi.fn()}
        />,
      );
    });

    await abrirFolha();

    // Antes da escolha: a foto do produto.
    expect(folha().querySelector("img")!.getAttribute("src")).toBe(
      "https://example.com/img.png",
    );

    const chipMM = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent?.trim() === "MM")!;
    await act(async () => {
      chipMM.click();
    });

    // Depois: a foto da variante escolhida, DENTRO da folha.
    expect(folha().querySelector("img")!.getAttribute("src")).toBe(
      "https://example.com/foto-da-escolha.png",
    );
  });

  it("muitos grupos de variante: a folha rola por dentro (overflow-y-auto em filho dedicado), o card não ganha um novo bloco no fluxo", async () => {
    await renderizarCard({
      id: "prod-muitas-opcoes",
      variants: criarMuitasVariantes(),
    });
    await abrirFolha();

    const scroll = document.querySelector<HTMLDivElement>(
      '[data-testid="product-card-options-scroll"]',
    );
    expect(scroll).not.toBeNull();
    expect(scroll!.className).toMatch(/overflow-y-auto/);
    // Os três grupos estão todos representados (a rolagem é da CAIXA, não
    // filtro de conteúdo) -- isto prova só GEOMETRIA/estrutura. Não prova
    // (e não afirma) que o carrinho recebe a combinação certa de grupos --
    // isso é cobertura do arquivo de fluxo (escolhe-opcoes-na-folha).
    expect(document.body.textContent).toContain("Cor");
    expect(document.body.textContent).toContain("Tamanho");
    expect(document.body.textContent).toContain("Sabor");
  });

  it("todas as variações sem estoque: a folha mostra um estado vazio honesto, em vez de só chips riscados", async () => {
    await renderizarCard({
      id: "prod-sem-estoque",
      variants: criarVariantesTodasSemEstoque(),
    });
    await abrirFolha();

    expect(document.body.textContent).toContain("Sem opções disponíveis");
  });

  // A folha é MODAL: com ela aberta, o card inteiro (favoritar, nome,
  // botão de ação) sai da árvore de acessibilidade -- o Radix marca o que
  // está fora do diálogo com aria-hidden (o `inert` manual de 12/09 morreu
  // com o painel: quem faz isso agora é o próprio diálogo). Fechar restaura.
  it("com a folha aberta, o card fica fora da árvore de acessibilidade (aria-hidden); fechado, volta", async () => {
    await renderizarCard();

    expect(hospedeiro.getAttribute("aria-hidden")).toBeNull();

    await abrirFolha();

    expect(hospedeiro.getAttribute("aria-hidden")).toBe("true");

    await act(async () => {
      xDaFolha().click();
    });

    expect(hospedeiro.getAttribute("aria-hidden")).toBeNull();
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
    await abrirFolha();

    const botaoG = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent === "G");
    expect(botaoG).toBeDefined();
    expect(botaoG!.disabled).toBe(true);
    expect(botaoG!.className).toMatch(/line-through/);
  });
});
