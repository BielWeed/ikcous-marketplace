// @vitest-environment jsdom
//
// Duas janelas do app abertas e visíveis na mesma conta; só a LÍDER tem o canal
// ao vivo, a secundária recebe o aviso "notification_update" pelo canal entre
// abas. Se só o socket da líder cai e volta (a internet segue, nenhuma janela
// muda de visibilidade), a líder relia a própria lista mas NÃO avisava a
// secundária, que ficava sem o aviso novo e com o contador velho. Agora a
// recuperação do canal usa o mesmo caminho do evento de mudança (relê E avisa
// as outras abas).
//
// A primeira confirmação do canal continua sem reler (o efeito acabou de
// buscar), e um SUBSCRIBED repetido sem queda também não. O caso de uma só
// janela líder está em notificacoes-rele-ao-voltar-ao-app-e-ao-reconectar.
const h = await vi.hoisted(async () => {
  const { createContext } = await import("react");
  return {
    // Papel de cada janela (líder ou não), lido pelo dublê da eleição.
    PapelDaJanela: createContext(true),
    // Objeto ESTÁVEL: o efeito do provedor depende da identidade de `user`.
    user: { id: "cliente-a" },
    consultas: 0,
    dados: [] as Record<string, unknown>[],
    statusDoCanal: null as ((status: string) => void) | null,
    pings: 0,
    // Os "canais entre abas" vivos (uma instância por janela).
    abertos: new Set<{
      nome: string;
      onmessage: ((e: { data: unknown }) => void) | null;
    }>(),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user }),
}));
vi.mock("@/hooks/useLeaderElection", async () => {
  const { useContext } = await import("react");
  return {
    useLeaderElection: () => ({ isLeader: useContext(h.PapelDaJanela) }),
  };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let campanha = false;
      const consulta = {
        eq: () => {
          h.consultas++;
          return consulta;
        },
        is: () => {
          campanha = true;
          return consulta;
        },
        order: () => consulta,
        limit: () =>
          Promise.resolve({ data: campanha ? [] : h.dados, error: null }),
      };
      return { select: () => consulta };
    },
    channel: () => {
      const canal: Record<string, unknown> = {};
      canal.on = () => canal;
      canal.subscribe = (aoMudarStatus?: (status: string) => void) => {
        h.statusDoCanal = aoMudarStatus ?? null;
        return canal;
      };
      return canal;
    },
    removeChannel: vi.fn(() => Promise.resolve()),
  },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Linha = Record<string, unknown>;
const AGORA = Date.now();
const aviso = (id: string): Linha => ({
  id,
  usuario_id: "cliente-a",
  titulo: id,
  mensagem: "Seu pedido foi atualizado.",
  tipo: "system",
  lida: false,
  created_at: new Date(AGORA - 60_000).toISOString(),
  dados: null,
});

/** O que cada janela mostra hoje. */
const tela: Record<"lider" | "secundaria", string[]> = {
  lider: [],
  secundaria: [],
};
function Sonda({ janela }: { janela: "lider" | "secundaria" }) {
  const { notifications } = useNotificationCenter();
  useEffect(() => {
    const ids = notifications.map((n) => n.id);
    if (janela === "lider") tela.lider = ids;
    else tela.secundaria = ids;
  });
  return null;
}

describe("notificações — só o socket da líder cai: a secundária também relê", () => {
  let raizes: Root[];
  let hospedeiros: HTMLDivElement[];

  async function abrirAsDuasJanelas() {
    for (const [janela, ehLider] of [
      ["lider", true],
      ["secundaria", false],
    ] as const) {
      const hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      const raiz = createRoot(hospedeiro);
      hospedeiros.push(hospedeiro);
      raizes.push(raiz);
      await act(async () => {
        raiz.render(
          <h.PapelDaJanela.Provider value={ehLider}>
            <NotificationProvider>
              <Sonda janela={janela} />
            </NotificationProvider>
          </h.PapelDaJanela.Provider>,
        );
      });
    }
  }

  /** 1,2 s: a líder espera a junção (500 ms), avisa, e a secundária espera a
   * DELA (mais 500 ms) antes de reler. */
  async function passarOTempo(ms = 1200) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    // Dublê do canal entre abas: entrega a mensagem às OUTRAS instâncias do
    // mesmo nome (o BroadcastChannel real nunca devolve à própria instância).
    class CanalEntreAbasFalso {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      nome: string;
      constructor(nome: string) {
        this.nome = nome;
        h.abertos.add(this);
      }
      postMessage(data: unknown) {
        if ((data as { type?: string })?.type === "notification_update") {
          h.pings++;
        }
        for (const outro of h.abertos) {
          if (outro !== this && outro.nome === this.nome) {
            outro.onmessage?.({ data });
          }
        }
      }
      close() {
        h.abertos.delete(this);
      }
    }
    vi.stubGlobal("BroadcastChannel", CanalEntreAbasFalso);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.consultas = 0;
    h.pings = 0;
    h.dados = [aviso("aviso-1")];
    h.statusDoCanal = null;
    h.abertos.clear();
    tela.lider = [];
    tela.secundaria = [];
    raizes = [];
    hospedeiros = [];
    await abrirAsDuasJanelas();
    await passarOTempo();
  });

  afterEach(() => {
    for (const raiz of raizes) act(() => raiz.unmount());
    for (const hospedeiro of hospedeiros) hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("controle: cada janela buscou uma vez ao abrir e só a líder tem canal", () => {
    expect(h.consultas).toBe(2);
    expect(h.statusDoCanal).not.toBeNull();
    expect(tela.lider).toEqual(["aviso-1"]);
    expect(tela.secundaria).toEqual(["aviso-1"]);
  });

  it("canal da líder cai e volta: as DUAS janelas mostram o aviso novo, uma leitura cada", async () => {
    h.statusDoCanal!("SUBSCRIBED");
    h.statusDoCanal!("CHANNEL_ERROR");
    h.dados = [aviso("aviso-2"), aviso("aviso-1")];
    h.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();

    expect(tela.lider).toContain("aviso-2");
    expect(tela.secundaria).toContain("aviso-2");
    expect(h.consultas).toBe(4); // 2 da abertura + 1 por janela
    expect(h.pings).toBe(1);
  });

  it("a primeira confirmação do canal não relê em janela nenhuma", async () => {
    h.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();

    expect(h.consultas).toBe(2);
    expect(h.pings).toBe(0);
  });

  it("SUBSCRIBED repetido sem queda no meio não relê em janela nenhuma", async () => {
    h.statusDoCanal!("SUBSCRIBED");
    h.statusDoCanal!("CHANNEL_ERROR");
    h.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();
    expect(h.consultas).toBe(4);

    h.statusDoCanal!("SUBSCRIBED");
    h.statusDoCanal!("SUBSCRIBED");
    await passarOTempo();
    expect(h.consultas).toBe(4);
    expect(h.pings).toBe(1);
  });

  it("a secundária não devolve o aviso à líder (sem eco entre as janelas)", async () => {
    h.statusDoCanal!("CLOSED");
    h.statusDoCanal!("SUBSCRIBED");
    await passarOTempo(5000);

    expect(h.consultas).toBe(4);
    expect(h.pings).toBe(1);
  });
});
