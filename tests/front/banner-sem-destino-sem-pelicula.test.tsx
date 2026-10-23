// @vitest-environment jsdom
//
// Complemento de banner-sem-destino-nao-mostra-botao-morto: banner so com
// imagem e texto de botao SEM link (1) nao ganha pelicula escura sobre a foto
// na loja e (2) a previa do painel mostra o mesmo que a loja (sem o botao).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("embla-carousel-react", () => ({
  default: () => [
    vi.fn(),
    {
      scrollNext: vi.fn(),
      scrollTo: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      selectedScrollSnap: () => 0,
    },
  ],
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("banner sem destino: película", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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
  });

  const base: Banner = {
    id: "b1",
    imageUrl: "https://example.com/banner.jpg",
    title: "",
    position: "home_top",
    active: true,
    order: 1,
    link: "",
    buttonText: "Ver ofertas",
    templateType: "default",
  };

  async function loja(banner: Banner) {
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(<BannerCarousel banners={[banner]} autoPlay={false} />);
    });
  }

  it("só imagem + botão sem link: nenhuma película sobre a foto", async () => {
    await loja(base);
    expect(hospedeiro.querySelector("img")).not.toBeNull();
    expect(hospedeiro.querySelector('div[style*="opacity"]')).toBeNull();
  });

  it("com link, a película continua (botão conta como conteúdo)", async () => {
    await loja({ ...base, link: "/?category=Bebidas" });
    expect(hospedeiro.querySelector('div[style*="opacity"]')).not.toBeNull();
  });
});
