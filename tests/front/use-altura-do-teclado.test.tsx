// @vitest-environment jsdom
// O teclado do Android/PWA NÃO redimensiona a página: ele se sobrepõe. Quem
// enxerga o tamanho dele é o `visualViewport`. O hook devolve quanto o
// teclado ocupa embaixo (0 quando fechado ou quando só há barra do navegador).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAlturaDoTeclado } from "@/hooks/useAlturaDoTeclado";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Ouvinte = () => void;
function criarVisualViewport(height: number, offsetTop = 0, scale = 1) {
  const ouvintes = new Map<string, Set<Ouvinte>>();
  return {
    height,
    offsetTop,
    scale,
    ouvintes,
    addEventListener: vi.fn((tipo: string, fn: Ouvinte) => {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
      ouvintes.get(tipo)?.add(fn);
    }),
    removeEventListener: vi.fn((tipo: string, fn: Ouvinte) => {
      ouvintes.get(tipo)?.delete(fn);
    }),
    emitir(tipo: string) {
      for (const fn of ouvintes.get(tipo) ?? []) fn();
    },
  };
}

let fila: FrameRequestCallback[] = [];
let cancelar = vi.fn();
/** Roda os quadros pendentes, como o navegador faria no próximo frame. */
function proximoQuadro() {
  act(() => {
    const pendentes = fila;
    fila = [];
    for (const fn of pendentes) fn(0);
  });
}

function Sonda() {
  const { altura, alturaVisivel } = useAlturaDoTeclado();
  return (
    <>
      <input aria-label="campo" />
      <output data-visivel={alturaVisivel}>{altura}</output>
    </>
  );
}

function focar() {
  act(() => {
    contedor.querySelector("input")?.focus();
  });
  proximoQuadro();
}

/** O que o hook devolveu, lido do DOM renderizado. */
function lido(): number {
  return Number(contedor.querySelector("output")?.textContent);
}

let raiz: Root;
let contedor: HTMLDivElement;

function montar() {
  act(() => {
    raiz.render(<Sonda />);
  });
  proximoQuadro();
}

beforeEach(() => {
  fila = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    fila.push(fn);
    return fila.length;
  });
  cancelar = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancelar);
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  contedor = document.createElement("div");
  document.body.appendChild(contedor);
  raiz = createRoot(contedor);
});

afterEach(() => {
  act(() => raiz.unmount());
  contedor.remove();
  Reflect.deleteProperty(window, "visualViewport");
  vi.unstubAllGlobals();
});

describe("useAlturaDoTeclado", () => {
  it("devolve o que o teclado ocupa embaixo (800 - 480 = 320)", () => {
    Object.defineProperty(window, "visualViewport", {
      value: criarVisualViewport(480),
      configurable: true,
    });
    montar();
    focar();
    expect(lido()).toBe(320);
    expect(contedor.querySelector("output")?.dataset.visivel).toBe("480");
  });

  it("acompanha resize e scroll do visualViewport", () => {
    const vv = criarVisualViewport(800);
    Object.defineProperty(window, "visualViewport", {
      value: vv,
      configurable: true,
    });
    montar();
    focar();
    expect(lido()).toBe(0);
    vv.height = 500;
    act(() => vv.emitir("resize"));
    proximoQuadro();
    expect(lido()).toBe(300);
    vv.offsetTop = 40;
    act(() => vv.emitir("scroll"));
    proximoQuadro();
    expect(lido()).toBe(260);
  });

  it("ignora diferença menor que 80px (barras do navegador)", () => {
    Object.defineProperty(window, "visualViewport", {
      value: criarVisualViewport(760),
      configurable: true,
    });
    montar();
    focar();
    expect(lido()).toBe(0);
  });

  it("sem visualViewport devolve 0", () => {
    montar();
    expect(lido()).toBe(0);
  });

  it("remove os ouvintes ao desmontar", () => {
    const vv = criarVisualViewport(480);
    Object.defineProperty(window, "visualViewport", {
      value: vv,
      configurable: true,
    });
    montar();
    expect(vv.ouvintes.get("resize")?.size).toBe(1);
    expect(vv.ouvintes.get("scroll")?.size).toBe(1);
    act(() => raiz.unmount());
    expect(vv.ouvintes.get("resize")?.size).toBe(0);
    expect(vv.ouvintes.get("scroll")?.size).toBe(0);
    raiz = createRoot(contedor);
  });

  it("pinch-zoom (scale 1,5) com campo focado não é teclado", () => {
    Object.defineProperty(window, "visualViewport", {
      value: criarVisualViewport(533, 0, 1.5),
      configurable: true,
    });
    montar();
    focar();
    expect(lido()).toBe(0);
  });

  it("só conta como teclado com campo de texto focado", () => {
    Object.defineProperty(window, "visualViewport", {
      value: criarVisualViewport(480),
      configurable: true,
    });
    montar();
    expect(lido()).toBe(0);
    focar();
    expect(lido()).toBe(320);
    act(() => {
      contedor.querySelector("input")?.blur();
    });
    proximoQuadro();
    expect(lido()).toBe(0);
  });

  it("cancela o quadro pendente ao desmontar", () => {
    Object.defineProperty(window, "visualViewport", {
      value: criarVisualViewport(480),
      configurable: true,
    });
    montar();
    act(() => {
      contedor.querySelector("input")?.focus();
    });
    expect(fila.length).toBeGreaterThan(0);
    act(() => raiz.unmount());
    expect(cancelar).toHaveBeenCalled();
    raiz = createRoot(contedor);
  });
});
