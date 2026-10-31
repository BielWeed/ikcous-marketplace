// @vitest-environment jsdom
//
// A foto do banner do TOPO da Home entra de uma vez, sem o esmaecer de 300 ms
// do LazyImage: o LCP (o banner) só é marcado no fim da transição de opacidade,
// e na primeira visita lenta isso são 300 ms a mais com o splash já fora.
// O corte vale SÓ para a primeira foto do carrossel do topo: o resto do
// LazyImage (outras fotos `priority`, cartões, miniaturas) e os carrosséis do
// meio e do rodapé da Home seguem esmaecendo como sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LazyImage } from "@/components/LazyImage";
import { BannerCarousel } from "@/components/ui/custom/BannerCarousel";
import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("embla-carousel-react", () => ({
  default: () => [() => {}, undefined],
}));

// Este observador marca TODA foto como visível: assim a 2a foto do carrossel
// (que não é `priority`) também monta o <img>, e dá para comparar as duas.
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
class ObserverStub {
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
const temTransicao = (img: HTMLImageElement) =>
  img.className.includes("transition-opacity");

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", ObservadorQueVe);
  vi.stubGlobal("ResizeObserver", ObserverStub);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("LazyImage — prop semFade", () => {
  it("com semFade a foto não ganha transição de opacidade, mas continua escondida até carregar", () => {
    act(() =>
      raiz.render(
        <LazyImage src="https://example.com/a.jpg" alt="a" priority semFade />,
      ),
    );
    const [img] = fotos();
    expect(img).toBeDefined();
    expect(temTransicao(img)).toBe(false);
    expect(img.className).not.toContain("duration-300");
    expect(img.className).toContain("opacity-0");
    act(() => {
      img.dispatchEvent(new Event("load"));
    });
    expect(fotos()[0].className).toContain("opacity-100");
    expect(temTransicao(fotos()[0])).toBe(false);
  });

  it("outra foto `priority` (sem semFade) continua esmaecendo como antes", () => {
    act(() =>
      raiz.render(
        <LazyImage src="https://example.com/a.jpg" alt="a" priority />,
      ),
    );
    const [img] = fotos();
    expect(temTransicao(img)).toBe(true);
    expect(img.className).toContain("duration-300");
    expect(img.className).toContain("ease-out");
  });

  it("foto comum (miniatura, cartão) continua esmaecendo como antes", () => {
    act(() =>
      raiz.render(<LazyImage src="https://example.com/a.jpg" alt="a" />),
    );
    const [img] = fotos();
    expect(img).toBeDefined();
    expect(temTransicao(img)).toBe(true);
  });
});

describe("BannerCarousel — a primeira foto do topo entra seca", () => {
  const dois = [banner("um", { order: 1 }), banner("dois", { order: 2 })];

  it("com primeiraSemFade, só a 1a foto perde a transição; a 2a segue esmaecendo", () => {
    act(() =>
      raiz.render(
        <BannerCarousel banners={dois} autoPlay={false} primeiraSemFade />,
      ),
    );
    const imgs = fotos();
    expect(imgs).toHaveLength(2);
    expect(temTransicao(imgs[0])).toBe(false);
    expect(temTransicao(imgs[1])).toBe(true);
  });

  it("sem a prop (carrossel do meio e do rodapé), nenhuma foto muda", () => {
    act(() => raiz.render(<BannerCarousel banners={dois} autoPlay={false} />));
    const imgs = fotos();
    expect(imgs).toHaveLength(2);
    expect(temTransicao(imgs[0])).toBe(true);
    expect(temTransicao(imgs[1])).toBe(true);
  });

  it("o banner de modelo pronto também entra seco no topo, e continua esmaecendo fora dele", () => {
    const pronto = [banner("p", { templateType: "pronto_destaque" })];
    act(() =>
      raiz.render(
        <BannerCarousel banners={pronto} autoPlay={false} primeiraSemFade />,
      ),
    );
    expect(temTransicao(fotos()[0])).toBe(false);
    act(() =>
      raiz.render(<BannerCarousel banners={pronto} autoPlay={false} />),
    );
    expect(temTransicao(fotos()[0])).toBe(true);
  });

  it("película, texto e botão do banner não mudam por causa da prop", () => {
    const comTexto = [
      banner("t", {
        title: "Oferta",
        buttonText: "Ver",
        link: "/?category=Bebidas",
        overlayColor: "#112233",
        overlayOpacity: 55,
      }),
    ];
    act(() =>
      raiz.render(
        <BannerCarousel banners={comTexto} autoPlay={false} primeiraSemFade />,
      ),
    );
    const comProp = hospedeiro.innerHTML.replace(
      /transition-opacity duration-300 ease-out /,
      "",
    );
    act(() =>
      raiz.render(<BannerCarousel banners={comTexto} autoPlay={false} />),
    );
    const semProp = hospedeiro.innerHTML.replace(
      /transition-opacity duration-300 ease-out /,
      "",
    );
    expect(comProp).toBe(semProp);
  });
});

// A Home arrasta hooks, supabase e framer-motion (mesma razão de
// home-nao-pula-contrato): a ligação é provada pela FONTE. Só o carrossel do
// topo liga a prop; meio e rodapé nunca.
const FONTE_DA_HOME = import.meta.glob<string>(
  "/src/views/customer/HomeView.tsx",
  { query: "?raw", import: "default", eager: true },
)["/src/views/customer/HomeView.tsx"];

describe("HomeView — quem liga primeiraSemFade", () => {
  const usos = Array.from(
    FONTE_DA_HOME.matchAll(/<BannerCarousel\b[\s\S]*?\/>/g),
    (m) => m[0],
  );

  it("achou os três carrosséis da Home (topo, meio, rodapé)", () => {
    expect(usos).toHaveLength(3);
  });

  it("o do topo liga; o do meio e o do rodapé não", () => {
    const doTopo = usos.filter((u) => u.includes("banners={topBanners}"));
    const dosOutros = usos.filter((u) => !u.includes("banners={topBanners}"));
    expect(doTopo).toHaveLength(1);
    expect(doTopo[0]).toContain("primeiraSemFade");
    expect(dosOutros).toHaveLength(2);
    for (const uso of dosOutros) expect(uso).not.toContain("primeiraSemFade");
  });
});
