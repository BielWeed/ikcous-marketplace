// @vitest-environment jsdom
//
// AdminKpiCarousel com o EMBLA DUBLADO (no jsdom o embla de verdade não mede
// largura nenhuma e nunca devolve "grupos", então os pontos, as setas e as
// páginas ficam sem prova). O dublê entrega a lista de grupos e a posição que o
// teste quiser. O que prova:
//  - faixa normal: pontos e setas só existem com MAIS DE UM grupo; o ponto do
//    grupo atual é o único marcado; cada toque manda o embla para o lugar certo;
//    "Anterior" trava no começo e "Próximo" trava no fim;
//  - esqueleto: carregando, a faixa mostra tantos esqueletos quantos cartões
//    (ou 4 sem cartões) e a grade expandida mostra sempre 4;
//  - modo relatório: 2 cartões por página, uma página por par, a atual marcada,
//    o toque na página respeita "movimento reduzido" e o embla anda de 2 em 2;
//  - o carrossel pede ao embla para refazer as medidas depois de montado.
import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { Package } from "lucide-react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const embla = vi.hoisted(() => ({
  opcoes: [] as Record<string, unknown>[],
  api: null as null | Record<string, unknown>,
  snaps: [] as number[],
  selecionado: 0,
  podeAnterior: false,
  podeProximo: true,
  scrollTo: undefined as unknown as (...a: unknown[]) => void,
  scrollNext: undefined as unknown as () => void,
  scrollPrev: undefined as unknown as () => void,
  reInit: undefined as unknown as () => void,
  /** O que o embla recebe como "ref": elemento enquanto a faixa existe, nulo ao sair. */
  ref: vi.fn(),
}));

vi.mock("embla-carousel-react", () => ({
  default: (opcoes: Record<string, unknown>) => {
    embla.opcoes.push(opcoes);
    return [embla.ref, embla.api];
  },
}));

import { AdminKpiCarousel } from "@/components/admin/AdminKpiCarousel";

function cartoes(n: number): KpiCardConfig[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    label: `Métrica ${i + 1}`,
    value: i + 10,
    icon: Package,
  }));
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  embla.opcoes.length = 0;
  embla.ref.mockClear();
  embla.snaps = [0, 1, 2];
  embla.selecionado = 0;
  embla.podeAnterior = false;
  embla.podeProximo = true;
  embla.scrollTo = vi.fn();
  embla.scrollNext = vi.fn();
  embla.scrollPrev = vi.fn();
  embla.reInit = vi.fn();
  embla.api = {
    on: vi.fn(),
    off: vi.fn(),
    selectedScrollSnap: () => embla.selecionado,
    canScrollPrev: () => embla.podeAnterior,
    canScrollNext: () => embla.podeProximo,
    scrollSnapList: () => embla.snaps,
    scrollTo: (...a: unknown[]) => embla.scrollTo(...a),
    scrollNext: () => embla.scrollNext(),
    scrollPrev: () => embla.scrollPrev(),
    reInit: () => embla.reInit(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function montar(
  props: Partial<React.ComponentProps<typeof AdminKpiCarousel>> = {},
) {
  await act(async () => {
    root.render(<AdminKpiCarousel cards={cartoes(6)} {...props} />);
  });
}

const botoes = (rotuloComeca: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
    b.getAttribute("aria-label")?.startsWith(rotuloComeca),
  );
const esqueletos = () => host.querySelectorAll(".w-24.animate-pulse").length;

describe("faixa normal — pontos e setas", () => {
  it("com 3 grupos: 3 pontos nomeados, só o atual marcado, e as duas setas", async () => {
    embla.selecionado = 1;
    await montar();
    const pontos = botoes("Mostrar o grupo");
    expect(pontos.map((p) => p.getAttribute("aria-label"))).toEqual([
      "Mostrar o grupo 1 de 3",
      "Mostrar o grupo 2 de 3",
      "Mostrar o grupo 3 de 3",
    ]);
    expect(pontos.map((p) => p.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
    expect(botoes("Anterior")).toHaveLength(1);
    expect(botoes("Próximo")).toHaveLength(1);
  });

  it("com 2 grupos já aparecem pontos e setas", async () => {
    embla.snaps = [0, 1];
    await montar();
    expect(botoes("Mostrar o grupo")).toHaveLength(2);
    expect(botoes("Próximo")).toHaveLength(1);
  });

  it("com 1 grupo só (tudo cabe): sem pontos e sem setas", async () => {
    embla.snaps = [0];
    await montar();
    expect(botoes("Mostrar o grupo")).toHaveLength(0);
    expect(botoes("Anterior")).toHaveLength(0);
    expect(botoes("Próximo")).toHaveLength(0);
  });

  it("carregando: sem pontos e sem setas", async () => {
    await montar({ loading: true });
    expect(botoes("Mostrar o grupo")).toHaveLength(0);
    expect(botoes("Próximo")).toHaveLength(0);
  });

  it("cada toque manda o embla para o lugar certo", async () => {
    embla.selecionado = 1;
    embla.podeAnterior = true;
    embla.podeProximo = true;
    await montar();
    await act(async () => botoes("Mostrar o grupo 3")[0]?.click());
    expect(embla.scrollTo).toHaveBeenCalledWith(2);
    await act(async () => botoes("Próximo")[0]?.click());
    expect(embla.scrollNext).toHaveBeenCalledTimes(1);
    await act(async () => botoes("Anterior")[0]?.click());
    expect(embla.scrollPrev).toHaveBeenCalledTimes(1);
  });

  it("no começo 'Anterior' trava e no fim 'Próximo' trava", async () => {
    await montar();
    expect(botoes("Anterior")[0]?.disabled).toBe(true);
    expect(botoes("Próximo")[0]?.disabled).toBe(false);
    act(() => root.unmount());
    root = createRoot(host);
    embla.selecionado = 2;
    embla.podeAnterior = true;
    embla.podeProximo = false;
    await montar();
    expect(botoes("Anterior")[0]?.disabled).toBe(false);
    expect(botoes("Próximo")[0]?.disabled).toBe(true);
  });

  it("o botão de expandir troca o rótulo, esconde os pontos e mostra todos os cartões em grade", async () => {
    await montar();
    const alternar = () =>
      [...host.querySelectorAll("button")].find((b) =>
        /Expandir|Carrossel/.test(b.textContent ?? ""),
      ) as HTMLButtonElement;
    expect(alternar().textContent).toContain("Expandir");
    await act(async () => alternar().click());
    expect(alternar().textContent).toContain("Carrossel");
    expect(botoes("Mostrar o grupo")).toHaveLength(0);
    expect(host.textContent).toContain("Métrica 6");
    await act(async () => alternar().click());
    expect(alternar().textContent).toContain("Expandir");
  });
});

describe("esqueletos", () => {
  it("faixa carregando: um esqueleto por cartão", async () => {
    await montar({ loading: true, cards: cartoes(6) });
    expect(esqueletos()).toBe(6);
  });

  it("faixa carregando sem cartões ainda: 4 esqueletos", async () => {
    await montar({ loading: true, cards: [] });
    expect(esqueletos()).toBe(4);
  });

  it("grade expandida carregando: sempre 4 esqueletos, mesmo com 6 cartões", async () => {
    await montar({ cards: cartoes(6) });
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => /Expandir/.test(b.textContent ?? ""))
        ?.click(),
    );
    await act(async () => {
      root.render(<AdminKpiCarousel cards={cartoes(6)} loading />);
    });
    expect(esqueletos()).toBe(4);
  });
});

describe("modo relatório", () => {
  const paginas = () => botoes("Página");

  it("5 cartões: 3 páginas (2 por página), a atual marcada", async () => {
    embla.selecionado = 2;
    await montar({ relatorio: true, cards: cartoes(5) });
    expect(paginas().map((p) => p.getAttribute("aria-label"))).toEqual([
      "Página 1 de 3",
      "Página 2 de 3",
      "Página 3 de 3",
    ]);
    expect(paginas().map((p) => p.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "true",
    ]);
  });

  it("4 cartões: 2 páginas", async () => {
    await montar({ relatorio: true, cards: cartoes(4) });
    expect(paginas()).toHaveLength(2);
  });

  it("toque na página manda o embla para ela; sem 'movimento reduzido' a animação fica", async () => {
    vi.stubGlobal("matchMedia", undefined);
    await montar({ relatorio: true, cards: cartoes(5) });
    await act(async () => paginas()[1]?.click());
    expect(embla.scrollTo).toHaveBeenCalledWith(1, false);
  });

  it("com 'movimento reduzido' ligado no aparelho o salto é imediato", async () => {
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: true,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    await montar({ relatorio: true, cards: cartoes(5) });
    await act(async () => paginas()[2]?.click());
    expect(embla.scrollTo).toHaveBeenCalledWith(2, true);
  });

  it("o embla anda de 2 em 2 no relatório e de 1 em 1 na faixa normal", async () => {
    await montar({ relatorio: true, cards: cartoes(5) });
    expect(embla.opcoes.at(-1)?.slidesToScroll).toBe(2);
    expect(embla.opcoes.at(-1)?.breakpoints).toBeDefined();
    embla.opcoes.length = 0;
    act(() => root.unmount());
    root = createRoot(host);
    await montar({ cards: cartoes(5) });
    expect(embla.opcoes.at(-1)?.slidesToScroll).toBe(1);
    expect(embla.opcoes.at(-1)?.breakpoints).toBeUndefined();
    expect(embla.opcoes.at(-1)?.loop).toBe(false);
  });

  it("o botão de expandir do relatório marca aria-expanded e esconde as páginas", async () => {
    await montar({ relatorio: true, cards: cartoes(5) });
    const alternar = host.querySelector(
      "button[aria-expanded]",
    ) as HTMLButtonElement;
    expect(alternar.getAttribute("aria-expanded")).toBe("false");
    expect(alternar.textContent).toContain("Expandir");
    await act(async () => alternar.click());
    expect(alternar.getAttribute("aria-expanded")).toBe("true");
    expect(alternar.textContent).toContain("Recolher");
    expect(paginas()).toHaveLength(0);
    // expandido não há faixa para o embla controlar: ele solta o elemento
    expect(embla.ref.mock.calls.at(-1)?.[0]).toBeNull();
    await act(async () => alternar.click());
    expect(embla.ref.mock.calls.at(-1)?.[0]).toBeInstanceOf(HTMLElement);
  });
});

describe("medidas do carrossel", () => {
  it("depois de montado, o carrossel pede ao embla para refazer as medidas", async () => {
    await montar();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(embla.reInit).toHaveBeenCalled();
  });

  it("sem o embla pronto (ainda nulo) a tela monta sem quebrar", async () => {
    embla.api = null;
    await montar();
    expect(host.textContent).toContain("Métrica 1");
    expect(botoes("Mostrar o grupo")).toHaveLength(0);
  });
});
