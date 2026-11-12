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
      raiz.render(
        <BannerCarousel primeiraSemFade banners={[banner]} autoPlay={false} />,
      );
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

  // r150-f: `trim()` não tira U+200B, U+200E (cola do WhatsApp), U+2800 nem
  // U+3164. Texto só disso é AUSENTE: sem pílula amarela vazia, sem botão sem
  // rótulo e sem película escura sobre a foto.
  const comLink = {
    ...base,
    link: "/?category=Bebidas",
    buttonText: "",
    title: "",
  };
  const CAMPOS = [
    ["badgeText", "span.rounded-full"],
    ["title", "h2"],
    ["subtitle", "p"],
    ["buttonText", "button"],
  ] as const;
  const INVISIVEIS = ["\u200b", "\u200e\u200e", "\u2800", "\u3164"];

  it.each(
    CAMPOS.flatMap(([campo, seletor]) =>
      INVISIVEIS.map((invisivel) => [campo, seletor, invisivel] as const),
    ),
  )(
    "%s só de caractere invisível (%s -> %j): sem texto e sem película",
    async (campo, _seletor, invisivel) => {
      await loja({ ...comLink, [campo]: invisivel });
      expect(hospedeiro.querySelector("img")).not.toBeNull();
      expect(hospedeiro.querySelector('div[style*="opacity"]')).toBeNull();
      for (const [, seletor] of CAMPOS) {
        expect(hospedeiro.querySelector(seletor)).toBeNull();
      }
    },
  );

  it.each(CAMPOS)(
    "%s invisível ao lado de um texto de verdade: o texto real aparece e o invisível não desenha nada",
    async (campo, seletor) => {
      const [, seletorReal] = campo === "title" ? CAMPOS[2] : CAMPOS[1];
      const real = campo === "title" ? "subtitle" : "title";
      await loja({ ...comLink, [real]: "Promoção real", [campo]: "\u200b" });
      expect(hospedeiro.querySelector(seletorReal)?.textContent).toBe(
        "Promoção real",
      );
      expect(hospedeiro.querySelector('div[style*="opacity"]')).not.toBeNull();
      expect(hospedeiro.querySelector(seletor)).toBeNull();
    },
  );
});
