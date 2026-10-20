// @vitest-environment jsdom
//
// DEFEITO (caçada de 14/10/2026), lado da PÁGINA DO PRODUTO: quem usa leitor
// de tela (TalkBack) aperta "Adicionar ao Carrinho" e fica no silêncio —
//   1. nenhum aviso falado de que entrou no carrinho;
//   2. durante ~2 s o botão ficava `disabled` e mostrava só um ícone girando
//      e depois um ✓, sem texto: perdia o NOME e o foco caía no body.
// O botão da barra fixa (portal) tinha o mesmo problema.
//
// O que NÃO pode mudar: o visual, e o bloqueio de clique duplo (o guard
// `cartStatus !== "idle"` do handler é o que segura — `aria-disabled` não
// bloqueia clique sozinho). Esgotado continua `disabled` de verdade.
//
// Modelo estrutural: product-view-barra-fixa-preco-promocional.test.tsx
// (<main> real para a barra fixa existir; mesmos dublês e stubs de jsdom).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

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
    config: { enableReviews: true },
    isLoaded: true,
  }),
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-leitor-de-tela",
  name: "Caderno Bom",
  description: "Descrição de teste",
  price: 20,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};

// Nome acessível neste caso: aria-label vence; sem ele vale o texto (o
// `sr-only` conta — é o que o leitor de tela lê).
const nomeAcessivel = (el: Element) =>
  (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();

describe("ProductView — adicionar ao carrinho fala para o leitor de tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;
  let onAddToCart: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    onAddToCart = vi.fn<(q: number, v?: string, n?: string) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  async function montar(p: Product = produto) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={p}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={onAddToCart}
          onBack={() => {}}
        />,
      );
    });
  }

  // O CTA principal está dentro do <main>; o da barra fixa vai por portal
  // para o body (fora do <main>) e, parado, mostra só "+".
  const botoes = () => Array.from(document.querySelectorAll("button"));
  const ctaPrincipal = () =>
    botoes().find(
      (b) =>
        hospedeiro.contains(b) &&
        /adicionar ao carrinho|adicionando|adicionado/i.test(nomeAcessivel(b)),
    )!;
  const ctaDaBarraFixa = () =>
    botoes().find((b) => !hospedeiro.contains(b) && b.textContent === "+") ??
    botoes().find(
      (b) =>
        !hospedeiro.contains(b) &&
        /adicionando|adicionado/i.test(nomeAcessivel(b)),
    )!;
  const avisosFalados = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="status"]'))
      .filter((r) => !r.closest('[aria-hidden="true"]'))
      .map((r) => r.textContent?.trim() ?? "")
      .filter((t) => /carrinho/i.test(t));

  it("ao adicionar, o botão vira 'Adicionando…' (nome mantido), NÃO fica `disabled`, e conserva o foco", async () => {
    vi.useFakeTimers();
    await montar();

    const botao = ctaPrincipal();
    expect(botao).toBeDefined();
    botao.focus();
    await act(async () => {
      botao.click();
    });

    // Mesmo nó: o React não trocou o botão por baixo do foco.
    expect(ctaPrincipal()).toBe(botao);
    expect(botao.disabled).toBe(false);
    expect(botao.getAttribute("aria-disabled")).toBe("true");
    expect(nomeAcessivel(botao)).toMatch(/adicionando/i);
    expect(document.activeElement).toBe(botao);

    await act(async () => {
      vi.advanceTimersByTime(750);
    });
    // O ✓ também tem nome.
    expect(botao.disabled).toBe(false);
    expect(nomeAcessivel(botao)).toMatch(/adicionado/i);

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(botao.hasAttribute("aria-disabled")).toBe(false);
    expect(nomeAcessivel(botao)).toMatch(/adicionar ao carrinho/i);
  });

  it("o ícone girando e o ✓ carregam texto escondido (sr-only), sem texto novo para quem enxerga", async () => {
    vi.useFakeTimers();
    await montar();
    const botao = ctaPrincipal();

    await act(async () => {
      botao.click();
    });
    const escondidoAdicionando = botao.querySelector(".sr-only");
    expect(escondidoAdicionando?.textContent).toMatch(/adicionando/i);

    await act(async () => {
      vi.advanceTimersByTime(750);
    });
    const escondidoAdicionado = botao.querySelector(".sr-only");
    expect(escondidoAdicionado?.textContent).toMatch(/adicionado/i);
  });

  it("dois toques seguidos NÃO somam duas unidades (o bloqueio sobrevive à troca de disabled por aria-disabled)", async () => {
    vi.useFakeTimers();
    await montar();
    const botao = ctaPrincipal();

    await act(async () => {
      botao.click();
    });
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      vi.advanceTimersByTime(750);
    });
    // Já no "Adicionado" (✓): outro toque também é ignorado.
    await act(async () => {
      botao.click();
    });

    expect(onAddToCart).toHaveBeenCalledTimes(1);

    // Terminado o ciclo, um toque NOVO volta a valer.
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {
      botao.click();
    });
    expect(onAddToCart).toHaveBeenCalledTimes(2);
  });

  it("uma região `role=status` (sr-only, polite) fala 'Adicionado ao carrinho' com o nome do produto — e já existia vazia antes", async () => {
    vi.useFakeTimers();
    await montar();

    const regiao = Array.from(
      document.querySelectorAll<HTMLElement>('[role="status"]'),
    ).find((r) => r.className.includes("sr-only"));
    expect(regiao).toBeDefined();
    expect(regiao!.getAttribute("aria-live")).toBe("polite");
    expect(avisosFalados()).toEqual([]);

    await act(async () => {
      ctaPrincipal().click();
    });
    // Ainda "Adicionando…": nada falado como pronto.
    expect(avisosFalados()).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(750);
    });
    expect(avisosFalados()).toEqual(["Adicionado ao carrinho: Caderno Bom"]);

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(avisosFalados()).toEqual([]);
  });

  it("a barra fixa: o botão do estado 'adicionando' também mantém o nome, não é `disabled`, e o clique duplo não soma", async () => {
    vi.useFakeTimers();
    await montar();

    const barra = ctaDaBarraFixa();
    expect(barra).toBeDefined();
    barra.focus();
    await act(async () => {
      barra.click();
    });
    await act(async () => {
      barra.click();
    });

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(barra.disabled).toBe(false);
    expect(barra.getAttribute("aria-disabled")).toBe("true");
    expect(nomeAcessivel(barra)).toMatch(/adicionando/i);
    expect(document.activeElement).toBe(barra);

    await act(async () => {
      vi.advanceTimersByTime(750);
    });
    expect(nomeAcessivel(barra)).toMatch(/adicionado/i);
  });

  it("esgotado NÃO é estado transitório: os dois botões continuam `disabled` de verdade, sem aria-disabled, e o toque não adiciona", async () => {
    await montar({ ...produto, stock: 0 });

    const esgotados = botoes().filter((b) =>
      /^esgotado$/i.test(nomeAcessivel(b)),
    );
    // CTA principal + botão da barra fixa.
    expect(esgotados.length).toBeGreaterThanOrEqual(2);
    for (const b of esgotados) {
      expect(b.disabled).toBe(true);
      expect(b.hasAttribute("aria-disabled")).toBe(false);
      await act(async () => {
        b.click();
      });
    }
    expect(onAddToCart).not.toHaveBeenCalled();
  });
});
