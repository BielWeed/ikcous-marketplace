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

// Escopo local: lê apenas o conteúdo da linha, sem dependência de Testing Library.
const within = (linha: Element) => SEM_NBSP(linha.textContent);

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
      "É o que a loja ganhou com cada produto: o que a cliente pagou pela peça (já com o cupom), menos todo dinheiro devolvido, menos o custo das peças que não voltaram para a prateleira.",
    );
    // As duas regras do ranking: reembolso total não tira o pedido; só o cancelado com estoque de volta sai.
    expect(texto).toContain(
      "Reembolso total não tira o pedido da lista; só sai o pedido cancelado.",
    );
    // A função do banco filtra `p.deleted_at IS NULL`: produto excluído não entra no ranking (o gráfico diário e o Financeiro contam a venda dele).
    expect(texto).toContain(
      "só sai o pedido cancelado. Produtos excluídos não aparecem aqui. Conta no dia",
    );
    expect(texto).toContain(
      "Conta no dia da venda e sem frete, por isso difere do Financeiro do mês.",
    );
    expect(texto).toContain("Produto sem custo não entra.");
    // A frase antiga lida ao pé da letra tirava o custo duas vezes ("preço menos o custo, menos ... o custo da peça").
    expect(texto).not.toContain("o preço pago menos o custo");
    // As frases antigas: a que prometia só preço menos custo e a que só falava de devoluções e estornos.
    expect(texto).not.toContain(
      "O valor é o lucro (preço menos custo). Produto",
    );
    expect(texto).not.toContain("descontadas as devoluções e os estornos");
  });

  it("cada linha reúne o nome, a quantidade e o lucro do próprio produto", () => {
    const produtos = [
      { id: "p1", name: "Vestido", quantity: 7, total: 60, image: "" },
      { id: "p2", name: "Blusa", quantity: 2, total: 0, image: "" },
      { id: "p3", name: "Saia", quantity: 1, total: -20, image: "" },
    ];
    montar(produtos);
    const linhas = [...hospedeiro.querySelectorAll("li")];
    expect(linhas).toHaveLength(3);
    for (const [indice, produto] of produtos.entries()) {
      const linha = within(linhas.at(indice) as HTMLElement);
      expect(linha).toContain(produto.name);
      expect(linha).toContain(
        `${produto.quantity} ${produto.quantity === 1 ? "unidade vendida" : "unidades vendidas"}`,
      );
      expect(linha).toContain(
        ["R$ 60,00", "R$ 0,00", "-R$ 20,00"].at(indice) as string,
      );
    }
  });

  it("o ranking mantém a ordem recebida recolhido e expandido", () => {
    const produtos = [
      { id: "p1", name: "Vestido", quantity: 7, total: 100, image: "" },
      { id: "p2", name: "Blusa", quantity: 6, total: 80, image: "" },
      { id: "p3", name: "Saia", quantity: 5, total: 60, image: "" },
      { id: "p4", name: "Calça", quantity: 4, total: 40, image: "" },
      { id: "p5", name: "Casaco", quantity: 3, total: 20, image: "" },
    ];
    montar(produtos);
    function conferirRanking(quantidade: number) {
      const linhas = [...hospedeiro.querySelectorAll("li")];
      expect(linhas).toHaveLength(quantidade);
      for (const [indice, linha] of linhas.entries()) {
        expect(within(linha)).toContain(
          (produtos.at(indice) as { name: string }).name,
        );
        expect(linha.querySelector("button > span")?.textContent?.trim()).toBe(
          String(indice + 1),
        );
      }
    }
    conferirRanking(3);
    expect(within(hospedeiro)).not.toContain("Calça");
    expect(within(hospedeiro)).not.toContain("Casaco");
    const expandir = hospedeiro.querySelector(
      "button[aria-expanded]",
    ) as HTMLButtonElement;
    expect(expandir.textContent).toBe("Ver os 5 produtos");
    act(() => expandir.click());
    conferirRanking(5);
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
