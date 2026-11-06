// @vitest-environment jsdom
//
// A CLIENTE QUE DISPENSOU OU BLOQUEOU OS AVISOS TEM ONDE ENTENDER E RELIGAR
// (caça r21, achado 5).
//
// O convite do `PushNotificationBanner` some com "Agora não" (7 dias) e some de
// vez com o bloqueio, e a tela de notificações não dizia nada sobre push: quem
// bloqueou sem querer seguia sem receber o "Pedido a caminho" sem saber por
// quê, e quem se arrependeu não tinha botão. Agora a tela da cliente mostra:
//   - bloqueado: por que não chega e COMO liberar (nenhuma página desfaz isso);
//   - desligado mas liberado: um botão que liga pelo mesmo `subscribe()`.
// E fica CALADA quando não há o que fazer (já recebe, sem conta, sem suporte).
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
}));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ ...push.estado, subscribe: push.subscribe }),
}));

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: [],
    unreadCount: 0,
    loading: false,
    erro: null,
    semConta: false,
    refresh: vi.fn(),
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAsRead: vi.fn(),
  }),
}));

import { AvisosDoAparelhoDaCliente } from "@/components/pwa/AvisosDoAparelhoDaCliente";
import { NotificationsView } from "@/views/customer/NotificationsView";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("avisos do aparelho na tela da cliente", () => {
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function desenhar(elemento: React.ReactElement) {
    act(() => raiz.render(elemento));
  }
  const texto = () => hospedeiro.textContent ?? "";
  const botaoDeLigar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Ligar avisos neste aparelho"),
    );

  it("bloqueado: explica por que não chega e como liberar, sem botão que não resolve", () => {
    push.estado.permission = "denied";
    desenhar(<AvisosDoAparelhoDaCliente />);

    expect(texto()).toContain("Avisos bloqueados neste aparelho");
    expect(texto()).toContain("Pedido a caminho");
    // Passos de liberar (aba do navegador, que é o ambiente do teste).
    expect(texto()).toContain("Mude para Permitir.");
    // Bloqueio só se resolve nas configurações: nenhum botão finge resolver.
    expect(botaoDeLigar()).toBeUndefined();
    expect(push.subscribe).not.toHaveBeenCalled();
  });

  it("desligado mas liberado (ex.: tocou Agora não): o botão liga pelo mesmo subscribe do convite", async () => {
    push.subscribe.mockResolvedValue({ endpoint: "https://push.exemplo/1" });
    desenhar(<AvisosDoAparelhoDaCliente />);

    expect(texto()).toContain("Avisos desligados neste aparelho");
    const botao = botaoDeLigar();
    expect(botao).toBeDefined();

    await act(async () => {
      botao?.click();
    });
    expect(push.subscribe).toHaveBeenCalledTimes(1);
    // Deu certo: sem erro na tela.
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("ligar que o aparelho recusa mostra a instrução FIXA, não o erro cru", async () => {
    const recusa = Object.assign(
      new Error("Abra as configurações do aparelho."),
      {
        name: "PushSubscribeError",
      },
    );
    push.subscribe.mockRejectedValue(recusa);
    desenhar(<AvisosDoAparelhoDaCliente />);

    await act(async () => {
      botaoDeLigar()?.click();
    });
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "Abra as configurações do aparelho.",
    );
  });

  it("erro qualquer (não do push) não vaza texto cru na tela", async () => {
    push.subscribe.mockRejectedValue(new Error("PGRST301 jwt expired"));
    desenhar(<AvisosDoAparelhoDaCliente />);

    await act(async () => {
      botaoDeLigar()?.click();
    });
    expect(texto()).not.toContain("PGRST301");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "não foram ligados",
    );
  });

  it("toque duplo no mesmo instante inscreve UMA vez só", async () => {
    let resolver: (v: object) => void = () => undefined;
    push.subscribe.mockReturnValue(
      new Promise<object>((r) => {
        resolver = r;
      }),
    );
    desenhar(<AvisosDoAparelhoDaCliente />);

    await act(async () => {
      botaoDeLigar()?.click();
      botaoDeLigar()?.click();
    });
    expect(push.subscribe).toHaveBeenCalledTimes(1);
    await act(async () => resolver({}));
  });

  it.each([
    ["já recebe os avisos", { permission: "granted", subscription: {} }],
    ["visitante sem conta", { semConta: true }],
    ["ainda sondando o navegador", { sondado: false }],
    ["navegador sem push", { isSupported: false }],
  ])("CONTROLE — %s: a tela fica calada", (_nome, mudanca) => {
    Object.assign(push.estado, mudanca);
    desenhar(<AvisosDoAparelhoDaCliente />);
    expect(hospedeiro.querySelector("section")).toBeNull();
    expect(texto()).toBe("");
  });

  it("a tela de notificações da cliente mostra o cartão (mesmo sem nenhum aviso)", () => {
    push.estado.permission = "denied";
    desenhar(<NotificationsView onNavigate={vi.fn()} />);

    expect(texto()).toContain("Avisos bloqueados neste aparelho");
    // E o resto da tela segue igual.
    expect(texto()).toContain("Sua caixa está limpa!");
  });

  it("CONTROLE — na tela de notificações, quem já recebe não vê o cartão", () => {
    push.estado.permission = "granted";
    push.estado.subscription = {};
    desenhar(<NotificationsView onNavigate={vi.fn()} />);

    expect(texto()).not.toContain("neste aparelho");
  });
});
