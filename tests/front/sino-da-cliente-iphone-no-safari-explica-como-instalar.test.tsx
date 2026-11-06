// @vitest-environment jsdom
//
// A CLIENTE NO IPHONE (SAFARI, FORA DO APP INSTALADO) NUNCA DESCOBRIA POR QUE
// NÃO RECEBE "PEDIDO A CAMINHO".
//
// O iOS só entrega aviso a app instalado na Tela de Início, e o Safari numa aba
// nem expõe o push: o hook diz "sem suporte" e o convite flutuante se esconde.
// O cartão da tela de notificações também ficava calado (`situacao` valia
// "instalar-no-ios" e só "ligar" desenhava). Agora a tela do sino explica o
// caminho, com passos escritos para a CLIENTE (os do lojista dizem "abra este
// painel").
//
// Controles: quem já instalou o app, o Android e o Mac de verdade continuam sem
// esse cartão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
  estado: {
    isSupported: false,
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

import { AvisosDoAparelhoDaCliente } from "@/components/pwa/AvisosDoAparelhoDaCliente";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER_AGENT_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

function definirNavegador(valores: Record<string, unknown>) {
  for (const [nome, valor] of Object.entries(valores)) {
    Object.defineProperty(navigator, nome, {
      value: valor,
      configurable: true,
    });
  }
}

function instaladoNaTela(instalado: boolean) {
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: instalado && consulta.includes("standalone"),
  }));
}

describe("avisos do aparelho na tela da cliente — iPhone fora do app instalado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    push.estado = {
      isSupported: false,
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
    vi.unstubAllGlobals();
    for (const nome of ["userAgent", "platform", "maxTouchPoints"]) {
      Reflect.deleteProperty(navigator, nome);
    }
  });

  function desenhar() {
    act(() => raiz.render(<AvisosDoAparelhoDaCliente />));
  }
  const texto = () => hospedeiro.textContent ?? "";
  const passos = () =>
    Array.from(hospedeiro.querySelectorAll("ol li")).map(
      (li) => li.textContent ?? "",
    );

  it("iPhone no Safari: o cartão explica como instalar para receber avisos", () => {
    definirNavegador({ userAgent: USER_AGENT_IPHONE });
    instaladoNaTela(false);
    desenhar();

    const regiao = hospedeiro.querySelector(
      'section[aria-label="Avisos neste aparelho"]',
    );
    expect(regiao).not.toBeNull();
    expect(texto()).toContain("Para receber avisos no iPhone, instale o app");
    expect(texto()).toContain("Pedido a caminho");

    const lista = passos();
    expect(lista.length).toBeGreaterThanOrEqual(4);
    expect(lista.join(" ")).toContain("Compartilhar");
    expect(lista.join(" ")).toContain("Adicionar à Tela de Início");
    expect(lista.join(" ")).toContain("novo ícone");
    // Texto da cliente: nada de "painel" (é o passo do lojista).
    expect(texto()).not.toContain("painel");
    // Instalar não se resolve com botão desta tela.
    expect(hospedeiro.querySelector("button")).toBeNull();
    expect(push.subscribe).not.toHaveBeenCalled();
  });

  it("o último passo manda voltar à tela de notificações para ligar os avisos", () => {
    definirNavegador({ userAgent: USER_AGENT_IPHONE });
    instaladoNaTela(false);
    desenhar();

    expect(passos().at(-1)).toContain("notificações");
    expect(passos().at(-1)).toContain("Ligar avisos neste aparelho");
  });

  it("iPad (que se apresenta como Mac com tela de toque) também recebe o cartão", () => {
    definirNavegador({ platform: "MacIntel", maxTouchPoints: 5 });
    instaladoNaTela(false);
    desenhar();

    expect(texto()).toContain("instale o app");
    expect(passos().join(" ")).toContain("Adicionar à Tela de Início");
  });

  it("CONTROLE — sem conta (visitante) o cartão não aparece", () => {
    push.estado.semConta = true;
    definirNavegador({ userAgent: USER_AGENT_IPHONE });
    instaladoNaTela(false);
    desenhar();

    expect(texto()).toBe("");
  });

  it("CONTROLE — enquanto a sonda não terminou o cartão não diz nada", () => {
    push.estado.sondado = false;
    definirNavegador({ userAgent: USER_AGENT_IPHONE });
    instaladoNaTela(false);
    desenhar();

    expect(texto()).toBe("");
  });

  it("CONTROLE — iPhone com o app instalado (e push funcionando) não vê o cartão de instalar", () => {
    push.estado.isSupported = true;
    definirNavegador({ userAgent: USER_AGENT_IPHONE });
    instaladoNaTela(true);
    desenhar();

    expect(texto()).not.toContain("instale o app");
    expect(texto()).toContain("Avisos desligados neste aparelho");
  });

  it("CONTROLE — iPhone instalado mas com iOS velho (sem push) continua calado", () => {
    definirNavegador({ userAgent: USER_AGENT_IPHONE });
    instaladoNaTela(true);
    desenhar();

    expect(texto()).toBe("");
  });

  it("CONTROLE — iPhone que já recebe os avisos não vê o cartão", () => {
    push.estado.permission = "granted";
    push.estado.subscription = {};
    definirNavegador({ userAgent: USER_AGENT_IPHONE });
    instaladoNaTela(true);
    desenhar();

    expect(texto()).toBe("");
  });

  it("CONTROLE — navegador sem push fora da Apple (não é iPhone) continua calado", () => {
    instaladoNaTela(false);
    desenhar();

    expect(texto()).toBe("");
  });

  it("CONTROLE — um Mac de verdade (sem tela de toque) não recebe instruções de iPhone", () => {
    definirNavegador({ platform: "MacIntel", maxTouchPoints: 0 });
    instaladoNaTela(false);
    desenhar();

    expect(texto()).toBe("");
  });
});
