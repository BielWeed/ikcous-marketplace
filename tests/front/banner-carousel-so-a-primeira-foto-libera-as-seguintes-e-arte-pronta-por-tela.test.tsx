// @vitest-environment jsdom
//
// Duas regras do carrossel do topo que o teste de "fotos seguintes baixam cedo"
// e o de "arte por dispositivo" não separavam:
//
//  1. Só a PRIMEIRA foto que carrega libera o download antecipado das seguintes.
//     Se a cliente já tem o segundo slide à vista (rolou, ou ele já foi
//     "visto") e é ele que carrega primeiro, isso NÃO conta como "a primeira
//     carregou": a terceira foto continua esperando a vez dela. Vale para o
//     banner comum e para o de modelo pronto.
//  2. No banner de MODELO PRONTO a arte também depende da tela: no celular vale
//     a imagem do celular, mesmo quando existe uma arte própria de computador;
//     no computador vale a arte própria.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BannerCarousel } from "@/components/ui/custom/BannerCarousel";
import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("embla-carousel-react", () => ({
  default: () => [() => {}, undefined],
}));

const h = vi.hoisted(() => ({
  desktop: false,
  listeners: new Set<() => void>(),
}));

// Observador que vê TUDO assim que observa: todos os slides já foram "vistos".
class ObservadorQueVeTudo {
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

const banner = (id: string, extras: Partial<Banner> = {}): Banner => ({
  id,
  imageUrl: `https://example.com/${id}.jpg`,
  title: "",
  position: "home_top",
  order: 1,
  active: true,
  templateType: "default",
  ...extras,
});

const fotos = () => Array.from(hospedeiro.querySelectorAll("img"));
const carregar = (img: HTMLImageElement) =>
  act(() => {
    img.dispatchEvent(new Event("load"));
  });

beforeEach(() => {
  h.desktop = false;
  h.listeners.clear();
  vi.stubGlobal("IntersectionObserver", ObservadorQueVeTudo);
  vi.stubGlobal("ResizeObserver", ObservadorQueVeTudo);
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: media === "(min-width: 1024px)" && h.desktop,
    addEventListener: (_: string, cb: () => void) => {
      if (media === "(min-width: 1024px)") h.listeners.add(cb);
    },
    removeEventListener: (_: string, cb: () => void) => {
      h.listeners.delete(cb);
    },
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("só a primeira foto libera o download antecipado das seguintes", () => {
  it.each([
    ["banner comum", "default"],
    ["banner de modelo pronto", "pronto_destaque"],
  ])(
    "%s: a segunda carregar antes da primeira não libera a terceira",
    (_, templateType) => {
      const tres = ["um", "dois", "tres"].map((id, i) =>
        banner(id, { order: i + 1, templateType }),
      );
      act(() =>
        raiz.render(
          <BannerCarousel primeiraSemFade banners={tres} autoPlay={false} />,
        ),
      );
      const antes = fotos();
      expect(antes).toHaveLength(3);
      expect(antes[2]?.getAttribute("loading")).toBe("lazy");

      carregar(antes[1] as HTMLImageElement);
      expect(fotos()[2]?.getAttribute("loading")).toBe("lazy");

      carregar(antes[0] as HTMLImageElement);
      expect(fotos()[2]?.getAttribute("loading")).toBe("eager");
    },
  );
});

describe("banner de modelo pronto: a arte segue a tela", () => {
  const pronto = banner("pronto", {
    templateType: "pronto_destaque",
    imageUrl: "https://example.com/celular.webp",
    desktopImageUrl: "https://example.com/computador.webp",
  });

  it("celular usa a arte de celular; computador usa a arte própria", async () => {
    act(() =>
      raiz.render(
        <BannerCarousel primeiraSemFade banners={[pronto]} autoPlay={false} />,
      ),
    );
    expect(fotos().map((f) => f.getAttribute("src"))).toEqual([
      "https://example.com/celular.webp",
    ]);

    await act(async () => {
      h.desktop = true;
      for (const aviso of h.listeners) aviso();
    });
    expect(fotos().map((f) => f.getAttribute("src"))).toEqual([
      "https://example.com/computador.webp",
    ]);

    await act(async () => {
      h.desktop = false;
      for (const aviso of h.listeners) aviso();
    });
    expect(fotos().map((f) => f.getAttribute("src"))).toEqual([
      "https://example.com/celular.webp",
    ]);
  });
});
