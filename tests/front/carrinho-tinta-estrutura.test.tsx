// @vitest-environment jsdom
//
// Carrinho no estilo "Tinta" (24/10/2026): o redesenho é só apresentação, então
// aqui se prova que NADA do que a tela faz sumiu — aviso de estoque, desconto,
// quantidade com limite, remover, limpar tudo, frete grátis/a calcular, ir para
// o checkout — e que o desenho novo está presente (aviso âmbar com ponto,
// seletor em pílula, botão de tinta). O visual em si (CSS) é provado no
// navegador real; as classes geram CSS em carrinho-tinta-classes-geram-css.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(sobre: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Ventilador de teto",
    description: "",
    price: 70,
    originalPrice: 100,
    images: [],
    category: "Utilidade",
    stock: 2,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...sobre,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const texto = (el: Element = hospedeiro) =>
  (el.textContent ?? "").replace(/\u00A0/g, " ");

const botao = (rotulo: string) =>
  hospedeiro.querySelector(
    `button[aria-label="${rotulo}"]`,
  ) as HTMLButtonElement | null;

async function montarLista(
  cart: CartItem[],
  sobre: {
    onRemove?: () => void;
    onUpdateQuantity?: () => void;
    handleClearCart?: () => void;
  } = {},
) {
  const { CartItemsList } = await import(
    "@/components/ui/custom/CartItemsList"
  );
  await act(async () => {
    raiz.render(
      <CartItemsList
        cart={cart}
        removingId={null}
        onUpdateQuantity={sobre.onUpdateQuantity ?? (() => {})}
        onRemove={sobre.onRemove ?? (() => {})}
        handleClearCart={sobre.handleClearCart ?? (() => {})}
      />,
    );
  });
}

describe("CartItemsList Tinta — a linha do carrinho continua fazendo tudo", () => {
  it("estoque baixo: ponto âmbar + 'Só 2 restantes' (plural) e 'Só 1 restante' (singular)", async () => {
    await montarLista([{ product: produto({ stock: 2 }), quantity: 1 }]);
    const aviso = Array.from(hospedeiro.querySelectorAll("span")).find((s) =>
      s.textContent?.startsWith("Só 2 restantes"),
    );
    expect(aviso).toBeDefined();
    expect(aviso?.classList.contains("text-amber-700")).toBe(true);
    // ponto âmbar, sem fundo pintado
    expect(aviso?.querySelector(".bg-amber-500.rounded-full")).not.toBeNull();
    expect(aviso?.className).not.toMatch(/\bbg-/);

    await montarLista([{ product: produto({ stock: 1 }), quantity: 1 }]);
    expect(texto()).toContain("Só 1 restante");
    expect(texto()).not.toContain("Só 1 restantes");
  });

  it("limite do aviso: estoque 4 ou mais e estoque 0 não mostram 'Só N'", async () => {
    await montarLista([{ product: produto({ stock: 4 }), quantity: 1 }]);
    expect(texto()).not.toContain("Só ");
    await montarLista([{ product: produto({ stock: 0 }), quantity: 1 }]);
    expect(texto()).not.toContain("Só ");
  });

  it("preço, preço antigo riscado e % de desconto", async () => {
    await montarLista([{ product: produto(), quantity: 1 }]);
    expect(texto()).toContain("R$ 70,00");
    const antigo = Array.from(hospedeiro.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").replace(/\u00A0/g, " ").includes("R$ 100,00"),
    );
    expect(antigo?.classList.contains("line-through")).toBe(true);
    const pct = Array.from(hospedeiro.querySelectorAll("span")).find(
      (s) => s.textContent === "-30%",
    );
    expect(pct?.classList.contains("text-emerald-700")).toBe(true);
  });

  it("sem desconto: nenhum preço riscado nem porcentagem", async () => {
    await montarLista([
      { product: produto({ originalPrice: undefined }), quantity: 1 },
    ]);
    expect(hospedeiro.querySelector(".line-through")).toBeNull();
    expect(texto()).not.toContain("%");
  });

  it("quantidade em pílula: + e - chamam onUpdateQuantity; no limite o + trava", async () => {
    const onUpdateQuantity = vi.fn();
    await montarLista([{ product: produto({ stock: 3 }), quantity: 2 }], {
      onUpdateQuantity,
    });
    const grupo = hospedeiro.querySelector('[role="group"]');
    expect(grupo?.classList.contains("rounded-full")).toBe(true);
    await act(async () => botao("Aumentar quantidade")?.click());
    expect(onUpdateQuantity).toHaveBeenLastCalledWith("prod-1", 3, undefined);
    await act(async () => botao("Diminuir quantidade")?.click());
    expect(onUpdateQuantity).toHaveBeenLastCalledWith("prod-1", 1, undefined);

    // borda: quantidade == estoque -> + desabilitado e não dispara
    onUpdateQuantity.mockClear();
    await montarLista([{ product: produto({ stock: 2 }), quantity: 2 }], {
      onUpdateQuantity,
    });
    expect(botao("Aumentar quantidade")?.disabled).toBe(true);
    await act(async () => botao("Aumentar quantidade")?.click());
    expect(onUpdateQuantity).not.toHaveBeenCalled();
  });

  it("borda do desenho (3º cartão): estoque 1 e quantidade 1 trava os dois botões", async () => {
    await montarLista([{ product: produto({ stock: 1 }), quantity: 1 }]);
    expect(botao("Aumentar quantidade")?.disabled).toBe(true);
    expect(botao("Diminuir quantidade")?.disabled).toBe(true);
  });

  it("Remover item continua chamando onRemove com o produto e a variação", async () => {
    const onRemove = vi.fn();
    await montarLista(
      [
        {
          product: produto(),
          quantity: 1,
          variantId: "var-azul",
          variantNames: "Cor: Azul",
        },
      ],
      { onRemove },
    );
    await act(async () => botao("Remover item")?.click());
    expect(onRemove).toHaveBeenCalledWith("prod-1", "var-azul");
    expect(texto()).toContain("Cor: Azul");
  });

  it("contador usa o plural certo e o rótulo vira mono em caixa alta", async () => {
    await montarLista([{ product: produto({ stock: 9 }), quantity: 1 }]);
    expect(texto()).toContain("1 Item Adicionado");
    expect(texto()).not.toContain("Itens Adicionados");
    await montarLista([{ product: produto({ stock: 9 }), quantity: 5 }]);
    expect(texto()).toContain("5 Itens Adicionados");
    const rotulo = Array.from(hospedeiro.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Itens Adicionados"),
    );
    expect(rotulo?.classList.contains("font-mono")).toBe(true);
    expect(rotulo?.classList.contains("uppercase")).toBe(true);
  });

  it("mais de 50 linhas: aviso de instabilidade e 'Limpar Tudo' chama handleClearCart", async () => {
    const handleClearCart = vi.fn();
    const muitos: CartItem[] = Array.from({ length: 51 }, (_, i) => ({
      product: produto({ id: `p-${i}`, stock: 9 }),
      quantity: 1,
    }));
    await montarLista(muitos, { handleClearCart });
    expect(texto()).toContain("Instabilidade detectada");
    const limpar = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Limpar Tudo"),
    );
    await act(async () => limpar?.click());
    expect(handleClearCart).toHaveBeenCalledTimes(1);

    // 50 linhas ou menos: sem aviso
    await montarLista(muitos.slice(0, 50), { handleClearCart });
    expect(texto()).not.toContain("Instabilidade detectada");
  });
});

describe("CartFooterSummary Tinta — total, frete e botão de tinta", () => {
  async function montarRodape(shipping: number | null, total: number) {
    const { CartFooterSummary } = await import(
      "@/components/ui/custom/CartFooterSummary"
    );
    const onNavigate = vi.fn();
    await act(async () => {
      raiz.render(
        <CartFooterSummary
          cartCount={2}
          shipping={shipping}
          total={total}
          onNavigate={onNavigate}
        />,
      );
    });
    return onNavigate;
  }

  const botaoFinalizar = () =>
    Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Finalizar"),
    ) as HTMLButtonElement;

  it("'Finalizar compra' é botão de tinta (bg-foreground) e leva ao checkout", async () => {
    const onNavigate = await montarRodape(10, 110);
    const b = botaoFinalizar();
    expect(b.textContent).toContain("Finalizar compra");
    expect(b.classList.contains("bg-foreground")).toBe(true);
    expect(b.className).not.toMatch(/bg-primary/);
    await act(async () => b.click());
    expect(onNavigate).toHaveBeenCalledWith("checkout");
  });

  it("frete grátis: ponto verde + 'grátis' em minúscula na tela; total sem degradê", async () => {
    await montarRodape(0, 100);
    const valor = Array.from(document.body.querySelectorAll("span")).find(
      (s) => s.textContent === "GRÁTIS",
    );
    expect(valor?.classList.contains("lowercase")).toBe(true);
    const linha = valor?.parentElement as HTMLElement;
    expect(linha.classList.contains("text-emerald-700")).toBe(true);
    expect(linha.querySelector(".bg-emerald-500.rounded-full")).not.toBeNull();
    expect(document.body.innerHTML).not.toContain("text-transparent");
    expect(texto(document.body)).toContain("R$ 100,00");
  });

  it("frete a calcular e frete cotado: sem ponto verde, texto cinza do tema", async () => {
    await montarRodape(null, 100);
    expect(texto(document.body)).toContain("A calcular");
    expect(document.body.querySelector(".bg-emerald-500")).toBeNull();
    await montarRodape(18.37, 118.37);
    expect(texto(document.body)).toContain("R$ 18,37");
    expect(texto(document.body)).not.toContain("A calcular");
    expect(document.body.querySelector(".bg-emerald-500")).toBeNull();
  });

  it("teclado aberto esconde a barra (comportamento antigo preservado)", async () => {
    const ouvintes = new Map<string, () => void>();
    vi.stubGlobal("visualViewport", {
      height: 300,
      addEventListener: (n: string, f: () => void) => {
        ouvintes.set(n, f);
      },
      removeEventListener: () => {},
    });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => {
      f();
      return 1;
    });
    await montarRodape(10, 110);
    expect(botaoFinalizar()).toBeDefined();
    const campo = document.createElement("input");
    document.body.appendChild(campo);
    campo.focus();
    await act(async () => ouvintes.get("resize")?.());
    expect(
      Array.from(document.body.querySelectorAll("button")).some((b) =>
        b.textContent?.includes("Finalizar"),
      ),
    ).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("EmptyCart Tinta", () => {
  it("título, texto e 'Explorar Produtos' → home, em botão de tinta", async () => {
    const { EmptyCart } = await import("@/components/ui/custom/EmptyCart");
    const onNavigate = vi.fn();
    await act(async () => {
      raiz.render(<EmptyCart onNavigate={onNavigate} />);
    });
    expect(texto()).toContain("Seu carrinho está vazio");
    const b = hospedeiro.querySelector("button") as HTMLButtonElement;
    expect(b.textContent).toContain("Explorar Produtos");
    expect(b.classList.contains("bg-foreground")).toBe(true);
    await act(async () => b.click());
    expect(onNavigate).toHaveBeenCalledWith("home");
  });
});

describe("ShippingProgress Tinta — os quatro estados seguem dizendo a mesma coisa", () => {
  async function montar(
    estado: "liberado" | "meta" | "gratis_so_na_mais_barata",
    sobre: { progressPercent?: number; amountToFree?: number } = {},
  ) {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    await act(async () => {
      raiz.render(
        <ShippingProgress
          estado={estado}
          savings={0}
          progressPercent={sobre.progressPercent ?? 40}
          amountToFree={sobre.amountToFree ?? 60}
          isNearlyThere={false}
          freeShippingProducts={[]}
        />,
      );
    });
  }

  it("meta: título, 'Faltam R$ 60,00' e barra de tinta; sem fundo pintado", async () => {
    await montar("meta");
    expect(texto()).toContain("Meta Frete Grátis");
    expect(texto()).toContain("Faltam R$ 60,00");
    expect(texto()).toContain("40%");
    expect(
      hospedeiro.querySelector(".bg-foreground.rounded-full"),
    ).not.toBeNull();
    expect(hospedeiro.firstElementChild?.className).not.toMatch(
      /bg-(emerald|amber|zinc|gradient)/,
    );
  });

  it("liberado: contorno verde, glifo verde, sem 'Faltam'", async () => {
    await montar("liberado", { progressPercent: 100, amountToFree: 0 });
    expect(texto()).toContain("Frete Grátis Liberado");
    expect(texto()).not.toContain("Faltam");
    expect(hospedeiro.firstElementChild?.className).toContain(
      "border-emerald-300",
    );
  });

  it("borda: 0% e R$ 0,00 juntos = não existe meta, nada é desenhado", async () => {
    await montar("meta", { progressPercent: 0, amountToFree: 0 });
    expect(hospedeiro.innerHTML).toBe("");
  });
});
