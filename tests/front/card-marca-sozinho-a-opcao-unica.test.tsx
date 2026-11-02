// @vitest-environment jsdom
//
// DEFEITO MEDIDO: 61 das 126 peças da Savy (48%) têm UMA variante só. Quem
// tocava em "Escolher opções" via "Escolha: Tamanho" (e o aviso "Falta
// escolher") mesmo havendo uma opção só -- um toque a mais, sem escolha
// nenhuma a fazer.
//
// A REGRA (decisão de produto do dono, 02/11/2026): eixo com exatamente UM
// valor, esse valor com estoque, já abre MARCADO na folha de opções do card.
// Eixo com 2+ valores continua esperando a cliente (nunca se chuta tamanho
// entre vários). O que vai ao carrinho é EXATAMENTE o que ia quando a cliente
// tocava no chip: mesmo variantId, mesmo nome, mesma quantidade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import { chaveDaVariacao } from "@/lib/escolhas-do-item";
import type { Product, ProductVariant } from "@/types";

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

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const variante = (
  id: string,
  name: string,
  value: string,
  stockIncrement = 5,
  extra: Partial<ProductVariant> = {},
): ProductVariant => ({
  id,
  productId: "prod-camisa",
  name,
  value,
  stockIncrement,
  active: true,
  ...extra,
});

const produtoCom = (variants: ProductVariant[]): Product => ({
  id: "prod-camisa",
  name: "Camisa Boa",
  description: "Descrição de teste",
  price: 50,
  images: ["https://example.com/img.png"],
  category: "roupas",
  stock: 10,
  sold: 3,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 4.5,
  reviewCount: 12,
  variants,
});

describe("ProductCard — opção única já vem marcada na folha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.mocked(toast.warning).mockClear();
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

  async function renderizarCard(
    produto: Product,
    entregar: (...args: unknown[]) => unknown = vi.fn(),
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
          onAddToCartWithVariants={entregar as never}
        />,
      );
    });
  }

  const abrirFolha = () =>
    act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[data-testid="product-card-action"]',
        )!
        .click();
    });
  const fecharFolha = () =>
    act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          'button[data-testid="product-card-options-handle"]',
        )!
        .click();
    });
  const folha = () =>
    document.querySelector<HTMLElement>(
      '[data-testid="product-card-options-sheet"]',
    );
  const cta = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-add"]',
    )!;
  const chip = (texto: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.getAttribute("aria-label") === texto,
    )!;
  const linha = (nome: string) =>
    Array.from(
      folha()!.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((b) => b.getAttribute("aria-label")?.startsWith(`${nome}:`))!;
  const marcado = (texto: string) => chip(texto).getAttribute("aria-pressed");

  it("um tamanho só: já marcado, o toque em Adicionar entrega a mesma linha de antes", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([variante("var-m", "Tamanho", "M", 3, { priceOverride: 65 })]),
      entregar,
    );
    await abrirFolha();

    expect(marcado("M")).toBe("true");
    expect(linha("Tamanho").getAttribute("aria-label")).toBe(
      "Tamanho: M. Toque para trocar",
    );
    // Nada a escolher: o botão já é "Adicionar", com o preço da variação.
    expect(cta().textContent).not.toContain("Escolha:");
    expect(cta().textContent).toContain("65,00");
    expect(document.activeElement).toBe(cta());

    await act(async () => cta().click());
    expect(toast.warning).not.toHaveBeenCalled();
    expect(entregar).toHaveBeenCalledTimes(1);
    expect(entregar.mock.calls[0]!.slice(1)).toEqual([
      "var-m",
      "Tamanho: M",
      1,
    ]);
  });

  it("tocar no chip já marcado só recolhe e entrega a MESMA linha do toque direto", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([variante("var-m", "Tamanho", "M", 3, { priceOverride: 65 })]),
      entregar,
    );
    await abrirFolha();
    await act(async () => linha("Tamanho").click());
    await act(async () => chip("M").click());
    expect(marcado("M")).toBe("true");
    await act(async () => cta().click());
    expect(entregar.mock.calls[0]!.slice(1)).toEqual([
      "var-m",
      "Tamanho: M",
      1,
    ]);
  });

  it("voltagem única também vem marcada", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([variante("var-220", "Voltagem", "220V", 2)]),
      entregar,
    );
    await abrirFolha();
    expect(marcado("220V")).toBe("true");
    await act(async () => cta().click());
    expect(entregar.mock.calls[0]!.slice(1)).toEqual([
      "var-220",
      "Voltagem: 220V",
      1,
    ]);
  });

  it("uma cor só continua marcada (regra que já existia)", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([variante("var-azul", "Cor", "Azul", 4)]),
      entregar,
    );
    await abrirFolha();
    expect(marcado("Azul")).toBe("true");
    await act(async () => cta().click());
    expect(entregar.mock.calls[0]!.slice(1)).toEqual([
      "var-azul",
      "Cor: Azul",
      1,
    ]);
  });

  it("tamanho E cor únicos (grade composta): os dois marcados, uma linha só", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([
        variante("var-azul-m", "Cor / Tamanho", "Azul / M", 4, {
          priceOverride: 75,
        }),
      ]),
      entregar,
    );
    await abrirFolha();
    expect(marcado("M")).toBe("true");
    expect(marcado("Azul")).toBe("true");
    expect(cta().textContent).toContain("75,00");
    await act(async () => cta().click());
    expect(entregar.mock.calls[0]!.slice(1)).toEqual([
      "var-azul-m",
      "Cor / Tamanho: Azul / M",
      1,
    ]);
  });

  it("três eixos únicos: os três marcados, preço e linha da única combinação", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([
        variante("var-3", "Cor / Tamanho / Manga", "Azul / M / Longa", 6, {
          priceOverride: 80,
        }),
      ]),
      entregar,
    );
    await abrirFolha();
    for (const valor of ["M", "Azul", "Longa"])
      expect(marcado(valor)).toBe("true");
    expect(cta().textContent).not.toContain("Escolha:");
    expect(cta().textContent).toContain("80,00");
    await act(async () => cta().click());
    expect(entregar.mock.calls[0]!.slice(1)).toEqual([
      "var-3",
      "Cor / Tamanho / Manga: Azul / M / Longa",
      1,
    ]);
  });

  it("produto de cadastro antigo (tamanho e cor em grupos separados), um de cada: a chave leva as duas escolhas", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([
        variante("cor-azul", "Cor", "Azul", 4),
        variante("tam-m", "Tamanho", "M", 3, { priceOverride: 65 }),
      ]),
      entregar,
    );
    await abrirFolha();
    expect(marcado("M")).toBe("true");
    expect(marcado("Azul")).toBe("true");
    await act(async () => cta().click());
    expect(entregar).toHaveBeenCalledTimes(1);
    const [, variantId, nomes, quantidade] = entregar.mock.calls[0]!;
    // Primeiro id pela ordem fixa da grade (Cor < Tamanho), como sempre.
    expect(variantId).toBe(chaveDaVariacao("cor-azul", ["tam-m"]));
    expect(nomes).toBe("Cor: Azul, Tamanho: M");
    expect(quantidade).toBe(1);
  });

  // REFERÊNCIA: o caminho antigo (a cliente tocando em cada chip) já entregava
  // estas linhas. Este teste passa com e sem a pré-marcação -- é ele que prova
  // que a literal do teste de cima é a de SEMPRE, não a que a mudança inventou.
  it("referência: tocar nos chips à mão entrega o mesmo que a pré-marcação (grupos separados)", async () => {
    const separados = vi.fn();
    await renderizarCard(
      produtoCom([
        variante("cor-azul", "Cor", "Azul", 4),
        variante("tam-m", "Tamanho", "M", 3, { priceOverride: 65 }),
      ]),
      separados,
    );
    await abrirFolha();
    await act(async () => linha("Tamanho").click());
    await act(async () => chip("M").click());
    await act(async () => linha("Cor").click());
    await act(async () => chip("Azul").click());
    await act(async () => cta().click());
    expect(separados.mock.calls[0]!.slice(1)).toEqual([
      chaveDaVariacao("cor-azul", ["tam-m"]),
      "Cor: Azul, Tamanho: M",
      1,
    ]);
  });

  it("dois tamanhos: nada é marcado por chute e a cliente ainda precisa escolher", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([
        variante("var-p", "Tamanho", "P", 5),
        variante("var-m", "Tamanho", "M", 3),
      ]),
      entregar,
    );
    await abrirFolha();
    expect(marcado("P")).toBe("false");
    expect(marcado("M")).toBe("false");
    expect(cta().textContent).toContain("Escolha: Tamanho");
    await act(async () => cta().click());
    expect(entregar).not.toHaveBeenCalled();
    expect(vi.mocked(toast.warning).mock.calls[0]![0]).toBe("Falta escolher");
  });

  it("cor única com dois tamanhos: a cor vem marcada, o tamanho continua com a cliente", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([
        variante("azul-p", "Cor / Tamanho", "Azul / P", 5),
        variante("azul-m", "Cor / Tamanho", "Azul / M", 3),
      ]),
      entregar,
    );
    await abrirFolha();
    expect(marcado("Azul")).toBe("true");
    expect(marcado("P")).toBe("false");
    expect(marcado("M")).toBe("false");
    expect(cta().textContent).toContain("Escolha: Tamanho");
    await act(async () => chip("M").click());
    expect(marcado("Azul")).toBe("true");
    await act(async () => cta().click());
    expect(entregar.mock.calls[0]!.slice(1)).toEqual([
      "azul-m",
      "Cor / Tamanho: Azul / M",
      1,
    ]);
  });

  it("três eixos com duas opções em cada um: nada marcado e a ordem de escolha é a de sempre", async () => {
    await renderizarCard(
      produtoCom([
        variante("a", "Cor / Tamanho / Manga", "Azul / M / Longa", 5),
        variante("b", "Cor / Tamanho / Manga", "Verde / G / Curta", 5),
      ]),
    );
    await abrirFolha();
    for (const valor of ["M", "G", "Azul", "Verde", "Longa", "Curta"])
      expect(marcado(valor)).toBe("false");
    expect(cta().textContent).toContain("Escolha: Tamanho");
  });

  it("reabrir a folha não duplica nem desmarca a opção única", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      produtoCom([variante("var-m", "Tamanho", "M", 3)]),
      entregar,
    );
    await abrirFolha();
    await fecharFolha();
    await abrirFolha();
    expect(marcado("M")).toBe("true");
    await act(async () => cta().click());
    expect(entregar).toHaveBeenCalledTimes(1);
    expect(entregar.mock.calls[0]!.slice(1)).toEqual([
      "var-m",
      "Tamanho: M",
      1,
    ]);
  });

  it("o estoque em tempo real esgota a opção marcada: nada é entregue, a marca some e não volta sozinha (sem laço)", async () => {
    const entregar = vi.fn();
    const antes = produtoCom([
      variante("azul-m", "Cor / Tamanho", "Azul / M", 2),
    ]);
    await renderizarCard(antes, entregar);
    await abrirFolha();
    expect(marcado("M")).toBe("true");
    expect(marcado("Azul")).toBe("true");

    // Tudo esgota com a folha aberta: ela passa a dizer que não há opção.
    const esgotado = {
      ...antes,
      variants: antes.variants!.map((v) => ({ ...v, stockIncrement: 0 })),
    };
    await renderizarCard(esgotado, entregar);
    expect(folha()!.textContent).toContain("Sem opções disponíveis");
    await act(async () => cta().click());
    expect(entregar).not.toHaveBeenCalled();

    // O estoque volta com a folha ainda aberta: a escolha limpa pelo efeito
    // de estoque NÃO é refeita por ele (só ao abrir) -- sem laço, sem chute.
    await renderizarCard(antes, entregar);
    expect(marcado("M")).toBe("false");
    expect(marcado("Azul")).toBe("false");
    // Ao reabrir, a opção única volta marcada.
    await fecharFolha();
    await abrirFolha();
    expect(marcado("M")).toBe("true");
    await act(async () => cta().click());
    expect(entregar).toHaveBeenCalledTimes(1);
    expect(entregar.mock.calls[0]![1]).toBe("azul-m");
  });
});
