// @vitest-environment jsdom
//
// `usePushNotifications` devolve `sondado`: a sonda de montagem (suporte,
// permissão, inscrição do navegador) já terminou? Antes disso `subscription`
// é `null` só por não ter sido lido ainda — e o cartão do Início ("este
// aparelho não está recebendo aviso de pedido novo") o trataria como "sem
// inscrição", mostrando o alarme por um instante também para o aparelho que
// ESTÁ inscrito. Prende: `sondado` só vira `true` quando a sonda acaba, e
// acaba em TODOS os caminhos (sem suporte, `ready` que rejeita, inscrição
// lida, leitura da inscrição que falha). O primeiro quadro mostra `false`
// (o controle: um `sondado` que já nasce `true` não prova nada).
//
// Mesmo andaime de push-hook-sem-service-worker.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      throw new Error("a sonda não deve gravar nada");
    },
  },
}));
vi.mock("@/lib/inscricao-de-push-da-conta", () => ({
  dequemEAInscricao: async () => "desconhecido",
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Quadro {
  sondado: boolean;
  isSupported: boolean;
  subscription: unknown;
}

function instalarSuporte(registro: Promise<unknown> | "indefinido") {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: registro === "indefinido" ? undefined : { ready: registro },
    configurable: true,
    writable: true,
  });
  vi.stubGlobal("Notification", {
    permission: "granted" as NotificationPermission,
    requestPermission: vi.fn(),
  });
  vi.stubGlobal("PushManager", class PushManagerStub {});
}

describe("usePushNotifications — sondado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const quadros: Quadro[] = [];

  beforeEach(() => {
    quadros.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
  });

  async function montar() {
    vi.resetModules();
    const { usePushNotifications } = await import(
      "@/hooks/usePushNotifications"
    );
    function Sonda() {
      const estado = usePushNotifications();
      useEffect(() => {
        quadros.push({
          sondado: estado.sondado,
          isSupported: estado.isSupported,
          subscription: estado.subscription,
        });
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
  }

  const ultimo = () => quadros.at(-1);

  it("sem suporte no navegador: a sonda termina na hora, com sondado=true", async () => {
    instalarSuporte("indefinido");
    await montar();

    expect(ultimo()).toMatchObject({ sondado: true, isSupported: false });
  });

  it("com suporte: sondado só vira true quando a inscrição é lida", async () => {
    let entregar: (valor: unknown) => void = () => undefined;
    const inscricao = { endpoint: "https://push.exemplo.test/1" };
    const registro = {
      pushManager: {
        getSubscription: () =>
          new Promise((resolve) => {
            entregar = resolve;
          }),
      },
    };
    instalarSuporte(Promise.resolve(registro));
    await montar();

    // A sonda está no ar: a inscrição ainda é desconhecida, não "ausente".
    expect(quadros.every((q) => q.sondado === false)).toBe(true);
    expect(ultimo()?.subscription).toBeNull();

    await act(async () => {
      entregar(inscricao);
    });

    expect(ultimo()).toMatchObject({ sondado: true, subscription: inscricao });
  });

  it("`ready` que rejeita: sondado=true e o suporte é desmarcado", async () => {
    instalarSuporte(Promise.reject(new Error("sem service worker")));
    await montar();

    expect(ultimo()).toMatchObject({ sondado: true, isSupported: false });
  });

  it("leitura da inscrição que falha: sondado=true, sem inscrição conhecida", async () => {
    const registro = {
      pushManager: {
        getSubscription: () => Promise.reject(new Error("falhou")),
      },
    };
    instalarSuporte(Promise.resolve(registro));
    await montar();

    expect(ultimo()).toMatchObject({
      sondado: true,
      isSupported: true,
      subscription: null,
    });
  });
});
