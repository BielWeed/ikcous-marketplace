// @vitest-environment jsdom
import { useDeslocamentoDaBarra } from "@/components/admin/products/useDeslocamentoDaBarra";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
function Sonda() {
  return <output>{useDeslocamentoDaBarra()}</output>;
}
const valor = () => host.querySelector("output")?.textContent;

function definirArea(area: unknown, instalado = false) {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: area,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: instalado }),
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("sem área visível informada, o navegador comum sobe 56px e o app instalado 0", () => {
  definirArea(undefined);
  act(() => raiz.render(<Sonda />));
  expect(valor()).toBe("56");
  definirArea(undefined, true);
  act(() => raiz.render(<Sonda key="instalado" />));
  expect(valor()).toBe("0");
});

it("usa a diferença entre a janela e a área visível, e ignora o teclado", () => {
  definirArea({
    offsetTop: 0,
    height: 760,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  act(() => raiz.render(<Sonda />));
  expect(valor()).toBe("40");
  definirArea({
    offsetTop: 0,
    height: 400,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  act(() => raiz.render(<Sonda key="teclado" />));
  expect(valor()).toBe("0");
});
