// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território pwa: o cartão "Avisos neste
// aparelho" da tela de notificações da cliente (consentimento para receber o
// "Pedido a caminho" no celular) tinha estes pontos sem teste:
//  - cada uma das cinco versões do cartão (ligados, bloqueado, instalar no
//    iPhone, iOS antigo e desligado) é uma região com nome para o leitor de
//    tela — sem o nome, ele pula o cartão que explica por que o aviso não chega;
//  - enquanto o pedido de permissão está em andamento, o botão "Ligar" diz
//    "Ligando...", fica travado e ocupado — e toque duplo não pede duas vezes.
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
  apple: false,
  instalado: false,
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

vi.mock("@/lib/avisos-do-aparelho", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/avisos-do-aparelho")>();
  return {
    ...real,
    ehAparelhoDaApple: () => push.apple,
    estaComoAppInstalado: () => push.instalado,
  };
});

import { AvisosDoAparelhoDaCliente } from "@/components/pwa/AvisosDoAparelhoDaCliente";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LIGAR = "Ligar avisos neste aparelho";

describe("avisos do aparelho da cliente: região nomeada e 'Ligando...'", () => {
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
    push.apple = false;
    push.instalado = false;
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
  function desenhar() {
    act(() => raiz.render(<AvisosDoAparelhoDaCliente />));
  }

  const versoes: [string, () => void, string][] = [
    [
      "ligados",
      () => {
        push.estado.permission = "granted";
        push.estado.subscription = {
          endpoint: "https://push.exemplo.invalid/1",
        };
      },
      "Avisos ligados neste aparelho",
    ],
    [
      "bloqueados",
      () => {
        push.estado.permission = "denied";
      },
      "Avisos bloqueados neste aparelho",
    ],
    [
      "instalar no iPhone",
      () => {
        push.apple = true;
        push.instalado = false;
        push.estado.isSupported = false;
      },
      "Para receber avisos no iPhone, instale o app",
    ],
    [
      "iOS antigo",
      () => {
        push.apple = true;
        push.instalado = true;
        push.estado.isSupported = false;
      },
      "Os avisos não estão disponíveis neste aparelho agora",
    ],
    ["desligados", () => {}, "Avisos desligados neste aparelho"],
  ];

  it.each(versoes)(
    "versão '%s': é uma região chamada 'Avisos neste aparelho' e diz o que acontece",
    (_nome, preparar, frase) => {
      preparar();
      desenhar();
      const regiao = hospedeiro.querySelector("section");
      expect(regiao).not.toBeNull();
      expect(regiao?.getAttribute("aria-label")).toBe("Avisos neste aparelho");
      expect(texto()).toContain(frase);
      // Exatamente um cartão por vez.
      expect(hospedeiro.querySelectorAll("section").length).toBe(1);
    },
  );

  it("sem conta ou navegador sem suporte (fora do iPhone): nenhum cartão", () => {
    push.estado.semConta = true;
    desenhar();
    expect(hospedeiro.querySelector("section")).toBeNull();

    push.estado.semConta = false;
    push.estado.isSupported = false;
    desenhar();
    expect(hospedeiro.querySelector("section")).toBeNull();
  });

  it("'Ligar' em andamento: botão 'Ligando...', travado e ocupado; toque duplo não pede de novo", async () => {
    let concluir: (v: object) => void = () => {};
    push.subscribe.mockImplementation(
      () =>
        new Promise((resolver) => {
          concluir = resolver;
        }),
    );
    desenhar();
    expect(botao(LIGAR)?.disabled).toBe(false);
    expect(botao(LIGAR)?.getAttribute("aria-busy")).toBe("false");

    await act(async () => {
      botao(LIGAR)?.click();
    });
    const ocupado = botao("Ligando...");
    expect(ocupado).toBeDefined();
    expect(ocupado?.disabled).toBe(true);
    expect(ocupado?.getAttribute("aria-busy")).toBe("true");
    expect(botao(LIGAR)).toBeUndefined();

    // Um segundo toque no mesmo instante não pede a permissão outra vez.
    await act(async () => {
      ocupado?.click();
    });
    expect(push.subscribe).toHaveBeenCalledTimes(1);

    await act(async () => {
      concluir({ endpoint: "https://push.exemplo.invalid/2" });
    });
    expect(botao(LIGAR)?.disabled).toBe(false);
    expect(botao(LIGAR)?.getAttribute("aria-busy")).toBe("false");
    expect(botao("Ligando...")).toBeUndefined();
  });
});
