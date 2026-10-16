// @vitest-environment jsdom
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { act, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — bandeira interna do React para o `act`
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Tela({
  active,
  onBack,
}: {
  readonly active: boolean;
  readonly onBack: () => void;
}) {
  const mainRef = useRef<HTMLElement | null>(null);
  useSwipeBack({ active, onBack, mainRef });
  return <main ref={mainRef} />;
}

function tocar(elemento: HTMLElement, tipo: string, clientX = 10) {
  const evento = new Event(tipo, { bubbles: true, cancelable: true });
  const toque = { clientX, clientY: 50 };
  Object.defineProperty(evento, "touches", {
    value: tipo === "touchend" || tipo === "touchcancel" ? [] : [toque],
  });
  Object.defineProperty(evento, "changedTouches", { value: [toque] });
  act(() => {
    elemento.dispatchEvent(evento);
  });
}

describe("swipe back: cancelamento e timers pendentes", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement;
  const onBack = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("innerWidth", 1000);
    onBack.mockClear();
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
    vi.unstubAllGlobals();
  });

  function renderizar(active = true) {
    act(() => {
      raiz?.render(<Tela active={active} onBack={onBack} />);
    });
    const main = container.querySelector("main");
    if (!main) throw new Error("main não montado");
    return main;
  }

  function arrastar(main: HTMLElement, distancia = 300) {
    tocar(main, "touchstart");
    tocar(main, "touchmove", 10 + distancia);
  }

  function avancar(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it.each(["desativar", "desmontar"] as const)(
    "não volta se %s antes do delay de navegação",
    (saida) => {
      const main = renderizar();
      arrastar(main);
      tocar(main, "touchend");
      avancar(100);

      if (saida === "desativar") {
        renderizar(false);
      } else {
        act(() => {
          raiz?.unmount();
        });
        raiz = null;
      }

      avancar(1000);
      expect(onBack).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["touchcancel", "touchend"])(
    "%s restaura a posição sem voltar quando o gesto é cancelado ou curto",
    (tipo) => {
      const main = renderizar();
      arrastar(main, tipo === "touchcancel" ? 300 : 100);
      expect(main.style.transform).not.toBe("");
      tocar(main, tipo);

      expect(main.style.transform).toBe("translate3d(0, 0, 0)");
      expect(main.classList.contains("swipe-back-transition")).toBe(true);
      act(() => {
        main.dispatchEvent(new Event("transitionend"));
      });
      expect(main.style.transform).toBe("");
      expect(main.classList.contains("swipe-back-transition")).toBe(false);

      // Um touchend tardio depois do cancelamento também não completa o gesto.
      tocar(main, "touchend");
      avancar(1000);
      expect(onBack).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("touchend completo volta uma única vez após 150 ms e restaura o visual", () => {
    const main = renderizar();
    arrastar(main);
    tocar(main, "touchend");
    expect(main.style.transform).toBe("translate3d(100%, 0, 0)");

    avancar(149);
    expect(onBack).not.toHaveBeenCalled();
    avancar(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    avancar(300);
    expect(main.style.transform).toBe("");
    expect(main.classList.contains("swipe-back-transition")).toBe(false);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("um segundo gesto cancela a volta ainda pendente do primeiro", () => {
    const main = renderizar();
    arrastar(main);
    tocar(main, "touchend");
    avancar(100);
    arrastar(main);
    tocar(main, "touchend");

    avancar(50);
    expect(onBack).not.toHaveBeenCalled();
    avancar(99);
    expect(onBack).not.toHaveBeenCalled();
    avancar(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    avancar(1000);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("o timer de restauração anterior não apaga um segundo gesto em andamento", () => {
    const main = renderizar();
    arrastar(main);
    tocar(main, "touchend");
    avancar(150);
    expect(onBack).toHaveBeenCalledTimes(1);

    arrastar(main);
    avancar(300);
    expect(main.style.transform).toBe("translate3d(300px, 0, 0)");
    tocar(main, "touchend");
    avancar(150);
    expect(onBack).toHaveBeenCalledTimes(2);
    avancar(300);
    expect(vi.getTimerCount()).toBe(0);
  });
});
