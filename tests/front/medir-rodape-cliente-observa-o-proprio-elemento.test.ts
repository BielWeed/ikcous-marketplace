// @vitest-environment jsdom
//
// A barra fixa de baixo da vitrine só reserva o espaço certo se ela AVISA
// quando muda de altura (teclado, texto que quebra, cupom que abre). O teste
// vizinho (`customer-footer-reserva-medida`) chama a função de aviso na mão e
// nunca confere que o rodapé foi mesmo REGISTRADO no observador: uma mutação
// que tirava o `observe(elemento)` passava, e no aparelho a reserva ficava
// congelada na primeira medida.
import { afterEach, describe, expect, it, vi } from "vitest";

import { medirRodapeCliente } from "@/lib/medir-rodape-cliente";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--customer-footer-height");
});

describe("medirRodapeCliente — o rodapé é registrado no observador de tamanho", () => {
  it("observa exatamente o elemento medido e para de observar ao sair", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(72);

    const barra = document.createElement("div");
    const limpar = medirRodapeCliente(barra);

    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(barra);
    expect(
      document.documentElement.style.getPropertyValue(
        "--customer-footer-height",
      ),
    ).toBe("72px");

    limpar?.();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(
      document.documentElement.style.getPropertyValue(
        "--customer-footer-height",
      ),
    ).toBe("");
  });

  it("sem ResizeObserver no aparelho, ainda mede uma vez e limpa ao sair", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(55);

    const barra = document.createElement("div");
    const limpar = medirRodapeCliente(barra);
    expect(
      document.documentElement.style.getPropertyValue(
        "--customer-footer-height",
      ),
    ).toBe("55px");
    limpar?.();
    expect(
      document.documentElement.style.getPropertyValue(
        "--customer-footer-height",
      ),
    ).toBe("");
  });

  it("elemento nulo (ref ainda não montada): não mede nada e não devolve limpeza", () => {
    expect(medirRodapeCliente(null)).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue(
        "--customer-footer-height",
      ),
    ).toBe("");
  });
});
