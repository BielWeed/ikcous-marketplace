// @vitest-environment jsdom
//
// Banner da vitrine: o toque tem que chegar no destino que a lojista escolheu.
//
// Dois defeitos medidos numa caçada (14/10):
//
// 1) Banner de CATEGORIA com "&", "+" ou "#" no nome ("Cama & Banho"): o painel
//    montava `/?category=Cama & Banho` sem codificar, o "&" virava separador de
//    parâmetro e a Home recebia a categoria "Cama " — a cliente via "Nenhum
//    produto agora" e nenhum botão de categoria marcado. O link novo sai
//    codificado, e o banner JÁ gravado com o link cru passa a funcionar na hora
//    do toque (sem migrar dado).
//
// 2) Banner "Página da Loja" nascia com `/produtos`, endereço que a loja não
//    tem: a cliente tocava e nada acontecia. Novo e antigo levam à Home.
//
// O leitor de endereço do App.tsx lê a categoria com
// `new URLSearchParams(location.search).get("category")`; o teste usa a mesma
// leitura depois do toque, para provar o que a Home de fato recebe.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LINK_DA_PAGINA_DA_LOJA,
  destinoDoBanner,
  linkDaCategoria,
} from "@/lib/destino-do-banner";
import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { emblaApi } = vi.hoisted(() => ({
  emblaApi: {
    scrollNext: vi.fn(),
    scrollTo: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    selectedScrollSnap: () => 0,
  },
}));

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), emblaApi],
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const categoriaNaUrl = () =>
  new URLSearchParams(globalThis.location.search).get("category");

describe("linkDaCategoria: o link novo sai codificado", () => {
  it.each([
    ["Cama & Banho", "/?category=Cama%20%26%20Banho"],
    ["Mais+Vendidos", "/?category=Mais%2BVendidos"],
    ["Moda #1", "/?category=Moda%20%231"],
    ["Bebidas", "/?category=Bebidas"],
  ])("%s", (nome, esperado) => {
    expect(linkDaCategoria(nome)).toBe(esperado);
  });

  it.each(["Cama & Banho", "Mais+Vendidos", "Moda #1", "100% Algodão"])(
    "o nome '%s' volta idêntico quando a Home lê o endereço",
    (nome) => {
      const url = new URL(linkDaCategoria(nome), "https://loja.test");
      expect(new URLSearchParams(url.search).get("category")).toBe(nome);
    },
  );
});

describe("destinoDoBanner: banner já gravado funciona sem migrar dado", () => {
  const lerCategoria = (link: string | null) =>
    new URLSearchParams(new URL(link ?? "", "https://loja.test").search).get(
      "category",
    );

  it.each([
    ["/?category=Cama & Banho", "Cama & Banho"],
    ["/?category=Cama&Banho", "Cama&Banho"],
    ["/?category=Mais+Vendidos", "Mais+Vendidos"],
    ["/?category=Moda #1", "Moda #1"],
    ["/?category=100% Algodão", "100% Algodão"],
  ])("link cru %s chega como '%s'", (cru, nome) => {
    expect(lerCategoria(destinoDoBanner(cru))).toBe(nome);
  });

  it("link já codificado não é codificado duas vezes", () => {
    const certo = "/?category=Cama%20%26%20Banho";
    expect(destinoDoBanner(certo)).toBe(certo);
    expect(lerCategoria(destinoDoBanner(certo))).toBe("Cama & Banho");
  });

  it("categoria simples fica como estava", () => {
    expect(destinoDoBanner("/?category=Bebidas")).toBe("/?category=Bebidas");
  });

  it("parâmetro de verdade depois do nome (chave=valor) é preservado", () => {
    const novo = destinoDoBanner("/?category=Roupas&utm_source=insta");
    const p = new URLSearchParams(
      new URL(novo ?? "", "https://loja.test").search,
    );
    expect(p.get("category")).toBe("Roupas");
    expect(p.get("utm_source")).toBe("insta");
  });

  it.each(["/produtos", "/produtos/", "/produtos?x=1", "/PRODUTOS"])(
    "'%s' (endereço que a loja não tem) vira a Home",
    (antigo) => {
      expect(destinoDoBanner(antigo)).toBe(LINK_DA_PAGINA_DA_LOJA);
      expect(LINK_DA_PAGINA_DA_LOJA).toBe("/");
    },
  );

  it.each([
    "/checkout",
    "/profile",
    "/product-detail?id=abc",
    "https://wa.me/5511999999999",
    "/produtos-especiais",
  ])("'%s' não é mexido", (link) => {
    expect(destinoDoBanner(link)).toBe(link);
  });
});

describe("BannerCarousel: o toque chega no destino certo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pushState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    }));
    globalThis.history.replaceState({}, "", "/");
    pushState = vi.spyOn(globalThis.history, "pushState");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    globalThis.history.replaceState({}, "", "/");
  });

  async function tocarNoBanner(link: string) {
    const banner: Banner = {
      id: "b1",
      imageUrl: "https://example.com/banner.jpg",
      title: "Campanha",
      position: "home_top",
      active: true,
      order: 1,
      link,
    };
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(<BannerCarousel banners={[banner]} autoPlay={false} />);
    });
    const alvo = hospedeiro.querySelector<HTMLElement>('[role="button"]');
    expect(alvo).not.toBeNull();
    await act(async () => {
      alvo?.click();
    });
  }

  it.each([
    ["link novo codificado", "/?category=Cama%20%26%20Banho", "Cama & Banho"],
    ["link antigo cru com &", "/?category=Cama & Banho", "Cama & Banho"],
    ["link antigo cru com +", "/?category=Mais+Vendidos", "Mais+Vendidos"],
    ["link antigo cru com #", "/?category=Moda #1", "Moda #1"],
  ])("%s: a Home recebe a categoria exata", async (_n, link, nome) => {
    await tocarNoBanner(link);
    expect(categoriaNaUrl()).toBe(nome);
    expect(globalThis.location.pathname).toBe("/");
    expect(pushState.mock.calls.at(-1)?.[0]).toMatchObject({ view: "home" });
  });

  it.each(["/produtos", "/"])(
    "página da loja (%s) leva à Home",
    async (link) => {
      globalThis.history.replaceState({}, "", "/carrinho-qualquer");
      await tocarNoBanner(link);
      expect(globalThis.location.pathname).toBe("/");
      expect(pushState.mock.calls.at(-1)?.[0]).toMatchObject({ view: "home" });
    },
  );
});
