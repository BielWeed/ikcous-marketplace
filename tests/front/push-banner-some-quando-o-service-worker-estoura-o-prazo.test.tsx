// @vitest-environment jsdom
//
// Achado c5 (rodada 2), segunda metade. O service worker nunca liga e o
// `navigator.serviceWorker.ready` fica pendente para sempre. O hook real
// começa dizendo "tem suporte", e o convite do `PushNotificationBanner`
// aparece aos 2,5 s. Aos 10 s o prazo da sonda estoura e o hook passa a dizer
// `isSupported === false`, mas o efeito do banner saía cedo (`return`) sem
// esconder o que já estava na tela. O toque em "Quero Receber!" chamava um
// `subscribe()` que devolve `undefined` na primeira linha, sem aviso e sem
// pedir permissão: o botão ficava inerte e mudo.
//
// O conserto é do lado do banner: sem suporte, sem convite. O contrato de
// `subscribe()` (devolver `undefined`) não muda, porque o cartão do Início e a
// AdminPushView contam com ele.
//
// Este teste usa o hook REAL e o banner REAL (nada de dublê do hook): o que
// quebrava era a conversa entre os dois, e um dublê esconderia exatamente isso.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USUARIO = { id: "cliente-1" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIO }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja de Teste" } }),
}));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError, warning: vi.fn() },
}));

// Sem a chave da ficha da loja, `subscribe()` para antes de pedir permissão.
vi.mock("@/config/configuracaoDaLoja", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/configuracaoDaLoja")>()),
  chavePublicaVapid: () => "chave-publica-de-teste",
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ upsert: vi.fn() }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { PushNotificationBanner } from "@/components/pwa/PushNotificationBanner";

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno dos
// outros testes do banner.
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

describe("PushNotificationBanner + hook real — o convite some quando o service worker estoura o prazo", () => {
  let container: HTMLDivElement;
  let root: Root;
  const requestPermission = vi.fn();
  let resolverPronto: (registro: unknown) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    toastError.mockReset();
    requestPermission.mockReset();

    class PushManagerStub {}
    vi.stubGlobal("PushManager", PushManagerStub);
    vi.stubGlobal("Notification", {
      permission: "default" as NotificationPermission,
      requestPermission,
    });

    // `ready` que só assenta quando o teste mandar (ou nunca).
    const pronto = new Promise((resolver) => {
      resolverPronto = resolver;
    });
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: { ready: pronto },
      configurable: true,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar() {
    await act(async () => {
      root.render(<PushNotificationBanner />);
    });
  }

  it("ready nunca assenta: o convite aparece aos 3 s e SOME quando o prazo de 10 s estoura", async () => {
    await montar();

    // Premissa: enquanto a sonda ainda espera, o convite aparece.
    await avancar(3_000);
    expect(container.textContent).toContain("Quero Receber!");

    // O prazo da sonda estoura: sem suporte provado, sem convite.
    await avancar(8_000);
    expect(container.textContent).not.toContain("Quero Receber!");
  });

  it("controle: ready assenta a tempo — o convite continua na tela e o toque pede a permissão", async () => {
    requestPermission.mockResolvedValue("denied");
    await montar();
    await act(async () => {
      resolverPronto({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(null) },
      });
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(container.textContent).toContain("Quero Receber!");

    // Passa dos 10 s: o prazo já foi cancelado pelo `ready` que assentou.
    await avancar(8_000);
    expect(container.textContent).toContain("Quero Receber!");

    const botao = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Quero Receber!"),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("borda: o service worker liga DEPOIS do prazo — o convite volta (a sonda recomeça)", async () => {
    await montar();
    await avancar(11_000);
    expect(container.textContent).not.toContain("Quero Receber!");

    await act(async () => {
      resolverPronto({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(null) },
      });
    });
    await avancar(3_000);
    expect(container.textContent).toContain("Quero Receber!");
  });
});
