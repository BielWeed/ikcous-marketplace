// @vitest-environment jsdom
//
// A grade de produtos do Catálogo (ProductList). Os testes vizinhos provam que
// ela volta a 12 quando o filtro muda e que não perde as páginas já carregadas;
// ficavam de fora:
//   - o que a cliente vê ENQUANTO carrega: 8 esqueletos e nenhum produto, mesmo
//     que a lista já tenha produtos;
//   - o carregamento só acontece quando o marcador do fim ENTRA na tela
//     (um aviso "saiu da tela" do navegador não pode trazer mais 12);
//   - a lista que cresce depois de a cliente ter visto tudo: mostra o que ela
//     já tinha visto (30) e carrega o resto sob demanda, não 6 produtos a mais
//     de uma vez por conta de uma página "fantasma";
//   - lista vazia: nada na tela, sem marcador de fim;
//   - o observador mede dentro do <main> (a área que rola de verdade), com
//     folga de 300px para carregar antes da cliente chegar ao fim;
//   - favorito, abrir, comprar e comprar por opções chegam à tela, e o cartão
//     só "celebra" (vibração de sucesso) quando entrou unidade no carrinho.
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductList } from "@/components/ui/custom/ProductList";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vibracao = vi.hoisted(() => ({
  success: vi.fn(),
  light: vi.fn(),
  medium: vi.fn(),
}));
vi.mock("@/utils/haptic", () => ({ haptic: vibracao }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

interface PropsDoCartao {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: (product: Product) => void;
  onClick: (id: string) => void;
  onAddToCart?: (product: Product) => unknown;
  onQuickBuy?: (product: Product) => void;
  onAddToCartWithVariants?: (
    product: Product,
    variantId: string | undefined,
    variantNames: string,
    quantity?: number,
  ) => unknown;
}
const devolvido = vi.hoisted(() => ({ valores: [] as unknown[] }));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: (p: PropsDoCartao) => (
    <article
      data-produto={p.product.id}
      data-favorito={String(p.isFavorite)}
      data-modo-opcoes={String(Boolean(p.onAddToCartWithVariants))}
    >
      <button type="button" onClick={() => p.onClick(p.product.id)}>
        abrir {p.product.id}
      </button>
      <button type="button" onClick={() => p.onToggleFavorite(p.product)}>
        favoritar {p.product.id}
      </button>
      <button
        type="button"
        onClick={() => devolvido.valores.push(p.onAddToCart?.(p.product))}
      >
        comprar {p.product.id}
      </button>
      <button type="button" onClick={() => p.onQuickBuy?.(p.product)}>
        rapida {p.product.id}
      </button>
      <button
        type="button"
        onClick={() =>
          devolvido.valores.push(
            p.onAddToCartWithVariants?.(p.product, "v1", "Azul / M", 2),
          )
        }
      >
        opcoes {p.product.id}
      </button>
    </article>
  ),
}));

interface Observador {
  disparar: (cruzou: boolean) => void;
  opcoes: IntersectionObserverInit | undefined;
}
const observadores = vi.hoisted(() => ({ ativos: [] as Observador[] }));

class IntersectionObserverStub {
  private readonly observador: Observador;
  constructor(
    callback: IntersectionObserverCallback,
    opcoes?: IntersectionObserverInit,
  ) {
    this.observador = {
      opcoes,
      disparar: (cruzou) =>
        callback(
          [{ isIntersecting: cruzou } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ),
    };
  }
  observe() {
    observadores.ativos.push(this.observador);
  }
  unobserve() {
    this.disconnect();
  }
  disconnect() {
    observadores.ativos = observadores.ativos.filter(
      (o) => o !== this.observador,
    );
  }
}

const produtos = (quantidade: number): Product[] =>
  Array.from(
    { length: quantidade },
    (_, i) =>
      ({
        id: `p${String(i + 1).padStart(2, "0")}`,
        name: `Produto ${i + 1}`,
      }) as Product,
  );

describe("ProductList — o que a grade mostra e quando carrega mais", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

  beforeEach(() => {
    observadores.ativos = [];
    devolvido.valores = [];
    vibracao.success.mockClear();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    // Dentro de um <main>, como na loja: é ele que rola.
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function monta(
    lista: Product[],
    extras: Partial<Parameters<typeof ProductList>[0]> = {},
  ) {
    act(() =>
      raiz.render(
        <ProductList
          products={lista}
          resetKey="fixo"
          isLoading={false}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          {...extras}
        />,
      ),
    );
  }
  const cartoes = () => hospedeiro.querySelectorAll("[data-produto]");
  const fimDaLista = () => {
    expect(observadores.ativos).toHaveLength(1);
    return observadores.ativos[0];
  };
  const clicar = (texto: string) => {
    const b = Array.from(hospedeiro.querySelectorAll("button")).find(
      (x) => x.textContent === texto,
    );
    act(() => b?.click());
  };

  describe("carregando", () => {
    it("mostra 8 esqueletos e nenhum produto, mesmo com a lista já preenchida", () => {
      monta(produtos(20), { isLoading: true });
      expect(cartoes()).toHaveLength(0);
      const grade = hospedeiro.querySelector('[role="status"]');
      expect(grade?.textContent).toContain("Carregando produtos");
      expect(grade?.querySelectorAll('[class*="aspect-[4/5]"]')).toHaveLength(
        8,
      );
      expect(observadores.ativos).toHaveLength(0);
    });

    it("terminou de carregar: produtos no lugar dos esqueletos", () => {
      monta(produtos(3), { isLoading: true });
      monta(produtos(3), { isLoading: false });
      expect(hospedeiro.querySelector('[role="status"]')).toBeNull();
      expect(cartoes()).toHaveLength(3);
    });
  });

  describe("páginas de 12", () => {
    it("lista vazia: nada na tela e nenhum marcador de fim", () => {
      monta([]);
      expect(cartoes()).toHaveLength(0);
      expect(observadores.ativos).toHaveLength(0);
      expect(hospedeiro.querySelector(".animate-spin")).toBeNull();
    });

    it("12 produtos exatos cabem na primeira página: sem marcador de fim", () => {
      monta(produtos(12));
      expect(cartoes()).toHaveLength(12);
      expect(hospedeiro.querySelector(".animate-spin")).toBeNull();
      expect(observadores.ativos).toHaveLength(0);
    });

    it("o marcador de fim só carrega mais quando ENTRA na tela", () => {
      monta(produtos(30));
      expect(cartoes()).toHaveLength(12);
      act(() => fimDaLista().disparar(false));
      expect(cartoes()).toHaveLength(12);
      act(() => fimDaLista().disparar(true));
      expect(cartoes()).toHaveLength(24);
    });

    it("a última página traz só o que falta e some o marcador", () => {
      monta(produtos(30));
      act(() => fimDaLista().disparar(true));
      act(() => fimDaLista().disparar(true));
      expect(cartoes()).toHaveLength(30);
      expect(hospedeiro.querySelector(".animate-spin")).toBeNull();
    });

    it("lista que cresce depois de tudo visto mostra o que a cliente já tinha visto (30), não mais", () => {
      monta(produtos(30));
      act(() => fimDaLista().disparar(true));
      act(() => fimDaLista().disparar(true));
      expect(cartoes()).toHaveLength(30);
      // Entram 10 produtos novos (mesmo filtro): não somem os 30 nem ganham
      // uma página "fantasma" de 6 de uma vez.
      monta(produtos(40));
      expect(cartoes()).toHaveLength(30);
      act(() => fimDaLista().disparar(true));
      expect(cartoes()).toHaveLength(40);
    });

    it("o observador mede dentro do <main> e carrega com 300px de folga", () => {
      monta(produtos(30));
      const { opcoes } = fimDaLista();
      expect(opcoes?.root).toBe(hospedeiro);
      expect(opcoes?.rootMargin).toBe("300px");
    });

    it("sair da tela desliga o marcador de fim", () => {
      monta(produtos(30));
      expect(observadores.ativos).toHaveLength(1);
      act(() => raiz.unmount());
      expect(observadores.ativos).toHaveLength(0);
      raiz = createRoot(hospedeiro);
    });
  });

  describe("cartões ligados à tela", () => {
    it("só o produto favoritado chega com o coração marcado", () => {
      monta(produtos(3), { favorites: ["p02"] });
      expect(
        Array.from(cartoes(), (c) => c.getAttribute("data-favorito")),
      ).toEqual(["false", "true", "false"]);
    });

    it("abrir, favoritar e compra rápida chegam à tela com o produto certo", () => {
      const abrir = vi.fn();
      const favoritar = vi.fn();
      const rapida = vi.fn();
      const lista = produtos(2);
      monta(lista, {
        onProductClick: abrir,
        onToggleFavorite: favoritar,
        onQuickBuy: rapida,
      });
      clicar("abrir p02");
      expect(abrir).toHaveBeenCalledWith("p02");
      clicar("favoritar p01");
      expect(favoritar).toHaveBeenCalledWith(lista[0]);
      clicar("rapida p02");
      expect(rapida).toHaveBeenCalledWith(lista[1]);
    });

    it("comprar devolve ao cartão quantas unidades entraram, e só celebra se entrou", () => {
      monta(produtos(1), { onAddToCart: vi.fn(() => 0) });
      clicar("comprar p01");
      expect(devolvido.valores).toEqual([0]);
      expect(vibracao.success).not.toHaveBeenCalled();

      monta(produtos(1), { onAddToCart: vi.fn(() => 2) });
      clicar("comprar p01");
      expect(devolvido.valores).toEqual([0, 2]);
      expect(vibracao.success).toHaveBeenCalledTimes(1);
    });

    it("comprar por opções entrega produto, opção, nomes e quantidade, e só celebra se entrou", () => {
      const lista = produtos(1);
      const comOpcoes = vi.fn(() => 0);
      monta(lista, { onAddToCartWithVariants: comOpcoes });
      expect(cartoes()[0].getAttribute("data-modo-opcoes")).toBe("true");
      clicar("opcoes p01");
      expect(comOpcoes).toHaveBeenCalledWith(lista[0], "v1", "Azul / M", 2);
      expect(devolvido.valores).toEqual([0]);
      expect(vibracao.success).not.toHaveBeenCalled();

      comOpcoes.mockReturnValue(1);
      clicar("opcoes p01");
      expect(vibracao.success).toHaveBeenCalledTimes(1);
    });

    it("sem a escolha de opções na grade, o cartão fica no modo 'ir para o produto'", () => {
      monta(produtos(1));
      expect(cartoes()[0].getAttribute("data-modo-opcoes")).toBe("false");
    });
  });
});
