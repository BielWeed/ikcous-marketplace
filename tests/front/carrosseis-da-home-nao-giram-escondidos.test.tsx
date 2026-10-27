// @vitest-environment jsdom
//
// Lote 226 (item 8): a Home fica montada (escondida) quando a cliente vai ao
// carrinho/produto, e os carrosséis seguiam girando e atualizando estado.
// Escondida = a aba da Home perdeu a classe `active-scroll-container`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BannerCarousel } from "@/components/ui/custom/BannerCarousel";
import { InfoBlockCarousel } from "@/components/ui/custom/InfoBlockCarousel";
import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  raiz: { current: null as HTMLElement | null },
  emblaApi: {
    scrollNext: vi.fn(),
    scrollTo: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    selectedScrollSnap: () => 0,
    rootNode: () => h.raiz.current,
  },
}));

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), h.emblaApi],
}));

class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function banner(id: string): Banner {
  return {
    id,
    title: `Banner ${id}`,
    image: `https://x.test/${id}.jpg`,
    link: "",
  } as unknown as Banner;
}

describe("carrosséis da Home não giram com a Home escondida", () => {
  let raiz: Root;
  let aba: HTMLDivElement;
  let alvo: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    h.emblaApi.scrollNext.mockClear();
    vi.stubGlobal("IntersectionObserver", StubObserver);
    vi.stubGlobal("ResizeObserver", StubObserver);
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    // Casca igual à do App: <div class="admin-tab-pane [active-scroll-container]">
    aba = document.createElement("div");
    aba.className = "admin-tab-pane active-scroll-container";
    alvo = document.createElement("div");
    aba.append(alvo);
    document.body.append(aba);
    h.raiz.current = alvo;
    raiz = createRoot(alvo);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    aba.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function montarBanner() {
    act(() => {
      raiz.render(
        <BannerCarousel banners={[banner("a"), banner("b")]} interval={5000} />,
      );
    });
  }

  it("Home visível: o banner gira", () => {
    montarBanner();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(h.emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("Home escondida: o banner não gira; ao voltar, volta a girar", () => {
    montarBanner();
    aba.classList.remove("active-scroll-container");
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(h.emblaApi.scrollNext).not.toHaveBeenCalled();

    aba.classList.add("active-scroll-container");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(h.emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("Home escondida: o carrossel de blocos de informação não gira", () => {
    act(() => {
      raiz.render(
        <InfoBlockCarousel interval={4000}>
          <div>um</div>
          <div>dois</div>
        </InfoBlockCarousel>,
      );
    });
    aba.classList.remove("active-scroll-container");
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(h.emblaApi.scrollNext).not.toHaveBeenCalled();
  });
});
