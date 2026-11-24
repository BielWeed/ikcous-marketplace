// @vitest-environment jsdom
//
// A chave publica VAPID chega em base64url (`-` e `_`, sem o `=` do fim) e o
// navegador exige os BYTES. O unico teste que olhava isso
// (push-vapid-vem-da-ficha) calcula o esperado com uma COPIA da mesma conta e
// usa uma chave sem `_`: tirar a troca de `_` por `/`, ou errar o
// preenchimento do `=`, passava despercebido -- e ai o `atob` lanca para
// qualquer chave real que tenha `_` (cerca de metade delas) e a loja inteira
// perde o aviso no celular.
//
// Aqui o esperado e FIXO, calculado a mao (nao reimplementa a conta):
//   bytes fb ff bf = base64 "+/+/"  = base64url "-_-_"
//   bytes fb ff    = base64 "+/8="  = base64url "-_8"
//   byte  fb       = base64 "+w=="  = base64url "-w"
// As tres cobrem os tres tamanhos de preenchimento (0, 1 e 2 sinais de `=`).
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const subscribeNoNavegador = vi.fn();
const getSubscriptionNoNavegador = vi.fn();
const requestPermission = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-1" } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") return { upsert };
      throw new Error(`tabela inesperada nos testes: ${tabela}`);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  isSupported: boolean;
  subscribe: () => Promise<unknown>;
}

async function esperarAte(condicao: () => boolean, timeoutMs = 2000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condicao nao ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("usePushNotifications — chave VAPID base64url vira os bytes certos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    getSubscriptionNoNavegador.mockResolvedValue(null);
    vi.stubGlobal("PushManager", class PushManagerStub {});
    vi.stubGlobal("Notification", {
      permission: "default" as NotificationPermission,
      requestPermission,
    });
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          pushManager: {
            subscribe: subscribeNoNavegador,
            getSubscription: getSubscriptionNoNavegador,
          },
        }),
      },
      configurable: true,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
  });

  it.each([
    ["sem preenchimento (4 caracteres)", "-_-_", [251, 255, 191]],
    [
      "com 1 sinal de preenchimento (7 caracteres)",
      "-_-_-_8",
      [251, 255, 191, 251, 255],
    ],
    ["com 2 sinais de preenchimento (2 caracteres)", "-w", [251]],
  ])(
    "chave %s entrega ao navegador os bytes exatos",
    async (_nome, chave, esperado) => {
      vi.stubEnv("VITE_VAPID_PUBLIC_KEY", chave);
      vi.resetModules();
      const { usePushNotifications } = await import(
        "@/hooks/usePushNotifications"
      );
      const aoAtualizar = vi.fn();
      function Sonda() {
        const estado = usePushNotifications();
        useEffect(() => {
          aoAtualizar(estado);
        });
        return null;
      }
      await act(async () => {
        raiz.render(createElement(Sonda));
      });
      const ultimo = () =>
        aoAtualizar.mock.calls.at(-1)?.[0] as Snapshot | undefined;
      await esperarAte(() => ultimo()?.isSupported === true);

      requestPermission.mockResolvedValue("granted");
      subscribeNoNavegador.mockResolvedValue({
        endpoint: "https://push.example/endpoint-vapid",
        toJSON: () => ({
          endpoint: "https://push.example/endpoint-vapid",
          keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
        }),
      });
      upsert.mockResolvedValue({ error: null });

      await act(async () => {
        await ultimo()!.subscribe();
      });

      expect(subscribeNoNavegador).toHaveBeenCalledTimes(1);
      const usada = subscribeNoNavegador.mock.calls[0][0]
        .applicationServerKey as Uint8Array;
      expect(Array.from(usada)).toEqual(esperado);
    },
  );
});
