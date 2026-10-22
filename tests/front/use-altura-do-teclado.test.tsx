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
function criarVisualViewport(height: number, offsetTop = 0) {
  const ouvintes = new Map<string, Set<Ouvinte>>();
  return {
    height,
    offsetTop,
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
/** Roda os quadros pendentes, como o navegador faria no próximo frame. */
function proximoQuadro() {
  act(() => {
    const pendentes = fila;
    fila = [];
    for (const fn of pendentes) fn(0);
  });
}

function Sonda() {
  return <output>{useAlturaDoTeclado()}</output>;
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
  vi.stubGlobal("cancelAnimationFrame", () => {});
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
    expect(lido()).toBe(320);
  });

  it("acompanha resize e scroll do visualViewport", () => {
    const vv = criarVisualViewport(800);
    Object.defineProperty(window, "visualViewport", {
      value: vv,
      configurable: true,
    });
    montar();
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
});
