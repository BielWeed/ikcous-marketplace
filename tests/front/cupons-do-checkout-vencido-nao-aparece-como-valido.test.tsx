// @vitest-environment jsdom
//
// CUPOM QUE VENCEU COM A TELA ABERTA.
//
// A lista de cupons é lida uma vez; se a cliente deixa o checkout aberto e o
// prazo de um cupom passa, o cartão continuava dizendo "Válido até <data que
// já passou>", como se valesse (e tocável). Agora: o texto da validade diz
// "Vencido" para prazo que passou e a lista tira o cupom vencido quando a
// cliente volta para a aba ou a janela ganha foco.
import { CuponsDoCheckout } from "@/components/checkout/CuponsDoCheckout";
import {
  type CupomDisponivel,
  validadeDoCupom,
} from "@/lib/cupons-do-checkout";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 28/09 23:59:59.999 em Brasília.
const FIM_DO_DIA_28 = "2026-09-29T02:59:59.999Z";

describe("validadeDoCupom — prazo que já passou", () => {
  it("diz Vencido, e não uma data como se ainda valesse", () => {
    // 29/09 10:00 em Brasília: o cupom do dia 28 já venceu.
    const agora = new Date("2026-09-29T13:00:00.000Z");
    expect(validadeDoCupom(FIM_DO_DIA_28, agora)).toBe("Vencido");
    // Mesmo vencido há meses, nunca "Válido até".
    expect(
      validadeDoCupom(FIM_DO_DIA_28, new Date("2027-03-01T12:00:00Z")),
    ).toBe("Vencido");
  });

  it("no último instante o cupom ainda vence hoje (só depois vira Vencido)", () => {
    expect(
      validadeDoCupom(FIM_DO_DIA_28, new Date("2026-09-29T02:59:59.999Z")),
    ).toBe("Vence hoje");
    expect(
      validadeDoCupom(FIM_DO_DIA_28, new Date("2026-09-29T03:00:00.000Z")),
    ).toBe("Vencido");
  });
});

const cupom = (extra: Partial<CupomDisponivel>): CupomDisponivel => ({
  codigo: "VITRINE10",
  tipo: "percentage",
  valor: 10,
  minimo: 0,
  validoAte: null,
  exclusivo: false,
  aplica: true,
  falta: 0,
  desconto: 10,
  ...extra,
});

describe("CuponsDoCheckout — cupom que vence com a tela aberta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 28/09 20:00 em Brasília.
    vi.setSystemTime(new Date("2026-09-28T23:00:00.000Z"));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  const codigosNaTela = () =>
    [
      ...hospedeiro.querySelectorAll(
        'ul[aria-label="Cupons disponíveis"] > li',
      ),
    ].map((li) => li.textContent ?? "");

  function montar() {
    act(() => {
      raiz.render(
        <CuponsDoCheckout
          cupons={[
            cupom({ codigo: "DOHOJE", validoAte: FIM_DO_DIA_28 }),
            cupom({ codigo: "SEMPRAZO" }),
          ]}
          situacao="pronto"
          onTentarDeNovo={() => {}}
          appliedCoupon={null}
          couponError=""
          aplicando={null}
          onApply={() => {}}
          onRemove={() => {}}
        />,
      );
    });
  }

  it("enquanto vale: o cartão aparece com 'Vence hoje'", () => {
    montar();
    const textos = codigosNaTela();
    expect(textos).toHaveLength(2);
    expect(textos.find((t) => t.includes("DOHOJE"))).toContain("Vence hoje");
  });

  it("a virada acontece com a tela aberta e a cliente volta para a aba: o cupom vencido sai da lista", () => {
    montar();
    expect(codigosNaTela().some((t) => t.includes("DOHOJE"))).toBe(true);

    // Passa da meia-noite (29/09 00:30 em Brasília) com a aba em segundo plano.
    act(() => {
      vi.setSystemTime(new Date("2026-09-29T03:30:00.000Z"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const textos = codigosNaTela();
    expect(textos.some((t) => t.includes("DOHOJE"))).toBe(false);
    expect(textos.some((t) => t.includes("SEMPRAZO"))).toBe(true);
    // E nenhum cartão diz "Válido até" para prazo que passou.
    expect(hospedeiro.textContent).not.toContain("Válido até");
  });

  it("a janela ganha foco depois da virada: o cupom vencido também sai", () => {
    montar();

    act(() => {
      vi.setSystemTime(new Date("2026-09-29T03:30:00.000Z"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(codigosNaTela().some((t) => t.includes("DOHOJE"))).toBe(false);
  });

  it("lista que já chega com cupom vencido não o mostra", () => {
    vi.setSystemTime(new Date("2026-09-29T13:00:00.000Z"));
    montar();

    const textos = codigosNaTela();
    expect(textos.some((t) => t.includes("DOHOJE"))).toBe(false);
    expect(textos).toHaveLength(1);
  });
});
