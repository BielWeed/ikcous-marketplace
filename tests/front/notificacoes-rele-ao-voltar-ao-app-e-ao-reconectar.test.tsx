// @vitest-environment jsdom
//
// O app congela em segundo plano e a internet cai: avisos que chegaram nesse
// meio-tempo (ex.: "Pedido a caminho") não vinham até recarregar a página. A
// caixa de avisos relê ao voltar a ficar visível, quando a internet volta e
// quando o canal ao vivo volta a conectar depois de ter caído — só com
// cliente logada, e sem deixar uma resposta velha apagar a nova.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const rede = vi.hoisted(() => ({
  user: { id: "cliente-a" } as { id: string } | null,
  consultasDosProprios: 0,
  consultasDeCampanha: 0,
  proximas: [] as Promise<{ data: Linha[]; error: null }>[],
  dados: [] as Linha[],
  statusDoCanal: null as ((status: string) => void) | null,
  canaisCriados: 0,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: rede.user }) }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let campanha = false;
      const consulta = {
        eq: () => {
          rede.consultasDosProprios++;
          return consulta;
        },
        is: () => {
          campanha = true;
          rede.consultasDeCampanha++;
          return consulta;
        },
        order: () => consulta,
        limit: () => {
          if (campanha) return Promise.resolve({ data: [], error: null });
          return (
            rede.proximas.shift() ??
            Promise.resolve({ data: rede.dados, error: null })
          );
        },
      };
      return { select: () => consulta };
    },
    channel: () => {
      rede.canaisCriados++;
      const canal: Record<string, unknown> = {};
      canal.on = () => canal;
      canal.subscribe = (aoMudarStatus?: (status: string) => void) => {
        rede.statusDoCanal = aoMudarStatus ?? null;
        return canal;
      };
      return canal;
    },
    removeChannel: vi.fn(() => Promise.resolve()),
  },
}));

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AGORA = Date.now();
function aviso(id: string): Linha {
  return {
    id,
    usuario_id: "cliente-a",
    titulo: id,
    mensagem: "Seu pedido foi atualizado.",
    tipo: "system",
    lida: false,
    created_at: new Date(AGORA - 60_000).toISOString(),
    dados: null,
  };
}

const espelho: { atual: ReturnType<typeof useNotificationCenter> | null } = {
  atual: null,
};
function Sonda() {
  const contexto = useNotificationCenter();
  useEffect(() => {
    espelho.atual = contexto;
  });
  return null;
}

let visibilidade: "visible" | "hidden" = "visible";

describe("notificações — relê ao voltar ao app, ao voltar a internet e ao reconectar", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  async function renderizar() {
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <Sonda />
        </NotificationProvider>,
      );
    });
  }

  /** Passa o tempo da junção de gatilhos (500 ms) e deixa as consultas resolverem. */
  async function passarOTempo() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  }

  function voltarAoApp() {
    visibilidade = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
    visibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilidade,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rede.user = { id: "cliente-a" };
    rede.consultasDosProprios = 0;
    rede.consultasDeCampanha = 0;
    rede.proximas = [];
    rede.dados = [aviso("aviso-1")];
    rede.statusDoCanal = null;
    rede.canaisCriados = 0;
    espelho.atual = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("controle: ao montar, busca uma vez e o canal ao vivo abre", async () => {
    await renderizar();
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(1);
    expect(rede.canaisCriados).toBe(1);
    expect(espelho.atual!.notifications.map((n) => n.id)).toEqual(["aviso-1"]);
  });

  it("voltar a ficar visível relê e traz o aviso que chegou com o app parado", async () => {
    await renderizar();
    await passarOTempo();
    rede.dados = [aviso("aviso-2"), aviso("aviso-1")];

    voltarAoApp();
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(2);
    expect(espelho.atual!.notifications.map((n) => n.id)).toContain("aviso-2");
  });

  it("ficar ESCONDIDO não relê", async () => {
    await renderizar();
    await passarOTempo();

    visibilidade = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(1);
  });

  it("a internet voltar (online) relê", async () => {
    await renderizar();
    await passarOTempo();

    window.dispatchEvent(new Event("online"));
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(2);
  });

  it("canal ao vivo que CAIU e voltou a SUBSCRIBED relê; a primeira conexão não", async () => {
    await renderizar();
    await passarOTempo();

    // Primeira conexão: o efeito já buscou, não repete.
    rede.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();
    expect(rede.consultasDosProprios).toBe(1);

    // Cai e volta: relê.
    rede.statusDoCanal!("CHANNEL_ERROR");
    await passarOTempo();
    expect(rede.consultasDosProprios).toBe(1);
    rede.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();
    expect(rede.consultasDosProprios).toBe(2);

    // Já recuperado: outro SUBSCRIBED sem queda no meio não relê.
    rede.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();
    expect(rede.consultasDosProprios).toBe(2);

    // TIMED_OUT e CLOSED também contam como queda.
    rede.statusDoCanal!("TIMED_OUT");
    rede.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();
    expect(rede.consultasDosProprios).toBe(3);
    rede.statusDoCanal!("CLOSED");
    rede.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();
    expect(rede.consultasDosProprios).toBe(4);
  });

  it("os três gatilhos juntos (volta ao app + internet + canal) viram UMA releitura", async () => {
    await renderizar();
    await passarOTempo();
    rede.statusDoCanal!("CLOSED");

    voltarAoApp();
    window.dispatchEvent(new Event("online"));
    rede.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(2);
  });

  it("resposta VELHA que chega depois da nova não apaga o aviso novo", async () => {
    let resolverVelha!: (r: { data: Linha[]; error: null }) => void;
    rede.proximas = [
      new Promise((resolve) => {
        resolverVelha = resolve;
      }),
    ];
    await renderizar();
    await passarOTempo(); // a busca da montagem ficou pendurada (rede ruim)
    expect(rede.consultasDosProprios).toBe(1);

    rede.dados = [aviso("aviso-novo")];
    voltarAoApp();
    await passarOTempo();
    expect(espelho.atual!.notifications.map((n) => n.id)).toEqual([
      "aviso-novo",
    ]);

    await act(async () => {
      resolverVelha({ data: [aviso("aviso-velho")], error: null });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(espelho.atual!.notifications.map((n) => n.id)).toEqual([
      "aviso-novo",
    ]);
  });

  it("SEM usuário: nada dispara (nem consulta, nem canal), mesmo com os três gatilhos", async () => {
    rede.user = null;
    await renderizar();
    await passarOTempo();

    voltarAoApp();
    window.dispatchEvent(new Event("online"));
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(0);
    expect(rede.canaisCriados).toBe(0);
    expect(rede.statusDoCanal).toBeNull();
  });

  it("depois de SAIR da conta, os gatilhos deixam de buscar (ouvintes removidos)", async () => {
    await renderizar();
    await passarOTempo();
    expect(rede.consultasDosProprios).toBe(1);

    rede.user = null;
    await renderizar();
    await passarOTempo();

    voltarAoApp();
    window.dispatchEvent(new Event("online"));
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(1);
  });

  it("gatilho pendente (na espera da junção) é cancelado se a conta sair antes de disparar", async () => {
    await renderizar();
    await passarOTempo();

    voltarAoApp();
    rede.user = null;
    await renderizar();
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(1);
  });

  it("canal que reconecta DEPOIS de a conta sair não busca", async () => {
    await renderizar();
    await passarOTempo();
    const aoMudarStatus = rede.statusDoCanal!;
    aoMudarStatus("CLOSED");

    rede.user = null;
    await renderizar();
    aoMudarStatus("SUBSCRIBED");
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(1);
  });
});
