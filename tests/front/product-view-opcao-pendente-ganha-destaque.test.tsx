// @vitest-environment jsdom
//
// UI-170, achado C2: quem toca em "Adicionar" sem escolher a opção (cor,
// tamanho) recebia só um aviso passageiro, quase invisível no celular, e a
// linha da opção pendente seguia cinza como se nada faltasse. Agora, DEPOIS
// desse toque, a linha da opção que falta (na página e na folha) e o atalho
// "Escolher cor ›" da barra de baixo ganham cor de alerta, até a pessoa
// escolher. Nada muda de lugar e nenhuma tela nova abre.
//
// O hospedeiro é um <main> real: o efeito que liga `scrolled` (a barra só
// existe com `scrolled=true`) só se inscreve com `document.querySelector
// ("main")`.
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

describe("ProductView — a opção pendente ganha destaque depois do toque sem escolha", () => {
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

  /** O atalho "Escolher cor ›" da barra de baixo. */
  const atalhoDaBarra = () =>
    [...(barra()?.querySelectorAll("button") ?? [])].find((b) =>
      /^Escolher .* ›$/.test(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement;

  /** Botão "Adicionar ao carrinho" DA PÁGINA (não o da barra). */
  const adicionarDaPagina = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Adicionar ao carrinho"]',
    );

  /** O texto "Escolha" (ou a escolha feita) da linha de um grupo, na página. */
  function rotuloDaLinha(grupo: string) {
    const linha = [...hospedeiro.querySelectorAll('[role="group"]')].find((g) =>
      g.textContent?.toUpperCase().startsWith(grupo.toUpperCase()),
    );
    const spans = linha?.querySelectorAll("span");
    // [0] nome do grupo, [1] "Escolha" / a escolha feita.
    return spans?.item(1) as HTMLElement;
  }

  function opcaoDaPagina(valor: string) {
    const span = [...hospedeiro.querySelectorAll("button span")].find(
      (el) => el.textContent === valor,
    );
    return span?.closest("button") as HTMLButtonElement;
  }

  const ALERTA = "text-red-700";

  it("antes de qualquer toque nada está em alerta", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );

    expect(atalhoDaBarra().className).toContain("text-muted-foreground");
    expect(atalhoDaBarra().className).not.toContain(ALERTA);
    expect(rotuloDaLinha("Cor").className).not.toContain(ALERTA);
    expect(atalhoDaBarra().getAttribute("aria-describedby")).toBeNull();
  });

  it("Adicionar da página sem escolher: a linha que falta e o atalho da barra ficam em alerta", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );

    await tocar(adicionarDaPagina());

    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(rotuloDaLinha("Cor").className).toContain(ALERTA);
    expect(rotuloDaLinha("Cor").textContent).toBe("Escolha");
    expect(atalhoDaBarra().className).toContain(ALERTA);
    expect(atalhoDaBarra().className).not.toContain("text-muted-foreground");
    // O atalho aponta para um texto que diz o que falta (leitor de tela).
    const id = atalhoDaBarra().getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)?.textContent).toContain(
      "Falta escolher",
    );
    // O texto do atalho não mudou (nada de layout novo).
    expect(atalhoDaBarra().textContent?.trim()).toBe("Escolher cor ›");
  });

  it("escolher a opção tira o alerta de tudo, e desmarcar depois NÃO o traz de volta", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );
    await tocar(adicionarDaPagina());

    await tocar(opcaoDaPagina("Vermelha"));
    expect(rotuloDaLinha("Cor").className).not.toContain(ALERTA);
    expect(barra()?.textContent).toContain("Vermelha");
    expect(
      [...(barra()?.querySelectorAll("button") ?? [])].some((b) =>
        b.className.includes(ALERTA),
      ),
    ).toBe(false);

    // Desmarcar não é um toque novo em "Adicionar": sem alerta.
    await tocar(opcaoDaPagina("Vermelha"));
    expect(rotuloDaLinha("Cor").className).not.toContain(ALERTA);
    expect(atalhoDaBarra().className).not.toContain(ALERTA);
  });

  it("com duas opções, só a que falta fica em alerta", async () => {
    await montar(
      blusa([
        { ...cor("azul-p", "Azul / P", 2), name: "Cor / Tamanho" },
        { ...cor("preto-m", "Preto / M", 4), name: "Cor / Tamanho" },
      ]),
    );
    await tocar(opcaoDaPagina("Azul"));

    await tocar(adicionarDaPagina());

    expect(rotuloDaLinha("Cor").className).not.toContain(ALERTA);
    expect(rotuloDaLinha("Tamanho").className).toContain(ALERTA);
  });

  it("Adicionar da barra sem escolher abre a folha e deixa o atalho em alerta", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );
    const botoes = barra()?.querySelectorAll("button") ?? [];

    await tocar(botoes[botoes.length - 1]);

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
    expect(atalhoDaBarra().className).toContain(ALERTA);
  });
});
