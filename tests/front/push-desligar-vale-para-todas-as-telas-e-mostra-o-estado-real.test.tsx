// @vitest-environment jsdom
//
// DESLIGAR OS AVISOS TEM DE VALER PARA TODAS AS TELAS, E A TELA TEM DE DIZER O
// QUE O APARELHO FAZ DE VERDADE.
//
// Cada tela que chama `usePushNotifications()` tem o PRÓPRIO estado (o convite
// do App e o cartão da tela do sino são duas). Dois defeitos nasciam daí:
//
// 1. A cliente tocava em "Desligar avisos", recebia a confirmação e o aparelho
//    voltava a receber notificação. A OUTRA tela estava no meio da conferência
//    "esta inscrição é desta conta?"; a resposta chegava DEPOIS do desligar e
//    gravava de volta o marcador de "avisos ligados" que o desligar tinha
//    acabado de apagar, e, quando a inscrição saía do estado, o religar
//    automático (que só roda se o marcador existe) a inscrevia de novo.
//    Desligar de propósito tem de invalidar as conferências atrasadas de TODAS
//    as telas, e nada religa sozinho depois dele.
//
// 2. O navegador cancelava a inscrição primeiro; se a exclusão no banco falhava
//    na hora, a tela que tocou ficava em "Avisos ligados neste aparelho", sem
//    botão de ligar, embora o aparelho já não recebesse nada (a atualização
//    enviada às outras telas excluía a própria). Agora a tela mostra o estado
//    real e diz o que aconteceu.
//
// Mesmo andaime de push-gravacao-pendurada-solta-as-telas.test.tsx.
import { type ReactElement, act, useEffect } from "react";
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
  subscribe: () => Promise<unknown>;
  unsubscribe: () => Promise<boolean>;
}

const AVISO_SO_NO_APARELHO =
  "Este aparelho já parou de receber os avisos, mas não deu para confirmar no servidor. Se voltar a receber, desligue de novo.";

describe("desligar os avisos: todas as telas e o estado real", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let noNavegador: PushSubscription | null;
  let nova: PushSubscription;
  let subscribeNoNavegador: ReturnType<typeof vi.fn>;
  let usePush: () => Estado;
  let Cartao: () => ReactElement | null;
  let avisosEstavamLigados: (id: string) => boolean;
  let marcarAvisosLigados: (id: string) => void;

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
    ({ AvisosDoAparelhoDaCliente: Cartao } = await import(
      "@/components/pwa/AvisosDoAparelhoDaCliente"
    ));
    ({ avisosEstavamLigados, marcarAvisosLigados } = await import(
      "@/lib/avisos-ligados-do-aparelho"
    ));
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
  // Uma tela do app que usa o hook; devolve onde ler o estado dela.
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
  function botao() {
    return host.querySelector<HTMLButtonElement>("button")!;
  }
  function adiado<T>() {
    let resolver!: (valor: T) => void;
    const promessa = new Promise<T>((resolve) => {
      resolver = resolve;
    });
    return { promessa, resolver };
  }

  it("a conferência de dono da OUTRA tela que chega depois de desligar não religa os avisos", async () => {
    noNavegador = nova;
    marcarAvisosLigados(usuario.id);
    const consultas: Array<(dono: "esta-conta") => void> = [];
    dono.mockImplementation(
      () =>
        new Promise((resolve) => {
          consultas.push(resolve);
        }),
    );
    const apagando = adiado<Resposta>();
    apagar.mockReturnValue(apagando.promessa);
    const a = tela();
    const b = tela();
    await act(async () => {
      raiz.render(
        <>
          <a.Sonda />
          <b.Sonda />
        </>,
      );
    });
    await assentar();
    // As duas telas estão conferindo de quem é a inscrição.
    expect(consultas).toHaveLength(2);

    // A cliente desliga numa delas; a exclusão no banco ainda está no ar.
    let desligou: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      desligou = a.atual().unsubscribe();
    });
    await assentar();
    expect(avisosEstavamLigados(usuario.id)).toBe(false);

    // A conferência atrasada responde "é desta conta" no meio do desligar.
    await act(async () => {
      for (const responder of consultas) responder("esta-conta");
    });
    await assentar();
    await act(async () => {
      apagando.resolver({ error: null });
      await desligou;
    });
    await assentar();

    // O desligar vale: nada voltou a ser marcado e nada foi reinscrito.
    expect(avisosEstavamLigados(usuario.id)).toBe(false);
    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(a.atual().subscription).toBeNull();
    expect(b.atual().subscription).toBeNull();
  });

  it("CONTROLE — sem desligar, a conferência que confirma a conta grava o marcador", async () => {
    noNavegador = nova;
    const a = tela();
    const b = tela();
    await act(async () => {
      raiz.render(
        <>
          <a.Sonda />
          <b.Sonda />
        </>,
      );
    });
    await assentar();
    expect(dono).toHaveBeenCalledTimes(2);
    expect(avisosEstavamLigados(usuario.id)).toBe(true);
  });

  it("CONTROLE — quem liga de novo DEPOIS de desligar volta a ser marcado", async () => {
    noNavegador = nova;
    const a = tela();
    await act(async () => {
      raiz.render(<a.Sonda />);
    });
    await assentar();
    await act(async () => {
      await a.atual().unsubscribe();
    });
    await assentar();
    expect(avisosEstavamLigados(usuario.id)).toBe(false);

    await act(async () => {
      await a.atual().subscribe();
    });
    await assentar();
    expect(a.atual().subscription?.endpoint).toBe(nova.endpoint);
    expect(avisosEstavamLigados(usuario.id)).toBe(true);
  });

  it("um religar automático que está no ar quando outra tela desliga é desfeito, sem marcar nada", async () => {
    // A limpeza do app levou a inscrição; o marcador diz que estavam ligados.
    marcarAvisosLigados(usuario.id);
    const gravando = adiado<Resposta>();
    upsert.mockReturnValue(gravando.promessa);
    const religa = tela();
    const desliga = tela();
    await act(async () => {
      raiz.render(
        <>
          <religa.Sonda />
          <desliga.Sonda />
        </>,
      );
    });
    await assentar();
    // O religar sozinho começou (esperando a gravação).
    expect(upsert).toHaveBeenCalledTimes(1);

    // A cliente desliga na outra tela enquanto isso.
    await act(async () => {
      await desliga.atual().unsubscribe();
    });
    expect(avisosEstavamLigados(usuario.id)).toBe(false);

    await act(async () => {
      gravando.resolver({ error: null });
    });
    await assentar();

    expect(avisosEstavamLigados(usuario.id)).toBe(false);
    expect(religa.atual().subscription).toBeNull();
    expect(nova.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("erro imediato do banco ao desligar: a tela que tocou e a outra mostram o aparelho DESLIGADO, com aviso claro", async () => {
    noNavegador = nova;
    marcarAvisosLigados(usuario.id);
    apagar.mockResolvedValue({ error: { message: "PGRST301 jwt expired" } });
    const outra = tela();
    await act(async () => {
      raiz.render(
        <>
          <outra.Sonda />
          <Cartao />
        </>,
      );
    });
    await assentar();
    expect(botao().textContent).toBe("Desligar avisos neste aparelho");

    await act(async () => {
      botao().click();
    });
    await assentar();

    // O navegador já cancelou: as DUAS telas dizem que está desligado.
    expect(nova.unsubscribe).toHaveBeenCalledTimes(1);
    expect(outra.atual().subscription).toBeNull();
    expect(botao().textContent).toBe("Ligar avisos neste aparelho");
    expect(host.textContent).toContain("Avisos desligados neste aparelho");
    expect(host.textContent).not.toContain("Avisos ligados neste aparelho");
    // O aviso diz o que de fato houve (e o texto cru do erro não aparece).
    expect(toast.error).toHaveBeenCalledWith(
      AVISO_SO_NO_APARELHO,
      expect.anything(),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain("PGRST301");
    // Desligou de propósito: nada religa sozinho.
    expect(avisosEstavamLigados(usuario.id)).toBe(false);
  });

  it("CONTROLE — o navegador recusa cancelar: a tela continua LIGADA e avisa que não desligou", async () => {
    noNavegador = nova;
    (nova.unsubscribe as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("falhou no navegador"),
    );
    const outra = tela();
    await act(async () => {
      raiz.render(
        <>
          <outra.Sonda />
          <Cartao />
        </>,
      );
    });
    await assentar();

    await act(async () => {
      botao().click();
    });
    await assentar();

    expect(outra.atual().subscription?.endpoint).toBe(nova.endpoint);
    expect(host.textContent).toContain("Avisos ligados neste aparelho");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível desligar",
    );
    expect(apagar).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Erro ao cancelar inscrição");
  });
});
