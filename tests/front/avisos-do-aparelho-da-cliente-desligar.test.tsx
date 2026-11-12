// @vitest-environment jsdom
//
// A CLIENTE QUE LIGOU OS AVISOS TEM COMO DESLIGAR SEM SAIR DA CONTA.
//
// Antes o cartão da tela de notificações só aparecia para "desligado" (ligar),
// "bloqueado" e "iPhone fora do app": inscrita, ele sumia, e o único caminho
// para parar de receber era sair da conta. Pedir e retirar o consentimento
// têm de ser simétricos. Agora, inscrita e com a permissão liberada, o cartão
// diz "Avisos ligados" e oferece "Desligar avisos neste aparelho", pelo mesmo
// `unsubscribe()` do hook (que tira a inscrição do navegador E a linha do banco).
//
// O contrato do hook: `unsubscribe()` devolve `true` quando desligou e `false`
// quando falhou (ele já mostra um aviso passageiro; o cartão deixa a frase FIXA).
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

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DESLIGAR = "Desligar avisos neste aparelho";
const LIGAR = "Ligar avisos neste aparelho";

describe("a cliente desliga os avisos do aparelho sem sair da conta", () => {
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
  function inscrita() {
    push.estado.permission = "granted";
    push.estado.subscription = { endpoint: "https://push.exemplo/1" };
  }
  function desenhar() {
    act(() => raiz.render(<AvisosDoAparelhoDaCliente />));
  }

  it("inscrita: diz que os avisos estão ligados e oferece desligar (sem oferecer ligar)", () => {
    inscrita();
    desenhar();

    expect(texto()).toContain("Avisos ligados neste aparelho");
    expect(texto()).toContain("Pedido a caminho");
    expect(botao(DESLIGAR)).toBeDefined();
    expect(botao(LIGAR)).toBeUndefined();
    expect(hospedeiro.querySelectorAll("section")).toHaveLength(1);
    // Alvo de toque de 44px, como o botão de ligar.
    expect(botao(DESLIGAR)?.className).toMatch(/\bh-11\b/);
  });

  it("o toque chama o unsubscribe do hook UMA vez, mesmo com toque duplo, e mostra 'Desligando...'", async () => {
    inscrita();
    let terminar: (ok: boolean) => void = () => undefined;
    push.unsubscribe.mockReturnValue(
      new Promise<boolean>((resolve) => {
        terminar = resolve;
      }),
    );
    desenhar();

    const alvo = botao(DESLIGAR);
    await act(async () => {
      alvo?.click();
      alvo?.click();
    });
    expect(push.unsubscribe).toHaveBeenCalledTimes(1);
    const ocupado = botao("Desligando...");
    expect(ocupado?.disabled).toBe(true);
    expect(ocupado?.getAttribute("aria-busy")).toBe("true");

    await act(async () => terminar(true));
    expect(alerta()).toBeNull();
  });

  it("depois de desligar, o cartão volta a 'Avisos desligados' com o botão de ligar", async () => {
    inscrita();
    push.unsubscribe.mockImplementation(async () => {
      // O hook, ao terminar, zera a inscrição que a tela lê.
      push.estado.subscription = null;
      return true;
    });
    desenhar();

    await act(async () => {
      botao(DESLIGAR)?.click();
    });
    // O hook real re-renderiza o consumidor ao zerar a inscrição.
    act(() => raiz.render(<AvisosDoAparelhoDaCliente />));

    expect(texto()).toContain("Avisos desligados neste aparelho");
    expect(botao(LIGAR)).toBeDefined();
    expect(botao(DESLIGAR)).toBeUndefined();
  });

  it("falha do hook (devolve false): mostra o alerta FIXO e o botão volta habilitado", async () => {
    inscrita();
    push.unsubscribe.mockResolvedValue(false);
    desenhar();

    await act(async () => {
      botao(DESLIGAR)?.click();
    });

    expect(alerta()?.textContent).toContain("Não foi possível desligar");
    const alvo = botao(DESLIGAR);
    expect(alvo).toBeDefined();
    expect(alvo?.disabled).toBe(false);
    expect(alvo?.getAttribute("aria-busy")).toBe("false");

    // E dá para tentar de novo.
    await act(async () => {
      alvo?.click();
    });
    expect(push.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("falha do hook (lança): o texto cru do erro NÃO chega à tela, vale a frase genérica", async () => {
    inscrita();
    push.unsubscribe.mockRejectedValue(new Error("PGRST301 jwt expired"));
    desenhar();

    await act(async () => {
      botao(DESLIGAR)?.click();
    });

    expect(texto()).not.toContain("PGRST301");
    expect(alerta()?.textContent).toContain("Não foi possível desligar");
    expect(botao(DESLIGAR)?.disabled).toBe(false);
  });

  it("CONTROLE — não inscrita: segue o cartão de ligar, sem botão de desligar", () => {
    desenhar();

    expect(texto()).toContain("Avisos desligados neste aparelho");
    expect(botao(LIGAR)).toBeDefined();
    expect(botao(DESLIGAR)).toBeUndefined();
  });

  it("CONTROLE — inscrição com a permissão revogada não vira 'ligado'", () => {
    push.estado.permission = "denied";
    push.estado.subscription = { endpoint: "https://push.exemplo/1" };
    desenhar();

    expect(botao(DESLIGAR)).toBeUndefined();
    expect(texto()).toContain("Avisos bloqueados neste aparelho");
  });

  it("CONTROLE — visitante sem conta não vê o cartão", () => {
    inscrita();
    push.estado.semConta = true;
    desenhar();

    expect(hospedeiro.querySelector("section")).toBeNull();
  });
});
