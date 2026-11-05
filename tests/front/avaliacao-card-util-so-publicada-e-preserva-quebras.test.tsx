// @vitest-environment jsdom
//
// Cartão de avaliação da vitrine:
// 1) o botão "Útil" só existe para avaliação já publicada -- a função do banco
//    recusa voto em avaliação "em análise", e o botão ativo só dava erro;
// 2) as quebras de linha do comentário da cliente e da resposta da loja chegam
//    à tela como foram escritas (o painel já as mostrava assim).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import type { Review } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function avaliacao(extra: Partial<Review> = {}): Review {
  return {
    id: "r1",
    productId: "p1",
    customerName: "Cliente",
    rating: 5,
    comment: "Gostei",
    verified: true,
    helpful: 2,
    createdAt: "2026-10-01T12:00:00Z",
    ...extra,
  };
}

let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(review: Review) {
  act(() => {
    raiz.render(<ReviewCard review={review} onHelpful={vi.fn()} />);
  });
}
const botaoUtil = () =>
  Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Útil"),
  );

it("avaliação em análise não mostra o botão Útil", () => {
  montar(avaliacao({ status: "pendente" }));
  expect(host.textContent).toContain("Em análise");
  expect(botaoUtil()).toBeUndefined();
});

it("avaliação publicada, ou sem status, mostra o botão Útil ativo", () => {
  montar(avaliacao({ status: "publicada" }));
  expect(botaoUtil()?.disabled).toBe(false);
  montar(avaliacao());
  expect(botaoUtil()?.disabled).toBe(false);
  expect(botaoUtil()?.textContent).toContain("Útil (2)");
});

it("comentário da cliente e resposta da loja preservam as quebras de linha", () => {
  montar(
    avaliacao({
      comment: "Primeira linha\nSegunda linha",
      merchantReply: "Temos em 3 cores:\nAzul\nRosa",
    }),
  );
  const paragrafo = (trecho: string) =>
    Array.from(host.querySelectorAll("p")).find((p) =>
      p.textContent?.includes(trecho),
    );
  expect(paragrafo("Primeira linha")?.className).toContain(
    "whitespace-pre-wrap",
  );
  expect(paragrafo("Temos em 3 cores")?.className).toContain(
    "whitespace-pre-wrap",
  );
});
