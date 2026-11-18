// @vitest-environment jsdom
//
// CUPOM QUE VENCEU COM A TELA ABERTA.
//
// A lista de cupons é lida uma vez; se a cliente deixa o checkout aberto e o
// prazo de um cupom passa, o cartão continuava dizendo "Válido até <data que
// já passou>", como se valesse. Agora o texto da validade diz "Vencido" para
// prazo que passou. QUEM TIRA o cupom vencido da lista é o servidor (a lista é
// relida ao abrir o checkout e a cada mudança de subtotal, e ele recusa o
// vencido ao aplicar): a tela NÃO o esconde pelo relógio do aparelho — com o
// celular adiantado, um cupom ainda válido (às vezes exclusivo, de código que
// a cliente não sabe) sumiria da lista.
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

  function montar(onApply: (codigo: string) => void = () => {}) {
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
          onApply={onApply}
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

  const botaoDeAplicar = (codigo: string) =>
    hospedeiro.querySelector<HTMLButtonElement>(
      `button[aria-label="Aplicar o cupom ${codigo}"]`,
    );

  it("a virada acontece com a tela aberta: o cupom fica até a próxima busca, o texto diz Vencido e o servidor decide no toque", () => {
    const onApply = vi.fn();
    montar(onApply);
    expect(codigosNaTela().some((t) => t.includes("DOHOJE"))).toBe(true);

    // Passa da meia-noite (29/09 00:30 em Brasília) com a aba em segundo plano.
    act(() => {
      vi.setSystemTime(new Date("2026-09-29T03:30:00.000Z"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    const textos = codigosNaTela();
    expect(textos.some((t) => t.includes("DOHOJE"))).toBe(true);
    expect(textos.some((t) => t.includes("SEMPRAZO"))).toBe(true);
    const botao = botaoDeAplicar("DOHOJE");
    expect(botao).not.toBeNull();
    act(() => botao?.click());
    expect(onApply).toHaveBeenCalledWith("DOHOJE");
  });

  it("relógio do aparelho adiantado: o cupom que o servidor ainda lista como válido aparece, com o botão de aplicar", () => {
    // O servidor listou o cupom do dia 28 (ainda válido para ele); o celular
    // da cliente está 1 dia adiantado (29/09 10:00 em Brasília).
    vi.setSystemTime(new Date("2026-09-29T13:00:00.000Z"));
    const onApply = vi.fn();
    montar(onApply);

    const textos = codigosNaTela();
    expect(textos.some((t) => t.includes("DOHOJE"))).toBe(true);
    expect(textos).toHaveLength(2);
    const botao = botaoDeAplicar("DOHOJE");
    expect(botao).not.toBeNull();
    expect(botao?.disabled).toBe(false);
    act(() => botao?.click());
    expect(onApply).toHaveBeenCalledWith("DOHOJE");
  });
});
