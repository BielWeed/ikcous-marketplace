// @vitest-environment jsdom
//
// Bordas do carrossel do topo da Home que os outros testes não separavam:
//
//  - UM banner só não gira: o carrossel não arma o relógio do autoplay (nada a
//    passar; um relógio ligado acorda a Home a cada intervalo à toa). Vale
//    também quando há dois banners cadastrados mas só um tem foto para esta
//    tela (o outro nem aparece);
//  - o mouse "emulado" que o celular dispara logo depois do toque é ignorado só
//    ENQUANTO o toque tem menos de 1 s: no milésimo 1000 ele já é um mouse de
//    verdade em cima do banner e pausa o autoplay (a janela é aberta no fim);
//  - o foco que o navegador não sabe classificar (sem `:focus-visible`) conta
//    como foco de teclado: na dúvida o autoplay PAUSA, nunca segue girando em
//    cima de quem navega por teclado;
//  - pelo teclado, Enter E Espaço no slide em foco abrem o destino (e seguram a
//    rolagem da página); qualquer outra tecla não faz nada;
//  - o escurecimento que a lojista escolhe (0 a 100) vira a opacidade na
//    proporção certa (40 vira 0,4; 0 vira 0), a cor escolhida vale e, sem
//    escolha, valem preto a 0,4;
//  - banner SEM destino (sem link, ou com link que a vitrine não abre, como
//    `javascript:`) não navega ao toque e não desenha o escurecimento de um
//    texto que ninguém vê (o botão some quando não há para onde ir);
//  - o toque num banner que aponta para o painel (`/admin/...`) vira a tela
//    `admin-...` com o `id` do endereço, como o roteador do App lê; e o `from`
//    guardado é a tela em que a cliente ESTAVA (para a seta Voltar recuar para
//    ela), caindo em `home` só quando o histórico não tem tela nenhuma.
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

function criarBanner(id: string, extra: Partial<Banner> = {}): Banner {
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

const INTERVALO = 2000;

describe("BannerCarousel: bordas do autoplay e da navegação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
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

  const montar = (banners: Banner[]) =>
    act(() => {
      raiz.render(<BannerCarousel banners={banners} interval={INTERVALO} />);
    });
  const regiao = () =>
    hospedeiro.querySelector<HTMLDivElement>('[role="region"]')!;
  const passar = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  const disparar = (evento: Event) =>
    act(() => {
      regiao().dispatchEvent(evento);
    });
  const mouseEntra = () =>
    disparar(
      new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );

  describe("um banner só", () => {
    it("controle: com dois banners com foto o autoplay gira", () => {
      montar([criarBanner("a"), criarBanner("b")]);
      passar(INTERVALO * 3);
      expect(emblaApi.scrollNext).toHaveBeenCalledTimes(3);
    });

    it("um banner só não arma o autoplay", () => {
      montar([criarBanner("a")]);
      passar(INTERVALO * 5);
      expect(emblaApi.scrollNext).not.toHaveBeenCalled();
    });

    it("dois banners, mas só um com foto para esta tela, não giram", () => {
      montar([criarBanner("a"), criarBanner("b", { imageUrl: "  " })]);
      passar(INTERVALO * 5);
      expect(emblaApi.scrollNext).not.toHaveBeenCalled();
      expect(
        hospedeiro.querySelectorAll('[aria-label^="Ir para slide"]'),
      ).toHaveLength(0);
    });
  });

  describe("o mouse emulado depois do toque", () => {
    it("com 999 ms desde o toque o mouse é emulado e o autoplay segue", () => {
      montar([criarBanner("a"), criarBanner("b")]);
      disparar(new Event("touchstart", { bubbles: true }));
      disparar(new Event("touchend", { bubbles: true }));
      passar(999);
      mouseEntra();
      passar(INTERVALO * 2);
      expect(emblaApi.scrollNext).toHaveBeenCalled();
    });

    it("com exatamente 1000 ms desde o toque o mouse é de verdade e pausa", () => {
      montar([criarBanner("a"), criarBanner("b")]);
      disparar(new Event("touchstart", { bubbles: true }));
      disparar(new Event("touchend", { bubbles: true }));
      passar(1000);
      mouseEntra();
      passar(INTERVALO * 3);
      expect(emblaApi.scrollNext).not.toHaveBeenCalled();
    });
  });

  describe("o foco que o navegador não sabe classificar", () => {
    it("sem suporte a :focus-visible o foco conta como de teclado e pausa", () => {
      const original = Element.prototype.matches;
      vi.spyOn(Element.prototype, "matches").mockImplementation(function (
        this: Element,
        seletor: string,
      ) {
        if (seletor === ":focus-visible") {
          throw new SyntaxError("seletor não suportado");
        }
        return original.call(this, seletor);
      });
      montar([criarBanner("a"), criarBanner("b")]);
      const indicador = hospedeiro.querySelector<HTMLButtonElement>(
        'button[aria-label^="Ir para slide"]',
      )!;

      act(() => {
        indicador.focus();
      });
      passar(INTERVALO * 3);

      expect(emblaApi.scrollNext).not.toHaveBeenCalled();
    });
  });

  describe("o teclado no slide em foco", () => {
    const teclar = (slide: HTMLElement, key: string) => {
      const evento = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        slide.dispatchEvent(evento);
      });
      return evento;
    };

    it.each(["Enter", " "])(
      "a tecla %j abre o destino e segura a rolagem",
      (tecla) => {
        montar([criarBanner("a", { link: "/cart" })]);
        const slide = hospedeiro.querySelector<HTMLElement>('[role="button"]')!;

        const evento = teclar(slide, tecla);

        expect(evento.defaultPrevented).toBe(true);
        expect(globalThis.location.pathname).toBe("/cart");
      },
    );

    it.each(["a", "Tab", "Escape"])("a tecla %j não abre nada", (tecla) => {
      montar([criarBanner("a", { link: "/cart" })]);
      const slide = hospedeiro.querySelector<HTMLElement>('[role="button"]')!;

      const evento = teclar(slide, tecla);

      expect(evento.defaultPrevented).toBe(false);
      expect(globalThis.location.pathname).toBe("/");
    });
  });

  describe("banner sem destino", () => {
    it.each([undefined, "javascript:alert(1)", "//outro-site.test", "   "])(
      "com o link %j o toque não navega",
      (link) => {
        globalThis.history.replaceState({ view: "cart" }, "", "/cart");
        const empilhar = vi.spyOn(globalThis.history, "pushState");
        montar([criarBanner("a", { link })]);
        const slide = hospedeiro.querySelector<HTMLElement>(
          '[aria-roledescription="slide"]',
        )!;

        act(() => {
          slide.click();
        });

        expect(empilhar).not.toHaveBeenCalled();
        expect(globalThis.location.pathname).toBe("/cart");
        expect(hospedeiro.querySelector('[role="button"]')).toBeNull();
      },
    );

    it("só com o texto do botão e sem destino não há escurecimento; com destino há", () => {
      const soBotao = {
        title: "",
        subtitle: "",
        badgeText: "",
        buttonText: "Compre agora",
      };
      const camada = () => hospedeiro.querySelector("div.transition-opacity");

      montar([criarBanner("a", { ...soBotao, link: undefined })]);
      expect(camada()).toBeNull();
      expect(hospedeiro.querySelector("button")).toBeNull();

      montar([criarBanner("a", { ...soBotao, link: "/cart" })]);
      expect(camada()).not.toBeNull();
      expect(hospedeiro.textContent).toContain("Compre agora");
    });
  });

  describe("o escurecimento escolhido pela lojista", () => {
    const camada = () =>
      hospedeiro.querySelector<HTMLElement>("div.transition-opacity")!;

    it.each([
      [40, "0.4"],
      [0, "0"],
      [100, "1"],
      [75, "0.75"],
    ])("opacidade %i vira %s", (escolhida, esperada) => {
      montar([criarBanner("a", { overlayOpacity: escolhida })]);
      expect(camada().style.opacity).toBe(esperada);
    });

    it("sem escolha, valem preto a 0,4; com cor escolhida, vale a cor", () => {
      montar([criarBanner("a", { overlayOpacity: undefined })]);
      expect(camada().style.opacity).toBe("0.4");
      expect(camada().style.backgroundColor).toBe("rgb(0, 0, 0)");

      montar([
        criarBanner("a", {
          overlayOpacity: undefined,
          overlayColor: "#112233",
        }),
      ]);
      expect(camada().style.backgroundColor).toBe("rgb(17, 34, 51)");
    });
  });

  describe("o toque num banner que aponta para o painel", () => {
    it("/admin/pedidos?id=7 vira a tela admin-pedidos com o id 7", () => {
      montar([criarBanner("a", { link: "/admin/pedidos?id=7" })]);
      const slide = hospedeiro.querySelector<HTMLElement>('[role="button"]')!;

      act(() => {
        slide.click();
      });

      expect(globalThis.history.state).toMatchObject({
        view: "admin-pedidos",
        id: "7",
        from: "home",
      });
      expect(globalThis.location.pathname).toBe("/admin/pedidos");
    });

    it("o from é a tela em que a cliente estava; sem tela no histórico, home", () => {
      globalThis.history.replaceState({ view: "search" }, "", "/");
      montar([criarBanner("a", { link: "/cart" })]);
      const slide = hospedeiro.querySelector<HTMLElement>('[role="button"]')!;
      act(() => {
        slide.click();
      });
      expect(globalThis.history.state).toMatchObject({
        view: "cart",
        from: "search",
      });

      globalThis.history.replaceState(null, "", "/");
      act(() => {
        slide.click();
      });
      expect(globalThis.history.state).toMatchObject({
        view: "cart",
        from: "home",
      });
    });

    it("um caminho comum guarda o nome da tela como está, sem o id", () => {
      montar([criarBanner("a", { link: "/cart" })]);
      const slide = hospedeiro.querySelector<HTMLElement>('[role="button"]')!;

      act(() => {
        slide.click();
      });

      expect(globalThis.history.state).toMatchObject({
        view: "cart",
        from: "home",
      });
      expect(globalThis.history.state.id).toBeUndefined();
    });
  });
});
