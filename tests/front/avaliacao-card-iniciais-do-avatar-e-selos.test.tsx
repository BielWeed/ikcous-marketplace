// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), cartão de avaliação da vitrine. A bolinha do
// avatar (quando a cliente não tem foto) mostra as iniciais do nome público, e
// nenhum teste lia essas letras: trocar o `toUpperCase()`, ou fazer o nome de
// uma palavra mostrar a inicial duas vezes, mantinha a suíte verde. Aqui também:
// o selo "Verificado" só aparece para compra verificada, e o "Útil (0)" mostra
// o zero de verdade (não some).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import type { Review } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function avaliacao(extra: Partial<Review> = {}): Review {
  return {
    id: "r1",
    productId: "p1",
    customerName: "Maria Souza",
    rating: 5,
    comment: "Gostei",
    verified: false,
    helpful: 0,
    createdAt: "2026-10-01T12:00:00Z",
    ...extra,
  };
}

let raiz: Root;
let host: HTMLDivElement;
class IntersectionObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverFalso);
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function montar(review: Review) {
  act(() => {
    raiz.render(<ReviewCard review={review} onHelpful={vi.fn()} />);
  });
}

// A bolinha do avatar é a única caixa com `select-none` e `items-center`
// dentro do cartão que carrega só as iniciais.
const iniciais = () =>
  host.querySelector("span.select-none.items-center")?.textContent;

describe("ReviewCard — iniciais do avatar", () => {
  it("nome e sobrenome: a inicial de cada um, em maiúscula", () => {
    montar(avaliacao({ customerName: "Maria Souza" }));
    expect(iniciais()).toBe("MS");
  });

  it("nome digitado em minúsculas também vira iniciais em maiúscula", () => {
    montar(avaliacao({ customerName: "joana lima" }));
    expect(iniciais()).toBe("JL");
  });

  it("nome de uma palavra só: uma inicial, não duas", () => {
    montar(avaliacao({ customerName: "joana" }));
    expect(iniciais()).toBe("J");
  });

  it("nome vazio ou só com espaços: aparece o nome padrão 'Cliente' e a inicial dele", () => {
    montar(avaliacao({ customerName: "   " }));
    expect(host.textContent).toContain("Cliente");
    expect(iniciais()).toBe("C");
  });

  it("nome que começa com emoji: a inicial é o emoji inteiro, sem partir ao meio", () => {
    montar(avaliacao({ customerName: "😀 Silva" }));
    expect(iniciais()).toBe("😀S");
  });

  it("nome composto: primeira palavra e inicial do último sobrenome (Ana Maria de Souza = AS)", () => {
    montar(avaliacao({ customerName: "Ana Maria de Souza" }));
    expect(iniciais()).toBe("AS");
  });
});

describe("ReviewCard — selos e contador", () => {
  it("compra não verificada não leva o selo Verificado; verificada leva", () => {
    montar(avaliacao({ verified: false }));
    expect(host.textContent).not.toContain("Verificado");
    montar(avaliacao({ verified: true }));
    expect(host.textContent).toContain("Verificado");
  });

  it("sem resposta da loja não desenha o bloco 'Resposta da Loja'; com resposta, desenha", () => {
    montar(avaliacao({ merchantReply: undefined }));
    expect(host.textContent).not.toContain("Resposta da Loja");
    montar(avaliacao({ merchantReply: "Obrigada pela compra!" }));
    expect(host.textContent).toContain("Resposta da Loja");
    expect(host.textContent).toContain("Obrigada pela compra!");
  });

  it("zero votos mostra 'Útil (0)'", () => {
    montar(avaliacao({ helpful: 0 }));
    expect(host.textContent).toContain("Útil (0)");
  });

  it("sem foto não desenha a faixa de imagens; com foto, desenha", () => {
    montar(avaliacao({ images: [] }));
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(host.querySelector(".scrollbar-hide")).toBeNull();
    montar(avaliacao({ images: ["https://exemplo.test/foto.png"] }));
    expect(host.querySelector(".scrollbar-hide")).not.toBeNull();
  });
});
