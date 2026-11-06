// @vitest-environment jsdom
//
// A limpeza do app (purga de versão obrigatória, 2º degrau da recuperação de
// chunk, último recurso do sentinela) desregistra o service worker, e a
// inscrição de push morre junto com o registro antigo. O celular da lojista
// parava de receber aviso de pedido novo e NADA religava sozinho: só o toque
// dela em "Quero receber".
//
// O conserto religa sozinho, mas só quando as quatro coisas são verdade ao
// mesmo tempo: há conta logada, a permissão do navegador JÁ é "granted", a
// sonda terminou sem inscrição, e existe o marcador local de que ESTA conta já
// tinha os avisos ligados neste aparelho. O marcador é o que separa "perdeu a
// inscrição na limpeza" de "desligou de propósito" — sem ele, quem desligou
// seria religada contra a vontade. E nunca se pede permissão: o caminho
// silencioso nem chama `Notification.requestPermission()`.
//
// Mesmo andaime de push-inscricao-de-outra-conta-no-aparelho.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const requestPermission = vi.fn();
const getSubscriptionNoNavegador = vi.fn();
const subscribeNoNavegador = vi.fn();
const dono = vi.fn();
const toastSucesso = vi.fn();
const toastErro = vi.fn();

let usuarioAtual: { id: string } | null = null;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSucesso(...a),
    error: (...a: unknown[]) => toastErro(...a),
    warning: vi.fn(),
  },
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

const CHAVE_DA_LOJISTA = "ikcous_push_avisos_ligados:lojista-1";

async function assentar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

function inscricaoFalsa(endpoint = "https://push.exemplo/aparelho-1") {
  return {
    endpoint,
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  };
}

function instalarNavegadorComPush(permissao: NotificationPermission) {
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
  vi.stubGlobal("Notification", {
    permission: permissao,
    requestPermission,
  });
  vi.stubGlobal("PushManager", class {});
}

interface Estado {
  subscription: unknown;
  unsubscribe: () => Promise<void>;
  subscribe: () => Promise<unknown>;
}

describe("usePushNotifications — religa sozinho depois da limpeza do app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aoAtualizar = vi.fn();
  let usePushNotifications: () => Estado;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    localStorage.clear();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    usuarioAtual = { id: "lojista-1" };
    upsert.mockResolvedValue({ error: null });
    dono.mockResolvedValue("esta-conta");
    getSubscriptionNoNavegador.mockResolvedValue(null);
    subscribeNoNavegador.mockImplementation(async () => inscricaoFalsa());
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

  async function montar() {
    function Sonda() {
      const estado = usePushNotifications();
      useEffect(() => {
        aoAtualizar(estado);
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await assentar();
  }

  const ultimo = () => aoAtualizar.mock.calls.at(-1)?.[0] as Estado;

  it("granted + sem inscrição + marcador da conta: religa UMA vez, sem pedir permissão e sem aviso na tela", async () => {
    instalarNavegadorComPush("granted");
    localStorage.setItem(CHAVE_DA_LOJISTA, "1");

    await montar();

    expect(subscribeNoNavegador).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      endpoint: "https://push.exemplo/aparelho-1",
      user_id: "lojista-1",
    });
    expect(ultimo().subscription).not.toBeNull();
    expect(toastSucesso).not.toHaveBeenCalled();
    expect(toastErro).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE_DA_LOJISTA)).not.toBeNull();
  });

  it("SEM marcador (desligou de propósito, ou nunca ligou): não religa", async () => {
    instalarNavegadorComPush("granted");

    await montar();

    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(ultimo().subscription).toBeNull();
  });

  it.each(["default", "denied"] as const)(
    "permissão '%s' com marcador: não religa e não pergunta nada",
    async (permissao) => {
      instalarNavegadorComPush(permissao);
      localStorage.setItem(CHAVE_DA_LOJISTA, "1");

      await montar();

      expect(subscribeNoNavegador).not.toHaveBeenCalled();
      expect(requestPermission).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it("sem conta logada: não religa, mesmo com marcador de alguém", async () => {
    instalarNavegadorComPush("granted");
    usuarioAtual = null;
    localStorage.setItem(CHAVE_DA_LOJISTA, "1");

    await montar();

    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("marcador de OUTRA conta não vale para a conta que está logada", async () => {
    instalarNavegadorComPush("granted");
    localStorage.setItem("ikcous_push_avisos_ligados:outra-pessoa", "1");

    await montar();

    expect(subscribeNoNavegador).not.toHaveBeenCalled();
  });

  it("aparelho que JÁ está inscrito (de verdade) não é inscrito de novo", async () => {
    instalarNavegadorComPush("granted");
    localStorage.setItem(CHAVE_DA_LOJISTA, "1");
    getSubscriptionNoNavegador.mockResolvedValue(inscricaoFalsa());

    await montar();

    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("falha ao religar é silenciosa (sem aviso, sem erro solto) e NÃO repete na mesma carga do app", async () => {
    instalarNavegadorComPush("granted");
    localStorage.setItem(CHAVE_DA_LOJISTA, "1");
    subscribeNoNavegador.mockRejectedValue(new Error("push service fora"));
    const consoleErro = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleAviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    await montar();
    expect(subscribeNoNavegador).toHaveBeenCalledTimes(1);
    expect(toastErro).not.toHaveBeenCalled();

    // Sai e volta para a tela (outra montagem do hook, MESMO carregamento do
    // app): não tenta de novo em laço.
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar();

    expect(subscribeNoNavegador).toHaveBeenCalledTimes(1);
    expect(toastErro).not.toHaveBeenCalled();
    consoleErro.mockRestore();
    consoleAviso.mockRestore();
  });

  it("o marcador sobrevive à purga de localStorage da limpeza do app", async () => {
    const { chaveSobreviveAPurga } = await import(
      "@/lib/localStoragePurgeWhitelist"
    );
    expect(chaveSobreviveAPurga(CHAVE_DA_LOJISTA)).toBe(true);
  });

  it("aparelho que já tinha inscrição DESTA conta ganha o marcador (quem ligou antes desta correção também é religado)", async () => {
    instalarNavegadorComPush("granted");
    getSubscriptionNoNavegador.mockResolvedValue(inscricaoFalsa());
    dono.mockResolvedValue("esta-conta");

    await montar();

    expect(localStorage.getItem(CHAVE_DA_LOJISTA)).not.toBeNull();
  });

  it("inscrição de OUTRA conta no aparelho NÃO vira marcador para esta (nunca inscrever quem não aceitou)", async () => {
    instalarNavegadorComPush("granted");
    getSubscriptionNoNavegador.mockResolvedValue(inscricaoFalsa());
    dono.mockResolvedValue("outra-conta");

    await montar();

    expect(localStorage.getItem(CHAVE_DA_LOJISTA)).toBeNull();
    // e mesmo numa carga seguinte (inscrição já solta) nada é religado
    expect(subscribeNoNavegador).not.toHaveBeenCalled();
  });

  it("o toque em 'Quero receber' grava o marcador; desligar apaga", async () => {
    instalarNavegadorComPush("granted");
    requestPermission.mockResolvedValue("granted");

    await montar();
    expect(localStorage.getItem(CHAVE_DA_LOJISTA)).toBeNull();

    await act(async () => {
      await ultimo().subscribe();
    });
    expect(localStorage.getItem(CHAVE_DA_LOJISTA)).not.toBeNull();

    await act(async () => {
      await ultimo().unsubscribe();
    });
    expect(localStorage.getItem(CHAVE_DA_LOJISTA)).toBeNull();
  });

  it("desligar apaga o marcador mesmo quando o navegador falha ao desinscrever", async () => {
    instalarNavegadorComPush("granted");
    const falha = inscricaoFalsa();
    falha.unsubscribe.mockRejectedValue(new Error("falhou"));
    getSubscriptionNoNavegador.mockResolvedValue(falha);
    const consoleErro = vi.spyOn(console, "error").mockImplementation(() => {});

    await montar();
    expect(localStorage.getItem(CHAVE_DA_LOJISTA)).not.toBeNull();

    await act(async () => {
      await ultimo().unsubscribe();
    });

    expect(localStorage.getItem(CHAVE_DA_LOJISTA)).toBeNull();
    consoleErro.mockRestore();
  });
});
