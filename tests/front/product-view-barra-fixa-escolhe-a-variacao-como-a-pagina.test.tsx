// @vitest-environment jsdom
//
// A barra de compra FIXA de baixo (aparece ao rolar, no celular) tem o
// próprio seletor de variações (hoje, a folha de opções). Achado do revisor no
// Chromium a 375px: escolher a Vermelha (10), subir para 5, rolar até a barra
// e trocar para a Azul (2) PELA BARRA deixava a quantidade em 5, sem o aviso
// "Só restam 2", mandava onAddToCart(5, "v-azul") e a galeria não andava até
// a foto da Azul. A escolha pela barra tem de ser a MESMA dos botões da
// página, inclusive desmarcando para permitir trocar combinações incompatíveis.
//
// O hospedeiro é um <main> real: o efeito que liga `scrolled` (a barra só
// existe com `scrolled=true`) só se inscreve com `document.querySelector
// ("main")` -- mesmo recurso de product-view-barra-fixa-preco-promocional.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const avisar = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    warning: (...args: unknown[]) => avisar(...args),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false },
    isLoaded: true,
  }),
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function cor(
  id: string,
  valor: string,
  estoque: number,
  imageUrl?: string,
): ProductVariant {
  return {
    id,
    productId: "p-blusa",
    name: "Cor",
    value: valor,
    stockIncrement: estoque,
    active: true,
    imageUrl,
  };
}

function blusa(variants: ProductVariant[]): Product {
  return {
    id: "p-blusa",
    name: "Blusa",
    description: "Descrição de teste",
    price: 80,
    images: ["/f1.png", "/f2.png"],
    category: "roupas",
    stock: 12,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    variants,
  };
}

describe("ProductView — a barra fixa escolhe a variação como a página", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;
  let adicionarAoCarrinho: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  beforeEach(() => {
    avisar.mockClear();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    adicionarAoCarrinho = vi.fn();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  async function montar(produto: Product) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={adicionarAoCarrinho}
          onBack={() => {}}
        />,
      );
    });
  }

  async function tocar(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      (el as HTMLElement).click();
    });
  }

  const barra = () =>
    document.querySelector<HTMLElement>(".bottom-docked-navigation");

  /** Botão de variação DA PÁGINA, fora do portal da folha. */
  function opcaoDaPagina(valor: string) {
    const span = [...hospedeiro.querySelectorAll("button span")].find(
      (el) => el.textContent === valor,
    );
    return span?.closest("button") as HTMLButtonElement;
  }

  /** Abre o menu da barra (o botão que mostra a cor escolhida) e devolve o item. */
  async function itemDoMenuDaBarra(escolhidaAgora: string, valor: string) {
    const gatilho = [...(barra()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent?.trim() === `${escolhidaAgora} ›`,
    );
    await tocar(gatilho);
    // O item do menu vem DEPOIS do gatilho no DOM (que também tem um <span>
    // com o mesmo texto quando a cor aberta é a escolhida): o último vale.
    const candidatos = [
      ...document.querySelectorAll('[role="dialog"] button span'),
    ];
    const item = candidatos.filter((el) => el.textContent === valor).at(-1);
    return item?.closest("button") as HTMLButtonElement;
  }

  async function comprarPelaBarra() {
    const botoes = barra()?.querySelectorAll("button") ?? [];
    await tocar(botoes[botoes.length - 1]);
  }

  it("a barra existe com a página rolada (o teste está de fato no caminho da barra)", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );
    expect(barra()).not.toBeNull();
  });

  it("5 do vermelho (10), trocar para o azul (2) PELA BARRA: vira 2, avisa e manda 2", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );

    await tocar(opcaoDaPagina("Vermelha"));
    const mais = document.querySelector(
      "button[aria-label='Aumentar quantidade']",
    );
    for (let i = 0; i < 4; i++) await tocar(mais);
    expect(avisar).not.toHaveBeenCalled();

    const azul = await itemDoMenuDaBarra("Vermelha", "Azul");
    await tocar(azul);

    await comprarPelaBarra();
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(adicionarAoCarrinho.mock.calls[0][0]).toBe(2);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBe("v-azul");
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(String(avisar.mock.calls[0][0])).toBe("Só restam 2");
  });

  it("escolher pela barra uma cor com foto leva a galeria até a foto dela", async () => {
    await montar(
      blusa([
        cor("v-verm", "Vermelha", 10, "/f1.png"),
        cor("v-azul", "Azul", 5, "/f2.png"),
      ]),
    );
    await tocar(opcaoDaPagina("Vermelha"));
    const ativa = () =>
      [...hospedeiro.querySelectorAll("button[aria-current='true']")].map((b) =>
        b.getAttribute("aria-label"),
      );
    expect(ativa()).toContain("Foto 1 de 2");

    await tocar(await itemDoMenuDaBarra("Vermelha", "Azul"));

    expect(ativa()).toContain("Foto 2 de 2");
  });

  it("variação esgotada fica desabilitada no menu da barra", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-preta", "Preta", 0)]),
    );
    await tocar(opcaoDaPagina("Vermelha"));

    const preta = await itemDoMenuDaBarra("Vermelha", "Preta");
    expect(preta.disabled).toBe(true);
    await tocar(preta);

    expect(opcaoDaPagina("Preta").getAttribute("aria-pressed")).toBe("false");
    expect(opcaoDaPagina("Vermelha").getAttribute("aria-pressed")).toBe("true");
  });

  it("a folha desmarca ao tocar na opção já escolhida", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );
    await tocar(opcaoDaPagina("Azul"));

    await tocar(await itemDoMenuDaBarra("Azul", "Azul"));

    expect(opcaoDaPagina("Azul").getAttribute("aria-pressed")).toBe("false");
  });

  it("Adicionar sem escolher abre a mesma folha; só a combinação completa envia id e preço", async () => {
    await montar(
      blusa([
        {
          ...cor("azul-p", "Azul / P", 2),
          name: "Cor / Tamanho",
          priceOverride: 25,
        },
        { ...cor("azul-m", "Azul / M", 0), name: "Cor / Tamanho" },
        { ...cor("preto-m", "Preto / M", 4), name: "Cor / Tamanho" },
      ]),
    );
    await comprarPelaBarra();
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
    const folha = document.querySelector('[role="dialog"]')!;
    expect(folha).not.toBeNull();
    await tocar(folha.querySelector('button[aria-label="Azul"]'));
    expect(
      (folha.querySelector('button[aria-label="M"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await tocar(folha.querySelector('button[aria-label="P"]'));
    expect(folha.textContent).toContain("R$ 25,00");
    await tocar(
      [...folha.querySelectorAll("button")].find(
        (b) => b.textContent === "Adicionar ao Carrinho",
      ),
    );
    expect(adicionarAoCarrinho).toHaveBeenCalledWith(
      1,
      "azul-p",
      "Cor / Tamanho: Azul / P",
    );
  });

  it.each([
    ["Modelo / Tamanho", "A / P", "B / M", ["A", "P"], ["B", "M"]],
    [
      "Modelo / Tamanho / Estampa",
      "A / P / Lisa",
      "B / M / Listrada",
      ["A", "P", "Lisa"],
      ["B", "M", "Listrada"],
    ],
  ])(
    "a folha permite sair da combinação A/P e comprar B/M em %s",
    async (name, primeira, segunda, escolhasA, escolhasB) => {
      await montar(
        blusa([
          { ...cor("a-p", primeira, 5), name },
          { ...cor("b-m", segunda, 2), name, priceOverride: 25 },
        ]),
      );
      await comprarPelaBarra();
      const folha = document.querySelector('[role="dialog"]')!;
      const opcao = (valor: string) =>
        folha.querySelector<HTMLButtonElement>(
          `button[aria-label="${valor}"]`,
        )!;
      const adicionar = () =>
        [...folha.querySelectorAll("button")].find(
          (b) => b.textContent === "Adicionar ao Carrinho",
        );
      for (const valor of escolhasA) await tocar(opcao(valor));
      for (const valor of escolhasB) {
        expect(opcao(valor).disabled).toBe(true);
        await tocar(opcao(valor));
        expect(opcao(valor).getAttribute("aria-pressed")).toBe("false");
      }
      for (const valor of escolhasA) {
        await tocar(opcao(valor));
        expect(opcao(valor).getAttribute("aria-pressed")).toBe("false");
      }
      await tocar(adicionar());
      expect(adicionarAoCarrinho).not.toHaveBeenCalled();
      for (const valor of escolhasB) await tocar(opcao(valor));
      expect(folha.textContent).toContain("R$ 25,00");
      await tocar(adicionar());
      expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
        1,
        "b-m",
        `${name}: ${segunda}`,
      );
    },
  );

  it("Azul/M não anuncia o total de todos os tamanhos como estoque da escolha", async () => {
    await montar(
      blusa([
        { ...cor("azul-p", "Azul / P", 12), name: "Cor / Tamanho" },
        { ...cor("azul-m", "Azul / M", 3), name: "Cor / Tamanho" },
      ]),
    );
    await comprarPelaBarra();
    const folha = document.querySelector('[role="dialog"]')!;
    await tocar(folha.querySelector('button[aria-label="Azul"]'));
    await tocar(folha.querySelector('button[aria-label="M"]'));
    expect(folha.querySelector("fieldset")?.textContent).not.toContain(
      "15 disponíveis",
    );
    expect(
      folha.querySelector('button[aria-label="Azul"]')?.getAttribute("title"),
    ).not.toContain("15 un.");
    const mais = folha.querySelector(
      'button[aria-label="Aumentar quantidade"]',
    );
    for (let i = 0; i < 4; i++) await tocar(mais);
    await tocar(
      [...folha.querySelectorAll("button")].find(
        (b) => b.textContent === "Adicionar ao Carrinho",
      ),
    );
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      3,
      "azul-m",
      "Cor / Tamanho: Azul / M",
    );
  });

  it("a área rolável da folha reserva a folga segura do rodapé", async () => {
    await montar(blusa([cor("azul", "Azul", 2)]));
    await comprarPelaBarra();
    const folha = document.querySelector('[role="dialog"]')!;
    const conteudo = folha.querySelector(".overflow-y-auto")!;
    expect(
      conteudo.classList.contains(
        "pb-[calc(20px+var(--safe-area-bottom,0px))]",
      ),
    ).toBe(true);
  });

  it("o botão principal tem rótulo curto abaixo de 380px sem perder o nome acessível", async () => {
    await montar(blusa([]));
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Adicionar ao carrinho"]',
    );
    expect(botao).not.toBeNull();
    expect(botao?.classList.contains("min-h-[52px]")).toBe(true);
    const curto = [...botao!.querySelectorAll("span")].find(
      (el) => el.textContent === "Adicionar",
    )!;
    const completo = [...botao!.querySelectorAll("span")].find(
      (el) => el.textContent === "Adicionar ao Carrinho",
    )!;
    expect(curto.classList.contains("min-[380px]:hidden")).toBe(true);
    expect(completo.classList.contains("hidden")).toBe(true);
    expect(completo.classList.contains("min-[380px]:inline")).toBe(true);
  });

  it("a barra distingue opção desligada de produto esgotado", async () => {
    const produto = blusa([cor("azul", "Azul", 2)]);
    await montar(produto);
    await tocar(opcaoDaPagina("Azul"));
    await montar({
      ...produto,
      variants: [{ ...produto.variants![0], active: false }],
    });
    const comprar =
      barra()?.querySelector<HTMLButtonElement>("button:last-child");
    expect(comprar?.disabled).toBe(true);
    expect(comprar?.textContent).toBe("Indisponível");
  });

  it("a barra mantém Esgotado para o produto sem estoque", async () => {
    await montar({ ...blusa([]), stock: 0 });
    expect(barra()?.textContent).toContain("Esgotado");
  });

  it("a folha mostra De riscado e preço promocional só com desconto real", async () => {
    const produto = blusa([cor("azul", "Azul", 2)]);
    await montar({ ...produto, originalPrice: 100 });
    await comprarPelaBarra();
    const folha = document.querySelector('[role="dialog"]')!;
    const anterior = [...folha.querySelectorAll("span")].find(
      (el) => el.textContent === "De: R$ 100,00",
    );
    expect(anterior?.classList.contains("line-through")).toBe(true);
    const preco = [...folha.querySelectorAll("p")].find(
      (el) => el.textContent === "R$ 80,00",
    )!;
    expect(preco.classList.contains("text-emerald-700")).toBe(true);
    await montar({ ...produto, originalPrice: 80 });
    expect(folha.textContent).not.toContain("De:");
    expect(preco.classList.contains("text-emerald-700")).toBe(false);
  });

  it("a folha mantém o botão de compra na cor da loja e com texto do tema", async () => {
    await montar(blusa([cor("azul", "Azul", 2)]));
    await comprarPelaBarra();
    const botao = [...document.querySelectorAll('[role="dialog"] button')].at(
      -1,
    )!;
    expect(botao.classList.contains("bg-primary")).toBe(true);
    expect(botao.classList.contains("text-primary-foreground")).toBe(true);
  });

  it("os dois botões de quantidade da folha usam alvos de 44px", async () => {
    await montar(blusa([cor("azul", "Azul", 2)]));
    await comprarPelaBarra();
    const folha = document.querySelector('[role="dialog"]')!;
    expect(folha).not.toBeNull();
    const botoes = [
      ...folha.querySelectorAll('button[aria-label$="quantidade"]'),
    ];
    expect(botoes).toHaveLength(2);
    for (const botao of botoes) {
      expect(
        botao.classList.contains("size-11"),
        botao.getAttribute("aria-label") ?? undefined,
      ).toBe(true);
    }
  });

  it("trocar para uma cor sem o tamanho escolhido limpa o tamanho, não compra combinação inexistente", async () => {
    await montar(
      blusa([
        { ...cor("azul-p", "Azul / P", 2), name: "Cor / Tamanho" },
        { ...cor("preto-m", "Preto / M", 4), name: "Cor / Tamanho" },
      ]),
    );
    await tocar(hospedeiro.querySelector('button[aria-label="Azul"]'));
    await tocar(hospedeiro.querySelector('button[aria-label="P"]'));
    expect(barra()?.textContent).toContain("Azul · P");
    await tocar(hospedeiro.querySelector('button[aria-label="Preto"]'));
    expect(
      hospedeiro
        .querySelector('button[aria-label="P"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(barra()?.textContent).toContain("Escolher cor e tamanho");
    await comprarPelaBarra();
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
