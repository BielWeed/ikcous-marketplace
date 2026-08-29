// @vitest-environment jsdom
//
// O contador de "Útil" somava o clique DUAS VEZES.
//
// O DEFEITO (auditoria 22/08, achado 68): ao clicar, o hook useReviews já
// aplica o update otimista (`helpful + 1` no objeto da review, useReviews.ts
// markHelpful) e o ReviewCard SOMAVA +1 DE NOVO no rótulo
// (`Útil ({review.helpful + (hasMarkedHelpful ? 1 : 0)})`). Um clique em uma
// avaliação com 2 votos mostrava 4 — e, se o RPC falhava e o hook revertia,
// o rótulo continuava mostrando um voto a mais que a verdade (o +1 de
// compensação ficava pendurado no estado local do card).
//
// Este teste reproduz o enxerto real: o card é renderizado dentro de um
// pai que faz exatamente o que o `markHelpful` faz com o objeto (soma +1),
// e cobra que o rótulo mostre old+1 — não old+2. Com a expressão antiga do
// rótulo de volta, este teste CAI.

vi.hoisted(() => {
  // jsdom não traz IntersectionObserver nem matchMedia (_REGRAS do mural):
  // dublês mínimos para a cadeia de import do ReviewCard não quebrar na monta.
  if (typeof globalThis.IntersectionObserver === "undefined") {
    class IntersectionObserverFalso {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): unknown[] {
        return [];
      }
    }
    (globalThis as unknown as Record<string, unknown>).IntersectionObserver =
      IntersectionObserverFalso;
  }
  if (!globalThis.matchMedia) {
    globalThis.matchMedia = ((consulta: string) => ({
      matches: false,
      media: consulta,
      onchange: null,
      addListener(): void {},
      removeListener(): void {},
      addEventListener(): void {},
      removeEventListener(): void {},
      dispatchEvent(): boolean {
        return false;
      },
    })) as unknown as typeof matchMedia;
  }
});

import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import type { Review } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// testes vizinhos (sem ela o React reclama de act() em todo render).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVALIACAO_BASE: Review = {
  id: "rev-1",
  productId: "prod-bolsa",
  userId: "cliente-1",
  customerName: "Marina",
  customerAvatar: undefined,
  rating: 5,
  comment: "Bolsa linda e bem acabada.",
  verified: false,
  helpful: 2,
  createdAt: "2026-08-20T12:00:00.000Z",
};

/** O pai imita o `markHelpful` do useReviews: no clique, soma +1 no objeto
 * da review (update otimista). É o enxerto real de ProductView.tsx:1307. */
function PaiComMarkHelpful({ revisao }: { revisao: Review }) {
  const [review, setReview] = useState(revisao);
  return (
    <ReviewCard
      review={review}
      onHelpful={() => {
        setReview((atual) => ({ ...atual, helpful: atual.helpful + 1 }));
      }}
    />
  );
}

/** O pai imita o `markHelpful` QUANDO O RPC FALHA: soma +1 otimista, o RPC
 * devolve erro, o hook REVERTE o +1 e devolve `false`. É a evidência do
 * CACADOR-A (msg #14): o card antigo travava o botão mesmo assim — voto
 * que o banco nunca gravou, botão morto até remontar a tela. */
function PaiComMarkHelpfulQueFalha({ revisao }: { revisao: Review }) {
  const [review, setReview] = useState(revisao);
  return (
    <ReviewCard
      review={review}
      onHelpful={async () => {
        setReview((atual) => ({ ...atual, helpful: atual.helpful + 1 }));
        await Promise.resolve();
        setReview((atual) => ({ ...atual, helpful: atual.helpful - 1 }));
        return false;
      }}
    />
  );
}

describe("voto Útil — um clique conta um voto, não dois", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("o rótulo mostra 2 antes do clique e 3 depois — nunca 4", async () => {
    await act(async () => {
      raiz.render(<PaiComMarkHelpful revisao={AVALIACAO_BASE} />);
    });

    const botaoUtil = hospedeiro.querySelector("button");
    expect(botaoUtil).not.toBeNull();
    expect(botaoUtil?.textContent).toContain("Útil (2)");

    await act(async () => {
      botaoUtil?.click();
    });

    // O objeto já somou +1 (update otimista do hook, imitado pelo pai).
    // O rótulo não pode somar +1 POR CIMA disso: 2 + 1 clique = 3.
    expect(botaoUtil?.textContent).toContain("Útil (3)");
    expect(botaoUtil?.textContent).not.toContain("Útil (4)");
  });

  it("sem clique, o rótulo fica no valor que veio do banco", async () => {
    await act(async () => {
      raiz.render(<PaiComMarkHelpful revisao={AVALIACAO_BASE} />);
    });
    const botaoUtil = hospedeiro.querySelector("button");
    expect(botaoUtil?.textContent).toContain("Útil (2)");
  });

  it("quando o RPC falha e o hook reverte, o botão NÃO trava e o contador volta à verdade", async () => {
    // Evidência do CACADOR-A: o card antigo marcava hasMarkedHelpful no
    // clique, sem saber se o voto gravou. Erro de rede = botão morto com
    // voto que não existe. O contrato novo: markHelpful devolve false e o
    // botão continua clicável.
    await act(async () => {
      raiz.render(<PaiComMarkHelpfulQueFalha revisao={AVALIACAO_BASE} />);
    });
    const botaoUtil = hospedeiro.querySelector("button");

    await act(async () => {
      botaoUtil?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // O +1 otimista foi revertido pelo hook: contador de volta a 2.
    expect(botaoUtil?.textContent).toContain("Útil (2)");
    // E o botão não trava: a pessoa pode tentar de novo quando a rede voltar.
    expect(botaoUtil?.hasAttribute("disabled")).toBe(false);
  });
});
