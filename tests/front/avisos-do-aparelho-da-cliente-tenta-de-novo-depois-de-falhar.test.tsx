// @vitest-environment jsdom
//
// Cartão de avisos do aparelho da CLIENTE (consentimento de notificações): depois de uma tentativa que
// terminou — com sucesso ou com falha — o botão volta a funcionar. A trava de toque duplo (`emVoo`) tem de
// soltar no fim de cada tentativa; se ficasse presa, a cliente que errou uma vez tocaria em "Ligar" (ou em
// "Desligar") de novo e nada aconteceria, sem aviso nenhum, até sair da tela. Também prova que o aviso da
// tentativa anterior some quando ela tenta outra vez.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
  estado: {
    isSupported: true,
    permission: "default" as NotificationPermission,
    subscription: null as null | object,
    semConta: false,
    sondado: true,
  },
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    ...push.estado,
    subscribe: push.subscribe,
    unsubscribe: push.unsubscribe,
  }),
}));

import { AvisosDoAparelhoDaCliente } from "@/components/pwa/AvisosDoAparelhoDaCliente";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LIGAR = "Ligar avisos neste aparelho";
const DESLIGAR = "Desligar avisos neste aparelho";

describe("avisos do aparelho da cliente: tentar de novo depois de falhar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    push.estado = {
      isSupported: true,
      permission: "default",
      subscription: null,
      semConta: false,
      sondado: true,
    };
    push.subscribe.mockReset();
    push.unsubscribe.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  const texto = () => hospedeiro.textContent ?? "";
  const botao = (nome: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(nome),
    );
  const alerta = () => hospedeiro.querySelector('[role="alert"]');
  function desenhar() {
    act(() => raiz.render(<AvisosDoAparelhoDaCliente />));
  }
  function inscrita() {
    push.estado.permission = "granted";
    push.estado.subscription = { endpoint: "https://push.exemplo.invalid/1" };
  }

  it("ligar que não inscreveu mostra o aviso fixo; tocar de novo chama o hook outra vez e limpa o aviso", async () => {
    push.subscribe.mockResolvedValueOnce(null);
    push.subscribe.mockResolvedValueOnce({ endpoint: "x" });
    desenhar();

    await act(async () => {
      botao(LIGAR)?.click();
    });
    expect(push.subscribe).toHaveBeenCalledTimes(1);
    expect(alerta()?.textContent).toBe(
      "Não foi possível ligar os avisos agora.",
    );
    // O botão voltou: habilitado e com o texto de sempre.
    expect(botao(LIGAR)?.disabled).toBe(false);

    await act(async () => {
      botao(LIGAR)?.click();
    });
    expect(push.subscribe).toHaveBeenCalledTimes(2);
    expect(alerta()).toBeNull();
  });

  it("ligar que o hook recusa com frase traduzida: a frase fica; tocar de novo tenta outra vez", async () => {
    const recusa = new Error("Libere os avisos nas configurações.");
    recusa.name = "PushSubscribeError";
    push.subscribe.mockRejectedValueOnce(recusa);
    push.subscribe.mockResolvedValueOnce({ endpoint: "x" });
    desenhar();

    await act(async () => {
      botao(LIGAR)?.click();
    });
    expect(alerta()?.textContent).toBe("Libere os avisos nas configurações.");

    await act(async () => {
      botao(LIGAR)?.click();
    });
    expect(push.subscribe).toHaveBeenCalledTimes(2);
    expect(alerta()).toBeNull();
  });

  it("erro cru (de fora do hook) mostra só a frase genérica, e erro com nome certo mas mensagem vazia também", async () => {
    push.subscribe.mockRejectedValueOnce(new Error("SQLSTATE 42P01 interno"));
    desenhar();
    await act(async () => {
      botao(LIGAR)?.click();
    });
    expect(texto()).not.toContain("SQLSTATE");
    expect(alerta()?.textContent).toBe(
      "Os avisos não foram ligados. Tente de novo em instantes.",
    );

    const vazio = new Error("   ");
    vazio.name = "PushSubscribeError";
    push.subscribe.mockRejectedValueOnce(vazio);
    await act(async () => {
      botao(LIGAR)?.click();
    });
    expect(alerta()?.textContent).toBe(
      "Os avisos não foram ligados. Tente de novo em instantes.",
    );
  });

  it("desligar que falhou (false): o aviso fica; tocar de novo chama o hook outra vez e limpa o aviso", async () => {
    inscrita();
    push.unsubscribe.mockResolvedValueOnce(false);
    push.unsubscribe.mockResolvedValueOnce(true);
    desenhar();

    await act(async () => {
      botao(DESLIGAR)?.click();
    });
    expect(alerta()?.textContent).toBe(
      "Não foi possível desligar os avisos agora. Tente de novo em instantes.",
    );
    expect(botao(DESLIGAR)?.disabled).toBe(false);

    await act(async () => {
      botao(DESLIGAR)?.click();
    });
    expect(push.unsubscribe).toHaveBeenCalledTimes(2);
    expect(alerta()).toBeNull();
  });

  it("desligar que lançou erro: o aviso fixo aparece e dá para tentar de novo", async () => {
    inscrita();
    push.unsubscribe.mockRejectedValueOnce(new Error("rede"));
    push.unsubscribe.mockResolvedValueOnce(true);
    desenhar();
    await act(async () => {
      botao(DESLIGAR)?.click();
    });
    expect(alerta()?.textContent).toContain("Não foi possível desligar");
    await act(async () => {
      botao(DESLIGAR)?.click();
    });
    expect(push.unsubscribe).toHaveBeenCalledTimes(2);
    expect(alerta()).toBeNull();
  });

  it("um toque duplo no mesmo instante vale UMA tentativa, e a seguinte (depois de terminar) vale outra", async () => {
    let terminar: (r: unknown) => void = () => undefined;
    push.subscribe.mockReturnValueOnce(
      new Promise((resolve) => {
        terminar = resolve;
      }),
    );
    push.subscribe.mockResolvedValueOnce({ endpoint: "x" });
    desenhar();
    const alvo = botao(LIGAR);
    await act(async () => {
      alvo?.click();
      alvo?.click();
    });
    expect(push.subscribe).toHaveBeenCalledTimes(1);
    await act(async () => terminar(null));
    expect(alerta()).not.toBeNull();
    await act(async () => {
      botao(LIGAR)?.click();
    });
    expect(push.subscribe).toHaveBeenCalledTimes(2);
  });
});
