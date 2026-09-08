// @vitest-environment jsdom
//
// Frente M7 (laudo de acessibilidade da loja, 20260905, item M7 — WCAG 2.2.2):
// dois defeitos medidos no banner da vitrine.
//
// 1) Contraste: o lojista pode deixar o overlay em 0% no painel, e o título
//    branco some sobre banner de foto clara — o overlay do lojista (0-100%,
//    `BannerCarousel.tsx:139-147`) é a única coisa que escurece hoje, e ele
//    ACEITA zero. A correção NÃO troca o número do slider (isso mudaria o
//    que o lojista já escolheu): um escurecimento (scrim) LOCAL, atrás só do
//    bloco de texto, some ao overlay dele em vez de substituí-lo. A mesma
//    conta tem que valer na loja (`BannerCarousel`) e na prévia do painel
//    (`ImageAdjuster`) — por isso a fonte única `classeDoScrimDoBanner` em
//    `src/lib/banner-scrim.ts`.
//
// 2) Movimento: o carrossel passava sozinho (`setInterval`) sem NENHUMA
//    pausa — nem por hover, nem por foco de teclado, nem para quem pediu
//    "menos movimento" no sistema (`prefers-reduced-motion: reduce`). Este
//    arquivo trava as duas pausas.
//
// Por que monta o componente de VERDADE (createRoot + act) em vez de
// @testing-library/react: a lib não está instalada neste projeto (ver
// tests/front/admin-kpi-carousel-compacto.test.tsx) — o padrão da casa é
// createRoot/act, com eventos DOM nativos despachados à mão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classeDoScrimDoBanner } from "@/lib/banner-scrim";
import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// de home-nao-pula-contrato.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O embla real não roda em jsdom (mede layout de verdade). Nenhum teste do
// repo mockava isto antes — a forma abaixo é a mínima que o BannerCarousel
// precisa: um ref qualquer e uma API com os métodos que o componente chama.
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

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Stub de matchMedia POR QUERY: só `prefers-reduced-motion` responde de
 * acordo com `reduzMovimento`; qualquer outra query devolve `false` — um
 * `matches: true` para tudo esconderia a mutação M4 (ver relatório). */
function matchMediaStub(reduzMovimento: boolean) {
  return (consulta: string) => ({
    matches: reduzMovimento && consulta.includes("prefers-reduced-motion"),
    media: consulta,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  });
}

function criarBanner(overrides: Partial<Banner> & { id: string }): Banner {
  return {
    imageUrl: "https://example.com/banner.jpg",
    title: "Título do banner",
    position: "home_top",
    active: true,
    order: 1,
    overlayOpacity: 0,
    ...overrides,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("matchMedia", matchMediaStub(false));
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
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("classeDoScrimDoBanner: a fonte única do escurecimento", () => {
  it("glassmorphic não recebe scrim (a caixa do texto já escurece)", () => {
    expect(classeDoScrimDoBanner("glassmorphic")).toBe("");
  });

  it("split_center escurece o centro", () => {
    expect(classeDoScrimDoBanner("split_center")).toContain("radial-gradient");
  });

  it("default e indefinido escurecem o rodapé", () => {
    expect(classeDoScrimDoBanner("default")).toContain("bg-gradient-to-t");
    expect(classeDoScrimDoBanner(undefined)).toBe(
      classeDoScrimDoBanner("default"),
    );
  });
});

describe("BannerCarousel: o texto sempre tem escurecimento atrás", () => {
  async function montar(banners: Banner[]) {
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(<BannerCarousel banners={banners} autoPlay={false} />);
    });
  }

  const scrims = () =>
    hospedeiro.querySelectorAll<HTMLDivElement>('div[aria-hidden="true"]');

  it("overlayOpacity 0 + título: o scrim padrão está atrás do texto", async () => {
    await montar([criarBanner({ id: "b1", overlayOpacity: 0 })]);

    const divs = Array.from(scrims());
    expect(divs.length).toBeGreaterThan(0);
    expect(divs.some((d) => d.className.includes("bg-gradient-to-t"))).toBe(
      true,
    );
  });

  it("overlayOpacity 40: o scrim continua lá (soma ao overlay, não substitui)", async () => {
    await montar([criarBanner({ id: "b1", overlayOpacity: 40 })]);

    const divs = Array.from(scrims());
    expect(divs.some((d) => d.className.includes("bg-gradient-to-t"))).toBe(
      true,
    );
  });

  it("banner sem texto (showTextOverlay false): nem scrim nem overlay", async () => {
    await montar([
      criarBanner({ id: "b1", showTextOverlay: false, title: "Tem título" }),
    ]);

    expect(scrims().length).toBe(0);
    expect(
      hospedeiro.querySelectorAll(".absolute.inset-0.transition-opacity")
        .length,
    ).toBe(0);
  });

  it("banner com todos os campos de texto vazios: nem scrim nem overlay", async () => {
    await montar([
      criarBanner({
        id: "b1",
        title: null,
        subtitle: undefined,
        buttonText: undefined,
        badgeText: undefined,
      }),
    ]);

    expect(scrims().length).toBe(0);
    expect(
      hospedeiro.querySelectorAll(".absolute.inset-0.transition-opacity")
        .length,
    ).toBe(0);
  });

  it("templateType glassmorphic: não duplica o escurecimento", async () => {
    await montar([
      criarBanner({
        id: "b1",
        templateType: "glassmorphic",
        overlayOpacity: 0,
      }),
    ]);

    expect(scrims().length).toBe(0);
  });
});

describe("ImageAdjuster: a prévia mostra o MESMO escurecimento da loja", () => {
  async function montarPrevia(bannerPreview: {
    title?: string;
    overlayOpacity?: number;
    templateType?: string;
  }) {
    const { ImageAdjuster } = await import(
      "@/components/ui/custom/ImageAdjuster"
    );
    act(() => {
      raiz.render(
        <ImageAdjuster
          isOpen
          onClose={() => {}}
          onConfirm={async () => {}}
          imageUrl="https://example.com/banner.jpg"
          allowedPresets={["2:1"]}
          defaultPreset="2:1"
          bannerPreview={bannerPreview}
        />,
      );
    });
    const img =
      document.body.querySelector<HTMLImageElement>('img[alt="Ajuste"]');
    expect(img, "a prévia precisa renderizar a <img> do editor").not.toBeNull();
    act(() => {
      img?.dispatchEvent(new Event("load"));
    });
  }

  const scrimsDaPrevia = () =>
    document.body.querySelectorAll<HTMLDivElement>('div[aria-hidden="true"]');

  it("overlayOpacity 0 + título: a prévia renderiza a MESMA classe do carrossel (default)", async () => {
    await montarPrevia({
      title: "Título",
      overlayOpacity: 0,
      templateType: "default",
    });

    const esperado = classeDoScrimDoBanner("default");
    const divs = Array.from(scrimsDaPrevia());
    expect(divs.some((d) => d.className.includes(esperado))).toBe(true);
  });

  it("templateType split_center: a prévia também casa com a fonte única", async () => {
    await montarPrevia({
      title: "Título",
      overlayOpacity: 0,
      templateType: "split_center",
    });

    const esperado = classeDoScrimDoBanner("split_center");
    const divs = Array.from(scrimsDaPrevia());
    expect(divs.some((d) => d.className.includes(esperado))).toBe(true);
  });
});

describe("BannerCarousel: o carrossel para de passar sozinho", () => {
  async function montar(
    banners: Banner[],
    props: { autoPlay?: boolean; interval?: number } = {},
  ) {
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(<BannerCarousel banners={banners} {...props} />);
    });
  }

  const doisBanners = () => [
    criarBanner({ id: "b1" }),
    criarBanner({ id: "b2", imageUrl: "https://example.com/banner2.jpg" }),
  ];

  const regiao = () =>
    hospedeiro.querySelector<HTMLDivElement>('[role="region"]')!;

  it("autoPlay com 2+ banners: após o intervalo, scrollNext é chamado", async () => {
    vi.useFakeTimers();
    await montar(doisBanners(), { autoPlay: true, interval: 2000 });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("mouse sobre o carrossel pausa; ao sair, volta a passar", async () => {
    vi.useFakeTimers();
    await montar(doisBanners(), { autoPlay: true, interval: 2000 });

    act(() => {
      regiao().dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();

    act(() => {
      regiao().dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("foco num elemento interno pausa o autoplay", async () => {
    vi.useFakeTimers();
    await montar(doisBanners(), { autoPlay: true, interval: 2000 });

    const indicador = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ir para slide"]',
    );
    expect(indicador, "precisa ter o botão indicador do slide").not.toBeNull();

    act(() => {
      indicador?.focus();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
  });

  it("prefers-reduced-motion: reduce — o autoplay NUNCA arma, mesmo sem hover", async () => {
    vi.stubGlobal("matchMedia", matchMediaStub(true));
    vi.useFakeTimers();
    await montar(doisBanners(), { autoPlay: true, interval: 1000 });

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
  });

  it("autoPlay={false} continua sem autoplay", async () => {
    vi.useFakeTimers();
    await montar(doisBanners(), { autoPlay: false, interval: 1000 });

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
  });

  // Laudo do revisor no PR #477 (rodada 2): `pausado` era UM booleano para
  // dois motivos (mouse e foco). Cada saída zerava os dois — mouse saindo
  // com foco ainda dentro (ou o inverso) destravava o autoplay incorreto.
  it("mouse sai mas o foco continua dentro → não avança", async () => {
    vi.useFakeTimers();
    await montar(doisBanners(), { autoPlay: true, interval: 2000 });

    const indicador = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ir para slide"]',
    );
    expect(indicador, "precisa ter o botão indicador do slide").not.toBeNull();

    act(() => {
      regiao().dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });
    act(() => {
      indicador?.focus();
    });
    act(() => {
      regiao().dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
  });

  it("foco sai mas o mouse continua em cima → não avança", async () => {
    vi.useFakeTimers();
    await montar(doisBanners(), { autoPlay: true, interval: 2000 });

    const indicador = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ir para slide"]',
    );
    expect(indicador, "precisa ter o botão indicador do slide").not.toBeNull();

    act(() => {
      regiao().dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });
    act(() => {
      indicador?.focus();
    });
    act(() => {
      indicador?.blur();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
  });

  it("mouse sai E foco sai → volta a avançar (controle: a pausa não fica presa)", async () => {
    vi.useFakeTimers();
    await montar(doisBanners(), { autoPlay: true, interval: 2000 });

    const indicador = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ir para slide"]',
    );
    expect(indicador, "precisa ter o botão indicador do slide").not.toBeNull();

    act(() => {
      regiao().dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });
    act(() => {
      indicador?.focus();
    });
    act(() => {
      indicador?.blur();
    });
    act(() => {
      regiao().dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });
});
