// @vitest-environment jsdom
//
// Três buracos de `usePushNotifications` (caça de 03/11/2026):
//
// 1. `navigator.serviceWorker.ready` NUNCA resolve nem rejeita quando o
//    serviço do app não chega a ligar (instalação falha na primeira visita,
//    registro bloqueado). A sonda ficava parada (o cartão do lojista sumia
//    para sempre em "sondando") e o `subscribe()` ficava preso depois de a
//    permissão já ter sido gasta (botão "Ativando..." eterno, sem aviso).
//    Agora `ready` tem prazo: a sonda termina como "sem suporte" e o
//    `subscribe()` falha com a frase da família "navegador". Se o serviço
//    ligar DEPOIS do prazo (instalação lenta, não quebrada), a sonda recomeça.
// 2. A permissão só era lida uma vez por montagem: quem bloqueou, liberou nas
//    configurações do aparelho e voltou ao app (ainda aberto) continuava com
//    `permission === "denied"` e sem o convite. Agora relê ao voltar o foco.
// 3. A frase do limite de 10 aparelhos mandava "desativar em um deles", mas o
//    app não tem botão de desativar aviso; o que existe é o "Sair".
//
// Mesmo andaime de push-hook-sem-service-worker.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const getSubscriptionNoNavegador = vi.fn();
const subscribeNoNavegador = vi.fn();
const requestPermission = vi.fn();

const USUARIO = { id: "cliente-1" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIO }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return { upsert };
      }
      throw new Error(`tabela inesperada nos testes: ${tabela}`);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const rejeicoesNaoTratadas: unknown[] = [];
const aoRejeitarNaoTratada = (motivo: unknown) => {
  rejeicoesNaoTratadas.push(motivo);
};

interface Snapshot {
  isSupported: boolean;
  sondado: boolean;
  permission: NotificationPermission;
  subscription: unknown;
  subscribe: () => Promise<unknown>;
}

const MENSAGEM_NAVEGADOR =
  "Não foi possível ativar as notificações neste navegador. Tente novamente ou use um navegador atualizado.";

// Mesmo valor de `PRAZO_DO_SERVICE_WORKER_MS` no hook; o teste anda além dele.
const ALEM_DO_PRAZO_MS = 30_000;

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

function instalarServiceWorker(ready: Promise<unknown>) {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: { ready },
    configurable: true,
    writable: true,
  });
}

function instalarNotification(permission: NotificationPermission) {
  const objeto = { permission, requestPermission };
  vi.stubGlobal("Notification", objeto);
  return objeto;
}

describe("usePushNotifications — prazo do serviço, permissão ao voltar e frase do limite", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    rejeicoesNaoTratadas.length = 0;
    process.on("unhandledRejection", aoRejeitarNaoTratada);
    getSubscriptionNoNavegador.mockResolvedValue(null);
    vi.stubGlobal("PushManager", class PushManagerStub {});

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    process.off("unhandledRejection", aoRejeitarNaoTratada);
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
  });

  async function montar() {
    vi.resetModules();
    const { usePushNotifications } = await import(
      "@/hooks/usePushNotifications"
    );
    const aoAtualizar = vi.fn();
    function SondaReal() {
      const estado = usePushNotifications();
      useEffect(() => {
        aoAtualizar(estado);
      });
      return null;
    }
    await act(async () => {
      raiz.render(<SondaReal />);
    });
    return { aoAtualizar };
  }

  async function passarOTempo(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // ---- 1. prazo do serviço ------------------------------------------------

  it("ready que nunca assenta: passado o prazo a sonda TERMINA, sem suporte (o cartão do lojista deixa de ficar em 'sondando')", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    instalarNotification("default");
    instalarServiceWorker(new Promise(() => {}));

    const { aoAtualizar } = await montar();
    // Antes do prazo: a fotografia é "suportado" e a sonda ainda não acabou.
    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(true);
    expect(ultimoEstado(aoAtualizar)?.sondado).toBe(false);

    await passarOTempo(ALEM_DO_PRAZO_MS);

    expect(ultimoEstado(aoAtualizar)?.sondado).toBe(true);
    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(false);
    expect(ultimoEstado(aoAtualizar)?.subscription).toBeNull();
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  it("instalação lenta: o serviço liga DEPOIS do prazo e a sonda recomeça (suporte volta, inscrição é lida)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    instalarNotification("granted");
    const inscricaoExistente = { endpoint: "https://push.example/lenta" };
    getSubscriptionNoNavegador.mockResolvedValue(inscricaoExistente);
    let ligar!: (registro: unknown) => void;
    instalarServiceWorker(
      new Promise((resolve) => {
        ligar = resolve;
      }),
    );

    const { aoAtualizar } = await montar();
    await passarOTempo(ALEM_DO_PRAZO_MS);
    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(false);

    await act(async () => {
      ligar({ pushManager: { getSubscription: getSubscriptionNoNavegador } });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(true);
    expect(ultimoEstado(aoAtualizar)?.subscription).toBe(inscricaoExistente);
    expect(ultimoEstado(aoAtualizar)?.sondado).toBe(true);
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  it("ready que resolve a tempo: nada muda (suporte e inscrição normais, o prazo não derruba depois)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    instalarNotification("granted");
    const inscricaoExistente = { endpoint: "https://push.example/ativa" };
    getSubscriptionNoNavegador.mockResolvedValue(inscricaoExistente);
    instalarServiceWorker(
      Promise.resolve({
        pushManager: { getSubscription: getSubscriptionNoNavegador },
      }),
    );

    const { aoAtualizar } = await montar();
    await passarOTempo(ALEM_DO_PRAZO_MS);

    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(true);
    expect(ultimoEstado(aoAtualizar)?.subscription).toBe(inscricaoExistente);
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  it("subscribe() com ready que nunca assenta: falha com a frase de 'navegador' em vez de ficar pendurado", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    instalarNotification("default");
    requestPermission.mockResolvedValue("granted");
    instalarServiceWorker(new Promise(() => {}));

    const { aoAtualizar } = await montar();
    const { subscribe } = ultimoEstado(aoAtualizar)!;

    let assentou = false;
    let falha: unknown;
    const toque = subscribe().then(
      () => {
        assentou = true;
      },
      (erro) => {
        assentou = true;
        falha = erro;
      },
    );
    // Duas passadas: a espera do `subscribe()` só nasce depois da permissão.
    await passarOTempo(ALEM_DO_PRAZO_MS);
    await passarOTempo(ALEM_DO_PRAZO_MS);
    await toque;

    expect(assentou).toBe(true);
    expect(falha).toMatchObject({ origin: "navegador" });
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_NAVEGADOR);
    expect(upsert).not.toHaveBeenCalled();
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  // ---- 2. permissão ao voltar para o app ------------------------------------

  it("quem liberou nas configurações do aparelho e voltou: 'focus' relê a permissão", async () => {
    const notification = instalarNotification("denied");
    instalarServiceWorker(
      Promise.resolve({
        pushManager: { getSubscription: getSubscriptionNoNavegador },
      }),
    );

    const { aoAtualizar } = await montar();
    expect(ultimoEstado(aoAtualizar)?.permission).toBe("denied");

    notification.permission = "default";
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(ultimoEstado(aoAtualizar)?.permission).toBe("default");
  });

  it("'visibilitychange' (voltou para a aba/app) também relê a permissão", async () => {
    const notification = instalarNotification("denied");
    instalarServiceWorker(
      Promise.resolve({
        pushManager: { getSubscription: getSubscriptionNoNavegador },
      }),
    );

    const { aoAtualizar } = await montar();
    notification.permission = "default";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(ultimoEstado(aoAtualizar)?.permission).toBe("default");
  });

  it("escondido (hidden) não relê; permissão igual não muda nada", async () => {
    const notification = instalarNotification("denied");
    instalarServiceWorker(
      Promise.resolve({
        pushManager: { getSubscription: getSubscriptionNoNavegador },
      }),
    );
    const { aoAtualizar } = await montar();

    const visibilidade = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    notification.permission = "granted";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(ultimoEstado(aoAtualizar)?.permission).toBe("denied");

    visibilidade.mockReturnValue("visible");
    const chamadasAntes = aoAtualizar.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(ultimoEstado(aoAtualizar)?.permission).toBe("granted");

    // Mesma permissão de novo: nenhuma renderização extra.
    const chamadasDepoisDaMudanca = aoAtualizar.mock.calls.length;
    expect(chamadasDepoisDaMudanca).toBeGreaterThan(chamadasAntes);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(aoAtualizar.mock.calls.length).toBe(chamadasDepoisDaMudanca);
  });

  it("aparelho sem suporte (sem serviceWorker): focus não faz nada e não explode", async () => {
    instalarNotification("denied");
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { aoAtualizar } = await montar();
    const antes = aoAtualizar.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(false);
    expect(aoAtualizar.mock.calls.length).toBe(antes);
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  // ---- 3. frase do limite de 10 aparelhos -------------------------------------

  it("limite de 10 aparelhos: a frase manda fazer o que EXISTE (Sair), não um 'desativar' que o app não tem", async () => {
    instalarNotification("default");
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = {
      endpoint: "https://push.example/11o",
      toJSON: () => ({
        endpoint: "https://push.example/11o",
        keys: { p256dh: "p", auth: "a" },
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({
      error: {
        code: "P0001",
        message: "limite",
        details: "push_limite_de_aparelhos",
      },
    });
    instalarServiceWorker(
      Promise.resolve({
        pushManager: {
          getSubscription: getSubscriptionNoNavegador,
          subscribe: subscribeNoNavegador,
        },
      }),
    );

    const { aoAtualizar } = await montar();
    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    const { toast } = await import("sonner");
    const frase = String(vi.mocked(toast.error).mock.calls.at(-1)?.[0]);
    expect(frase).toContain("10 aparelhos");
    expect(frase).not.toMatch(/desativ/i);
    expect(frase).toContain("Sair");
  });
});
