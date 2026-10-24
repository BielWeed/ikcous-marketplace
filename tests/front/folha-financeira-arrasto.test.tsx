// @vitest-environment jsdom
// A folha do Financeiro no celular fecha arrastando a alça/cabeçalho para
// baixo (passou de 1/4 da altura ou desceu rápido); o corpo que rola nunca
// arrasta; o X é o único botão de fechar; no computador não há alça.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { FolhaFinanceira } from "@/components/admin/financeiro/FolhaFinanceira";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mockLarga = false;
vi.mock("@/hooks/useFinanceiro", () => ({
  useTelaLarga: () => mockLarga,
}));
vi.mock("@/hooks/useAlturaDoTeclado", () => ({
  useAlturaDoTeclado: () => ({ altura: 0, alturaVisivel: 0 }),
}));

const ALTURA = 600; // 25% = 150 px
let raiz: Root;
let contedor: HTMLDivElement;
let agora = 0;
let aoFechar: Mock<() => void>;
let descritorAltura: PropertyDescriptor | undefined;

function montar(props: { fecharBloqueado?: boolean } = {}) {
  act(() => {
    raiz.render(
      <FolhaFinanceira
        titulo="Novo lançamento"
        aoFechar={aoFechar}
        rodape={<button type="button">Salvar lançamento</button>}
        {...props}
      >
        <input aria-label="Valor" />
      </FolhaFinanceira>,
    );
  });
}

function folha(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-folha-financeira]");
  if (!el) throw new Error("folha não montou");
  return el;
}

function regiaoDeArrasto(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-folha-arraste]");
  if (!el) throw new Error("região de arrasto não existe");
  return el;
}

function ponteiro(alvo: Element, tipo: string, y: number, dt: number) {
  agora += dt;
  act(() => {
    alvo.dispatchEvent(
      new PointerEvent(tipo, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientY: y,
      }),
    );
  });
}

beforeEach(() => {
  mockLarga = false;
  agora = 0;
  aoFechar = vi.fn<() => void>();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => agora);
  descritorAltura = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => ALTURA,
  });
  contedor = document.createElement("div");
  document.body.appendChild(contedor);
  raiz = createRoot(contedor);
});

afterEach(() => {
  act(() => raiz.unmount());
  contedor.remove();
  if (descritorAltura) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      descritorAltura,
    );
  } else {
    // biome-ignore lint/performance/noDelete: restaura o protótipo do jsdom
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .offsetHeight;
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("FolhaFinanceira — arrastar para baixo para fechar (celular)", () => {
  it("a folha segue o dedo e, abaixo de 25% e devagar, volta sem fechar", () => {
    montar();
    const alvo = regiaoDeArrasto();
    ponteiro(alvo, "pointerdown", 100, 0);
    ponteiro(alvo, "pointermove", 160, 400);
    expect(folha().style.transform).toBe("translateY(60px)");
    ponteiro(alvo, "pointermove", 200, 400);
    ponteiro(alvo, "pointerup", 200, 400);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(aoFechar).not.toHaveBeenCalled();
    expect(folha().style.transform).toBe("");
  });

  it("passou de 25% da altura: sai da tela e fecha uma única vez", () => {
    montar();
    const alvo = regiaoDeArrasto();
    ponteiro(alvo, "pointerdown", 100, 0);
    ponteiro(alvo, "pointermove", 200, 300);
    ponteiro(alvo, "pointermove", 300, 300);
    ponteiro(alvo, "pointerup", 300, 300); // dy 200 > 150, devagar
    expect(aoFechar).not.toHaveBeenCalled();
    expect(folha().style.transform).toBe(`translateY(${ALTURA}px)`);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("descida rápida (acima de 0,5 px/ms) fecha mesmo com pouco deslocamento", () => {
    montar();
    const alvo = regiaoDeArrasto();
    ponteiro(alvo, "pointerdown", 100, 0);
    ponteiro(alvo, "pointermove", 120, 10);
    ponteiro(alvo, "pointermove", 140, 10); // 2 px/ms, dy 40 < 150
    ponteiro(alvo, "pointerup", 140, 10);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("arrastar para cima não desloca nem fecha", () => {
    montar();
    const alvo = regiaoDeArrasto();
    ponteiro(alvo, "pointerdown", 300, 0);
    ponteiro(alvo, "pointermove", 100, 10);
    expect(folha().style.transform).toBe("");
    ponteiro(alvo, "pointerup", 100, 10);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("no corpo que rola não arrasta (não briga com a rolagem)", () => {
    montar();
    const campo = document.querySelector<HTMLInputElement>("input");
    if (!campo) throw new Error("campo não montou");
    ponteiro(campo, "pointerdown", 100, 0);
    ponteiro(campo, "pointermove", 400, 10);
    ponteiro(campo, "pointerup", 400, 10);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(folha().style.transform).toBe("");
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("com movimento reduzido fecha na hora, sem animar a saída", () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: consulta.includes("prefers-reduced-motion"),
    }));
    montar();
    const alvo = regiaoDeArrasto();
    ponteiro(alvo, "pointerdown", 100, 0);
    ponteiro(alvo, "pointermove", 400, 300);
    ponteiro(alvo, "pointerup", 400, 300);
    expect(aoFechar).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("enquanto grava (fecharBloqueado) o arrasto não fecha e o X fica parado", () => {
    montar({ fecharBloqueado: true });
    const x = document.querySelector<HTMLButtonElement>(
      '[aria-label="Fechar"]',
    );
    expect(x?.disabled).toBe(true);
    const alvo = regiaoDeArrasto();
    ponteiro(alvo, "pointerdown", 100, 0);
    ponteiro(alvo, "pointermove", 500, 300);
    ponteiro(alvo, "pointerup", 500, 300);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(folha().style.transform).toBe("");
    expect(aoFechar).not.toHaveBeenCalled();
  });
});

describe("FolhaFinanceira — um único fechar visível", () => {
  it("o X fecha pelo aoFechar e é o único botão de fechar da folha", () => {
    montar();
    const botoes = [...folha().querySelectorAll("button")].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent?.trim(),
    );
    expect(botoes).toEqual(["Fechar", "Salvar lançamento"]);
    const x = folha().querySelector<HTMLButtonElement>('[aria-label="Fechar"]');
    act(() => x?.click());
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("tocar no X dentro da região de arrasto não inicia arrasto", () => {
    montar();
    const x = folha().querySelector<HTMLButtonElement>('[aria-label="Fechar"]');
    if (!x) throw new Error("X não existe");
    ponteiro(x, "pointerdown", 50, 0);
    ponteiro(x, "pointermove", 500, 300);
    expect(folha().style.transform).toBe("");
  });

  it("no computador (folha lateral) não há alça nem arrasto", () => {
    mockLarga = true;
    montar();
    const alvo = regiaoDeArrasto();
    expect(alvo.className).not.toContain("touch-none");
    ponteiro(alvo, "pointerdown", 100, 0);
    ponteiro(alvo, "pointermove", 500, 300);
    ponteiro(alvo, "pointerup", 500, 300);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(aoFechar).not.toHaveBeenCalled();
    expect(folha().textContent).not.toContain("Arraste para baixo");
  });

  it("o véu da folha não usa bg-black/50 (o tema do painel o troca por cinza opaco)", () => {
    montar();
    const veu = document.querySelector('[data-slot="sheet-overlay"]');
    expect(veu?.className).not.toContain("bg-black/50");
    expect(veu?.className).toContain("bg-[rgb(0_0_0/0.5)]");
  });
});
