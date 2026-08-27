// @vitest-environment jsdom
//
// Item 5 da revisão de 27/08/2026. `subscribe()` fazia
// `if (!vapidPublicKey) { console.warn(...); return; }` — nem toast, nem
// erro. `push-sem-conta-avisa-em-vez-de-calar.test.ts` já apontava isto
// como o MESMO defeito, "dormente porque a chave existe em todos os
// `.env`", e não era o que aquele arquivo cobria.
//
// O buraco é pré-existente, mas este diff (o banner que reaparece sempre
// que há permissão concedida e nenhuma inscrição salva — ver
// PushNotificationBanner.tsx) o alarga: sem a chave, a cliente vê o tarjão
// "Quero Receber!" para sempre, clica num botão que não faz nada e nenhuma
// mensagem explica por quê.
//
// O conserto: trocar o `return` por
// `throw new PushSubscribeError("navegador", ...)` — a classe e a frase já
// existem para esta família ("Não foi possível ativar as notificações
// neste navegador. Tente novamente ou use um navegador atualizado.").
//
// Mesmo andaime de push-sem-conta-avisa-em-vez-de-calar.test.ts: Sonda
// (useEffect capturando o retorno do hook) via createRoot + act, sem
// @testing-library/react. `.test.ts` (não `.tsx`) porque não há JSX aqui.
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const subscribeNoNavegador = vi.fn();
const getSubscriptionNoNavegador = vi.fn();
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

interface Snapshot {
  isSupported: boolean;
  subscribe: () => Promise<unknown>;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

describe("usePushNotifications — sem VITE_VAPID_PUBLIC_KEY avisa em vez de ficar inerte", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let registration: {
    pushManager: {
      subscribe: typeof subscribeNoNavegador;
      getSubscription: typeof getSubscriptionNoNavegador;
    };
  };

  beforeEach(() => {
    vi.resetAllMocks();

    registration = {
      pushManager: {
        subscribe: subscribeNoNavegador,
        getSubscription: getSubscriptionNoNavegador,
      },
    };
    getSubscriptionNoNavegador.mockResolvedValue(null);

    class PushManagerStub {}
    vi.stubGlobal("PushManager", PushManagerStub);
    vi.stubGlobal("Notification", {
      permission: "default" as NotificationPermission,
      requestPermission,
    });

    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: { ready: Promise.resolve(registration) },
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
      raiz.render(createElement(SondaReal));
    });

    await esperarAte(() => ultimoEstado(aoAtualizar)?.isSupported === true);

    const { toast } = await import("sonner");
    return { toast, aoAtualizar };
  }

  const MENSAGEM_NAVEGADOR =
    "Não foi possível ativar as notificações neste navegador. Tente novamente ou use um navegador atualizado.";

  it("chave VAPID ausente no build: a inscrição lança e avisa, em vez de sumir em silêncio", async () => {
    // Vazia, não ausente: `.env` deste repositório sempre tem a chave (ver
    // .env), então o teste precisa ANULAR o valor real para simular o build
    // sem ela — omitir o `vi.stubEnv` deixaria o valor de verdade passar.
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");

    const { toast, aoAtualizar } = await montar();

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_NAVEGADOR);
  });

  // A metade que prova o "antes de pedir permissão": se a checagem
  // continuasse depois de `Notification.requestPermission()`, o balão do
  // navegador já teria sido respondido — a permissão ficaria concedida (ou
  // negada) por nada, e o defeito original (o convite sumir do banner sem a
  // cliente nunca ter recebido nada) sobreviveria mesmo com o toast novo.
  it("a permissão do navegador não chega a ser pedida quando a chave falta", async () => {
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
    const { aoAtualizar } = await montar();

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  // Controle negativo, na MESMA rodada: sem ele, um conserto que lançasse
  // para todo mundo (com ou sem chave) passaria no teste acima por engano.
  it("controle: com a chave presente, o caminho normal continua — permissão pedida e inscrição gravada", async () => {
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = {
      endpoint: "https://push.example/endpoint-controle-vapid",
      toJSON: () => ({
        endpoint: "https://push.example/endpoint-controle-vapid",
        keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
      }),
    };
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({ error: null });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await subscribe();
    });

    expect(requestPermission).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });
});
