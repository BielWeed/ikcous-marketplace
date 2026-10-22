// @vitest-environment jsdom
// No celular a folha do Financeiro sobe junto com o teclado: o campo e o
// botão principal ficam acima dele, em vez de cobertos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FolhaFinanceira } from "@/components/admin/financeiro/FolhaFinanceira";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mockLarga = false;
let mockTeclado = 0;
let mockVisivel = 0;
vi.mock("@/hooks/useFinanceiro", () => ({
  useTelaLarga: () => mockLarga,
}));
vi.mock("@/hooks/useAlturaDoTeclado", () => ({
  useAlturaDoTeclado: () => ({
    altura: mockTeclado,
    alturaVisivel: mockVisivel,
  }),
}));

let raiz: Root;
let contedor: HTMLDivElement;

function montar() {
  act(() => {
    raiz.render(
      <FolhaFinanceira
        titulo="Abrir caixa"
        aoFechar={() => {}}
        rodape={<button type="button">Abrir caixa</button>}
      >
        <input aria-label="Dinheiro na gaveta" inputMode="numeric" />
      </FolhaFinanceira>,
    );
  });
}

function folha(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
  if (!el) throw new Error("folha não montou");
  return el;
}

beforeEach(() => {
  mockLarga = false;
  mockTeclado = 0;
  mockVisivel = 0;
  contedor = document.createElement("div");
  document.body.appendChild(contedor);
  raiz = createRoot(contedor);
});

afterEach(() => {
  act(() => raiz.unmount());
  contedor.remove();
  vi.useRealTimers();
});

describe("FolhaFinanceira com teclado", () => {
  it("no celular, teclado de 320px sobe a folha 320px e limita a altura à área visível", () => {
    mockTeclado = 320;
    mockVisivel = 480;
    montar();
    expect(folha().style.bottom).toBe("320px");
    expect(folha().style.maxHeight).toBe("calc(480px - 1rem)");
  });

  it("no celular, sem teclado, não desloca nada", () => {
    montar();
    expect(folha().style.bottom).toBe("");
    expect(folha().style.maxHeight).toBe("");
  });

  it("no computador (folha pela direita) o teclado não muda nada", () => {
    mockLarga = true;
    mockTeclado = 320;
    montar();
    expect(folha().style.bottom).toBe("");
  });

  it("ao focar um campo, ele é trazido à vista depois de ~150ms", () => {
    vi.useFakeTimers();
    montar();
    const campo = document.querySelector<HTMLInputElement>("input");
    if (!campo) throw new Error("campo não montou");
    const rolar = vi.fn();
    campo.scrollIntoView = rolar;
    act(() => {
      campo.focus();
    });
    expect(rolar).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(rolar).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("refaz a rolagem quando o teclado termina de abrir com o campo em foco", () => {
    vi.useFakeTimers();
    montar();
    const campo = document.querySelector<HTMLInputElement>("input");
    if (!campo) throw new Error("campo não montou");
    const rolar = vi.fn();
    campo.scrollIntoView = rolar;
    act(() => {
      campo.focus();
    });
    expect(rolar).not.toHaveBeenCalled();
    mockTeclado = 320;
    mockVisivel = 480;
    montar();
    expect(rolar).toHaveBeenCalledWith({ block: "nearest" });
  });
});
