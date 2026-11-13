// @vitest-environment jsdom
//
// PAR das migrations 20261399970000 e 20261399995000: o ranking "Produtos que mais dão lucro" (e o lucro do gráfico diário)
// desconta a devolução e o estorno, pedido a pedido como o Financeiro (o dinheiro devolvido de verdade, o custo da peça que não
// voltou para a prateleira, sem frete, no dia da venda). A explicação do cartão tem de dizer isso, e o cartão tem de
// mostrar sem tropeço o produto que voltou inteiro (0 unidades, lucro R$ 0,00) e o que perdeu dinheiro
// (lucro negativo: a peça devolvida e não reestocada).
import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SEM_NBSP = (t: string | null) =>
  (t ?? "").split(String.fromCharCode(160)).join(" ").replace(/\s+/g, " ");

describe("TopProductsList — o lucro desconta devolução e estorno", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function montar(topProducts: unknown[]) {
    const stats = { topProducts } as unknown as DashboardStats;
    act(() =>
      raiz.render(
        <TopProductsList stats={stats} loading={false} onNavigate={vi.fn()} />,
      ),
    );
  }

  it("a explicação do cartão diz que o dinheiro devolvido e a peça que não voltou são descontados, que a conta é do dia da venda e sem frete (por isso difere do Financeiro do mês), e que produto sem custo não entra", () => {
    montar([{ id: "p1", name: "Vestido", quantity: 1, total: 60, image: "" }]);
    const botao = hospedeiro.querySelector(
      'button[aria-label="Entender Produtos que mais dão lucro"]',
    ) as HTMLButtonElement;
    expect(botao).not.toBeNull();
    act(() => botao.click());
    const texto = SEM_NBSP(document.body.textContent);
    expect(texto).toContain(
      "É o que a loja ganhou com cada produto: o preço pago menos o custo, menos o dinheiro devolvido e o custo da peça que não voltou para a prateleira. Conta no dia da venda e sem frete — por isso o total não é o mesmo do Financeiro do mês.",
    );
    expect(texto).toContain("Produto sem custo cadastrado não entra.");
    // As frases antigas: a que prometia só preço menos custo e a que só falava de devoluções e estornos.
    expect(texto).not.toContain(
      "O valor é o lucro (preço menos custo). Produto",
    );
    expect(texto).not.toContain("descontadas as devoluções e os estornos");
  });

  it("produto devolvido por inteiro aparece com 0 unidades e R$ 0,00; peça perdida aparece com o menos antes do R$", () => {
    montar([
      { id: "p1", name: "Vestido", quantity: 1, total: 60, image: "" },
      { id: "p2", name: "Blusa", quantity: 0, total: 0, image: "" },
      { id: "p3", name: "Saia", quantity: 0, total: -20, image: "" },
    ]);
    // O cartão mostra os três primeiros; os três cabem.
    const texto = SEM_NBSP(hospedeiro.textContent);
    expect(texto).toContain("Vestido");
    expect(texto).toContain("1 unidade vendida");
    expect(texto).toContain("Blusa");
    expect(texto).toContain("0 unidades vendidas");
    expect(texto).toContain("R$ 0,00");
    expect(texto).toContain("-R$ 20,00");
    expect(texto).not.toContain("R$ -20");
  });
});
