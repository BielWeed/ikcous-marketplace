// @vitest-environment jsdom
//
// DEFEITO: quem usa fonte grande no celular (40–60 anos) perdia informação
// essencial por texto cortado em três pontos da compra:
//   1. o NOME do produto no resumo do checkout era `truncate` (uma linha só):
//      a cliente não conferia o que estava comprando antes de pagar;
//   2. "Máximo disponível: N" e "Só N restantes" do carrinho tinham
//      `whitespace-nowrap` ao lado da foto, num cartão `overflow-hidden`: o
//      aviso era cortado;
//   3. o botão "Escolher opções" do card virava reticências.
//
// jsdom não calcula CSS nem mede fonte ampliada: o contrato aqui são as CLASSES
// renderizadas (carrinho e card) e, no resumo do checkout — tela grande demais
// para montar inteira num teste —, as classes lidas do arquivo-fonte.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ProductVariant } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FONTES = import.meta.glob<string>(
  ["/src/views/customer/CheckoutView.tsx"],
  { query: "?raw", import: "default", eager: true },
);

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function produto(sobre: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Ventilador de teto",
    description: "",
    price: 70,
    images: [],
    category: "Utilidade",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...sobre,
  };
}

function variantes(): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-1",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: true,
    },
    {
      id: "var-m",
      productId: "prod-1",
      name: "Tamanho",
      value: "M",
      stockIncrement: 3,
      active: true,
    },
  ];
}

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
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function montarLista(cart: CartItem[]) {
  const { CartItemsList } = await import(
    "@/components/ui/custom/CartItemsList"
  );
  await act(async () => {
    raiz.render(
      <CartItemsList
        cart={cart}
        removingId={null}
        onUpdateQuantity={() => {}}
        onRemove={() => {}}
        handleClearCart={() => {}}
      />,
    );
  });
}

// O <span> mais interno cujo texto próprio contém a frase (o que leva a classe).
function aviso(frase: string): HTMLElement {
  const achados = Array.from(
    hospedeiro.querySelectorAll<HTMLElement>("span"),
  ).filter((s) => (s.textContent ?? "").replaceAll(" ", " ").includes(frase));
  expect(achados.length, frase).toBeGreaterThan(0);
  return achados[achados.length - 1].closest("span.font-semibold")!;
}

describe("fonte grande: o resumo do checkout deixa conferir o nome do produto", () => {
  it("o nome do produto no resumo quebra em até 2 linhas, sem reticências de uma linha só", () => {
    const fonte = Object.values(FONTES)[0];
    expect(fonte).toBeDefined();
    const classes = fonte.match(
      /<p className="([^"]+)">\s*\{item\.product\.name\}\s*<\/p>/,
    )?.[1];
    expect(classes).toBeDefined();
    expect(classes).not.toContain("truncate");
    expect(classes).toContain("line-clamp-2");
    expect(classes).toContain("break-words");
  });
});

describe("fonte grande: o aviso de estoque do carrinho não é cortado", () => {
  it("'Máximo disponível: N' pode quebrar de linha", async () => {
    await montarLista([{ product: produto({ stock: 5 }), quantity: 5 }]);
    const classes = aviso("Máximo disponível: 5").className;
    expect(classes).not.toContain("whitespace-nowrap");
  });

  it("'Só N restantes' pode quebrar de linha", async () => {
    await montarLista([{ product: produto({ stock: 2 }), quantity: 1 }]);
    const classes = aviso("Só 2 restantes").className;
    expect(classes).not.toContain("whitespace-nowrap");
  });
});

describe("fonte grande: o botão do card diz a ação inteira", () => {
  it("'Escolher opções' quebra em duas linhas em vez de virar reticências, e mantém a altura de hoje", async () => {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto({ variants: variantes() })}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={vi.fn()}
          showRating={false}
          onAddToCartWithVariants={vi.fn()}
        />,
      );
    });
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;
    expect(botao).not.toBeNull();
    const rotulo = Array.from(botao.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").includes("Escolher opções"),
    )!;
    expect(rotulo).toBeDefined();
    expect(rotulo.className).not.toContain("truncate");
    expect(rotulo.className).toContain("whitespace-normal");
    // Altura mínima igual à de antes (min-h-11), nunca `h-*` fixa: o botão só
    // cresce quando o texto não cabe.
    expect(botao.className).toContain("min-h-11");
    expect(botao.className).not.toMatch(/(^|\s)h-\d/);
  });
});
