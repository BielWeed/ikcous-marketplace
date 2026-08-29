// @vitest-environment jsdom
//
// Tarefa A3 do lote 2 (VITRINE) — ponto 2: `usePushNotifications.ts` tinha um
// único `catch` no fim de `subscribe()` mostrando `error.message` cru para
// TRÊS causas de família diferente:
//
//   1. Permissão negada pela própria pessoa (`Notification.requestPermission`
//      não resolve "granted") — causa já conhecida com certeza: o `if
//      (result !== "granted")` já provou isso, não é chute.
//   2. Falha do navegador/serviço de push ao criar a inscrição
//      (`PushManager.subscribe()` rejeita — MDN: pode ser `NotAllowedError`,
//      `AbortError`, `NotSupportedError` etc., cada engine com o seu texto).
//   3. Falha ao SALVAR a inscrição no Supabase (`.upsert()` devolve
//      `{ error }` sem lançar exceção — postgrest-js não lança).
//
// A causa 1 é 100% certa (o próprio código verificou o resultado). As causas
// 2 e 3 são heterogêneas por dentro (Chrome, Firefox, Safari/iOS têm nomes de
// DOMException diferentes; o banco pode recusar por RLS, coluna, o que for) —
// por isso elas recebem UMA frase genérica e HONESTA por família, não uma
// prescrição que só serve para um subtipo. O que importa aqui é a pessoa
// saber ONDE o problema está (navegador vs. "sua inscrição não foi salva"),
// não o texto exato do DOMException ou do Postgrest.
//
// Mesmo padrão de auth-mensagem-traduzida.test.tsx: Sonda (useState +
// useContext-like snapshot) capturando o retorno do hook, sem
// @testing-library/react (vitest.config.ts documenta a escolha).
import { act, useEffect } from "react";
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

describe("usePushNotifications — o erro deixa de ser um catch só para três causas diferentes", () => {
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
      raiz.render(<SondaReal />);
    });

    await esperarAte(() => ultimoEstado(aoAtualizar)?.isSupported === true);

    const { toast } = await import("sonner");
    return { toast, aoAtualizar };
  }

  // As três mensagens abaixo são comparadas por IGUALDADE EXATA (não só "não
  // contém o texto cru"): isso prova, ao mesmo tempo, que (a) o texto técnico
  // sumiu e (b) as três causas têm frases DIFERENTES entre si — a armadilha
  // do lote é justamente cair as três na mesma frase genérica, que seria uma
  // "tradução" que não traduz nada.
  // "configurações do site" não existe com esse nome no iOS: fora do modo
  // instalado o Safari nem expõe `PushManager` (a mensagem nunca aparece),
  // e no web app instalado a permissão mora em Ajustes do iOS →
  // Notificações → o app. "Navegador ou aparelho" é verdadeiro nos dois.
  const MENSAGEM_PERMISSAO =
    "Você precisa permitir as notificações para recebê-las. Ative a permissão nas configurações de notificações do seu navegador ou do seu aparelho e tente de novo.";
  // "denied" é decisão CONFIRMADA (a pessoa escolheu Bloquear) — só se
  // resolve nas configurações. "default" é o balão fechado sem escolha: a
  // permissão ainda está pendente, e mandar para configurações mostraria
  // "Perguntar" (nada aparentemente errado) sem dizer o que fazer. Tocar de
  // novo reabre o balão do navegador.
  const MENSAGEM_PERMISSAO_PENDENTE =
    "Toque de novo e escolha Permitir quando o navegador perguntar.";
  const MENSAGEM_NAVEGADOR =
    "Não foi possível ativar as notificações neste navegador. Tente novamente ou use um navegador atualizado.";
  // "Não foi possível salvar" mentiria se a requisição chegou e só a
  // resposta se perdeu (o `postgrest-js` devolve `{ error }` em vez de
  // lançar) — nesse caso a gravação pode ter acontecido de verdade. "Não
  // conseguimos confirmar" é verdade nos dois casos.
  const MENSAGEM_BANCO =
    "Não conseguimos confirmar que sua inscrição foi salva. Tente novamente em instantes.";

  it("permissão negada: mensagem ACIONÁVEL própria, e o navegador nem chega a ser chamado", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("denied");

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_PERMISSAO);
  });

  // Anotado 1 da revisão: `result === "default"` (a pessoa fechou o balão do
  // Chrome sem escolher Permitir/Bloquear) caía na MESMA frase de "denied",
  // que manda ir até as configurações do navegador — lá ela encontra a
  // permissão em "Perguntar" e nada aparentemente errado, sem entender por
  // que a notificação não ativou. Mensagem própria: pedir para tocar de novo.
  it("permissão ainda não respondida (balão fechado sem escolher): mensagem diferente da de 'negada', pedindo para tocar de novo", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("default");

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_PERMISSAO_PENDENTE);
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM_PERMISSAO);
  });

  it("falha do navegador ao ativar (PushManager.subscribe rejeita): mensagem própria, sem o texto cru do DOMException", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    subscribeNoNavegador.mockRejectedValue(
      new DOMException(
        "Registration failed - push service error",
        "AbortError",
      ),
    );

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(upsert).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_NAVEGADOR);
    const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(mensagem).not.toMatch(/registration failed|push service error/i);
  });

  it("falha ao salvar no banco (upsert devolve { error }): mensagem própria, sem o texto cru do Postgrest/RLS", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = {
      endpoint: "https://push.example/endpoint-1",
      toJSON: () => ({
        endpoint: "https://push.example/endpoint-1",
        keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
      }),
    };
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({
      error: {
        message:
          'new row violates row-level security policy for table "push_subscriptions"',
      },
    });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_BANCO);
    const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(mensagem).not.toMatch(/row-level security|violates|postgrest/i);
  });

  // "Campo coletado não é campo assertado": sem isso, trocar `p256dh` por
  // `keys?.auth` no upsert sobrevive com o teste inteiro verde.
  it("banco: o upsert recebe o payload correto, com o par p256dh/auth no lugar certo", async () => {
    const { aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = {
      endpoint: "https://push.example/endpoint-3",
      toJSON: () => ({
        endpoint: "https://push.example/endpoint-3",
        keys: { p256dh: "chave-p256dh-3", auth: "chave-auth-3" },
      }),
    };
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({ error: null });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await subscribe();
    });

    expect(upsert).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example/endpoint-3",
        p256dh: "chave-p256dh-3",
        auth: "chave-auth-3",
        user_id: USUARIO.id,
      },
      { onConflict: "endpoint" },
    );
  });

  // O ramo genérico de `mensagemPorOrigem` (erro que não é
  // `PushSubscribeError`) falha fechado hoje, mas nada trava isso — um
  // `?? error.message` futuro passaria verde sem este teste. Simula um
  // erro que NÃO passa por nenhuma das três origens conhecidas:
  // `requestPermission` rejeitando (em vez de resolver "denied"/"granted").
  it("erro que não é PushSubscribeError (ex.: requestPermission rejeita): mensagem genérica, sem vazar o texto cru", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockRejectedValue(
      new Error("texto tecnico que nao pode vazar"),
    );

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await subscribe();
      }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível se inscrever para notificações. Tente novamente.",
    );
    const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(mensagem).not.toMatch(/texto tecnico/i);
  });

  // O caminho feliz não pode ter regredido: as três traduções não podem ter
  // "engolido" o sucesso.
  it("tudo dá certo: toast de sucesso, sem nenhum toast de erro", async () => {
    const { toast, aoAtualizar } = await montar();
    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = {
      endpoint: "https://push.example/endpoint-2",
      toJSON: () => ({
        endpoint: "https://push.example/endpoint-2",
        keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
      }),
    };
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({ error: null });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await subscribe();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });
});
