// @vitest-environment jsdom
import { ProductCarousel } from "@/components/ui/custom/ProductCarousel";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: () => <article>Produto de teste</article>,
}));

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Rolar = (options?: ScrollToOptions | number, y?: number) => void;

const produtos = [{ id: "a" }, { id: "b" }] as Product[];

describe("carrossel — setas só no computador", () => {
  let root: Root;
  let host: HTMLDivElement;
  let faixa: HTMLDivElement;
  let scrollBy: ReturnType<typeof vi.fn<Rolar>>;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root.render(
        <ProductCarousel
          title="Produtos"
          products={produtos}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      ),
    );
    faixa = host.querySelector<HTMLDivElement>(".overflow-x-auto")!;
    Object.defineProperties(faixa, {
      clientWidth: { configurable: true, value: 600 },
      scrollWidth: { configurable: true, value: 1400 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
    });
    scrollBy = vi.fn<Rolar>();
    faixa.scrollBy = scrollBy;
    rolar(0);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function rolar(left: number) {
    act(() => {
      faixa.scrollLeft = left;
      faixa.dispatchEvent(new Event("scroll"));
    });
  }

  function seta(nome: string) {
    return host.querySelector<HTMLButtonElement>(
      `button[aria-label="${nome}"]`,
    );
  }

  it("avança uma página útil com movimento suave e nome acessível", () => {
    const direita = seta("Ver próximos produtos");
    expect(direita).not.toBeNull();
    expect(direita?.type).toBe("button");
    act(() => direita!.click());
    expect(scrollBy).toHaveBeenCalledWith({ left: 552, behavior: "smooth" });
  });

  it("a anterior só existe após rolar; a próxima some ao chegar ao fim", () => {
    expect(seta("Ver produtos anteriores")).toBeNull();
    rolar(400);
    const esquerda = seta("Ver produtos anteriores");
    expect(esquerda).not.toBeNull();
    act(() => esquerda!.click());
    expect(scrollBy).toHaveBeenCalledWith({ left: -552, behavior: "smooth" });
    rolar(800);
    expect(seta("Ver próximos produtos")).toBeNull();
    rolar(0);
    expect(seta("Ver produtos anteriores")).toBeNull();
  });

  it("ambos os botões são hidden lg:flex, com alvo de 44px e foco visível", () => {
    rolar(400);
    for (const nome of ["Ver produtos anteriores", "Ver próximos produtos"]) {
      const botao = seta(nome);
      expect(botao).not.toBeNull();
      for (const classe of [
        "hidden",
        "lg:flex",
        "h-11",
        "w-11",
        "focus-visible:ring-2",
      ]) {
        expect(botao!.classList.contains(classe), classe).toBe(true);
      }
      expect(botao!.type).toBe("button");
    }
  });

  it("preserva literalmente as classes do container rolável do celular", () => {
    expect(faixa.className).toBe(
      "scrollbar-hide flex snap-x snap-mandatory items-stretch gap-4 overflow-x-auto scroll-smooth pb-2",
    );
  });

  it("não monta setas quando todos os produtos cabem", () => {
    Object.defineProperty(faixa, "scrollWidth", { value: 600 });
    rolar(0);
    expect(seta("Ver produtos anteriores")).toBeNull();
    expect(seta("Ver próximos produtos")).toBeNull();
  });

  it("respeita movimento reduzido sem consultar largura de janela", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
    } as MediaQueryList);
    let comportamentoDuranteClique = "";
    scrollBy.mockImplementation(() => {
      comportamentoDuranteClique = faixa.style.scrollBehavior;
    });
    act(() => seta("Ver próximos produtos")!.click());
    // "auto" na API herda scroll-smooth do CSS: a preferência precisa vencer.
    expect(comportamentoDuranteClique).toBe("auto");
    expect(faixa.style.scrollBehavior).toBe("");
    expect(window.matchMedia).toHaveBeenCalledWith(
      "(prefers-reduced-motion: reduce)",
    );
    expect(scrollBy).toHaveBeenCalledWith({ left: 552, behavior: "auto" });
  });
});
