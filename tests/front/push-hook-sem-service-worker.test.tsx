// @vitest-environment jsdom
//
// O guard de suporte de `usePushNotifications` era só
// `"serviceWorker" in navigator && "PushManager" in globalThis` — e o
// operador `in` prova que a PROPRIEDADE existe, não que ela vale algo.
// `src/main.tsx` define `navigator.serviceWorker = undefined` como proteção
// de sandbox em headless/playwright/`disable_sw`: a propriedade continua
// existindo, o hook acreditava no suporte e o
// `await navigator.serviceWorker.ready` explodia como rejeição não tratada
// (pageerror no Chromium headless).
//
// Este arquivo trava o guard REAL (container + `Notification` +
// `PushManager` precisam existir de verdade) e o tratamento das rejeições
// da sonda de montagem (`ready`/`getSubscription`), incluindo o caso de
// desmontagem no meio. A rejeição não tratada é aferida capturando o
// evento `unhandledRejection` do Node: é ele que o Playwright vê como
// `pageerror`.
//
// Mesmo andaime de push-notifications-erro-por-origem.test.tsx: Sonda
// (useState + useEffect snapshot) via createRoot + act, sem
// @testing-library/react.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
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

// Captura de rejeição não tratada: um `await` solto dentro de `useEffect`
// não reprova teste por conta própria — vira `unhandledRejection` no Node
// (e `pageerror` no Playwright). Sem isto, a afirmação "não explode mais"
// seria apenas "não explodiu antes do assert".
const rejeicoesNaoTratadas: unknown[] = [];
const aoRejeitarNaoTratada = (motivo: unknown) => {
  rejeicoesNaoTratadas.push(motivo);
};

/** Espera até `condicao()` ficar verdadeira. Cada tique tem o PRÓPRIO
 * `act()` — ver o comentário homônimo em push-notifications-erro-por-origem.
 * test.tsx: com um único `act()` externo, atualizações agendadas por
 * `useEffect`/promises não chegam a se refletir no snapshot. */
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

/** Dá tempo de um `unhandledRejection` eventual (se existisse) chegar ao
 * listener do Node antes do assert — sem isso o teste poderia passar verde
 * antes de o defeito sequer ser reportado. */
async function escoarMacrotarefas() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

interface Snapshot {
  isSupported: boolean;
  permission: NotificationPermission;
  subscription: unknown;
  subscribe: () => Promise<unknown>;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

/** Instala o par serviceWorker/registration dos cenários suportados. O
 * `ready` e o `getSubscription` são os mesmos mocks do topo do arquivo. */
function instalarServiceWorker(ready: Promise<unknown>) {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: { ready },
    configurable: true,
    writable: true,
  });
}

/** Repete o gesto exato de `src/main.tsx` no sandbox headless: a
 * PROPRIEDADE `serviceWorker` continua existindo — valendo `undefined`. */
function instalarServiceWorkerIndefinido() {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

function instalarNotificationPresente() {
  // Objeto, não classe: o código sob teste só lê `Notification.permission`
  // e chama `Notification.requestPermission()` — nunca faz `new` (mesma
  // decisão documentada em push-notifications-erro-por-origem.test.tsx).
  vi.stubGlobal("Notification", {
    permission: "granted" as NotificationPermission,
    requestPermission,
  });
}

function instalarPushManagerPresente() {
  class PushManagerStub {}
  vi.stubGlobal("PushManager", PushManagerStub);
}

const MENSAGEM_NAVEGADOR =
  "Não foi possível ativar as notificações neste navegador. Tente novamente ou use um navegador atualizado.";

describe("usePushNotifications — guard real de suporte e sonda que não explode", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    rejeicoesNaoTratadas.length = 0;
    process.on("unhandledRejection", aoRejeitarNaoTratada);

    getSubscriptionNoNavegador.mockResolvedValue(null);

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
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    // `Reflect.deleteProperty` em vez de `delete`: mesmo efeito, e o Biome
    // reprova o operador (`lint/performance/noDelete`).
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

  it("serviceWorker presente valendo undefined (main.tsx headless): NÃO é suporte, e nada explode", async () => {
    instalarNotificationPresente();
    instalarPushManagerPresente();
    instalarServiceWorkerIndefinido();

    const { aoAtualizar } = await montar();
    await esperarAte(() => aoAtualizar.mock.calls.length >= 1);
    await escoarMacrotarefas();

    // O coração do defeito: `isSupported === true` aqui fazia o
    // `await navigator.serviceWorker.ready` virar pageerror no headless.
    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(false);
    expect(ultimoEstado(aoAtualizar)?.subscription).toBeNull();
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  it("Notification ausente: sem suporte, sem ler Notification.permission e sem tocar no serviceWorker", async () => {
    instalarPushManagerPresente();
    instalarServiceWorker(Promise.resolve({ pushManager: {} }));
    // `vi.stubGlobal` com `undefined`: mesmo padrão de
    // mensagens-erro-codigo-da-edge.test.ts / build-identity-runtime.test.tsx.
    vi.stubGlobal("Notification", undefined);

    const { aoAtualizar } = await montar();
    await esperarAte(() => aoAtualizar.mock.calls.length >= 1);
    await escoarMacrotarefas();

    // O código antigo passaria no `'serviceWorker' in navigator` e morreria
    // lendo `Notification.permission` de `undefined`.
    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(false);
    expect(getSubscriptionNoNavegador).not.toHaveBeenCalled();
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  it("PushManager ausente: sem suporte, sonda do navegador não roda", async () => {
    instalarNotificationPresente();
    instalarServiceWorker(Promise.resolve({ pushManager: {} }));
    vi.stubGlobal("PushManager", undefined);

    const { aoAtualizar } = await montar();
    await esperarAte(() => aoAtualizar.mock.calls.length >= 1);
    await escoarMacrotarefas();

    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(false);
    expect(getSubscriptionNoNavegador).not.toHaveBeenCalled();
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  it("ready rejeita: suporte é desmarcado (não fica o falso positivo do banner) e nada vira rejeição não tratada", async () => {
    instalarNotificationPresente();
    instalarPushManagerPresente();
    instalarServiceWorker(
      Promise.reject(
        new Error("Registration failed - no active service worker"),
      ),
    );

    const { aoAtualizar } = await montar();
    // A fotografia sincrona é `true` (as três peças existem); o estado
    // final honesto só chega quando a rejeição assenta.
    await esperarAte(() => {
      const viuSuportado = aoAtualizar.mock.calls.some(
        (chamada) => chamada[0].isSupported === true,
      );
      return viuSuportado && ultimoEstado(aoAtualizar)?.isSupported === false;
    });
    await escoarMacrotarefas();

    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(false);
    expect(ultimoEstado(aoAtualizar)?.subscription).toBeNull();
    expect(getSubscriptionNoNavegador).not.toHaveBeenCalled();
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  it("getSubscription rejeita: sonda falhou não é falta de suporte — inscrição fica null, suporte segue true", async () => {
    instalarNotificationPresente();
    instalarPushManagerPresente();
    getSubscriptionNoNavegador.mockRejectedValue(
      new Error("push manager unavailable"),
    );
    instalarServiceWorker(
      Promise.resolve({
        pushManager: { getSubscription: getSubscriptionNoNavegador },
      }),
    );

    const { aoAtualizar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.isSupported === true);
    await esperarAte(() => getSubscriptionNoNavegador.mock.calls.length === 1);
    await escoarMacrotarefas();

    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(true);
    expect(ultimoEstado(aoAtualizar)?.subscription).toBeNull();
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  it("happy path suportado: isSupported true, permissão espelhada e inscrição existente no estado", async () => {
    instalarNotificationPresente();
    instalarPushManagerPresente();
    const inscricaoExistente = { endpoint: "https://push.example/ativa" };
    getSubscriptionNoNavegador.mockResolvedValue(inscricaoExistente);
    instalarServiceWorker(
      Promise.resolve({
        pushManager: { getSubscription: getSubscriptionNoNavegador },
      }),
    );

    const { aoAtualizar } = await montar();
    await esperarAte(
      () => ultimoEstado(aoAtualizar)?.subscription === inscricaoExistente,
    );
    await escoarMacrotarefas();

    expect(ultimoEstado(aoAtualizar)?.isSupported).toBe(true);
    expect(ultimoEstado(aoAtualizar)?.permission).toBe("granted");
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  it("subscribe revalida no ato do toque: suporte sumiu depois da montagem → família 'navegador', sem gastar o balão de permissão", async () => {
    instalarNotificationPresente();
    instalarPushManagerPresente();
    instalarServiceWorker(
      Promise.resolve({
        pushManager: { getSubscription: getSubscriptionNoNavegador },
      }),
    );

    const { aoAtualizar } = await montar();
    await esperarAte(() => ultimoEstado(aoAtualizar)?.isSupported === true);

    // O mundo mudou DEPOIS da montagem: `isSupported` ainda é `true`
    // (fotografia antiga), mas o serviceWorker sumiu — o mesmo gesto do
    // main.tsx chegando atrasado ao navegador.
    instalarServiceWorkerIndefinido();

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_NAVEGADOR);
    // O balão de permissão não pode ser gasto para depois falhar em `ready`.
    expect(requestPermission).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    await escoarMacrotarefas();
    expect(rejeicoesNaoTratadas).toEqual([]);
  });
});
