// @vitest-environment jsdom
//
// Banner de modelo antigo com texto de botão e SEM link: o cliente via um
// botão amarelo chamativo que não fazia nada ao tocar. Sem destino, o botão
// não aparece; com destino, continua igual (o toque sobe para o banner).
//
// Vermelho contra o HEAD: o <button> era renderizado sem checar o destino.
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

describe("BannerCarousel: botão do banner só existe quando há para onde ir", () => {
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
    globalThis.history.replaceState({}, "", "/");
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
  });

  async function renderizar(link: string) {
    const banner: Banner = {
      id: "b1",
      imageUrl: "https://example.com/banner.jpg",
      title: "Campanha",
      position: "home_top",
      active: true,
      order: 1,
      link,
      buttonText: "Ver ofertas",
      templateType: "default",
    };
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(<BannerCarousel banners={[banner]} autoPlay={false} />);
    });
  }

  it.each(["", "   ", "javascript:alert(1)"])(
    "link '%s' (sem destino): nenhum botão 'Ver ofertas'",
    async (link) => {
      await renderizar(link);
      expect(hospedeiro.textContent).not.toContain("Ver ofertas");
      expect(hospedeiro.querySelector("button")).toBeNull();
    },
  );

  it("link com destino: o botão continua lá e o toque no banner navega", async () => {
    await renderizar("/?category=Bebidas");
    const botao = hospedeiro.querySelector("button");
    expect(botao?.textContent).toBe("Ver ofertas");
    const pushState = vi.spyOn(globalThis.history, "pushState");
    await act(async () => {
      botao?.click();
    });
    expect(pushState).toHaveBeenCalled();
    expect(
      new URLSearchParams(globalThis.location.search).get("category"),
    ).toBe("Bebidas");
  });
});
