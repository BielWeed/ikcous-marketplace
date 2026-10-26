// @vitest-environment jsdom
//
// UI-191 (G1): o card mostrava "Salvando…" -> "Salvo!", voava a bolinha e o
// leitor de tela anunciava "Adicionado ao carrinho" mesmo quando NADA entrou
// (o estoque já estava todo no carrinho). Agora o carrinho diz quantas
// unidades entraram e o card só comemora se entrou alguma.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

const voar = vi.fn();
const vibrar = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));

// A faixa de ofertas importa a cadeia do app, que lê o ambiente do banco.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/utils/cartAnimation", () => ({
  triggerFlyingCartAnimation: (...args: unknown[]) => voar(...args),
  pontoDeSaidaVisivel: () => true,
}));

vi.mock("@/utils/haptic", () => ({
  haptic: {
    success: () => vibrar("success"),
    medium: () => vibrar("medium"),
    light: () => vibrar("light"),
    heavy: () => vibrar("heavy"),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const variantes: ProductVariant[] = [
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
    active: true,
  },
];

function criarProduto(extra: Partial<Product> = {}): Product {
  return {
    id: "prod-caderno",
    name: "Caderno Bom",
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "papelaria",
    stock: 2,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

describe("ProductCard — só comemora quando algo entrou no carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    voar.mockClear();
    vibrar.mockClear();
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
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizar(
    produto: Product,
    props: {
      layout?: "card" | "linha";
      onAddToCart?: (p: Product, e: React.MouseEvent) => unknown;
      onAddToCartWithVariants?: (
        p: Product,
        variantId: string | undefined,
        variantNames: string,
        quantity?: number,
      ) => unknown;
    },
  ) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={vi.fn()}
          showRating={false}
          layout={props.layout}
          onAddToCart={props.onAddToCart}
          onAddToCartWithVariants={props.onAddToCartWithVariants}
        />,
      );
    });
  }

  const botao = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;
  const cta = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-add"]',
    )!;
  const folha = () =>
    document.querySelector('[data-testid="product-card-options-sheet"]');
  const chip = (texto: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === texto,
    )!;
  const avisosFalados = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="status"]'))
      .filter((r) => !r.closest('[aria-hidden="true"]'))
      .map((r) => r.textContent?.trim() ?? "")
      .filter(Boolean);

  for (const layout of ["card", "linha"] as const) {
    it(`[${layout}] sem variação, nada entrou (0): sem "Salvando…", sem "Salvo!", sem voo e sem aviso falado`, async () => {
      vi.useFakeTimers();
      const onAddToCart = vi.fn(() => 0);
      await renderizar(criarProduto(), { layout, onAddToCart });

      await act(async () => {
        botao().click();
      });
      expect(onAddToCart).toHaveBeenCalledTimes(1);
      expect(botao().textContent).not.toMatch(/salv/i);
      expect(botao().hasAttribute("aria-disabled")).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      expect(botao().textContent).not.toMatch(/salv/i);
      expect(avisosFalados()).toEqual([]);
      expect(voar).not.toHaveBeenCalled();

      // O botão voltou ao normal de verdade: um toque novo é aceito.
      await act(async () => {
        botao().click();
      });
      expect(onAddToCart).toHaveBeenCalledTimes(2);
    });

    it(`[${layout}] sem variação, entrou 1: comemora ("Salvo!", voo e aviso falado)`, async () => {
      vi.useFakeTimers();
      await renderizar(criarProduto(), {
        layout,
        onAddToCart: vi.fn(() => 1),
      });

      await act(async () => {
        botao().click();
      });
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(botao().textContent).toMatch(/salvo/i);
      expect(avisosFalados()).toEqual(["Adicionado ao carrinho: Caderno Bom"]);
      expect(voar).toHaveBeenCalledTimes(1);
    });
  }

  it("quem não informa a quantidade (void) segue comemorando, como sempre", async () => {
    vi.useFakeTimers();
    await renderizar(criarProduto(), { onAddToCart: vi.fn() });
    await act(async () => {
      botao().click();
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(botao().textContent).toMatch(/salvo/i);
  });

  it("com variação, a escolhida já está toda no carrinho (0): sem 'Salvo!', sem voo, a folha continua aberta", async () => {
    vi.useFakeTimers();
    const onAddToCartWithVariants = vi.fn(() => 0);
    await renderizar(criarProduto({ stock: 99, variants: variantes }), {
      onAddToCartWithVariants,
    });

    await act(async () => {
      botao().click();
    });
    await act(async () => {
      chip("M").click();
    });
    await act(async () => {
      cta().click();
    });
    expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);
    expect(cta().textContent).not.toMatch(/salv/i);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(folha()).not.toBeNull();
    expect(cta().textContent).not.toMatch(/salv/i);
    expect(avisosFalados()).toEqual([]);
    // Nem na saída da folha a bolinha voa: nada foi anotado.
    expect(voar).not.toHaveBeenCalled();
  });

  it("com variação, entrada parcial (pediu 3, coube 1): comemora", async () => {
    vi.useFakeTimers();
    const onAddToCartWithVariants = vi.fn(() => 1);
    await renderizar(criarProduto({ stock: 99, variants: variantes }), {
      onAddToCartWithVariants,
    });

    await act(async () => {
      botao().click();
    });
    await act(async () => {
      chip("M").click();
    });
    await act(async () => {
      cta().click();
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(cta().textContent).toMatch(/salvo/i);
    expect(avisosFalados()).toEqual(["Adicionado ao carrinho: Caderno Bom"]);
  });
});

describe("Faixa de ofertas — só comemora quando algo entrou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    voar.mockClear();
    vibrar.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar(onAddToCart: () => unknown) {
    const { useAcoesDaOferta } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    function Sonda() {
      const acoes = useAcoesDaOferta({
        product: criarProduto(),
        onProductClick: () => {},
        onToggleFavorite: () => {},
        onAddToCart,
      });
      return (
        <button type="button" onClick={acoes.handleAddToCartClick}>
          {acoes.cartStatus}
        </button>
      );
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    return () => hospedeiro.querySelector<HTMLButtonElement>("button")!;
  }

  it("nada entrou (0): o botão fica parado, sem voo e sem vibração", async () => {
    vi.useFakeTimers();
    const botao = await montar(() => 0);
    await act(async () => {
      botao().click();
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(botao().textContent).toBe("idle");
    expect(voar).not.toHaveBeenCalled();
    expect(vibrar).not.toHaveBeenCalled();
  });

  it("entrou 1: carrega, confirma e voa", async () => {
    vi.useFakeTimers();
    const botao = await montar(() => 1);
    await act(async () => {
      botao().click();
    });
    expect(botao().textContent).toBe("loading");
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(botao().textContent).toBe("success");
    expect(voar).toHaveBeenCalledTimes(1);
  });
});
