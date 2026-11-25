// @vitest-environment jsdom
//
// O balão do gráfico "Histórico da loja" põe o sinal de menos SÓ quando o
// valor, em centavos, é de fato negativo. Um resto de conta de ponto
// flutuante (-0,004) vira "R$ 0,00" sem sinal: "−R$ 0,00" faria a lojista
// achar que está no prejuízo. Valor negativo de verdade mostra o menos
// tipográfico (U+2212), tanto na receita quanto no lucro e no estoque
// (caça por mutação, 24/11/2026).
import { BalaoDoGrafico } from "@/components/admin/dashboard/BalaoDoGrafico";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let raiz: Root;
let hospedeiro: HTMLDivElement;

const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("BalaoDoGrafico: sinal de menos", () => {
  it("vendas: resto de ponto flutuante vira R$ 0,00 sem sinal; negativo de verdade leva o menos", async () => {
    await act(async () => {
      raiz.render(
        <BalaoDoGrafico
          tipo="vendas"
          data="22/10"
          receita={-0.004}
          pedidos={2}
        />,
      );
    });
    expect(texto()).toContain("R$ 0,00");
    expect(texto()).not.toContain("−");

    await act(async () => {
      raiz.render(
        <BalaoDoGrafico
          tipo="vendas"
          data="22/10"
          receita={-12.34}
          pedidos={2}
        />,
      );
    });
    expect(texto()).toContain("−R$ 12,34");
  });

  it("lucro e estoque: o mesmo vale para as duas linhas do balão", async () => {
    await act(async () => {
      raiz.render(
        <BalaoDoGrafico
          tipo="lucro"
          data="22/10"
          lucroAcumulado={-0.004}
          estoqueInvestido={-0.004}
        />,
      );
    });
    expect(texto()).not.toContain("−");
    expect(texto().match(/R\$ 0,00/g)).toHaveLength(2);

    await act(async () => {
      raiz.render(
        <BalaoDoGrafico
          tipo="lucro"
          data="22/10"
          lucroAcumulado={-1500.5}
          estoqueInvestido={800}
        />,
      );
    });
    expect(texto()).toContain("Lucro acumulado−R$ 1.500,50");
    expect(texto()).toContain("Estoque investidoR$ 800,00");
  });
});
