// @vitest-environment jsdom
//
// Pedido do dono (celular real): o balao do grafico "Historico da loja"
// ocupava mais da metade da largura, com letras maiusculas espacadas e
// itálico. Aqui o balao novo e renderizado direto, com um payload falso do
// Recharts. jsdom NAO faz layout: este teste prova texto e estrutura (sem
// caixa alta, sem itálico, numeros certos), nunca posicao nem transbordo na
// tela do celular.
import {
  ALTURA_LUCRO,
  ALTURA_VENDAS,
  BalaoDoGrafico,
  MARGEM_TOPO_LUCRO,
  MARGEM_TOPO_VENDAS,
} from "@/components/admin/dashboard/BalaoDoGrafico";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(el: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => createRoot(container).render(el));
  return { container };
}

const texto = (c: HTMLElement) => (c.textContent ?? "").replace(/\s+/g, " ");

describe("BalaoDoGrafico - vendas", () => {
  it("mostra data, valor com espaco e pedidos", () => {
    const { container } = render(
      <BalaoDoGrafico
        tipo="vendas"
        data="22/10/2026"
        receita={240}
        pedidos={3}
      />,
    );
    const t = texto(container);
    expect(t).toContain("22/10/2026");
    expect(t).toContain("R$ 240");
    expect(t).toContain("3 pedidos");
  });

  it("singular e zero", () => {
    const um = render(
      <BalaoDoGrafico tipo="vendas" data="d" receita={10} pedidos={1} />,
    );
    expect(texto(um.container)).toContain("1 pedido");
    expect(texto(um.container)).not.toContain("1 pedidos");
    const zero = render(
      <BalaoDoGrafico tipo="vendas" data="d" receita={0} pedidos={0} />,
    );
    expect(texto(zero.container)).toContain("R$ 0");
    expect(texto(zero.container)).toContain("0 pedidos");
  });

  it("milhar usa o formato pt-BR sem casas", () => {
    const { container } = render(
      <BalaoDoGrafico tipo="vendas" data="d" receita={1234.6} pedidos={2} />,
    );
    expect(texto(container).replace(/\u00a0/g, " ")).toContain("R$ 1.235");
  });
});

describe("BalaoDoGrafico - lucro e estoque", () => {
  it("mostra os dois valores com 2 casas", () => {
    const { container } = render(
      <BalaoDoGrafico
        tipo="lucro"
        data="22/10/2026"
        lucroAcumulado={1500.5}
        estoqueInvestido={320}
      />,
    );
    const t = texto(container).replace(/\u00a0/g, " ");
    expect(t).toContain("22/10/2026");
    expect(t).toContain("Lucro acumulado");
    expect(t).toContain("R$ 1.500,50");
    expect(t).toContain("Estoque investido");
    expect(t).toContain("R$ 320,00");
  });
});

describe("BalaoDoGrafico - apresentacao", () => {
  it("nao usa caixa alta forcada, italico nem brilho, e nao captura toque", () => {
    const a = render(
      <BalaoDoGrafico tipo="vendas" data="d" receita={5} pedidos={2} />,
    );
    const b = render(
      <BalaoDoGrafico
        tipo="lucro"
        data="d"
        lucroAcumulado={1}
        estoqueInvestido={2}
      />,
    );
    for (const c of [a.container, b.container]) {
      const html = c.innerHTML;
      expect(html).not.toMatch(
        /uppercase|italic|tracking-|font-black|shadow-\[0_0_/,
      );
      expect(c.firstElementChild?.className).toContain("pointer-events-none");
      expect(c.firstElementChild?.className).toMatch(/max-w-\[\d+px\]/);
    }
  });
});

describe("BalaoDoGrafico - cabe na faixa reservada", () => {
  it("a linha de vendas nao quebra nem com valor de 5 digitos", () => {
    const { container } = render(
      <BalaoDoGrafico tipo="vendas" data="d" receita={12346} pedidos={12} />,
    );
    const linha = container.querySelector(".items-baseline");
    expect(linha?.className).toContain("flex-nowrap");
    expect(linha?.className).toContain("whitespace-nowrap");
    expect(linha?.className).not.toContain("flex-wrap");
    expect(texto(container)).toContain("R$ 12.346");
  });

  it("margens e alturas guardam balao + folga e a area util de antes", () => {
    expect(MARGEM_TOPO_VENDAS).toBeGreaterThanOrEqual(66);
    expect(MARGEM_TOPO_LUCRO).toBeGreaterThanOrEqual(84);
    expect(ALTURA_VENDAS - MARGEM_TOPO_VENDAS).toBe(140);
    expect(ALTURA_LUCRO - MARGEM_TOPO_LUCRO).toBe(150);
  });
});
