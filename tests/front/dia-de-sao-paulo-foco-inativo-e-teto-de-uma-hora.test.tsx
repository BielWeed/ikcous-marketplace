// @vitest-environment jsdom
//
// O relógio do Início ("Hoje", períodos "Hoje" e "30 dias") vive de
// `useDiaDeSaoPaulo`. Quatro garantias dele que nenhum teste segurava (achadas
// por mutação em 24/11/2026):
//  - `msAteAViradaDoDia` dá a espera até a meia-noite de São Paulo mais a folga
//    de 1 s, inclusive para instantes anteriores a 1970 (módulo negativo);
//  - voltar o FOCO à janela confere o dia (o app aberto de um dia para o outro);
//  - o hook INATIVO não arma temporizador nem ouvinte (tela escondida atrás de
//    outra aba não gasta nada);
//  - o temporizador da virada espera no MÁXIMO 1 hora: se o relógio do aparelho
//    mudar (ou ele dormir), o dia não fica preso até a meia-noite que já passou.
import { msAteAViradaDoDia, useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const UM_SEGUNDO = 1000;
const UMA_HORA = 3_600_000;

function Dia({ ativo }: Readonly<{ ativo?: boolean }>) {
  const dia = useDiaDeSaoPaulo(ativo);
  return <p data-testid="dia">{dia}</p>;
}

describe("msAteAViradaDoDia", () => {
  it("meia-noite de São Paulo (03:00Z) espera um dia inteiro mais a folga de 1 s", () => {
    expect(msAteAViradaDoDia(new Date("2026-10-14T03:00:00Z"))).toBe(
      86_400_000 + UM_SEGUNDO,
    );
  });

  it("um segundo antes da virada espera 1 s mais a folga de 1 s", () => {
    expect(msAteAViradaDoDia(new Date("2026-10-14T02:59:59Z"))).toBe(
      2 * UM_SEGUNDO,
    );
  });

  it("meio-dia em São Paulo (15:00Z) espera 12 h mais a folga", () => {
    expect(msAteAViradaDoDia(new Date("2026-10-14T15:00:00Z"))).toBe(
      12 * UMA_HORA + UM_SEGUNDO,
    );
  });

  it("instante anterior a 1970 (módulo negativo) também conta até a meia-noite de São Paulo", () => {
    // 00:00Z de 01/01/1970 é 21:00 de 31/12/1969 em São Paulo: faltam 3 h.
    expect(msAteAViradaDoDia(new Date("1970-01-01T00:00:00Z"))).toBe(
      3 * UMA_HORA + UM_SEGUNDO,
    );
  });
});

describe("useDiaDeSaoPaulo: gatilhos e prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-13T15:00:00Z")); // meio-dia, 13/10 em SP
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  const dia = () =>
    hospedeiro.querySelector('[data-testid="dia"]')?.textContent;

  it("voltar o foco à janela, no dia seguinte, confere o dia", async () => {
    await act(async () => raiz.render(<Dia />));
    expect(dia()).toBe("2026-10-13");
    await act(async () => {
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(dia()).toBe("2026-10-14");
  });

  it("o temporizador da virada espera no máximo 1 hora: relógio que andou sem avisar é corrigido", async () => {
    await act(async () => raiz.render(<Dia />));
    expect(dia()).toBe("2026-10-13");
    // O relógio do aparelho andou um dia inteiro sem disparar evento nenhum.
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UMA_HORA);
    });
    expect(dia()).toBe("2026-10-14");
  });

  it("inativo: não arma temporizador e ignora foco (confere de novo só ao ficar ativo)", async () => {
    await act(async () => raiz.render(<Dia ativo={false} />));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(dia()).toBe("2026-10-13");

    await act(async () => raiz.render(<Dia ativo />));
    expect(dia()).toBe("2026-10-14");
    expect(vi.getTimerCount()).toBe(1);
  });
});
