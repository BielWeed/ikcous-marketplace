// @vitest-environment jsdom
//
// No celular (a imensa maioria das clientes) o banner da Home avançava sozinho
// com o dedo em cima dele, no meio do arrasto: só mouse e foco de teclado
// pausavam o autoplay; os handlers de toque só marcavam "houve toque" para
// ignorar o mouse emulado. O dedo passa a ser um terceiro motivo de pausa,
// independente dos outros dois (a saída de um não zera os demais).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BannerCarousel } from "@/components/ui/custom/BannerCarousel";
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

class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function criarBanner(id: string): Banner {
  return {
    id,
    imageUrl: `https://example.com/${id}.jpg`,
    title: `Banner ${id}`,
    position: "home_top",
    active: true,
    order: 1,
    overlayOpacity: 0,
  };
}

const INTERVALO = 2000;

describe("BannerCarousel: o dedo no banner pausa o autoplay", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    emblaApi.scrollNext.mockClear();
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
    // Foco de teclado: jsdom não implementa `:focus-visible`.
    const original = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (
      this: Element,
      seletor: string,
    ) {
      return seletor === ":focus-visible" ? true : original.call(this, seletor);
    });
    hospedeiro = document.createElement("div");
    document.body.append(hospedeiro);
    raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(
        <BannerCarousel
          banners={[criarBanner("a"), criarBanner("b")]}
          interval={INTERVALO}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    // devolve o `hidden` nativo do jsdom (o teste do touchend perdido o troca)
    Reflect.deleteProperty(document, "hidden");
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const regiao = () =>
    hospedeiro.querySelector<HTMLDivElement>('[role="region"]')!;
  const disparar = (tipo: string) =>
    act(() => {
      regiao().dispatchEvent(new Event(tipo, { bubbles: true }));
    });
  const passar = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  const mouse = (tipo: "mouseover" | "mouseout") =>
    act(() => {
      regiao().dispatchEvent(
        new MouseEvent(tipo, { bubbles: true, relatedTarget: document.body }),
      );
    });

  it("controle: sem ninguém tocando, o banner avança após o intervalo", () => {
    passar(INTERVALO);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("dedo em cima: não avança; ao tirar o dedo, volta a avançar", () => {
    disparar("touchstart");
    passar(INTERVALO * 3);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();

    disparar("touchend");
    passar(INTERVALO);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("toque cancelado pelo sistema (touchcancel) também solta o autoplay", () => {
    disparar("touchstart");
    passar(INTERVALO * 3);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();

    disparar("touchcancel");
    passar(INTERVALO);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("o touchend perdido (app em segundo plano) não prende o autoplay para sempre", () => {
    disparar("touchstart");
    const ocultar = (oculta: boolean) =>
      act(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => oculta,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    ocultar(true);
    ocultar(false);
    passar(INTERVALO);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("o dedo sai mas o mouse continua em cima: não avança (motivos independentes)", () => {
    mouse("mouseover");
    disparar("touchstart");
    disparar("touchend");
    // touchend marca o toque; o mouse real vem antes dele, então segue pausado.
    passar(INTERVALO * 2);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
  });

  it("controle: o mouse em cima continua pausando, e ao sair volta a avançar", () => {
    mouse("mouseover");
    passar(INTERVALO);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();

    mouse("mouseout");
    passar(INTERVALO);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("controle: o foco de teclado continua pausando", () => {
    const indicador = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ir para slide"]',
    )!;
    act(() => {
      indicador.focus();
    });
    passar(INTERVALO);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
  });

  it("dedo + foco: tirar o dedo não destrava o autoplay enquanto o foco está dentro", () => {
    const indicador = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ir para slide"]',
    )!;
    act(() => {
      indicador.focus();
    });
    disparar("touchstart");
    disparar("touchend");
    passar(INTERVALO * 2);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
  });
});
