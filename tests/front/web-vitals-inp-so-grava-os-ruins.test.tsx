// @vitest-environment jsdom
//
// Lote 226 (item 2): o observador de INP gravava no banco do aparelho UM
// registro por toque/tecla de todo visitante (duração >= 16 ms). Agora só
// grava interação RUIM (acima de 200 ms, o limite "precisa melhorar" do
// web-vitals) e no máximo 50 registros por visita. O formato não muda.
import { useWebVitals } from "@/hooks/useWebVitals";
import { logForensic } from "@/lib/forensicsDB";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/forensicsDB", () => ({
  logForensic: vi.fn().mockResolvedValue(undefined),
}));

// @ts-expect-error — bandeira interna do React para o `act`
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorDeEventos {
  static supportedEntryTypes = ["event"];
  static instancias: ObservadorDeEventos[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  private readonly callback: PerformanceObserverCallback;

  constructor(callback: PerformanceObserverCallback) {
    this.callback = callback;
    ObservadorDeEventos.instancias.push(this);
  }

  produzir(duracoes: number[]) {
    const entradas = duracoes.map((duration) => ({
      name: "click",
      entryType: "event",
      startTime: 0,
      duration,
      interactionId: 1,
      toJSON: () => ({}),
    }));
    this.callback(
      {
        getEntries: () => entradas,
      } as unknown as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

function Tela() {
  useWebVitals();
  return null;
}

describe("Web Vitals: INP só grava interação ruim, com teto por visita", () => {
  let raiz: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.mocked(logForensic).mockClear();
    ObservadorDeEventos.instancias = [];
    vi.stubGlobal("PerformanceObserver", ObservadorDeEventos);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    raiz = createRoot(container);
    act(() => {
      raiz.render(<Tela />);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  function observador() {
    const o = ObservadorDeEventos.instancias.at(-1);
    if (!o) throw new Error("observador de INP não montado");
    return o;
  }

  it("toques rápidos (até 200 ms) não gravam nada", () => {
    act(() => {
      observador().produzir(Array.from({ length: 50 }, () => 40).concat(200));
    });
    expect(logForensic).not.toHaveBeenCalled();
  });

  it("toque lento grava com o formato de sempre", () => {
    act(() => {
      observador().produzir([320]);
    });
    expect(logForensic).toHaveBeenCalledTimes(1);
    expect(logForensic).toHaveBeenCalledWith(
      expect.objectContaining({
        m: "Web Vital: INP",
        source: "app",
        level: "info",
        d: { name: "INP", value: 320, rating: "needs-improvement", delta: 320 },
      }),
    );
  });

  it("muitos toques lentos gravam no máximo 50 registros", () => {
    act(() => {
      observador().produzir(Array.from({ length: 120 }, () => 600));
    });
    expect(logForensic).toHaveBeenCalledTimes(50);
  });
});
