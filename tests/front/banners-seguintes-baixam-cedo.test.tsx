// @vitest-environment jsdom
//
// Do segundo banner em diante, a foto so comecava a baixar quando o banner ja
// estava passando na tela: a faixa do carrossel corta o que esta fora (overflow
// escondido), o observador de visibilidade do LazyImage nao ve esses slides e o
// <img> nem era pedido. Na rede lenta cada banner que chegava era um retangulo
// cinza por alguns segundos. O conserto: depois que a PRIMEIRA foto carrega, as
// seguintes passam a baixar de uma vez, sem prioridade alta (nao competem com
// a primeira) e com `loading="eager"` (o `lazy` do navegador tambem nao as
// enxergaria dentro da faixa cortada).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LazyImage } from "@/components/LazyImage";
import { BannerCarousel } from "@/components/ui/custom/BannerCarousel";
import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("embla-carousel-react", () => ({
  default: () => [() => {}, undefined],
}));

// Observador que NUNCA ve nada: e o que acontece com os slides cortados pela
// faixa do carrossel. Sem isto o teste nao provaria o defeito.
class ObservadorQueNaoVe {
  observe() {}
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

function fotos(): HTMLImageElement[] {
  return Array.from(hospedeiro.querySelectorAll("img"));
}
function carregar(img: HTMLImageElement) {
  act(() => {
    img.dispatchEvent(new Event("load"));
  });
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", ObservadorQueNaoVe);
  vi.stubGlobal("ResizeObserver", ObservadorQueNaoVe);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("LazyImage — carregarCedo", () => {
  it("sem a prop e sem ser visto, a foto nao e pedida (como sempre foi)", () => {
    act(() =>
      raiz.render(<LazyImage src="https://example.com/a.jpg" alt="a" />),
    );
    expect(fotos()).toHaveLength(0);
  });

  it("com a prop, a foto e pedida sem esperar ser vista, sem prioridade alta e sem `lazy`", () => {
    act(() =>
      raiz.render(
        <LazyImage src="https://example.com/a.jpg" alt="a" carregarCedo />,
      ),
    );
    const [img] = fotos();
    expect(img).toBeDefined();
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).not.toBe("high");
  });

  it("aoCarregar avisa quando a foto termina de carregar", () => {
    const aoCarregar = vi.fn();
    act(() =>
      raiz.render(
        <LazyImage
          src="https://example.com/a.jpg"
          alt="a"
          priority
          aoCarregar={aoCarregar}
        />,
      ),
    );
    expect(aoCarregar).not.toHaveBeenCalled();
    carregar(fotos()[0]);
    expect(aoCarregar).toHaveBeenCalledTimes(1);
  });
});

describe("BannerCarousel — as fotos seguintes baixam depois da primeira", () => {
  const tres = [
    banner("um", { order: 1 }),
    banner("dois", { order: 2 }),
    banner("tres", { order: 3 }),
  ];

  it("antes da primeira carregar, so ela e pedida (nao competir com o banner 1)", () => {
    act(() =>
      raiz.render(
        <BannerCarousel primeiraSemFade banners={tres} autoPlay={false} />,
      ),
    );
    expect(fotos()).toHaveLength(1);
    expect(fotos()[0].getAttribute("src")).toContain("um.jpg");
  });

  it("quando a primeira carrega, a segunda e a terceira passam a ser pedidas sem prioridade alta", () => {
    act(() =>
      raiz.render(
        <BannerCarousel primeiraSemFade banners={tres} autoPlay={false} />,
      ),
    );
    carregar(fotos()[0]);
    const imgs = fotos();
    expect(imgs).toHaveLength(3);
    expect(imgs[0].getAttribute("fetchpriority")).toBe("high");
    for (const img of imgs.slice(1)) {
      expect(img.getAttribute("loading")).toBe("eager");
      expect(img.getAttribute("fetchpriority")).not.toBe("high");
    }
  });

  it("o banner de modelo pronto segue a mesma regra", () => {
    const prontos = [
      banner("p1", { templateType: "pronto_destaque" }),
      banner("p2", { templateType: "pronto_destaque" }),
    ];
    act(() =>
      raiz.render(
        <BannerCarousel primeiraSemFade banners={prontos} autoPlay={false} />,
      ),
    );
    expect(fotos()).toHaveLength(1);
    carregar(fotos()[0]);
    expect(fotos()).toHaveLength(2);
    expect(fotos()[1].getAttribute("loading")).toBe("eager");
  });

  it("no meio, espera aparecer e carrega a primeira sem prioridade alta; depois antecipa as seguintes", () => {
    const aoAparecer: (() => void)[] = [];
    class ObservadorControlado {
      private readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        aoAparecer.push(() =>
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", ObservadorControlado);
    act(() => raiz.render(<BannerCarousel banners={tres} autoPlay={false} />));
    expect(fotos()).toHaveLength(0);
    expect(aoAparecer.length).toBeGreaterThan(0);
    act(() => aoAparecer[0]());
    expect(fotos()).toHaveLength(1);
    expect(fotos()[0].getAttribute("src")).toContain("um.jpg");
    expect(fotos()[0].getAttribute("loading")).toBe("lazy");
    expect(fotos()[0].getAttribute("fetchpriority")).toBe("auto");
    carregar(fotos()[0]);
    expect(fotos()).toHaveLength(3);
    for (const img of fotos().slice(1)) {
      expect(img.getAttribute("loading")).toBe("eager");
      expect(img.getAttribute("fetchpriority")).toBe("auto");
    }
  });

  it("banner unico: nada muda", () => {
    act(() =>
      raiz.render(
        <BannerCarousel primeiraSemFade banners={[tres[0]]} autoPlay={false} />,
      ),
    );
    carregar(fotos()[0]);
    expect(fotos()).toHaveLength(1);
  });
});
