// @vitest-environment jsdom
//
// ABRIR O SINO NO MEIO DE "QUERO RECEBER!" DESLIGAVA OS AVISOS QUE A CLIENTE
// ACABOU DE LIGAR.
//
// A cliente toca "Quero Receber!" e permite: o navegador cria a inscrição, mas
// a confirmação do servidor (a linha em `push_subscriptions`) ainda não voltou.
// Se ela abre o sino nessa janela, a tela nova acha a inscrição no navegador e
// NÃO acha a linha no servidor: lia isso como "inscrição de outra conta" e a
// cancelava. Depois a ativação original anunciava sucesso com o aparelho
// desinscrito. A proteção de "ativação em andamento" só valia na releitura por
// foco/evento, não na conferência de dono da primeira leitura.
//
// O servidor aqui é simulado por `linhaGravada`: a consulta de dono responde
// "outra-conta" enquanto a gravação não terminou e "esta-conta" depois — a mesma
// resposta que a RLS dá de verdade.
//
// Controles negativos decidem o teste: a falha de gravação (a conferência
// adiada tem de, ao fim, deixar a tela sem inscrição) e a inscrição alheia SEM
// ativação no ar (continua sendo cancelada).
//
// Mesmo andaime de push-inscricao-compartilhada-entre-telas.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, requestPermission, dono, toast } = vi.hoisted(() => ({
  upsert: vi.fn(),
  requestPermission: vi.fn(),
  dono: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const USUARIO = { id: "cliente-1" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIO }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      upsert,
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock("@/lib/inscricao-de-push-da-conta", () => ({
  dequemEAInscricao: (...a: unknown[]) => dono(...a),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Estado {
  subscription: { endpoint: string } | null;
  subscribe: () => Promise<unknown>;
}

const ENDPOINT = "https://push.exemplo/aparelho-1";

describe("usePushNotifications — a conferência de dono espera a ativação em andamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let usePushNotifications: () => Estado;
  const convite = vi.fn();
  const sino = vi.fn();
  // O que o navegador tem de verdade e o que o servidor já gravou.
  let noNavegador: ReturnType<typeof inscricaoFalsa> | null;
  let linhaGravada: boolean;
  // Consultas de dono seguradas (a resposta chega quando o teste mandar).
  let seguraConsultas: boolean;
  let consultasPendentes: Array<(dono: string) => void>;
  let liberarGravacao: () => void;

  function inscricaoFalsa() {
    return {
      endpoint: ENDPOINT,
      unsubscribe: vi.fn(async () => {
        noNavegador = null;
        return true;
      }),
      toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }),
    };
  }

  // A gravação só termina quando o teste manda (ou na hora, se `pendurada` é
  // falso), e só então o servidor passa a ter a linha.
  function gravacaoPendurada() {
    upsert.mockImplementation(
      () =>
        new Promise((resolve) => {
          liberarGravacao = () => {
            linhaGravada = true;
            resolve({ error: null });
          };
        }),
    );
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    localStorage.clear();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    vi.spyOn(console, "error").mockImplementation(() => {});
    noNavegador = null;
    linhaGravada = false;
    seguraConsultas = false;
    consultasPendentes = [];
    liberarGravacao = () => undefined;
    upsert.mockImplementation(async () => {
      linhaGravada = true;
      return { error: null };
    });
    dono.mockImplementation(() =>
      seguraConsultas
        ? new Promise((resolve) => consultasPendentes.push(resolve))
        : Promise.resolve(linhaGravada ? "esta-conta" : "outra-conta"),
    );
    requestPermission.mockResolvedValue("granted");
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn(async () => noNavegador),
            // A spec devolve a inscrição EXISTENTE quando já há uma.
            subscribe: vi.fn(async () => {
              noNavegador ??= inscricaoFalsa();
              return noNavegador;
            }),
          },
        }),
      },
      configurable: true,
      writable: true,
    });
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission,
    });
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
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function assentar() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }

  function Convite() {
    const estado = usePushNotifications();
    useEffect(() => {
      convite(estado);
    });
    return null;
  }
  function Sino() {
    const estado = usePushNotifications();
    useEffect(() => {
      sino(estado);
    });
    return null;
  }
  async function montarSoOConvite() {
    await act(async () => {
      raiz.render(<Convite />);
    });
    await assentar();
  }
  // O sino abre por cima do convite que já estava no App.
  async function abrirOSino() {
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
  const doConvite = () => convite.mock.calls.at(-1)?.[0] as Estado;
  const doSino = () => sino.mock.calls.at(-1)?.[0] as Estado;

  async function tocarEmQueroReceber(): Promise<{ ligando: Promise<unknown> }> {
    let ligando: Promise<unknown> = Promise.resolve();
    await act(async () => {
      ligando = doConvite().subscribe();
      // O navegador cria a inscrição; a gravação segue pendurada.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return { ligando };
  }

  it("sino aberto com a gravação pendurada NÃO cancela a inscrição; a ativação termina inscrita", async () => {
    gravacaoPendurada();
    await montarSoOConvite();
    const { ligando } = await tocarEmQueroReceber();
    const criada = noNavegador;
    expect(criada).not.toBeNull();

    await abrirOSino();
    // A tela nova adotou a inscrição do navegador, mas NÃO conferiu dono (a
    // resposta do servidor, agora, não vale nada) e muito menos cancelou.
    expect(doSino().subscription?.endpoint).toBe(ENDPOINT);
    expect(dono).not.toHaveBeenCalled();
    expect(criada?.unsubscribe).not.toHaveBeenCalled();

    await act(async () => {
      liberarGravacao();
      await ligando;
    });
    await assentar();

    expect(criada?.unsubscribe).not.toHaveBeenCalled();
    expect(noNavegador).toBe(criada);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(doConvite().subscription?.endpoint).toBe(ENDPOINT);
    expect(doSino().subscription?.endpoint).toBe(ENDPOINT);
    // Terminada a ativação a conferência adiada rodou, e agora a linha existe.
    expect(dono).toHaveBeenCalledWith(ENDPOINT, USUARIO.id);
  });

  it("CONTROLE — a gravação FALHA: a conferência adiada roda no fim e a tela nova fica sem inscrição", async () => {
    upsert.mockImplementation(
      () =>
        new Promise((resolve) => {
          liberarGravacao = () => resolve({ error: { message: "rls" } });
        }),
    );
    await montarSoOConvite();
    const { ligando } = await tocarEmQueroReceber();
    ligando.catch(() => undefined);
    await abrirOSino();
    expect(doSino().subscription?.endpoint).toBe(ENDPOINT);

    await act(async () => {
      liberarGravacao();
      await ligando.catch(() => undefined);
    });
    await assentar();

    // Nada foi gravado: o navegador foi desfeito e as telas não mentem.
    expect(noNavegador).toBeNull();
    expect(doSino().subscription).toBeNull();
    expect(doConvite().subscription).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("CONTROLE — SEM ativação no ar, a inscrição de outra conta continua sendo cancelada", async () => {
    noNavegador = inscricaoFalsa();
    const alheia = noNavegador;
    await act(async () => {
      raiz.render(<Sino />);
    });
    await assentar();

    expect(dono).toHaveBeenCalledWith(ENDPOINT, USUARIO.id);
    expect(alheia.unsubscribe).toHaveBeenCalledTimes(1);
    expect(doSino().subscription).toBeNull();
  });

  it("a consulta que já estava no ar quando a ativação começou e responde 'outra-conta' no meio dela NÃO cancela", async () => {
    // Já havia inscrição no navegador e as duas telas a conferem (respostas
    // seguradas). Só então a cliente toca; a gravação pendura.
    noNavegador = inscricaoFalsa();
    const existente = noNavegador;
    seguraConsultas = true;
    gravacaoPendurada();
    await act(async () => {
      raiz.render(
        <>
          <Convite />
          <Sino />
        </>,
      );
    });
    await assentar();
    expect(consultasPendentes.length).toBe(2);

    const { ligando } = await tocarEmQueroReceber();
    // As respostas chegam com a ativação ainda no ar: "não achei linha".
    seguraConsultas = false;
    await act(async () => {
      for (const responder of consultasPendentes) responder("outra-conta");
    });
    await assentar();
    expect(existente.unsubscribe).not.toHaveBeenCalled();
    expect(doSino().subscription).not.toBeNull();

    await act(async () => {
      liberarGravacao();
      await ligando;
    });
    await assentar();
    expect(existente.unsubscribe).not.toHaveBeenCalled();
    expect(noNavegador).toBe(existente);
    expect(doSino().subscription?.endpoint).toBe(ENDPOINT);
  });

  it("a resposta 'outra-conta' que chega DEPOIS de a ativação já ter acabado (consulta velha) NÃO cancela e a conferência é refeita", async () => {
    noNavegador = inscricaoFalsa();
    const existente = noNavegador;
    seguraConsultas = true;
    await act(async () => {
      raiz.render(
        <>
          <Convite />
          <Sino />
        </>,
      );
    });
    await assentar();
    expect(consultasPendentes.length).toBe(2);

    // A ativação começa e TERMINA (a linha já existe) enquanto as consultas
    // feitas antes dela seguem no ar.
    await act(async () => {
      await doConvite().subscribe();
    });
    await assentar();
    expect(linhaGravada).toBe(true);

    seguraConsultas = false;
    const consultasAntes = dono.mock.calls.length;
    await act(async () => {
      for (const responder of consultasPendentes) responder("outra-conta");
    });
    await assentar();

    expect(existente.unsubscribe).not.toHaveBeenCalled();
    expect(noNavegador).toBe(existente);
    expect(doSino().subscription?.endpoint).toBe(ENDPOINT);
    // Refeita com o servidor já em dia.
    expect(dono.mock.calls.length).toBeGreaterThan(consultasAntes);
  });
});
