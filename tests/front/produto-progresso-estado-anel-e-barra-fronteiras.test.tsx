// @vitest-environment jsdom
// O progresso dos cinco campos essenciais do produto (anel "N/5" e barra) só
// aparecia indiretamente na tela do formulário. Aqui fica preso o estado
// (vazio / parcial / completo) nas fronteiras 0, 1, total-1, total e acima do
// total, o arco do anel (some quando vazio, nunca passa de uma volta) e o que a
// barra diz para o leitor de tela.
import { act } from "react";

import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AnelDoProgresso,
  BarraDoProgresso,
  estadoDoProgresso,
} from "@/components/admin/products/ProgressoDoProduto";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("estadoDoProgresso — fronteiras", () => {
  it("zero e negativo são 'vazio'", () => {
    expect(estadoDoProgresso(0, 5)).toBe("vazio");
    expect(estadoDoProgresso(-1, 5)).toBe("vazio");
  });

  it("de 1 até total-1 é 'parcial'", () => {
    expect(estadoDoProgresso(1, 5)).toBe("parcial");
    expect(estadoDoProgresso(4, 5)).toBe("parcial");
  });

  it("exatamente o total já é 'completo', e acima do total continua completo", () => {
    expect(estadoDoProgresso(5, 5)).toBe("completo");
    expect(estadoDoProgresso(6, 5)).toBe("completo");
  });

  it("um campo de um total de um: completo; nenhum: vazio", () => {
    expect(estadoDoProgresso(1, 1)).toBe("completo");
    expect(estadoDoProgresso(0, 1)).toBe("vazio");
  });

  it("zero de zero é 'vazio' (a ausência de campos não é 'completo')", () => {
    expect(estadoDoProgresso(0, 0)).toBe("vazio");
  });
});

describe("AnelDoProgresso e BarraDoProgresso", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function desenhar(peca: "anel" | "barra", preenchidos: number, total = 5) {
    act(() => {
      root.render(
        peca === "anel" ? (
          <AnelDoProgresso preenchidos={preenchidos} total={total} />
        ) : (
          <BarraDoProgresso preenchidos={preenchidos} total={total} />
        ),
      );
    });
  }

  const CIRCUNFERENCIA = 2 * Math.PI * 18;
  const arco = () => host.querySelector("circle.produto-anel-arco");

  it("anel vazio: mostra '0/5', sem arco desenhado e sem a cor de progresso", () => {
    desenhar("anel", 0);
    const anel = host.querySelector('[data-testid="anel-do-produto"]');
    expect(anel?.getAttribute("data-estado")).toBe("vazio");
    expect(anel?.getAttribute("aria-hidden")).toBe("true");
    expect(anel?.className).not.toContain("text-emerald-300");
    expect(host.textContent).toBe("0/5");
    expect(arco()).toBeNull();
  });

  it("anel parcial 2/5: arco com 40% da volta (o resto do traço fica escondido)", () => {
    desenhar("anel", 2);
    const anel = host.querySelector('[data-testid="anel-do-produto"]');
    expect(anel?.getAttribute("data-estado")).toBe("parcial");
    expect(anel?.className).toContain("text-emerald-300");
    expect(host.textContent).toBe("2/5");
    const deslocamento = Number(arco()?.getAttribute("stroke-dashoffset"));
    expect(Number(arco()?.getAttribute("stroke-dasharray"))).toBeCloseTo(
      CIRCUNFERENCIA,
      6,
    );
    expect(deslocamento).toBeCloseTo(CIRCUNFERENCIA * 0.6, 6);
  });

  it("anel completo 5/5: volta inteira (deslocamento 0)", () => {
    desenhar("anel", 5);
    expect(
      host
        .querySelector('[data-testid="anel-do-produto"]')
        ?.getAttribute("data-estado"),
    ).toBe("completo");
    expect(Number(arco()?.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 6);
  });

  it("anel com mais que o total NÃO passa de uma volta (sem deslocamento negativo)", () => {
    desenhar("anel", 8);
    expect(Number(arco()?.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 6);
  });

  it("anel com valor negativo não desenha arco (estado vazio) nem deslocamento além da volta", () => {
    desenhar("anel", -3);
    expect(arco()).toBeNull();
  });

  it("barra diz em palavras quantos essenciais estão prontos e o estado", () => {
    desenhar("barra", 3);
    const barra = host.querySelector('[role="progressbar"]');
    expect(barra?.getAttribute("aria-valuemin")).toBe("0");
    expect(barra?.getAttribute("aria-valuemax")).toBe("5");
    expect(barra?.getAttribute("aria-valuenow")).toBe("3");
    expect(barra?.getAttribute("aria-valuetext")).toBe(
      "3 de 5 essenciais prontos",
    );
    expect(barra?.getAttribute("data-estado")).toBe("parcial");
    expect((barra?.firstElementChild as HTMLElement).style.width).toBe("60%");
  });

  it("barra vazia tem largura 0% e estado 'vazio'; cheia tem 100% e 'completo'", () => {
    desenhar("barra", 0);
    let barra = host.querySelector('[role="progressbar"]');
    expect(barra?.getAttribute("data-estado")).toBe("vazio");
    expect((barra?.firstElementChild as HTMLElement).style.width).toBe("0%");

    desenhar("barra", 5);
    barra = host.querySelector('[role="progressbar"]');
    expect(barra?.getAttribute("data-estado")).toBe("completo");
    expect((barra?.firstElementChild as HTMLElement).style.width).toBe("100%");
  });
});
