// @vitest-environment jsdom
//
// O card recebe o contador confirmado pelo hook e nunca soma outro voto no
// rótulo. O teste de integração vizinho cobre RPC, releitura e cache reais.

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

/** O pai entrega o número confirmado pela releitura do servidor. */
function PaiComMarkHelpful({ revisao }: { revisao: Review }) {
  const [review, setReview] = useState(revisao);
  return (
    <ReviewCard
      review={review}
      onHelpful={async () => {
        await Promise.resolve();
        setReview((atual) => ({ ...atual, helpful: 3 }));
        return true;
      }}
    />
  );
}

/** Falha da RPC mantém o último contador confirmado e permite repetir. */
function PaiComMarkHelpfulQueFalha({ revisao }: { revisao: Review }) {
  return (
    <ReviewCard
      review={revisao}
      onHelpful={async () => {
        await Promise.resolve();
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

    // O objeto já contém o 3 confirmado: o rótulo não pode somar de novo.
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

  it("quando o RPC falha, o botão NÃO trava e o contador continua confirmado", async () => {
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

    // Falha de gravação não altera o 2 que já veio do servidor.
    expect(botaoUtil?.textContent).toContain("Útil (2)");
    // E o botão não trava: a pessoa pode tentar de novo quando a rede voltar.
    expect(botaoUtil?.hasAttribute("disabled")).toBe(false);
  });
});
