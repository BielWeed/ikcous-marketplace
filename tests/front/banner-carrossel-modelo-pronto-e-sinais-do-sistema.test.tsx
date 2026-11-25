// @vitest-environment jsdom
//
// Carrossel de banners — bordas sem guarda:
//  1. Modelo PRONTO (arte feita pelo app, não a foto crua): só a 1a foto do
//     topo perde o esmaecer (as seguintes seguem esmaecendo); `data-varios`
//     diz se há mais de um banner; sem destino o texto do botão não aparece.
//  2. O sistema pode mudar a preferência "reduzir movimento" COM o carrossel
//     aberto: ligou, o autoplay para; desligou, volta a girar.
//  3. O mouse "emulado" que o celular manda logo após o toque não pode segurar o
//     carrossel parado, mesmo que chegue ANTES de o dedo sair da tela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

// Marca TODA foto como visível: a 2a foto também monta o <img> e dá para comparar.
class ObservadorQueVe {
  private readonly aoVer: IntersectionObserverCallback;
  constructor(aoVer: IntersectionObserverCallback) {
    this.aoVer = aoVer;
  }
  observe(alvo: Element) {
    this.aoVer(
      [{ isIntersecting: true, target: alvo } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

function banner(id: string, extra: Partial<Banner> = {}): Banner {
  return {
    id,
    imageUrl: `https://example.com/${id}.jpg`,
    title: `Banner ${id}`,
    position: "home_top",
    active: true,
    order: 1,
    overlayOpacity: 0,
    ...extra,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeAll(async () => {
  await import("@/components/ui/custom/BannerCarousel");
}, 60_000);

beforeEach(() => {
  emblaApi.scrollNext.mockClear();
  globalThis.history.replaceState({ view: "home" }, "", "/");
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BannerCarousel — modelo pronto (arte do app)", () => {
  const PRONTO = "pronto_destaque";

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ObservadorQueVe);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });

  async function montar(banners: Banner[], primeiraSemFade = false) {
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(
        <BannerCarousel
          banners={banners}
          autoPlay={false}
          primeiraSemFade={primeiraSemFade}
        />,
      );
    });
  }
  const fotos = () => Array.from(hospedeiro.querySelectorAll("img"));
  const temTransicao = (img: HTMLImageElement) =>
    img.className.includes("transition-opacity");

  it("com primeiraSemFade, só a 1a arte entra seca; a 2a segue esmaecendo", async () => {
    await montar(
      [
        banner("um", { templateType: PRONTO }),
        banner("dois", { templateType: PRONTO, order: 2 }),
      ],
      true,
    );
    expect(fotos().length).toBeGreaterThanOrEqual(2);
    expect(temTransicao(fotos()[0])).toBe(false);
    expect(temTransicao(fotos()[1])).toBe(true);
  });

  it("sem primeiraSemFade, as duas esmaecem", async () => {
    await montar([
      banner("um", { templateType: PRONTO }),
      banner("dois", { templateType: PRONTO, order: 2 }),
    ]);
    expect(temTransicao(fotos()[0])).toBe(true);
    expect(temTransicao(fotos()[1])).toBe(true);
  });

  it("data-varios: 'false' com um banner, 'true' com dois", async () => {
    await montar([banner("um", { templateType: PRONTO })]);
    expect(
      hospedeiro
        .querySelector(".banner-pronto-slide")
        ?.getAttribute("data-varios"),
    ).toBe("false");

    await montar([
      banner("um", { templateType: PRONTO }),
      banner("dois", { templateType: PRONTO, order: 2 }),
    ]);
    const marcas = Array.from(
      hospedeiro.querySelectorAll(".banner-pronto-slide"),
    ).map((s) => s.getAttribute("data-varios"));
    expect(marcas).toEqual(["true", "true"]);
  });

  it("sem destino o texto do botão não aparece; com destino aparece", async () => {
    await montar([
      banner("um", {
        templateType: PRONTO,
        title: "Liquidação",
        buttonText: "Aproveitar agora",
        link: "",
      }),
    ]);
    expect(hospedeiro.textContent).not.toContain("Aproveitar agora");

    await montar([
      banner("um", {
        templateType: PRONTO,
        title: "Liquidação",
        buttonText: "Aproveitar agora",
        link: "/?category=Casa",
      }),
    ]);
    expect(hospedeiro.textContent).toContain("Aproveitar agora");
  });
});

describe("BannerCarousel — sinais do sistema e do dedo", () => {
  const INTERVALO = 2000;
  let ouvintesDeMovimento: Array<(e: { matches: boolean }) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T15:00:00Z"));
    ouvintesDeMovimento = [];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: false,
      media: q,
      addEventListener: (
        _: string,
        ouvinte: (e: { matches: boolean }) => void,
      ) => {
        if (q.includes("prefers-reduced-motion")) {
          ouvintesDeMovimento.push(ouvinte);
        }
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });

  async function montar() {
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(
        <BannerCarousel
          banners={[banner("a"), banner("b", { order: 2 })]}
          interval={INTERVALO}
        />,
      );
    });
  }
  const passar = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  const regiao = () =>
    hospedeiro.querySelector<HTMLDivElement>('[role="region"]') as HTMLElement;
  const disparar = (evento: Event) =>
    act(() => {
      regiao().dispatchEvent(evento);
    });

  it("o sistema liga 'reduzir movimento' com o carrossel aberto: para; desliga: volta a girar", async () => {
    await montar();
    passar(INTERVALO);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
    expect(ouvintesDeMovimento).toHaveLength(1);

    act(() => ouvintesDeMovimento[0]({ matches: true }));
    passar(INTERVALO * 5);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);

    act(() => ouvintesDeMovimento[0]({ matches: false }));
    passar(INTERVALO);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(2);
  });

  it("mouse emulado que chega ANTES de o dedo sair não segura o carrossel", async () => {
    await montar();
    disparar(new Event("touchstart", { bubbles: true }));
    // O navegador do celular emula o mouse junto do toque.
    disparar(
      new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    // O dedo sai: nenhum contato resta na tela.
    disparar(new Event("touchend", { bubbles: true }));
    passar(INTERVALO);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });
});
