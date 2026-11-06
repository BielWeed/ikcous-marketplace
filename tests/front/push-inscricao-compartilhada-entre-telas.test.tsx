// @vitest-environment jsdom
//
// O CONVITE "QUERO RECEBER!" VOLTAVA DEPOIS QUE A CLIENTE JÁ LIGOU OS AVISOS
// PELO SINO.
//
// Cada tela que chama `usePushNotifications()` cria o PRÓPRIO estado: o convite
// flutuante (`PushNotificationBanner`, montado no App) e o cartão da tela de
// notificações são duas instâncias. A cliente ligava os avisos no cartão, voltava
// ao Início e o convite — que só sabia o que leu ao montar — aparecia de novo
// ("Quero Receber!" para quem já recebe). Agora uma instância avisa as outras
// quando liga ou desliga (evento da janela), e todas relêem a inscrição do
// navegador; ao voltar o foco para o app também.
//
// Controles negativos decidem o teste: reler sempre "tem inscrição" (ou não ler
// nada) passaria num dos dois lados. Por isso há o desligar (a outra tela volta a
// ficar sem) e o meio do ligar (o foco que o balão devolve NÃO adota uma
// inscrição que ainda não foi gravada).
//
// Mesmo andaime de push-religa-sozinho-depois-da-limpeza-do-app.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const requestPermission = vi.fn();
const getSubscriptionNoNavegador = vi.fn();
const subscribeNoNavegador = vi.fn();
const dono = vi.fn();

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
        return {
          upsert,
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      throw new Error(`tabela inesperada nos testes: ${tabela}`);
    },
  },
}));
vi.mock("@/lib/inscricao-de-push-da-conta", () => ({
  dequemEAInscricao: (...a: unknown[]) => dono(...a),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Estado {
  subscription: { endpoint: string } | null;
  permission: NotificationPermission;
  subscribe: () => Promise<unknown>;
  unsubscribe: () => Promise<void>;
}

const ENDPOINT = "https://push.exemplo/aparelho-1";

describe("usePushNotifications — a inscrição é compartilhada entre as telas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let usePushNotifications: () => Estado;
  const sino = vi.fn();
  const convite = vi.fn();
  // O que o navegador tem de verdade (a fonte que o hook relê).
  let noNavegador: ReturnType<typeof inscricaoFalsa> | null;
  let permissaoDoNavegador: { permission: NotificationPermission };

  function inscricaoFalsa() {
    const sub = {
      endpoint: ENDPOINT,
      unsubscribe: vi.fn(async () => {
        noNavegador = null;
        return true;
      }),
      toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }),
    };
    return sub;
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    localStorage.clear();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    noNavegador = null;
    upsert.mockResolvedValue({ error: null });
    dono.mockResolvedValue("esta-conta");
    getSubscriptionNoNavegador.mockImplementation(async () => noNavegador);
    subscribeNoNavegador.mockImplementation(async () => {
      noNavegador = inscricaoFalsa();
      return noNavegador;
    });
    requestPermission.mockImplementation(async () => {
      permissaoDoNavegador.permission = "granted";
      return "granted";
    });
    permissaoDoNavegador = { permission: "default" };
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: getSubscriptionNoNavegador,
            subscribe: subscribeNoNavegador,
          },
        }),
      },
      configurable: true,
      writable: true,
    });
    vi.stubGlobal(
      "Notification",
      Object.assign(permissaoDoNavegador, { requestPermission }),
    );
    vi.stubGlobal("PushManager", class {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    ({ usePushNotifications } = (await import(
      "@/hooks/usePushNotifications"
    )) as unknown as { usePushNotifications: () => Estado });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function assentar() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }

  // Duas telas ao mesmo tempo, como o App: o convite e o cartão do sino.
  async function montarAsDuasTelas() {
    function Sino() {
      const estado = usePushNotifications();
      useEffect(() => {
        sino(estado);
      });
      return null;
    }
    function Convite() {
      const estado = usePushNotifications();
      useEffect(() => {
        convite(estado);
      });
      return null;
    }
    await act(async () => {
      raiz.render(
        <>
          <Convite />
          <Sino />
        </>,
      );
    });
    await assentar();
  }

  const doSino = () => sino.mock.calls.at(-1)?.[0] as Estado;
  const doConvite = () => convite.mock.calls.at(-1)?.[0] as Estado;

  it("a cliente liga no sino: o convite fica sabendo, sem remontar e sem trocar de conta", async () => {
    await montarAsDuasTelas();
    expect(doConvite().subscription).toBeNull();

    await act(async () => {
      await doSino().subscribe();
    });
    await assentar();

    expect(doSino().subscription?.endpoint).toBe(ENDPOINT);
    expect(doConvite().subscription?.endpoint).toBe(ENDPOINT);
    // O convite também enxerga a permissão que a cliente deu no balão.
    expect(doConvite().permission).toBe("granted");
  });

  it("CONTROLE — se desligar depois, o convite volta a saber que NÃO há inscrição", async () => {
    await montarAsDuasTelas();
    await act(async () => {
      await doSino().subscribe();
    });
    await assentar();
    expect(doConvite().subscription).not.toBeNull();

    await act(async () => {
      await doSino().unsubscribe();
    });
    await assentar();

    expect(doSino().subscription).toBeNull();
    expect(doConvite().subscription).toBeNull();
  });

  it("voltar o foco ao app relê a inscrição do navegador (ligada por outro caminho)", async () => {
    permissaoDoNavegador.permission = "granted";
    await montarAsDuasTelas();
    expect(doConvite().subscription).toBeNull();

    // O navegador ganhou a inscrição enquanto a tela estava parada.
    noNavegador = inscricaoFalsa();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await assentar();

    expect(doConvite().subscription?.endpoint).toBe(ENDPOINT);
  });

  it("CONTROLE — no MEIO de ligar (balão fechou, falta gravar) o foco não adota a inscrição que ainda não foi gravada", async () => {
    let gravar: (resposta: { error: null }) => void = () => undefined;
    upsert.mockReturnValue(
      new Promise((resolve) => {
        gravar = resolve;
      }),
    );
    await montarAsDuasTelas();

    let ligando: Promise<unknown> = Promise.resolve();
    await act(async () => {
      ligando = doSino().subscribe();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // O navegador já tem a inscrição; o banco ainda não.
    expect(noNavegador).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await assentar();
    expect(doConvite().subscription).toBeNull();
    expect(doSino().subscription).toBeNull();

    // Gravou: aí sim as duas telas sabem.
    await act(async () => {
      gravar({ error: null });
      await ligando;
    });
    await assentar();
    expect(doSino().subscription?.endpoint).toBe(ENDPOINT);
    expect(doConvite().subscription?.endpoint).toBe(ENDPOINT);
  });

  it("CONTROLE — sem inscrição em lugar nenhum, o foco não inventa uma", async () => {
    await montarAsDuasTelas();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await assentar();

    expect(doConvite().subscription).toBeNull();
    expect(doSino().subscription).toBeNull();
  });

  it("CONTROLE — escondido (hidden) o foco não relê a inscrição", async () => {
    permissaoDoNavegador.permission = "granted";
    await montarAsDuasTelas();
    noNavegador = inscricaoFalsa();
    const antes = getSubscriptionNoNavegador.mock.calls.length;

    const visibilidade = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await assentar();
    visibilidade.mockRestore();

    expect(getSubscriptionNoNavegador.mock.calls.length).toBe(antes);
    expect(doConvite().subscription).toBeNull();
  });

  it("desmontadas as telas, os ouvintes saem (nada relê um componente que já não existe)", async () => {
    await montarAsDuasTelas();
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    const antes = getSubscriptionNoNavegador.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("ikcous:push-inscricao-mudou"));
    });
    await assentar();

    expect(getSubscriptionNoNavegador.mock.calls.length).toBe(antes);
  });
});
