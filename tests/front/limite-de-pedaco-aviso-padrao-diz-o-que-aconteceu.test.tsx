// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), LimiteDePedaco. O texto do aviso padrão não era prendido por
// teste: a frase tranquiliza a cliente ("o resto da tela continua como estava") e é isso que
// separa este aviso do de tela cheia. O aviso também fala como alerta para o leitor de tela e
// registra a falha no console (sem isso, ninguém descobre por que o pedaço não abriu).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LimiteDePedaco } from "@/components/ui/custom/LimiteDePedaco";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LimiteDePedaco: o aviso padrão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aviso: ReturnType<typeof vi.spyOn>;

  function Bomba(): never {
    throw new Error("pedaço não baixou");
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  function montar(aoFechar?: () => void) {
    act(() => {
      raiz.render(
        <LimiteDePedaco aoFechar={aoFechar}>
          <Bomba />
        </LimiteDePedaco>,
      );
    });
  }

  it("diz que a parte não abriu e que o resto da tela continua como estava, como alerta", () => {
    montar();
    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta).not.toBeNull();
    expect(alerta?.querySelector("p")?.textContent).toBe(
      "Esta parte não abriu. O resto da tela continua como estava.",
    );
    expect(
      [...hospedeiro.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Tentar de novo"]);
  });

  it("com aoFechar, o aviso ganha 'Fechar' depois de 'Tentar de novo'", () => {
    montar(() => {});
    expect(
      [...hospedeiro.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Tentar de novo", "Fechar"]);
  });

  it("registra a falha no console com o rótulo do limite e o erro de verdade", () => {
    montar();
    const chamada = aviso.mock.calls.find(
      (c: unknown[]) => c[0] === "[LimiteDePedaco] pedaço não abriu:",
    );
    expect(chamada).toBeDefined();
    expect((chamada?.[1] as Error).message).toBe("pedaço não baixou");
  });
});
