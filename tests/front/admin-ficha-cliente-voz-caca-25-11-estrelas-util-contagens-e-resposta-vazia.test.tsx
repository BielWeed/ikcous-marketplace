// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) — aba "Voz do Cliente" da ficha.
//
// O que os testes antigos não viam:
//  - as estrelas acesas são exatamente a nota (5 = cinco acesas, 0 = nenhuma);
//  - "Útil (N)" só aparece com N maior que zero (nunca "Útil (0)");
//  - cada título mostra a contagem da PRÓPRIA lista (avaliações e perguntas
//    com números diferentes);
//  - pergunta sem resposta não desenha caixa de respostas vazia.
// Dados inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AvaliacaoDaFicha,
  type PerguntaDaFicha,
  VozClienteTab,
} from "@/components/admin/users/VozClienteTab";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function avaliacao(over: Partial<AvaliacaoDaFicha> = {}): AvaliacaoDaFicha {
  return {
    id: "a1",
    productId: "p1",
    produtoNome: "Produto de teste",
    rating: 4,
    comment: "Gostei do produto de teste",
    status: "publicada",
    helpful: 0,
    merchantReply: null,
    createdAt: "2026-10-05T15:00:00Z",
    ...over,
  };
}

function pergunta(over: Partial<PerguntaDaFicha> = {}): PerguntaDaFicha {
  return {
    id: "q1",
    productId: "p1",
    produtoNome: "Produto de teste",
    question: "Tem em outra cor?",
    createdAt: "2026-10-06T15:00:00Z",
    respostas: [],
    ...over,
  };
}

describe("VozClienteTab — bordas", () => {
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

  function montar(
    avaliacoes: AvaliacaoDaFicha[],
    perguntas: PerguntaDaFicha[],
  ): HTMLElement {
    act(() => {
      raiz.render(
        <VozClienteTab
          carregando={false}
          erro={null}
          avaliacoes={avaliacoes}
          perguntas={perguntas}
          onTentarDeNovo={vi.fn()}
        />,
      );
    });
    return hospedeiro;
  }

  const acesas = (el: ParentNode) =>
    el.querySelectorAll("svg.fill-admin-gold").length;
  const apagadas = (el: ParentNode) =>
    el.querySelectorAll("svg.text-zinc-700").length;

  it.each([
    [5, 5, 0],
    [3, 3, 2],
    [1, 1, 4],
    [0, 0, 5],
  ])("nota %i: %i estrelas acesas e %i apagadas", (rating, a, b) => {
    const h = montar([avaliacao({ rating })], []);
    const secao = h.querySelectorAll("section")[0] as HTMLElement;
    const lista = secao.querySelector(".divide-y") as HTMLElement;
    expect(acesas(lista)).toBe(a);
    expect(apagadas(lista)).toBe(b);
  });

  it("'Útil (N)' só aparece com N maior que zero", () => {
    const h = montar(
      [
        avaliacao({ id: "a1", helpful: 0 }),
        avaliacao({ id: "a2", helpful: 3, comment: "Outra opinião" }),
      ],
      [],
    );
    const texto = h.textContent ?? "";
    expect(texto).toContain("Útil (3)");
    expect(texto).not.toContain("Útil (0)");
    expect((texto.match(/Útil \(/g) ?? []).length).toBe(1);
  });

  it("cada título mostra a contagem da própria lista", () => {
    const h = montar(
      [
        avaliacao({ id: "a1" }),
        avaliacao({ id: "a2" }),
        avaliacao({ id: "a3" }),
      ],
      [pergunta({ id: "q1" })],
    );
    const titulos = [...h.querySelectorAll("h3")].map((t) =>
      (t.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    expect(titulos).toEqual(["Avaliações(3)", "Perguntas(1)"]);
  });

  it("pergunta sem resposta não desenha a caixa de respostas; com resposta desenha uma por resposta", () => {
    const h = montar(
      [],
      [
        pergunta({ id: "q1", respostas: [] }),
        pergunta({
          id: "q2",
          question: "Qual o prazo?",
          respostas: [
            {
              id: "r1",
              answer: "Cinco dias úteis",
              createdAt: "2026-10-07T15:00:00Z",
            },
            {
              id: "r2",
              answer: "Pode variar",
              createdAt: "2026-10-08T15:00:00Z",
            },
          ],
        }),
      ],
    );
    const caixas = h.querySelectorAll(".space-y-2");
    expect(caixas).toHaveLength(1);
    expect(caixas[0]?.children).toHaveLength(2);
  });
});
