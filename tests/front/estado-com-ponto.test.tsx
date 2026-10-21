// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { corDoValor } from "@/components/admin/financeiro/partes";
import {
  EstadoComPonto,
  VariacaoComSeta,
} from "@/components/admin/primitivos/EstadoComPonto";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("EstadoComPonto", () => {
  it("mostra texto na cor do tom e ponto aria-hidden, sem fundo", () => {
    act(() => root.render(<EstadoComPonto tom="negativo" texto="Atrasado" />));
    const span = host.querySelector("span") as HTMLElement;
    expect(span.textContent).toBe("Atrasado");
    expect(span.className).toContain("text-red-400");
    expect(span.className).toContain("font-semibold");
    expect(span.className).not.toMatch(/\bbg-|border/);
    const ponto = span.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(ponto.className).toContain("bg-red-400");
  });
  it("superficie loja usa as classes da loja", () => {
    act(() =>
      root.render(
        <EstadoComPonto tom="positivo" texto="Pago" superficie="loja" />,
      ),
    );
    expect(host.querySelector("span")?.className).toContain("text-emerald-700");
    expect(host.querySelector("[aria-hidden='true']")?.className).toContain(
      "bg-emerald-600",
    );
  });
});

describe("VariacaoComSeta", () => {
  it("seta pelo sinal, aria-hidden, e texto visível", () => {
    act(() => root.render(<VariacaoComSeta valor={-3} texto="-3%" />));
    const span = host.querySelector("span") as HTMLElement;
    expect(span.textContent).toContain("-3%");
    expect(span.className).toContain("text-red-400");
    expect(span.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });
  it("zero fica neutro", () => {
    act(() => root.render(<VariacaoComSeta valor={0} texto="0%" />));
    expect(host.querySelector("span")?.className).toContain("text-zinc-400");
  });
});

describe("corDoValor (regressão)", () => {
  it("mantém as classes de hoje", () => {
    expect(corDoValor(12.5)).toBe("text-emerald-400");
    expect(corDoValor(-0.02)).toBe("text-red-400");
    expect(corDoValor(0)).toBe("text-zinc-300");
    expect(corDoValor(0.004)).toBe("text-zinc-300");
    expect(corDoValor(-0.004)).toBe("text-zinc-300");
    expect(corDoValor(0.005)).toBe("text-emerald-400");
  });
});
