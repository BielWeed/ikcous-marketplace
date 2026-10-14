// @vitest-environment jsdom
//
// A CAIXA "QUERO RECEBER NOVIDADES" COBRIA O BOTÃO DE COMPRAR E CONVIDAVA
// QUEM NÃO PODIA ACEITAR (caçada de 14/10/2026, celular 360px).
//
// 1. Na página do produto a caixa (fixa a 80px do fundo, 2,5 s depois de abrir)
//    cobria preço, quantidade e o botão ADICIONAR; o toque no botão caía na
//    caixa. A tela do produto ("product-detail") ficou de fora da lista de
//    exclusões (que já tinha painel, pedido concluído, carrinho e finalizar).
// 2. Para quem NÃO entrou na conta a caixa não funcionava: "Quero Receber!" só
//    respondia "entre na sua conta primeiro" e a caixa continuava ali. A
//    decisão "sem conta" é do hook (usePushNotifications: `semConta`, a mesma
//    checagem que faz o subscribe() recusar com a origem "sem_conta").
//
// Controles negativos decidem o teste: uma caixa que nunca aparece passaria
// em tudo — a vitrine, com conta, tem de continuar convidando, e no mesmo
// momento de antes (2,5 s).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste" },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const usePushNotificationsMock = vi.fn();
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => usePushNotificationsMock(),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { PushNotificationBanner } from "@/components/pwa/PushNotificationBanner";

function estadoDoHook(sobrescreve: Record<string, unknown> = {}) {
  return {
    isSupported: true,
    permission: "default" as NotificationPermission,
    subscription: null,
    semConta: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    ...sobrescreve,
  };
}

function criarLocalStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("PushNotificationBanner — produto e visitante sem conta", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    usePushNotificationsMock.mockReturnValue(estadoDoHook());
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function montar(currentView: string) {
    act(() => {
      root.render(<PushNotificationBanner currentView={currentView} />);
    });
  }

  function avancar(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("na página do PRODUTO a caixa não nasce nem depois do delay", () => {
    montar("product-detail");
    avancar(2600);
    expect(container.textContent).not.toContain("Quero Receber!");
  });

  it("quem estava na vitrine com a caixa aberta e ABRE um produto: a caixa sai", () => {
    montar("home");
    avancar(2600);
    expect(container.textContent).toContain("Quero Receber!");

    montar("product-detail");
    expect(container.textContent).not.toContain("Quero Receber!");
  });

  it("visitante SEM conta não recebe o convite (nem na vitrine)", () => {
    usePushNotificationsMock.mockReturnValue(estadoDoHook({ semConta: true }));
    montar("home");
    avancar(2600);
    expect(container.textContent).not.toContain("Quero Receber!");
  });

  it("visitante que ENTRA na conta com a vitrine aberta passa a ver o convite, sem esperar de novo", () => {
    usePushNotificationsMock.mockReturnValue(estadoDoHook({ semConta: true }));
    montar("home");
    avancar(2600);
    expect(container.textContent).not.toContain("Quero Receber!");

    usePushNotificationsMock.mockReturnValue(estadoDoHook({ semConta: false }));
    montar("home");
    expect(container.textContent).toContain("Quero Receber!");
  });

  // Controles: o convite NÃO morreu. Com conta, na vitrine, continua nascendo
  // e no mesmo momento de antes (2,5 s — nem um tique antes).
  it("controle: com conta, na vitrine, aparece depois de 2,5 s (e não antes)", () => {
    montar("home");
    avancar(2400);
    expect(container.textContent).not.toContain("Quero Receber!");
    avancar(200);
    expect(container.textContent).toContain("Quero Receber!");
  });

  it("controle: com conta, em outra tela secundária (busca), continua aparecendo", () => {
    montar("search");
    avancar(2600);
    expect(container.textContent).toContain("Quero Receber!");
  });
});
