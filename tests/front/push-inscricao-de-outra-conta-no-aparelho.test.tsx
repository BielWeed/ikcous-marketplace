// @vitest-environment jsdom
//
// A inscrição de push é do NAVEGADOR e fica gravada no nome de quem estava
// logado. Quando outra conta entra no mesmo navegador (celular da família,
// aparelho da loja), `getSubscription()` devolvia a inscrição da conta
// anterior: o banner de convite não aparecia (ele some se o navegador já
// "tem inscrição"), o push dirigido à conta nova dava 0 inscrições e o da
// conta antiga caía neste aparelho.
//
// A RLS da tabela só deixa cada conta ver/apagar/assumir as SUAS linhas
// (admin vê todas): a conta nova não consegue tomar a linha da antiga. O que
// ela consegue é perceber que a inscrição do navegador não é dela (nenhuma
// linha sua com aquele endpoint) e desinscrever o navegador — a inscrição
// some do estado do hook, o banner volta, e o toque em "Quero Receber!" cria
// uma inscrição NOVA e dela, sem pedir permissão de novo (já foi concedida).
//
// Mesmo andaime de push-hook-sem-service-worker.test.tsx (Sonda via
// createRoot + act, sem @testing-library/react).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const selecionar = vi.fn();
const getSession = vi.fn();
const requestPermission = vi.fn();
const getSubscriptionNoNavegador = vi.fn();
const subscribeNoNavegador = vi.fn();

let usuarioAtual: { id: string } | null = null;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => getSession(...args) },
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return { upsert, select: selecionar };
      }
      throw new Error(`tabela inesperada nos testes: ${tabela}`);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
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

async function assentar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

interface Snapshot {
  isSupported: boolean;
  subscription: unknown;
  subscribe: () => Promise<unknown>;
}

function ultimoEstado(aoAtualizar: ReturnType<typeof vi.fn>): Snapshot {
  return aoAtualizar.mock.calls.at(-1)?.[0] as Snapshot;
}

const ENDPOINT_DE_A = "https://push.exemplo/aparelho-da-familia";

function inscricaoFalsa(endpoint = ENDPOINT_DE_A) {
  return {
    endpoint,
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  };
}

function instalarNavegadorComPush() {
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
    permission: "granted" as NotificationPermission,
    requestPermission,
  });
  vi.stubGlobal("PushManager", class {});
}

/** `.from("push_subscriptions").select("user_id").eq("endpoint", x)` */
function linhasVisiveisParaA(
  resultado: () => Promise<{ data: unknown; error: unknown }>,
) {
  const eq = vi.fn(() => resultado());
  selecionar.mockImplementation(() => ({ eq }));
  return eq;
}

describe("usePushNotifications — a inscrição do navegador é de quem?", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    usuarioAtual = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    instalarNavegadorComPush();
    upsert.mockResolvedValue({ error: null });
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
    const remontar = async () => {
      await act(async () => {
        raiz.render(<Sonda />);
      });
    };
    return { aoAtualizar, remontar };
  }

  it("conta B entra no navegador que tem a inscrição de A: a inscrição some do estado e o navegador é desinscrito (o banner volta)", async () => {
    const deA = inscricaoFalsa();
    getSubscriptionNoNavegador.mockResolvedValue(deA);
    usuarioAtual = { id: "conta-b" };
    getSession.mockResolvedValue({
      data: { session: { user: { id: "conta-b" } } },
    });
    const eq = linhasVisiveisParaA(async () => ({ data: [], error: null })); // a RLS esconde a linha de A

    const { aoAtualizar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.isSupported === true);
    await esperarAte(() => deA.unsubscribe.mock.calls.length === 1);
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === null);

    expect(eq).toHaveBeenCalledWith("endpoint", ENDPOINT_DE_A);
    expect(ultimoEstado(aoAtualizar).subscription).toBeNull();
    expect(deA.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("a inscrição é da própria conta: nada é desfeito", async () => {
    const minha = inscricaoFalsa();
    getSubscriptionNoNavegador.mockResolvedValue(minha);
    usuarioAtual = { id: "conta-b" };
    getSession.mockResolvedValue({
      data: { session: { user: { id: "conta-b" } } },
    });
    linhasVisiveisParaA(async () => ({
      data: [{ user_id: "conta-b" }],
      error: null,
    }));

    const { aoAtualizar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === minha);
    await assentar();

    expect(ultimoEstado(aoAtualizar).subscription).toBe(minha);
    expect(minha.unsubscribe).not.toHaveBeenCalled();
  });

  it("admin enxerga a linha de A (RLS deixa), mas ela não é do admin: o navegador é desinscrito", async () => {
    const deA = inscricaoFalsa();
    getSubscriptionNoNavegador.mockResolvedValue(deA);
    usuarioAtual = { id: "admin-1" };
    getSession.mockResolvedValue({
      data: { session: { user: { id: "admin-1" } } },
    });
    linhasVisiveisParaA(async () => ({
      data: [{ user_id: "conta-a" }],
      error: null,
    }));

    const { aoAtualizar } = await montar();
    await esperarAte(() => deA.unsubscribe.mock.calls.length === 1);
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === null);

    expect(ultimoEstado(aoAtualizar).subscription).toBeNull();
  });

  it("consulta falhou (rede, erro do banco): desconhecido não autoriza destruir — a inscrição fica", async () => {
    const deA = inscricaoFalsa();
    getSubscriptionNoNavegador.mockResolvedValue(deA);
    usuarioAtual = { id: "conta-b" };
    getSession.mockResolvedValue({
      data: { session: { user: { id: "conta-b" } } },
    });
    linhasVisiveisParaA(async () => ({
      data: null,
      error: { message: "Failed to fetch" },
    }));

    const { aoAtualizar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === deA);
    await assentar();

    expect(ultimoEstado(aoAtualizar).subscription).toBe(deA);
    expect(deA.unsubscribe).not.toHaveBeenCalled();
  });

  it("sem conta (visitante): nada é consultado nem desfeito", async () => {
    const deA = inscricaoFalsa();
    getSubscriptionNoNavegador.mockResolvedValue(deA);
    usuarioAtual = null;

    const { aoAtualizar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === deA);
    await assentar();

    expect(getSession).not.toHaveBeenCalled();
    expect(selecionar).not.toHaveBeenCalled();
    expect(deA.unsubscribe).not.toHaveBeenCalled();
  });

  it("a conta só aparece DEPOIS da montagem (a sessão carrega assíncrona): a verificação roda quando ela chega", async () => {
    const deA = inscricaoFalsa();
    getSubscriptionNoNavegador.mockResolvedValue(deA);
    usuarioAtual = null;
    getSession.mockResolvedValue({
      data: { session: { user: { id: "conta-b" } } },
    });
    linhasVisiveisParaA(async () => ({ data: [], error: null }));

    const { aoAtualizar, remontar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === deA);
    expect(selecionar).not.toHaveBeenCalled();

    usuarioAtual = { id: "conta-b" };
    await remontar();
    await esperarAte(() => deA.unsubscribe.mock.calls.length === 1);
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === null);
  });

  it("troca de conta com a tela aberta (A -> B): a de A deixa de valer quando B chega", async () => {
    const deA = inscricaoFalsa();
    getSubscriptionNoNavegador.mockResolvedValue(deA);
    usuarioAtual = { id: "conta-a" };
    getSession.mockImplementation(async () => ({
      data: { session: { user: { id: usuarioAtual?.id } } },
    }));
    linhasVisiveisParaA(async () => ({
      data: usuarioAtual?.id === "conta-a" ? [{ user_id: "conta-a" }] : [],
      error: null,
    }));

    const { aoAtualizar, remontar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === deA);
    await assentar();
    expect(deA.unsubscribe).not.toHaveBeenCalled();

    usuarioAtual = { id: "conta-b" };
    await remontar();
    await esperarAte(() => deA.unsubscribe.mock.calls.length === 1);
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === null);
  });

  it("o cliente do Supabase ainda não tem a sessão desta conta: a consulta iria como anônima e voltaria vazia — a inscrição NÃO é destruída", async () => {
    const minha = inscricaoFalsa();
    getSubscriptionNoNavegador.mockResolvedValue(minha);
    usuarioAtual = { id: "conta-b" };
    getSession.mockResolvedValue({ data: { session: null } });
    linhasVisiveisParaA(async () => ({ data: [], error: null }));

    const { aoAtualizar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === minha);
    await assentar();

    expect(selecionar).not.toHaveBeenCalled();
    expect(minha.unsubscribe).not.toHaveBeenCalled();
    expect(ultimoEstado(aoAtualizar).subscription).toBe(minha);
  });

  it("depois que B se inscreve (toque em 'Quero Receber!'), a inscrição NOVA dela não é derrubada pela verificação", async () => {
    getSubscriptionNoNavegador.mockResolvedValue(null);
    usuarioAtual = { id: "conta-b" };
    getSession.mockResolvedValue({
      data: { session: { user: { id: "conta-b" } } },
    });
    // Mesmo que a leitura voltasse vazia, a inscrição criada AGORA por B é de B.
    linhasVisiveisParaA(async () => ({ data: [], error: null }));
    requestPermission.mockResolvedValue("granted");
    const nova = inscricaoFalsa("https://push.exemplo/nova-de-b");
    subscribeNoNavegador.mockResolvedValue(nova);

    const { aoAtualizar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.isSupported === true);
    await act(async () => {
      await ultimoEstado(aoAtualizar).subscribe();
    });
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === nova);
    await assentar();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://push.exemplo/nova-de-b",
        user_id: "conta-b",
      }),
      { onConflict: "endpoint" },
    );
    expect(nova.unsubscribe).not.toHaveBeenCalled();
    expect(ultimoEstado(aoAtualizar).subscription).toBe(nova);
  });

  it("A sai da conta (o Sair desinscreveu o aparelho): o estado deixa de acusar uma inscrição que já não existe", async () => {
    const deA = inscricaoFalsa();
    getSubscriptionNoNavegador.mockResolvedValue(deA);
    usuarioAtual = { id: "conta-a" };
    getSession.mockResolvedValue({
      data: { session: { user: { id: "conta-a" } } },
    });
    linhasVisiveisParaA(async () => ({
      data: [{ user_id: "conta-a" }],
      error: null,
    }));

    const { aoAtualizar, remontar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === deA);

    // O Sair já desinscreveu o navegador; a tela segue montada.
    getSubscriptionNoNavegador.mockResolvedValue(null);
    usuarioAtual = null;
    await remontar();

    await esperarAte(() => ultimoEstado(aoAtualizar)?.subscription === null);
  });

  it("navegador sem push: nada é consultado e nada lança", async () => {
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    usuarioAtual = { id: "conta-b" };

    const { aoAtualizar } = await montar();
    await assentar();

    expect(ultimoEstado(aoAtualizar).isSupported).toBe(false);
    expect(getSession).not.toHaveBeenCalled();
    expect(selecionar).not.toHaveBeenCalled();
  });
});
