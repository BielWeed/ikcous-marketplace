// @vitest-environment jsdom
//
// A ajuda "Como ler os relatórios" dizia que produto sem custo cadastrado
// "conta custo zero" no ranking de lucro. Deixou de ser verdade (migration
// 20261234: o produto sem custo é TIRADO do lucro, e a tela avisa quais) e a
// lojista lia uma regra que o painel não aplica mais. Também faltava dizer
// que o lucro usa o custo de HOJE de cada produto (o item do pedido não guarda
// o custo do dia da venda). Este teste prende o texto verdadeiro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AjudaDoCrm } from "@/components/admin/crm/AjudaDoCrm";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let hospedeiro: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("AjudaDoCrm — ranking de lucro e produto sem custo", () => {
  it("diz que produto sem custo fica FORA da conta e que o lucro usa o custo de hoje", () => {
    act(() => raiz.render(<AjudaDoCrm isOpen onClose={() => {}} />));
    const texto = (document.body.textContent ?? "").replace(/\s+/g, " ");

    expect(texto).toContain("Produtos Mais Lucrativos");
    expect(texto).toContain(
      "Produto sem custo cadastrado fica fora da conta do lucro",
    );
    expect(texto).toContain("a tela avisa quais são");
    expect(texto).toContain(
      "O lucro usa o custo de hoje de cada produto: se você mudar o custo, o lucro das vendas antigas muda junto.",
    );
    // A afirmação antiga, falsa.
    expect(texto).not.toContain("conta custo zero");
  });
});
