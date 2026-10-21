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
  it("explica visivelmente onde ver o lucro que desconta devolução parcial e estorno", () => {
    act(() => raiz.render(<AjudaDoCrm isOpen onClose={() => {}} />));
    const visivel = document.body.cloneNode(true) as HTMLElement;
    visivel.querySelectorAll(".sr-only, [hidden]").forEach((el) => el.remove());
    const texto = (visivel.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain(
      "No lucro dos gráficos, devolução parcial e estorno só são descontados na aba Resultado do Financeiro.",
    );
  });

  it("diz que produto sem custo fica FORA da conta e que o lucro usa o custo de hoje", () => {
    act(() => raiz.render(<AjudaDoCrm isOpen onClose={() => {}} />));
    const texto = (document.body.textContent ?? "").replace(/\s+/g, " ");

    expect(texto).toContain("Produtos Mais Lucrativos");
    expect(texto).toContain(
      "Venda sem custo (nem guardado no dia, nem cadastrado hoje) fica fora da conta do lucro",
    );
    expect(texto).toContain("a tela avisa quantos produtos ficaram de fora");
    expect(texto).toContain(
      'toque no botão ao lado da busca ("Mostrar em lista com detalhes") e procure o selo "Sem Custo Cadastrado"',
    );
    expect(texto).not.toContain("cartão detalhado");
    // A tela só mostra a QUANTIDADE, não a lista de quais são.
    expect(texto).not.toContain("avisa quais são");
    expect(texto).toContain(
      "A venda de um produto que já tinha custo guarda o custo do dia: mudar o custo depois não altera o lucro dela. As vendas feitas sem custo cadastrado, e as feitas antes de o app passar a guardar o custo do dia, usam o custo de hoje.",
    );
    // A promessa antiga, falsa desde o custo do dia: mudar o custo mudava o lucro de TODA venda antiga.
    expect(texto).not.toContain("o lucro das vendas antigas muda junto");
    // A afirmação antiga, falsa.
    expect(texto).not.toContain("conta custo zero");
  });
});
