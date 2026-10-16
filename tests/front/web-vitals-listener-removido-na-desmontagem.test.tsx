// @vitest-environment jsdom
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

class ObservadorDeLayout {
  static supportedEntryTypes = ["layout-shift"];
  static instancias: ObservadorDeLayout[] = [];
  observe = vi.fn();
  disconnect = vi.fn();

  private readonly callback: PerformanceObserverCallback;

  constructor(callback: PerformanceObserverCallback) {
    this.callback = callback;
    ObservadorDeLayout.instancias.push(this);
  }

  produzirDeslocamento() {
    const entrada = {
      name: "layout-shift",
      entryType: "layout-shift",
      startTime: 0,
      duration: 0,
      toJSON: () => ({}),
      hadRecentInput: false,
      value: 0.2,
    };
    this.callback(
      {
        getEntries: () => [entrada],
      } as unknown as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

function Tela() {
  useWebVitals();
  return null;
}

describe("Web Vitals remove o listener da instância desmontada", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logForensic).mockClear();
    ObservadorDeLayout.instancias = [];
    vi.stubGlobal("PerformanceObserver", ObservadorDeLayout);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    container = document.createElement("div");
    document.body.append(container);
    raiz = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      raiz?.unmount();
    });
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function montar() {
    act(() => {
      raiz?.render(<Tela />);
    });
    const observador = ObservadorDeLayout.instancias.at(-1);
    if (!observador) throw new Error("observador de layout não montado");
    act(() => {
      observador.produzirDeslocamento();
    });
    return observador;
  }

  function ocultar() {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.runAllTimers();
    });
  }

  it("remove exatamente a função registrada e não registra CLS após desmontar", () => {
    const adicionar = vi.spyOn(document, "addEventListener");
    const remover = vi.spyOn(document, "removeEventListener");
    const observador = montar();
    const registro = adicionar.mock.calls.find(
      ([tipo]) => tipo === "visibilitychange",
    );
    expect(registro).toBeDefined();
    expect(registro?.[2]).toEqual({ once: true });
    expect(logForensic).not.toHaveBeenCalled();

    act(() => {
      raiz?.unmount();
    });
    raiz = null;

    expect(observador.disconnect).toHaveBeenCalledTimes(1);
    expect(remover).toHaveBeenCalledWith("visibilitychange", registro?.[1]);
    ocultar();
    expect(logForensic).not.toHaveBeenCalled();
  });

  it("a instância montada ainda registra seu CLS uma única vez", () => {
    montar();
    ocultar();
    expect(logForensic).toHaveBeenCalledTimes(1);
    expect(logForensic).toHaveBeenCalledWith(
      expect.objectContaining({
        m: "Web Vital: CLS",
        d: expect.objectContaining({ name: "CLS", value: 200, delta: 200 }),
      }),
    );
    ocultar();
    expect(logForensic).toHaveBeenCalledTimes(1);
  });

  it("remontar não acumula o CLS da instância encerrada", () => {
    montar();
    act(() => {
      raiz?.unmount();
    });
    raiz = createRoot(container);
    montar();
    ocultar();
    expect(logForensic).toHaveBeenCalledTimes(1);
  });
});
