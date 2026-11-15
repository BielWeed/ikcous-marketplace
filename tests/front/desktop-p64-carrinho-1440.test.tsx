// @vitest-environment jsdom
//
// P64 (D2): a 1536 px e 1920 px o cabeçalho do computador usa 1440 px úteis
// (`2xl:max-w-[1440px]`), mas o conteúdo do Carrinho ficava em 1280 (max-w-7xl)
// e o dos Pedidos em 1216: o resumo terminava ~80 px antes do ícone do
// carrinho. Em `2xl` a barra de abas e o conteúdo das duas abas passam a 1440,
// juntos (barra e conteúdo têm de ter a MESMA largura, senão as abas ficam
// desalinhadas do que está embaixo). Só classes `2xl:` acrescentadas: o celular
// e o `lg:` (1024-1535) ficam byte a byte como eram -- os literais abaixo são
// CONGELADOS. jsdom não calcula layout: a ordem da cascata, que decide quem
// ganha a 1536+, é provada compilando o Tailwind real do projeto.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import tailwindcss from "tailwindcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";
import { classesDoCelular } from "./classes-do-celular";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 15, freeShippingMin: 0 },
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    getFreeShippingEligibleProducts: () => [],
  }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    shippingFee: 0,
    freteGratis: false,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: null,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn() }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const item: CartItem = {
  product: {
    id: "prod-p64",
    name: "Produto inventado",
    description: "",
    price: 100,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
  quantity: 1,
};

// Literais do CELULAR (sem lg:/xl:/2xl:), congelados na base 1.5.192.
const ABAS_NO_CELULAR =
  "sticky top-[-2px] z-50 bg-background/95 px-4 py-3 backdrop-blur-md min-[380px]:px-5";
const CARRINHO_NO_CELULAR =
  "mx-auto flex w-full max-w-7xl flex-col items-stretch gap-6 px-4 pb-6 pt-1 min-[380px]:px-5";
const PEDIDOS_NO_CELULAR =
  "flex w-full flex-1 flex-col px-4 pb-6 pt-0 focus:outline-none min-[380px]:px-5";

describe("P64 -- Carrinho e Pedidos alinham com o cabeçalho a partir de 1536 px", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function montar(aba: "cart" | "orders") {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(
        <CartView cart={[item]} onNavigate={() => {}} initialTab={aba} />,
      );
    });
    const abas = host
      .querySelector("#tab-cart")!
      .closest<HTMLElement>(".sticky")!;
    return { abas };
  }
  const tokens = (el: Element) => el.className.split(/\s+/);

  it("aba Carrinho: barra e conteúdo vão a 1440 em 2xl, e o celular e o lg ficam como eram", async () => {
    const { abas } = await montar("cart");
    const conteudo = host.querySelector<HTMLElement>("div.max-w-7xl")!;
    expect(conteudo).not.toBeNull();

    expect(classesDoCelular(abas.className)).toBe(ABAS_NO_CELULAR);
    expect(classesDoCelular(conteudo.className)).toBe(CARRINHO_NO_CELULAR);

    // 1024-1535 continua como era.
    expect(tokens(abas)).toContain(
      "lg:has-[#tab-cart[aria-selected=true]]:max-w-7xl",
    );
    expect(tokens(abas)).toContain(
      "lg:has-[#tab-orders[aria-selected=true]]:max-w-[1216px]",
    );
    expect(tokens(conteudo)).toContain("lg:px-8");

    // 1536+ : barra e conteúdo na mesma largura do cabeçalho.
    expect(tokens(conteudo)).toContain("2xl:max-w-[1440px]");
    expect(tokens(abas)).toContain(
      "2xl:has-[#tab-cart[aria-selected=true]]:max-w-[1440px]",
    );
  });

  it("aba Pedidos: barra e painel vão juntos a 1440 em 2xl, e o celular e o lg ficam como eram", async () => {
    const { abas } = await montar("orders");
    const painel = host.querySelector<HTMLElement>("#painel-orders")!;
    expect(painel).not.toBeNull();

    expect(classesDoCelular(abas.className)).toBe(ABAS_NO_CELULAR);
    expect(classesDoCelular(painel.className)).toBe(PEDIDOS_NO_CELULAR);

    expect(tokens(painel)).toContain("lg:max-w-[1216px]");
    expect(tokens(painel)).toContain("lg:px-8");

    expect(tokens(painel)).toContain("2xl:max-w-[1440px]");
    // Sem este par a barra ficaria em 1216 sobre um painel de 1440.
    expect(tokens(abas)).toContain(
      "2xl:has-[#tab-orders[aria-selected=true]]:max-w-[1440px]",
    );
  });
});

describe("P64 -- a cascata do Tailwind deixa o 2xl vencer o lg", () => {
  async function compilar(candidatas: string[]) {
    const requisitar = createRequire(import.meta.url);
    const carregar = requisitar("tailwindcss/loadConfig") as (
      caminho: string,
    ) => Record<string, unknown>;
    const config = carregar(resolve("tailwind.config.js"));
    const css = readFileSync("src/index.css", "utf8");
    const resultado = await postcss([
      tailwindcss({
        ...config,
        content: [{ raw: candidatas.join(" "), extension: "html" }],
      }),
    ]).process(css, { from: "src/index.css" });
    return resultado.css;
  }
  // `\` e `[`/`]` aparecem escapados no seletor gerado; basta a ordem dos
  // trechos que identificam cada regra.
  const posicao = (css: string, trecho: string) => {
    const i = css.indexOf(trecho);
    expect(i, trecho).toBeGreaterThan(-1);
    return i;
  };

  it("2xl vem depois do lg para o mesmo elemento (a regra posterior ganha)", async () => {
    const css = await compilar([
      "lg:has-[#tab-cart[aria-selected=true]]:max-w-7xl",
      "2xl:has-[#tab-cart[aria-selected=true]]:max-w-[1440px]",
      "lg:has-[#tab-orders[aria-selected=true]]:max-w-[1216px]",
      "2xl:has-[#tab-orders[aria-selected=true]]:max-w-[1440px]",
      "lg:max-w-[1216px]",
      "2xl:max-w-[1440px]",
    ]);
    expect(
      posicao(css, ".\\32xl\\:has-\\[\\#tab-cart"),
      "tab-cart",
    ).toBeGreaterThan(posicao(css, ".lg\\:has-\\[\\#tab-cart"));
    expect(
      posicao(css, ".\\32xl\\:has-\\[\\#tab-orders"),
      "tab-orders",
    ).toBeGreaterThan(posicao(css, ".lg\\:has-\\[\\#tab-orders"));
    expect(posicao(css, ".\\32xl\\:max-w-\\[1440px\\]")).toBeGreaterThan(
      posicao(css, ".lg\\:max-w-\\[1216px\\]"),
    );
  }, 60_000);
});
