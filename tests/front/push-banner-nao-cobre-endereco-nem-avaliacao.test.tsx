// @vitest-environment jsdom
//
// A CAIXA "QUERO RECEBER NOVIDADES" COBRIA O BOTAO "SALVAR ENDERECO" E O
// "PUBLICAR AVALIACAO".
//
// A caixa e `fixed z-[999] bottom-20` (~140 px de altura). No formulario de
// endereco ("address-form") a barra do Salvar fica a 64 px do fundo, e no
// detalhe do pedido ("order-details") a folha da avaliacao tem o Publicar no
// rodape: o toque caia na caixa. Mesma razao do carrinho/finalizar/produto.
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

describe("PushNotificationBanner — telas com barra de ação no rodapé", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    usePushNotificationsMock.mockReturnValue({
      isSupported: true,
      permission: "default" as NotificationPermission,
      subscription: null,
      semConta: false,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    });
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

  it.each(["address-form", "order-details"])(
    "em %s a caixa não nasce nem depois do delay",
    (tela) => {
      montar(tela);
      avancar(2600);
      expect(container.textContent).not.toContain("Quero Receber!");
    },
  );

  it("quem estava na vitrine com a caixa aberta e ABRE o formulário de endereço: a caixa sai", () => {
    montar("home");
    avancar(2600);
    expect(container.textContent).toContain("Quero Receber!");

    montar("address-form");
    expect(container.textContent).not.toContain("Quero Receber!");
  });

  it("controle: na vitrine a caixa continua aparecendo", () => {
    montar("home");
    avancar(2600);
    expect(container.textContent).toContain("Quero Receber!");
  });
});
