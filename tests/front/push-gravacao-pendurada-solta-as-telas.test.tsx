// @vitest-environment jsdom
import { type ReactElement, act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, apagar, dono, toast, usuario } = vi.hoisted(() => ({
  upsert: vi.fn(),
  apagar: vi.fn(),
  dono: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  usuario: { id: "conta-exemplo" },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ upsert, delete: () => ({ eq: apagar }) }) },
}));
vi.mock("@/lib/inscricao-de-push-da-conta", () => ({
  dequemEAInscricao: dono,
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Estado {
  subscription: PushSubscription | null;
  subscribe: () => Promise<unknown>;
  unsubscribe: () => Promise<boolean>;
}
describe("gravação de avisos pendurada", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let atual: Estado;
  let noNavegador: PushSubscription | null;
  let nova: PushSubscription;
  let getSubscription: ReturnType<typeof vi.fn>;
  let usePush: () => Estado;
  let Cartao: () => ReactElement | null;

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const disco = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => disco.get(k) ?? null,
      setItem: (k: string, v: string) => disco.set(k, v),
      removeItem: (k: string) => disco.delete(k),
    });
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    vi.spyOn(console, "error").mockImplementation(() => {});
    noNavegador = null;
    nova = {
      endpoint: "https://push.example/aviso",
      toJSON: () => ({
        endpoint: "https://push.example/aviso",
        keys: { p256dh: "p", auth: "a" },
      }),
      unsubscribe: vi.fn(async () => {
        noNavegador = null;
        return true;
      }),
    } as unknown as PushSubscription;
    getSubscription = vi.fn(async () => noNavegador);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription,
            subscribe: vi.fn(async () => {
              noNavegador = nova;
              return nova;
            }),
          },
        }),
      },
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: vi.fn(async () => "granted"),
    });
    dono.mockResolvedValue("esta-conta");
    upsert.mockResolvedValue({ error: null });
    apagar.mockResolvedValue({ error: null });
    ({ usePushNotifications: usePush } = await import(
      "@/hooks/usePushNotifications"
    ));
    ({ AvisosDoAparelhoDaCliente: Cartao } = await import(
      "@/components/pwa/AvisosDoAparelhoDaCliente"
    ));
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    Reflect.deleteProperty(navigator, "serviceWorker");
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  async function montar(cartao = false) {
    function Sonda() {
      const estado = usePush();
      useEffect(() => {
        atual = estado;
      });
      return null;
    }
    await act(async () => {
      raiz.render(
        <>
          <Sonda />
          {cartao && <Cartao />}
        </>,
      );
    });
    await passar(0);
  }
  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  function botao() {
    return host.querySelector<HTMLButtonElement>("button")!;
  }

  it("upsert sem resposta solta o botão e a leitura global; resposta tardia não dá sucesso", async () => {
    let resolver!: (v: { error: null }) => void;
    upsert.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    await montar(true);
    await act(async () => {
      botao().click();
    });
    expect(botao().textContent).toBe("Ligando...");
    await passar(20_000);
    expect(botao().disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "antes de tentar de novo",
    );
    expect(nova.unsubscribe).toHaveBeenCalledTimes(1);
    const leituras = getSubscription.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await passar(0);
    expect(getSubscription.mock.calls.length).toBeGreaterThan(leituras);
    await act(async () => {
      resolver({ error: null });
    });
    expect(atual.subscription).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    upsert.mockResolvedValue({ error: null });
    await act(async () => {
      botao().click();
    });
    await passar(0);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(atual.subscription?.endpoint).toBe(nova.endpoint);
  });

  it("timeout do upsert preserva a inscrição que já existia e relê o estado real", async () => {
    noNavegador = nova;
    upsert.mockReturnValue(new Promise(() => {}));
    await montar();
    let terminou = false;
    await act(async () => {
      void atual.subscribe().catch(() => {
        terminou = true;
      });
    });
    await passar(20_000);
    expect(terminou).toBe(true);
    expect(nova.unsubscribe).not.toHaveBeenCalled();
    expect(atual.subscription?.endpoint).toBe(nova.endpoint);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("delete sem resposta termina, relê ambas as telas e ignora sucesso tardio", async () => {
    noNavegador = nova;
    let resolver!: (v: { error: null }) => void;
    apagar.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    await montar(true);
    let terminou = false;
    await act(async () => {
      void atual.unsubscribe().then(() => {
        terminou = true;
      });
    });
    await passar(20_000);
    expect(terminou).toBe(true);
    expect(atual.subscription).toBeNull();
    expect(botao().textContent).toBe("Ligar avisos neste aparelho");
    // O navegador já cancelou e o banco não respondeu: o aviso diz isso.
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("não deu para confirmar no servidor"),
      expect.anything(),
    );
    const leituras = getSubscription.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await passar(0);
    expect(getSubscription.mock.calls.length).toBeGreaterThan(leituras);
    await act(async () => {
      resolver({ error: null });
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(atual.subscription).toBeNull();
  });
});
