// @vitest-environment jsdom
//
// Cartão "Produtos que mais dão lucro" do painel — fronteiras que nenhum teste
// segurava (achadas por mutação em 24/11/2026):
//  - o botão "Ver os N produtos" só existe com MAIS de 3 produtos: com 3, todos
//    já estão na tela;
//  - o aviso "N produtos sem custo" e o botão "Cadastrar custo" só aparecem
//    quando há produto sem custo (zero não é aviso);
//  - total ausente de um produto sai "R$ 0,00", nunca "R$ NaN";
//  - lista vazia SEM produto sem custo diz "Nenhum dado de vendas disponível"
//    (a frase que manda cadastrar custo é só para quem tem produto sem custo).
import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ObservadorQueNaoVeNada {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = (n: number) => ({
  id: `p${n}`,
  name: `Produto ${n}`,
  quantity: n,
  total: 10 * n,
  image: "",
});
// O campo `total` simplesmente não veio na linha do banco.
const produtoSemTotal = () => ({
  id: "p9",
  name: "Produto 9",
  quantity: 1,
  image: "",
});

function statsCom(
  topProducts: unknown[],
  productsWithoutCost?: number,
): DashboardStats {
  return { topProducts, productsWithoutCost } as unknown as DashboardStats;
}

describe("TopProductsList: fronteiras", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ObservadorQueNaoVeNada);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const montar = (stats: DashboardStats) =>
    act(() =>
      raiz.render(
        <TopProductsList stats={stats} loading={false} onNavigate={() => {}} />,
      ),
    );
  const texto = () =>
    (hospedeiro.textContent ?? "")
      .replaceAll(String.fromCharCode(160), " ")
      .replace(/\s+/g, " ");

  it("com 3 produtos não há 'Ver os 3 produtos'; com 4, há, e abre os 4", () => {
    montar(statsCom([1, 2, 3].map((n) => produto(n))));
    expect(hospedeiro.querySelectorAll("ol li")).toHaveLength(3);
    expect(texto()).not.toContain("Ver os");

    montar(statsCom([1, 2, 3, 4].map((n) => produto(n))));
    expect(hospedeiro.querySelectorAll("ol li")).toHaveLength(3);
    expect(texto()).toContain("Ver os 4 produtos");
  });

  it("zero produto sem custo: nenhum aviso e nenhum 'Cadastrar custo'", () => {
    montar(statsCom([produto(1)], 0));
    expect(texto()).not.toContain("sem custo cadastrado");
    expect(texto()).not.toContain("Cadastrar custo");
  });

  it("produto sem custo: aviso no singular e o botão 'Cadastrar custo'", () => {
    montar(statsCom([produto(1)], 1));
    expect(texto()).toContain(
      "1 produto sem custo cadastrado ficou fora do lucro.",
    );
    expect(texto()).toContain("Cadastrar custo");
  });

  it("total ausente de um produto sai R$ 0,00, nunca R$ NaN", () => {
    montar(statsCom([produtoSemTotal()]));
    expect(texto()).toContain("R$ 0,00");
    expect(texto()).not.toContain("NaN");
  });

  it("lista vazia sem produto sem custo: 'Nenhum dado de vendas disponível'", () => {
    montar(statsCom([], 0));
    expect(texto()).toContain("Nenhum dado de vendas disponível");
    expect(texto()).not.toContain("Cadastre o custo");
  });

  it("lista vazia COM produtos sem custo: manda cadastrar o custo", () => {
    montar(statsCom([], 2));
    expect(texto()).toContain("Cadastre o custo dos produtos vendidos");
    expect(texto()).not.toContain("Nenhum dado de vendas disponível");
  });
});
