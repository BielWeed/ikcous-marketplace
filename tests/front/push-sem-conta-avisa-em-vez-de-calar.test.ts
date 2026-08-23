// @vitest-environment jsdom
//
// `subscribe()` já criava a inscrição no navegador ANTES de checar se havia
// uma conta logada. Quando não havia, o código fazia
// `if (!user) { console.warn(...); return; }`, devolvendo `undefined` em
// silêncio em vez de lançar `PushSubscribeError` como os outros caminhos de
// falha. (NÃO era o único assim: `if (!vapidPublicKey)` também devolve em
// silêncio, e continua devolvendo — está dormente porque a chave existe em
// todos os `.env`, e não é o defeito que este arquivo cobre.) O banner não
// mostrava nada
// (nem verde, nem vermelho) e, pior: a permissão do navegador JÁ TINHA SIDO
// concedida nesse ponto, então o balão some do próximo carregamento em
// diante e nunca mais volta — a pessoa fica achando que ativou e nunca
// recebe nada.
//
// O conserto move a checagem de `user` para ANTES de
// `Notification.requestPermission()` e faz ela LANÇAR. Assim, se não há
// conta, a permissão nunca chega a ser pedida — continua PENDENTE, o balão
// continua aparecendo, e a pessoa pode tentar de novo depois de entrar.
//
// Mesmo padrão de push-notifications-erro-por-origem.test.tsx: Sonda
// (useState + useContext-like snapshot) capturando o retorno do hook, sem
// @testing-library/react (vitest.config.ts documenta a escolha). Este
// arquivo usa `createElement` em vez de JSX porque nasceu `.test.ts`
// (esbuild só habilita a sintaxe JSX para `.tsx`).
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const subscribeNoNavegador = vi.fn();
const getSubscriptionNoNavegador = vi.fn();
const requestPermission = vi.fn();

const USUARIO = { id: "cliente-1" };

// Mutável, e lida a cada chamada de `useAuth()` — não no momento em que o
// `vi.mock` é declarado. É o que permite o MESMO arquivo testar "sem conta"
// e, no controle negativo, "com conta", sem precisar de um `vi.mock` por
// cenário.
const estadoAuth: { user: { id: string } | null } = { user: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estadoAuth.user }),
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

/** Espera até `condicao()` ficar verdadeira. Cada tique tem o PRÓPRIO
 * `act()` — não um `act()` só envolvendo o laço inteiro. Ver o comentário
 * homônimo em account-settings-senha-usa-o-hook-traduzido.test.tsx: com um
 * único `act()` externo, atualizações agendadas por `useEffect`/promises não
 * chegam a se refletir no snapshot antes do timeout. */
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

describe("usePushNotifications — sem conta avisa em vez de calar", () => {
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
    estadoAuth.user = null;
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));

    registration = {
      pushManager: {
        subscribe: subscribeNoNavegador,
        getSubscription: getSubscriptionNoNavegador,
      },
    };
    getSubscriptionNoNavegador.mockResolvedValue(null);

    class PushManagerStub {}
    vi.stubGlobal("PushManager", PushManagerStub);

    // Objeto, não classe: o código sob teste só lê `Notification.permission`
    // e chama `Notification.requestPermission()` — nunca faz `new`. Uma
    // classe com apenas membros estáticos é o mesmo objeto com cerimônia a
    // mais, e o Biome reprova (`lint/complexity/noStaticOnlyClass`).
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
      raiz.render(createElement(SondaReal));
    });

    await esperarAte(() => ultimoEstado(aoAtualizar)?.isSupported === true);

    const { toast } = await import("sonner");
    return { toast, aoAtualizar };
  }

  const MENSAGEM_SEM_CONTA =
    "Para receber os avisos, entre na sua conta primeiro — é assim que a loja sabe para qual aparelho enviar.";

  it("visitante sem conta toca em 'Quero Receber!': a inscrição lança em vez de sumir em silêncio, pedindo para entrar na conta", async () => {
    const { toast, aoAtualizar } = await montar();

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_SEM_CONTA);
  });

  // Esta é a metade que prova o "antes", não só o "lança": se a checagem
  // ficasse DEPOIS de `requestPermission()` (como um `throw` no lugar do
  // `return` antigo, sem mover a linha), o dublê abaixo teria sido chamado
  // e a permissão do navegador já estaria concedida — o balão sumiria do
  // próximo carregamento em diante, mesmo com o aviso aparecendo agora.
  it("a permissão do navegador não chega a ser pedida quando não há conta", async () => {
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
  // para todo mundo (com ou sem conta) passaria nos dois testes acima.
  it("controle: visitante COM conta segue o caminho normal — permissão pedida e inscrição gravada", async () => {
    estadoAuth.user = USUARIO;
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = {
      endpoint: "https://push.example/endpoint-controle",
      toJSON: () => ({
        endpoint: "https://push.example/endpoint-controle",
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
    expect(upsert).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example/endpoint-controle",
        p256dh: "chave-p256dh",
        auth: "chave-auth",
        user_id: USUARIO.id,
      },
      { onConflict: "endpoint" },
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });
});
