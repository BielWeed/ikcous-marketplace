// @vitest-environment jsdom
//
// A faixa de métricas do painel para de girar com o mouse em cima. No toque,
// o navegador emula `mouseenter` logo depois do dedo e só manda o
// `mouseleave` quando a pessoa toca em outro lugar: sem filtro, um toque na
// faixa a deixava parada para sempre. O filtro é o mesmo do BannerCarousel e
// do PremiumOffers: `mouseenter` até 1 s depois de um toque não conta como
// mouse em cima.
//
// O embla é dublado (no jsdom o de verdade não mede nada): o que se observa é
// se o autoplay chama `scrollNext`.
import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { Package } from "lucide-react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const embla = vi.hoisted(() => ({
  scrollNext: undefined as unknown as () => void,
  api: null as null | Record<string, unknown>,
}));

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), embla.api],
}));

import { AdminKpiCarousel } from "@/components/admin/AdminKpiCarousel";

const cartoes: KpiCardConfig[] = Array.from({ length: 6 }, (_, i) => ({
  id: `c${i}`,
  label: `Métrica ${i + 1}`,
  value: i + 10,
  icon: Package,
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  embla.scrollNext = vi.fn();
  embla.api = {
    on: vi.fn(),
    off: vi.fn(),
    selectedScrollSnap: () => 0,
    canScrollPrev: () => false,
    canScrollNext: () => true,
    scrollSnapList: () => [0, 1, 2],
    scrollTo: vi.fn(),
    scrollNext: () => embla.scrollNext(),
    scrollPrev: vi.fn(),
    reInit: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function montar() {
  await act(async () => {
    root.render(<AdminKpiCarousel cards={cartoes} autoplayInterval={1000} />);
  });
}

const faixa = () => {
  const el = host.querySelector<HTMLElement>(".group\\/carousel");
  expect(el).not.toBeNull();
  return el as HTMLElement;
};

/** React traduz `mouseover` vindo de fora em `onMouseEnter`. */
function mouseEntra(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
}

function toca(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new Event("touchstart", { bubbles: true }));
    el.dispatchEvent(new Event("touchend", { bubbles: true }));
  });
}

describe("faixa de métricas: o toque não deixa o carrossel parado", () => {
  it("depois de um toque, o mouse emulado não pausa: a faixa continua girando", async () => {
    await montar();
    toca(faixa());
    mouseEntra(faixa());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(embla.scrollNext).toHaveBeenCalled();
  });

  // O navegador emula o `mouseenter` um pouco DEPOIS do toque, não no mesmo
  // instante: o teste acima dispara os dois no mesmo tique do relógio falso e
  // passaria com qualquer janela, até 1 ms. Aqui o mouse emulado chega 300 ms
  // depois — dentro da janela de 1 s, então ainda é toque.
  it("mouse emulado que chega 300 ms depois do toque também não pausa", async () => {
    await montar();
    toca(faixa());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const giros = vi.mocked(embla.scrollNext).mock.calls.length;
    mouseEntra(faixa());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(vi.mocked(embla.scrollNext).mock.calls.length).toBeGreaterThan(
      giros,
    );
  });

  it("controle: mouse de verdade em cima (sem toque) pausa a faixa", async () => {
    await montar();
    mouseEntra(faixa());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(embla.scrollNext).not.toHaveBeenCalled();
  });

  it("mouse que chega mais de 1 s depois do toque volta a pausar", async () => {
    await montar();
    toca(faixa());
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    const giros = vi.mocked(embla.scrollNext).mock.calls.length;
    mouseEntra(faixa());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(vi.mocked(embla.scrollNext).mock.calls.length).toBe(giros);
  });
});
