// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), `useDiaDeSaoPaulo`. Dois defeitos de UMA
// linha que o teste vizinho deixava passar:
//  - o temporizador da virada NÃO se rearmar: o dia mudava na primeira hora
//    e depois ficava preso para sempre (o painel aberto por dois dias seguidos
//    mostrava "Hoje" de anteontem);
//  - a limpeza ao fechar a tela esquecer algum ouvinte (`visibilitychange`,
//    `focus`, `pageshow`) ou o temporizador: a tela fechada continuaria
//    trabalhando e vazando memória a cada abertura.
// Datas e ids inventados; nenhuma chamada de rede.
import { useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const UMA_HORA = 3_600_000;

function Dia() {
  const dia = useDiaDeSaoPaulo();
  return <p data-testid="dia">{dia}</p>;
}

let raiz: Root | null;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-13T15:00:00Z")); // meio-dia, 13/10 em SP
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  if (raiz) act(() => raiz?.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const dia = () => hospedeiro.querySelector('[data-testid="dia"]')?.textContent;

describe("useDiaDeSaoPaulo: o temporizador continua depois da primeira vez", () => {
  it("o dia anda de novo na segunda hora, sem nenhum evento da janela", async () => {
    await act(async () => raiz?.render(<Dia />));
    expect(dia()).toBe("2026-10-13");

    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UMA_HORA);
    });
    expect(dia()).toBe("2026-10-14");

    // Segunda volta: se o temporizador não tivesse sido rearmado, o dia
    // ficaria preso em 14.
    vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UMA_HORA);
    });
    expect(dia()).toBe("2026-10-15");
  });
});

describe("useDiaDeSaoPaulo: fechar a tela limpa tudo", () => {
  it("sem temporizador pendente depois de desmontar", async () => {
    await act(async () => raiz?.render(<Dia />));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => raiz?.unmount());
    raiz = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cada ouvinte registrado (visibilitychange, focus, pageshow) é removido com a MESMA função", async () => {
    const adicionaDoc = vi.spyOn(document, "addEventListener");
    const removeDoc = vi.spyOn(document, "removeEventListener");
    const adicionaJanela = vi.spyOn(window, "addEventListener");
    const removeJanela = vi.spyOn(window, "removeEventListener");

    await act(async () => raiz?.render(<Dia />));
    await act(async () => raiz?.unmount());
    raiz = null;

    const par = (
      adiciona: typeof adicionaDoc,
      remove: typeof removeDoc,
      evento: string,
    ) => {
      const registrados = adiciona.mock.calls
        .filter((chamada) => chamada[0] === evento)
        .map((chamada) => chamada[1]);
      expect(registrados.length).toBeGreaterThan(0);
      const removidos = remove.mock.calls
        .filter((chamada) => chamada[0] === evento)
        .map((chamada) => chamada[1]);
      for (const funcao of registrados) {
        expect(removidos).toContain(funcao);
      }
    };

    par(adicionaDoc, removeDoc, "visibilitychange");
    par(adicionaJanela, removeJanela, "focus");
    par(adicionaJanela, removeJanela, "pageshow");
  });
});
