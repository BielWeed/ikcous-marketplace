// @vitest-environment jsdom
//
// AVISOS DESLIGADOS EM OUTRA ABA NÃO SE RELIGAM SOZINHOS.
//
// A mesma conta aberta em duas abas do navegador. A aba A está no meio da
// conferência "esta inscrição é desta conta?" (resposta atrasada). Na aba B a
// cliente DESLIGA os avisos: o marcador de "avisos ligados" é apagado do
// armazenamento COMPARTILHADO e o navegador cancela a inscrição. Cada aba é um
// JavaScript separado: o contador de desligamentos (`desligamentosDoAparelho`)
// de A não sabe de nada. A resposta antiga de A gravava o marcador de volta e,
// quando A relia o navegador (volta ao foco), o religar automático inscrevia o
// aparelho de novo, sem a cliente tocar em nada: ela voltava a receber aviso
// depois de ter retirado o consentimento.
//
// O que a outra aba faz aqui é só o que ela faz de verdade ao desligar: apagar a
// chave do armazenamento (direto, sem passar pelo contador desta aba) e
// cancelar a inscrição no navegador.
//
// Mesmo andaime de push-desligar-vale-para-todas-as-telas-e-mostra-o-estado-real.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { error: unknown };

const { upsert, apagar, dono, toast, usuario } = vi.hoisted(() => ({
  upsert: vi.fn<() => Promise<Resposta>>(),
  apagar: vi.fn<() => Promise<Resposta>>(),
  dono: vi.fn<() => Promise<"esta-conta" | "outra-conta" | "desconhecido">>(),
  toast: { success: vi.fn(), error: vi.fn() },
  usuario: { id: "conta-exemplo" },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ upsert, delete: () => ({ eq: apagar }) }) },
}));
vi.mock("@/lib/inscricao-de-push-da-conta", () => ({
  dequemEAInscricao: dono,
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Estado {
  subscription: PushSubscription | null;
}

describe("avisos desligados em outra aba não se religam", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let noNavegador: PushSubscription | null;
  let nova: PushSubscription;
  let subscribeNoNavegador: ReturnType<typeof vi.fn>;
  let usePush: () => Estado;
  let avisosEstavamLigados: (id: string) => boolean;
  let marcarAvisosLigados: (id: string) => void;
  let chaveDoMarcador: (id: string) => string;

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    const disco = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => disco.get(k) ?? null,
      setItem: (k: string, v: string) => disco.set(k, v),
      removeItem: (k: string) => disco.delete(k),
    });
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));
    vi.spyOn(console, "error").mockImplementation(() => {});
    noNavegador = null;
    nova = {
      endpoint: "https://push.example/aviso",
      toJSON: () => ({
        endpoint: "https://push.example/aviso",
        keys: { p256dh: "p", auth: "a" },
      }),
      unsubscribe: vi.fn(async () => {
        noNavegador = null;
        return true;
      }),
    } as unknown as PushSubscription;
    subscribeNoNavegador = vi.fn(async () => {
      noNavegador = nova;
      return nova;
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn(async () => noNavegador),
            subscribe: subscribeNoNavegador,
          },
        }),
      },
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: vi.fn(async () => "granted"),
    });
    dono.mockResolvedValue("esta-conta");
    upsert.mockResolvedValue({ error: null });
    apagar.mockResolvedValue({ error: null });
    ({ usePushNotifications: usePush } = await import(
      "@/hooks/usePushNotifications"
    ));
    const lib = await import("@/lib/avisos-ligados-do-aparelho");
    avisosEstavamLigados = lib.avisosEstavamLigados;
    marcarAvisosLigados = lib.marcarAvisosLigados;
    chaveDoMarcador = (id) => `${lib.PREFIXO_AVISOS_LIGADOS}${id}`;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    Reflect.deleteProperty(navigator, "serviceWorker");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function assentar() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
  function tela(): { atual: () => Estado; Sonda: () => null } {
    let estado: Estado | undefined;
    function Sonda() {
      const lido = usePush();
      useEffect(() => {
        estado = lido;
      });
      return null;
    }
    return { atual: () => estado as Estado, Sonda };
  }
  function adiado<T>() {
    let resolver!: (valor: T) => void;
    const promessa = new Promise<T>((resolve) => {
      resolver = resolve;
    });
    return { promessa, resolver };
  }
  // O que a OUTRA aba faz ao desligar: apaga a chave compartilhada e cancela a
  // inscrição do navegador. Nada disso passa pelo contador desta aba.
  function outraAbaDesliga() {
    localStorage.removeItem(chaveDoMarcador(usuario.id));
    noNavegador = null;
  }
  // A aba volta ao foco e relê a inscrição do navegador.
  async function voltarAoFoco() {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await assentar();
  }

  it("a conferência atrasada desta aba não ressuscita o marcador que a outra aba apagou, e nada se reinscreve", async () => {
    noNavegador = nova;
    marcarAvisosLigados(usuario.id);
    const consulta = adiado<"esta-conta">();
    dono.mockReturnValue(consulta.promessa);
    const a = tela();
    await act(async () => {
      raiz.render(<a.Sonda />);
    });
    await assentar();
    expect(dono).toHaveBeenCalledTimes(1);
    expect(a.atual().subscription?.endpoint).toBe(nova.endpoint);

    // A cliente desliga na outra aba enquanto a conferência desta ainda espera.
    outraAbaDesliga();
    await act(async () => {
      consulta.resolver("esta-conta");
    });
    await assentar();
    expect(avisosEstavamLigados(usuario.id)).toBe(false);

    // Esta aba volta ao foco: relê o navegador, que já não tem inscrição.
    await voltarAoFoco();

    expect(a.atual().subscription).toBeNull();
    expect(avisosEstavamLigados(usuario.id)).toBe(false);
    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("CONTROLE — ninguém desligou: a conferência confirma e, se o aparelho perde a inscrição sozinho, o religar automático funciona", async () => {
    noNavegador = nova;
    marcarAvisosLigados(usuario.id);
    const consulta = adiado<"esta-conta">();
    dono.mockReturnValue(consulta.promessa);
    const a = tela();
    await act(async () => {
      raiz.render(<a.Sonda />);
    });
    await assentar();

    await act(async () => {
      consulta.resolver("esta-conta");
    });
    await assentar();
    expect(avisosEstavamLigados(usuario.id)).toBe(true);

    // A limpeza do app levou a inscrição; a cliente NÃO desligou nada.
    noNavegador = null;
    await voltarAoFoco();

    expect(subscribeNoNavegador).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(a.atual().subscription?.endpoint).toBe(nova.endpoint);
    expect(avisosEstavamLigados(usuario.id)).toBe(true);
  });

  it("CONTROLE — inscrição de antes do marcador existir (sem marcador no começo): a conferência ainda grava o marcador", async () => {
    noNavegador = nova;
    const a = tela();
    await act(async () => {
      raiz.render(<a.Sonda />);
    });
    await assentar();
    expect(dono).toHaveBeenCalledTimes(1);
    expect(avisosEstavamLigados(usuario.id)).toBe(true);
  });

  it("um religar automático no ar quando a OUTRA aba desliga é desfeito, sem marcar nada", async () => {
    // A limpeza do app levou a inscrição; o marcador diz que estavam ligados.
    marcarAvisosLigados(usuario.id);
    const gravando = adiado<Resposta>();
    upsert.mockReturnValue(gravando.promessa);
    const a = tela();
    await act(async () => {
      raiz.render(<a.Sonda />);
    });
    await assentar();
    // O religar sozinho desta aba começou (esperando a gravação).
    expect(upsert).toHaveBeenCalledTimes(1);

    // Na outra aba a cliente desliga: marcador apagado no armazenamento comum.
    localStorage.removeItem(chaveDoMarcador(usuario.id));
    await act(async () => {
      gravando.resolver({ error: null });
    });
    await assentar();

    expect(avisosEstavamLigados(usuario.id)).toBe(false);
    expect(a.atual().subscription).toBeNull();
    expect(nova.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE — religar automático sem ninguém desligar segue até o fim e marca", async () => {
    marcarAvisosLigados(usuario.id);
    const a = tela();
    await act(async () => {
      raiz.render(<a.Sonda />);
    });
    await assentar();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(a.atual().subscription?.endpoint).toBe(nova.endpoint);
    expect(avisosEstavamLigados(usuario.id)).toBe(true);
    expect(nova.unsubscribe).not.toHaveBeenCalled();
  });
});
