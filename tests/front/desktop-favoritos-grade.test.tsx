import type { Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { AnimatePresence } from "framer-motion";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const produtos = [
  { id: "favorito", name: "Vestido", isActive: true },
] as Product[];
const navegar = vi.fn();
const favoritosRefresh = vi.fn();
let favoritosErro: string | null = null;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, products: produtos }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ erro: favoritosErro, refresh: favoritosRefresh }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: () => <article>Vestido</article>,
}));
vi.mock("@/components/ui/custom/ProductCardSkeleton", () => ({
  ProductCardSkeleton: () => <article>Carregando produto</article>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Favoritos no computador — F4", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    navegar.mockClear();
    favoritosRefresh.mockClear();
    favoritosErro = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function renderizar(loading = false, favorites = produtos) {
    act(() =>
      raiz.render(
        <AnimatePresence>
          <FavoritesView
            favorites={favorites}
            loading={loading}
            onToggleFavorite={vi.fn()}
            onProductClick={vi.fn()}
            onNavigate={navegar}
          />
        </AnimatePresence>,
      ),
    );
  }

  it.each([false, true])(
    "container, cabeçalho e grade mantêm celular (loading=%s)",
    (loading) => {
      renderizar(loading);
      const pagina = hospedeiro.firstElementChild as HTMLElement;
      expect(classesDoCelular(pagina.className)).toBe(
        `${loading ? "pb-customer" : "pb-customer-summary"} min-h-full overflow-x-hidden bg-zinc-50/30`,
      );
      expect(pagina.classList.contains("lg:max-w-[1280px]")).toBe(true);
      const titulo = hospedeiro.querySelector("h1")!;
      expect(classesDoCelular(titulo.className)).toBe(
        "pt-0.5 text-[13px] font-black uppercase tracking-[0.25em] text-zinc-950",
      );
      expect(titulo.classList.contains("lg:text-4xl")).toBe(true);
      const cabecalho = titulo.parentElement!.parentElement!;
      expect(classesDoCelular(cabecalho.className)).toBe(
        "sticky top-[-2px] z-40 flex items-center justify-between border-b border-zinc-100 bg-white/80 p-4 backdrop-blur-md transition-all duration-300 xs:px-6",
      );
      expect(cabecalho.classList.contains("lg:top-6")).toBe(true);
      const grade = hospedeiro.querySelector(".grid")!;
      expect(classesDoCelular(grade.className)).toBe(
        "grid grid-cols-2 gap-4 sm:gap-6",
      );
      expect(grade.classList.contains("lg:grid-cols-4")).toBe(true);
      expect(grade.classList.contains("xl:grid-cols-5")).toBe(true);
      expect(grade.classList.contains("lg:gap-5")).toBe(true);
    },
  );

  it("mantém o CTA móvel montado e o esconde apenas no desktop", () => {
    renderizar();
    expect(hospedeiro.textContent).not.toContain("Continuar comprando");
    const portal = document.querySelector(".bottom-docked-navigation")!;
    expect(classesDoCelular(portal.className)).toBe(
      "bottom-docked-navigation pointer-events-none fixed inset-x-0 z-[90] px-6 md:bottom-[104px] md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2",
    );
    expect(portal.classList.contains("lg:hidden")).toBe(true);
  });

  it("Continuar comprando nasce só no desktop e leva ao início", () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: consulta === "(min-width: 1024px)",
    }));
    renderizar();
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Continuar comprando"),
    );
    expect(botao).toBeDefined();
    expect(
      hospedeiro
        .querySelector("h1")!
        .parentElement!.parentElement!.contains(botao!),
    ).toBe(true);
    act(() => botao!.click());
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("vazio mantém o herói central e abre as quatro sugestões no desktop", () => {
    renderizar(false, []);
    const pagina = hospedeiro.firstElementChild as HTMLElement;
    expect(classesDoCelular(pagina.className)).toBe(
      "pb-customer relative flex min-h-full flex-col items-center justify-start overflow-x-hidden bg-gradient-to-b from-zinc-50 via-white to-white px-4 py-8 sm:px-6",
    );
    const sugestoes =
      hospedeiro.querySelector("h3")!.parentElement!.parentElement!;
    expect(classesDoCelular(sugestoes.className)).toBe(
      "mt-10 w-full max-w-md border-t border-zinc-100 pt-6",
    );
    expect(sugestoes.classList.contains("lg:max-w-5xl")).toBe(true);
    const grade = sugestoes.querySelector(".grid")!;
    expect(classesDoCelular(grade.className)).toBe(
      "grid grid-cols-2 gap-3 sm:gap-4",
    );
    expect(grade.classList.contains("lg:grid-cols-4")).toBe(true);
    expect(grade.classList.contains("lg:gap-5")).toBe(true);
  });

  it("distingue erro de lista vazia e permite tentar novamente", () => {
    favoritosErro = "Falha ao consultar favoritos.";
    renderizar(false, []);

    expect(hospedeiro.textContent).toContain("Não conseguimos carregar");
    expect(hospedeiro.textContent).toContain("Falha ao consultar favoritos.");
    expect(hospedeiro.textContent).not.toContain("Sua lista de desejos");

    const tentarNovamente = [...hospedeiro.querySelectorAll("button")].find(
      (botao) => botao.textContent?.includes("Tentar de novo"),
    );
    expect(tentarNovamente).toBeDefined();
    act(() => tentarNovamente!.click());
    expect(favoritosRefresh).toHaveBeenCalledOnce();
  });
});
