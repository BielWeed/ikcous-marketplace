// @vitest-environment jsdom
//
// Relatórios › Vendas por categoria fala como a loja: vírgula na porcentagem
// ("45,3%", não "45.3%"), singular quando é um só ("1 pedido"), e o vazio sem
// Title Case ("Sem dados registrados").
import {
  type CategoryData,
  StrategicIntelligenceBlocks,
} from "@/components/admin/dashboard/StrategicIntelligenceBlocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Vendas por categoria: números e frases em português", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(dados: CategoryData[]) {
    await act(async () => {
      raiz.render(
        <StrategicIntelligenceBlocks categoryData={dados} loading={false} />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  it("porcentagem com vírgula e uma casa; a barra segue usando ponto no CSS", async () => {
    const texto = await montar([
      { name: "camisetas", value: 453, orders: 5 },
      { name: "bonés", value: 547, orders: 7 },
    ]);
    expect(texto).toContain("45,3%");
    expect(texto).toContain("54,7%");
    expect(texto).not.toContain("45.3%");
    const barra = [
      ...hospedeiro.querySelectorAll<HTMLElement>("li div[style]"),
    ];
    expect(barra.map((b) => b.style.width)).toEqual(["45.3%", "54.7%"]);
  });

  it("um pedido fica no singular, vários no plural", async () => {
    const texto = await montar([
      { name: "camisetas", value: 100, orders: 1 },
      { name: "bonés", value: 100, orders: 2 },
      { name: "meias", value: 100, orders: 0 },
    ]);
    expect(texto).toContain("1 pedido ·");
    expect(texto).not.toContain("1 pedidos");
    expect(texto).toContain("2 pedidos ·");
    expect(texto).toContain("0 pedidos ·");
  });

  it("sem categoria, o vazio diz 'Sem dados registrados'", async () => {
    const texto = await montar([]);
    expect(texto).toContain("Sem dados registrados");
    expect(texto).not.toContain("Sem Dados Registrados");
  });
});
