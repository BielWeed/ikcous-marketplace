// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco, toast, usuario } = vi.hoisted(() => ({
  banco: { linhas: [] as { user_id: string; endpoint: string }[] },
  toast: { success: vi.fn(), error: vi.fn() },
  usuario: { id: "conta-ficticia" },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/inscricao-de-push-da-conta", () => ({
  dequemEAInscricao: vi.fn(async () => "esta-conta"),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "push_subscriptions") {
        throw new Error(`Tabela inesperada: ${tabela}`);
      }
      return {
        delete: () => {
          const filtros: { coluna: string; valor: unknown }[] = [];
          // Como no PostgREST, só executa ao aguardar a consulta. Sem eq,
          // todas as linhas acessíveis à mesma conta seriam apagadas.
          const consulta = {
            eq: (coluna: string, valor: unknown) => {
              filtros.push({ coluna, valor });
              return consulta;
            },
            // biome-ignore lint/suspicious/noThenProperty: dublê da consulta aguardável do PostgREST, executada só após aplicar os filtros.
            then: (resolver: (resposta: { error: null }) => unknown) => {
              banco.linhas = banco.linhas.filter(
                (linha) =>
                  !filtros.every(
                    ({ coluna, valor }) => Reflect.get(linha, coluna) === valor,
                  ),
              );
              return Promise.resolve({ error: null }).then(resolver);
            },
          };
          return consulta;
        },
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Estado {
  subscription: PushSubscription | null;
  unsubscribe: () => Promise<void>;
}

const ENDPOINT_A = "https://push.example/aparelho-a";
const ENDPOINT_B = "https://push.example/aparelho-b";

describe("cancelar avisos só neste aparelho", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let atual: Estado;
  let noNavegador: PushSubscription | null;
  let usePush: () => Estado;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    banco.linhas = [
      { user_id: usuario.id, endpoint: ENDPOINT_A },
      { user_id: usuario.id, endpoint: ENDPOINT_B },
    ];
    noNavegador = {
      endpoint: ENDPOINT_A,
      toJSON: () => ({
        endpoint: ENDPOINT_A,
        keys: { p256dh: "p256dh-ficticio", auth: "auth-ficticio" },
      }),
      unsubscribe: vi.fn(async () => {
        noNavegador = null;
        return true;
      }),
    } as unknown as PushSubscription;
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn(async () => noNavegador),
          },
        }),
      },
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { permission: "granted" });
    ({ usePushNotifications: usePush } = await import(
      "@/hooks/usePushNotifications"
    ));
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    Reflect.deleteProperty(navigator, "serviceWorker");
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("remove o endpoint A, preserva o B da mesma conta e confirma o cancelamento", async () => {
    function Sonda() {
      const estado = usePush();
      useEffect(() => {
        atual = estado;
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    expect(atual.subscription?.endpoint).toBe(ENDPOINT_A);
    expect(banco.linhas).toHaveLength(2);

    await act(async () => {
      await atual.unsubscribe();
    });

    expect(banco.linhas).toEqual([
      { user_id: usuario.id, endpoint: ENDPOINT_B },
    ]);
    expect(noNavegador).toBeNull();
    expect(atual.subscription).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      "Você não receberá mais notificações.",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
