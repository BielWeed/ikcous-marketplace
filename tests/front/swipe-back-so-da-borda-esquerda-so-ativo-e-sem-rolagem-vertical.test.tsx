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

function tocar(
  elemento: HTMLElement,
  tipo: string,
  clientX: number,
  clientY = 50,
) {
  const evento = new Event(tipo, { bubbles: true, cancelable: true });
  const toque = { clientX, clientY };
  Object.defineProperty(evento, "touches", {
    value: tipo === "touchend" || tipo === "touchcancel" ? [] : [toque],
  });
  Object.defineProperty(evento, "changedTouches", { value: [toque] });
  act(() => {
    elemento.dispatchEvent(evento);
  });
  return evento;
}

describe("swipe back: só da borda esquerda, só ativo, sem rolagem vertical", () => {
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

  function avancar(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("controle positivo: gesto da borda esquerda (10 -> 310) volta uma vez", () => {
    const main = renderizar();
    tocar(main, "touchstart", 10);
    const move = tocar(main, "touchmove", 310);
    expect(move.defaultPrevented).toBe(true);
    expect(main.style.transform).toBe("translate3d(300px, 0, 0)");
    tocar(main, "touchend", 310);
    avancar(150);
    expect(onBack).toHaveBeenCalledTimes(1);
    avancar(1000);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("arrasto que começa fora da borda (x = 100) não move a tela nem volta", () => {
    const main = renderizar();
    tocar(main, "touchstart", 100);
    const move = tocar(main, "touchmove", 400);

    expect(move.defaultPrevented).toBe(false);
    expect(main.style.transform).toBe("");
    expect(main.classList.contains("swipe-back-transition")).toBe(false);

    tocar(main, "touchend", 400);
    avancar(1000);
    expect(main.style.transform).toBe("");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("tela inativa (active=false) ignora o gesto completo da borda", () => {
    const main = renderizar(false);
    tocar(main, "touchstart", 10);
    const move = tocar(main, "touchmove", 310);

    expect(move.defaultPrevented).toBe(false);
    expect(main.style.transform).toBe("");

    tocar(main, "touchend", 310);
    avancar(1000);
    expect(main.style.transform).toBe("");
    expect(main.classList.contains("swipe-back-transition")).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("rolagem vertical (deltaY grande, deltaX < 20) aborta o gesto e ele não volta mais", () => {
    const main = renderizar();
    tocar(main, "touchstart", 10, 50);
    const rolagem = tocar(main, "touchmove", 25, 150);

    // Abortado: não tomou o toque (a rolagem nativa segue) nem arrastou a tela.
    expect(rolagem.defaultPrevented).toBe(false);
    expect(main.style.transform).toBe("translate3d(0, 0, 0)");
    act(() => {
      main.dispatchEvent(new Event("transitionend"));
    });
    expect(main.style.transform).toBe("");

    // O dedo continua para a direita, mas o gesto já morreu: nada volta.
    const depois = tocar(main, "touchmove", 310, 150);
    expect(depois.defaultPrevented).toBe(false);
    expect(main.style.transform).toBe("");
    tocar(main, "touchend", 310, 150);
    avancar(1000);
    expect(onBack).not.toHaveBeenCalled();
  });
});
