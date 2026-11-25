// @vitest-environment jsdom
//
// Banner (modelo antigo, foto + texto): as cores. A lojista pode deixar o
// botão, a película e os textos SEM cor escolhida, e então valem os padrões da
// casa (botão amarelo com letra preta, película preta a 40%); com cor escolhida
// vale a dela. Uma película de 0% fica TRANSPARENTE (não volta a 40%).
//  - botão: fundo `#FFBF00` e letra `#000000` por padrão;
//  - película: `#000000` a 40% por padrão; 25% vira 0,25; 0% vira 0;
//  - título e subtítulo só ganham `color` quando a lojista escolheu uma.
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

describe("BannerCarousel — cores do botão, da película e dos textos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/components/ui/custom/BannerCarousel");
  }, 60_000);

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

  async function renderizar(extra: Partial<Banner> = {}) {
    const banner: Banner = {
      id: "b-cores",
      imageUrl: "https://example.com/banner.jpg",
      title: "Semana da cozinha",
      subtitle: "Panelas com preço de fábrica",
      position: "home_top",
      active: true,
      order: 1,
      link: "/?category=Cozinha",
      buttonText: "Ver ofertas",
      templateType: "default",
      ...extra,
    };
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(<BannerCarousel banners={[banner]} autoPlay={false} />);
    });
  }

  const botao = () => hospedeiro.querySelector("button") as HTMLButtonElement;
  const titulo = () => hospedeiro.querySelector("h2") as HTMLElement;
  const subtitulo = () =>
    [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Panelas"),
    ) as HTMLElement;
  // A película é a camada que só tem cor de fundo e opacidade.
  const pelicula = () =>
    [...hospedeiro.querySelectorAll<HTMLElement>("div")].find(
      (d) => d.style.backgroundColor !== "" && d.style.opacity !== "",
    ) as HTMLElement;

  it("sem cores escolhidas: botão amarelo com letra preta e película preta a 40%", async () => {
    await renderizar();
    expect(botao().style.backgroundColor).toBe("rgb(255, 191, 0)");
    expect(botao().style.color).toBe("rgb(0, 0, 0)");
    expect(pelicula().style.backgroundColor).toBe("rgb(0, 0, 0)");
    expect(pelicula().style.opacity).toBe("0.4");
  });

  it("com cores escolhidas: valem as da lojista", async () => {
    await renderizar({
      buttonBgColor: "#112233",
      buttonTextColor: "#ffeedd",
      overlayColor: "#334455",
      overlayOpacity: 25,
    });
    expect(botao().style.backgroundColor).toBe("rgb(17, 34, 51)");
    expect(botao().style.color).toBe("rgb(255, 238, 221)");
    expect(pelicula().style.backgroundColor).toBe("rgb(51, 68, 85)");
    expect(pelicula().style.opacity).toBe("0.25");
  });

  it("película a 0%: fica transparente, não volta ao padrão de 40%", async () => {
    await renderizar({ overlayOpacity: 0 });
    expect(pelicula().style.opacity).toBe("0");
  });

  it("título e subtítulo sem cor escolhida não ganham `color`; com cor, ganham", async () => {
    await renderizar();
    expect(titulo().style.color).toBe("");
    expect(subtitulo().style.color).toBe("");

    await renderizar({ titleColor: "#aa0000", subtitleColor: "#00aa00" });
    expect(titulo().style.color).toBe("rgb(170, 0, 0)");
    expect(subtitulo().style.color).toBe("rgb(0, 170, 0)");
  });

  it("modelo neon: o brilho usa a cor do título e do botão; sem cor, o amarelo da casa", async () => {
    await renderizar({ templateType: "neon_glow" });
    expect(titulo().style.textShadow).toBe("0 0 8px #FFBF00");
    expect(botao().style.boxShadow).toBe("0 0 12px #FFBF00");

    await renderizar({
      templateType: "neon_glow",
      titleColor: "#00ffaa",
      buttonBgColor: "#0000ff",
    });
    expect(titulo().style.textShadow).toBe("0 0 8px #00ffaa");
    expect(botao().style.boxShadow).toBe("0 0 12px #0000ff");
  });

  it("fora do modelo neon não há brilho nenhum", async () => {
    await renderizar({ titleColor: "#00ffaa", buttonBgColor: "#0000ff" });
    expect(titulo().style.textShadow).toBe("");
    expect(botao().style.boxShadow).toBe("");
  });
});
