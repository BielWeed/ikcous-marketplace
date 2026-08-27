// @vitest-environment jsdom
//
// A metade do defeito que a correção do banner (PushNotificationBanner.tsx)
// não alcança: `pushManager.subscribe()` do navegador pode dar certo e a
// gravação da inscrição no Supabase falhar logo depois (família "banco",
// usePushNotifications.ts, dentro de `subscribe()`). Sem este conserto o
// estado final ficava:
//
//   - navegador: inscrito de verdade — `getSubscription()` devolve
//     não-nulo ao recarregar.
//   - banco: nada — nenhuma linha em `push_subscriptions`.
//
// Ao recarregar, o app vê a inscrição do navegador, considera a cliente
// inscrita e ESCONDE o convite — mesmo com a correção do banner (que já
// olha `subscription` em vez de só `permission === "granted"`), porque desta
// vez `subscription` É não-nulo. Quem dispara notificação nunca encontra
// essa cliente, para sempre, e a permissão concedida vira beco sem saída.
//
// O conserto: quando o `upsert` falha, desfazer a inscrição do NAVEGADOR
// (`newSubscription.unsubscribe()`) antes de lançar o erro — devolve um
// estado consistente (nem navegador, nem banco), e como a permissão do
// SO/navegador já foi concedida, tentar de novo não pede o balão de novo.
//
// Mesmo andaime de push-notifications-erro-por-origem.test.tsx e
// push-sem-conta-avisa-em-vez-de-calar.test.ts: Sonda (useEffect capturando
// o retorno do hook) via createRoot + act, sem @testing-library/react.
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

describe("usePushNotifications — falha ao salvar no banco desfaz a inscrição do navegador", () => {
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

  const MENSAGEM_BANCO =
    "Não conseguimos confirmar que sua inscrição foi salva. Tente novamente em instantes.";

  function subscricaoFalsaComUnsubscribe() {
    return {
      endpoint: "https://push.example/endpoint-1",
      unsubscribe: vi.fn().mockResolvedValue(true),
      toJSON: () => ({
        endpoint: "https://push.example/endpoint-1",
        keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
      }),
    };
  }

  it("upsert falha: a inscrição do navegador é desfeita — sem isso, a próxima carga acha `getSubscription()` não-nulo e esconde o convite para sempre", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = subscricaoFalsaComUnsubscribe();
    // `subscribeNoNavegador` e `getSubscriptionNoNavegador` eram mocks
    // INDEPENDENTES: chamar um não mudava o retorno do outro. No navegador
    // real eles são ligados por causa e efeito — depois que `subscribe()`
    // roda, a MESMA inscrição passa a existir para `getSubscription()`
    // também. Sem essa causalidade, a ORDEM entre a sonda e o `subscribe()`
    // não tinha consequência observável (mutante sobrevivente: mover a
    // sonda de ANTES do `subscribe()` para DEPOIS do catch não derrubava
    // este teste).
    subscribeNoNavegador.mockImplementation(async () => {
      getSubscriptionNoNavegador.mockResolvedValue(subscricaoFalsa);
      return subscricaoFalsa;
    });
    upsert.mockResolvedValue({
      error: { message: "RLS negou a linha" },
    });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_BANCO);
    // O dente do conserto: o navegador é desfeito da inscrição que acabou
    // de criar, para não sobreviver sozinho sem contraparte no banco. Isto
    // só prova a ORDEM certa (sonda ANTES do `subscribe()`) porque agora o
    // dublê tem a mesma causalidade do navegador real: se a sonda rodasse
    // depois, ela acharia `getSubscription()` já não-nulo (a inscrição que
    // o próprio `subscribe()` acabou de criar) e nunca chamaria
    // `unsubscribe`.
    expect(subscricaoFalsa.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("upsert falha, e o próprio unsubscribe também falha: a mensagem continua sendo a de banco, não uma terceira mensagem que esconde a causa original", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = {
      endpoint: "https://push.example/endpoint-2",
      unsubscribe: vi.fn().mockRejectedValue(new Error("rede caiu")),
      toJSON: () => ({
        endpoint: "https://push.example/endpoint-2",
        keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
      }),
    };
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({
      error: { message: "RLS negou a linha" },
    });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    // A falha ao desfazer não pode mascarar a causa original (banco) nem
    // travar o fluxo de erro inteiro.
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_BANCO);
    expect(subscricaoFalsa.unsubscribe).toHaveBeenCalledTimes(1);
  });

  // Controle negativo: o caminho de SUCESSO não pode ter passado a desfazer
  // a inscrição — só o de erro no banco chama `unsubscribe`.
  it("controle: caminho de sucesso continua inscrevendo e gravando normalmente — sem desfazer nada", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = subscricaoFalsaComUnsubscribe();
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({ error: null });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await subscribe();
    });

    expect(subscricaoFalsa.unsubscribe).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  // Controle negativo: falha de PERMISSÃO (outra família de erro) não deve
  // chamar unsubscribe — o navegador nem chegou a criar inscrição nenhuma.
  it("controle: falha de permissão (outra família) não tenta desfazer inscrição nenhuma — o navegador nunca chegou a criar uma", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("denied");

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM_BANCO);
  });

  // O achado que bloqueou a revisão: `pushManager.subscribe()` com a MESMA
  // `applicationServerKey` não cria nada quando já existe uma inscrição viva
  // — a spec (W3C Push API, subscribe(), passo 11.6) devolve a inscrição
  // EXISTENTE. Sem a sonda, o `unsubscribe()` de erro do banco destruiria
  // essa inscrição viva, que este fluxo nem criou.
  it("já existia inscrição viva no navegador antes desta chamada: upsert falha e o unsubscribe NÃO é chamado — senão destruiria uma inscrição que este fluxo não criou", async () => {
    const { toast, aoAtualizar } = await montar();
    const inscricaoJaExistente = {
      endpoint: "https://push.example/ja-existia",
    };
    getSubscriptionNoNavegador.mockResolvedValue(inscricaoJaExistente);
    requestPermission.mockResolvedValue("granted");
    // Mesma chave → a spec devolve a inscrição já viva (não cria outra).
    const inscricaoDevolvidaPelaSpec = subscricaoFalsaComUnsubscribe();
    subscribeNoNavegador.mockResolvedValue(inscricaoDevolvidaPelaSpec);
    upsert.mockResolvedValue({
      error: { message: "RLS negou a linha" },
    });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_BANCO);
    expect(inscricaoDevolvidaPelaSpec.unsubscribe).not.toHaveBeenCalled();
  });

  // A guarda é `inscricaoExistente !== null` — de propósito, comparação
  // ESTRITA. `getSubscription()` resolvendo `undefined` (em vez de `null`
  // explícito) tem de cair do MESMO lado que "já existia": `undefined`
  // também não autoriza destruir. Se um refactor trocasse `!==` por `!=`
  // (simplificação plausível, ou regra de lint), `undefined != null` vira
  // `false` — inverte a falha fechada e o `unsubscribe` passaria a ser
  // chamado. Mutante que este teste mata.
  it("a sondagem resolve `undefined` (não `null`): falha fechada — assume que já existia e não desfaz nada", async () => {
    const { toast, aoAtualizar } = await montar();
    getSubscriptionNoNavegador.mockResolvedValue(undefined);
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = subscricaoFalsaComUnsubscribe();
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({
      error: { message: "RLS negou a linha" },
    });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_BANCO);
    expect(subscricaoFalsa.unsubscribe).not.toHaveBeenCalled();
  });

  // Falha ao sondar = estado DESCONHECIDO, e desconhecido não autoriza
  // destruir — falha fechada.
  it("a sondagem de inscrição existente falha: falha fechada — assume que já existia e não desfaz nada", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = subscricaoFalsaComUnsubscribe();
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({
      error: { message: "RLS negou a linha" },
    });
    // Sonda falha DEPOIS de montar (o `useEffect` de suporte também chama
    // `getSubscription`, e este mock só precisa valer dentro de `subscribe`).
    getSubscriptionNoNavegador.mockRejectedValue(
      new Error("falha ao consultar inscrição existente"),
    );

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_BANCO);
    expect(subscricaoFalsa.unsubscribe).not.toHaveBeenCalled();
  });
});
