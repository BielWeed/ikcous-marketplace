// @vitest-environment jsdom
//
// O navegador troca a inscrição de push sozinho (`pushsubscriptionchange`) e o
// Service Worker reinscreve, mas não consegue gravar a nova (a RLS exige a
// sessão da conta). Ele chama as janelas abertas; aqui se prova que a página
// grava a inscrição nova pelo MESMO caminho do religar sozinho — com as
// mesmas condições: conta logada, permissão já "granted", marcador de que
// ESTA conta tinha os avisos ligados. Nunca pergunta nada, nunca mostra aviso.
//
// Mesmo andaime de push-religa-sozinho-depois-da-limpeza-do-app.test.tsx, com
// o `navigator.serviceWorker` capaz de entregar mensagem.
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
const TROCOU = { tipo: "ikcous:inscricao-de-push-trocou" };

async function assentar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

function inscricaoFalsa(endpoint: string) {
  return {
    endpoint,
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  };
}

let servico: EventTarget & { ready?: Promise<unknown> };

function instalarNavegadorComPush(permissao: NotificationPermission) {
  servico = Object.assign(new EventTarget(), {
    ready: Promise.resolve({
      pushManager: {
        getSubscription: getSubscriptionNoNavegador,
        subscribe: subscribeNoNavegador,
      },
    }),
  });
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: servico,
    configurable: true,
    writable: true,
  });
  vi.stubGlobal("Notification", { permission: permissao, requestPermission });
  vi.stubGlobal("PushManager", class {});
}

async function mensagemDoServiceWorker(data: unknown) {
  await act(async () => {
    servico.dispatchEvent(Object.assign(new Event("message"), { data }));
  });
  await assentar();
}

describe("usePushNotifications — grava a inscrição que o navegador trocou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let usePushNotifications: () => unknown;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    localStorage.clear();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    usuarioAtual = { id: "lojista-1" };
    upsert.mockResolvedValue({ error: null });
    dono.mockResolvedValue("esta-conta");
    // Antes da troca: o aparelho está inscrito (endereço velho, desta conta).
    getSubscriptionNoNavegador.mockResolvedValue(inscricaoFalsa("velho"));
    // Depois da troca o SW já reinscreveu: `subscribe` com a mesma chave
    // devolve a inscrição NOVA que já existe.
    subscribeNoNavegador.mockImplementation(async () => inscricaoFalsa("novo"));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    ({ usePushNotifications } = (await import(
      "@/hooks/usePushNotifications"
    )) as unknown as { usePushNotifications: () => unknown });
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
        void estado;
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await assentar();
  }

  it("com marcador e permissão: grava a inscrição nova desta conta, sem perguntar e sem aviso na tela", async () => {
    instalarNavegadorComPush("granted");
    localStorage.setItem(CHAVE_DA_LOJISTA, "1");
    await montar();
    expect(upsert).not.toHaveBeenCalled();

    await mensagemDoServiceWorker(TROCOU);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      endpoint: "novo",
      user_id: "lojista-1",
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(toastSucesso).not.toHaveBeenCalled();
    expect(toastErro).not.toHaveBeenCalled();
  });

  it("SEM marcador (desligou de propósito): não grava nem inscreve", async () => {
    instalarNavegadorComPush("granted");
    // Desligar desinscreve o aparelho e apaga o marcador. (Um aparelho com
    // inscrição DESTA conta ganha o marcador na conferência de dono.)
    getSubscriptionNoNavegador.mockResolvedValue(null);
    await montar();

    await mensagemDoServiceWorker(TROCOU);

    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("permissão que não é 'granted': não grava nem pergunta", async () => {
    instalarNavegadorComPush("default");
    localStorage.setItem(CHAVE_DA_LOJISTA, "1");
    await montar();

    await mensagemDoServiceWorker(TROCOU);

    expect(upsert).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it.each([
    ["pulso do service worker", "HEARTBEAT_ACK"],
    [
      "aviso de pedido",
      { tipo: "ikcous:abrir-pedido-do-aviso", pedidoId: "B" },
    ],
    ["nada", undefined],
  ])("outra mensagem (%s): ignorada", async (_nome, data) => {
    instalarNavegadorComPush("granted");
    localStorage.setItem(CHAVE_DA_LOJISTA, "1");
    await montar();

    await mensagemDoServiceWorker(data);

    expect(upsert).not.toHaveBeenCalled();
  });

  it("saiu da tela: a mensagem que chega depois não grava nada", async () => {
    instalarNavegadorComPush("granted");
    localStorage.setItem(CHAVE_DA_LOJISTA, "1");
    await montar();
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);

    await mensagemDoServiceWorker(TROCOU);

    expect(upsert).not.toHaveBeenCalled();
  });
});
