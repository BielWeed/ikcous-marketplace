// @vitest-environment jsdom
//
// "Marcar como lidas" grava so os ids que a cliente tinha na mao, em lotes de
// ate 100 ids (o `id=in.(...)` vai na URL). O teste vizinho
// (avisos-marcar-lidas-so-o-que-a-cliente-viu) usa 230 avisos e so confere
// "nenhum lote passa de 100": um lote de 99 passava igual. A FRONTEIRA e que
// nao tinha prova:
//  - exatamente 100 ids sao UM pedido so (nao dois);
//  - 101 ids sao dois pedidos, de 100 e de 1;
//  - o mesmo vale para "abrir o pedido" (markOrderAsRead).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";

const DONA = { id: "cliente-1" };

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: DONA, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const { bancoFalso } = vi.hoisted(() => ({
  bancoFalso: {
    linhas: [] as Record<string, unknown>[],
    // O tamanho de cada `.in("id", ...)` enviado, na ordem.
    tamanhosDosLotes: [] as number[],
    // Os ids de cada lote, na ordem.
    idsDosLotes: [] as string[][],
    // Os filtros de cada UPDATE (eq/contains), na ordem em que foram pedidos.
    filtrosDosUpdates: [] as Array<Array<[string, unknown, unknown?]>>,
    // Linhas de campanha (usuario_id nulo), devolvidas pela ponta `.is`.
    campanha: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const consulta = (proprias: boolean) => {
          const c = {
            order: () => c,
            // Ignora o limite de 50 de proposito: o que se prova aqui e o
            // lote do UPDATE, nao o corte da lista.
            limit: () =>
              Promise.resolve({
                data: proprias ? bancoFalso.linhas : bancoFalso.campanha,
                error: null,
              }),
          };
          return c;
        };
        return { eq: () => consulta(true), is: () => consulta(false) };
      },
      update: () => {
        const filtros: Array<[string, unknown, unknown?]> = [];
        bancoFalso.filtrosDosUpdates.push(filtros);
        const e = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push(["eq", coluna, valor]);
            return e;
          },
          contains: (coluna: string, valor: unknown) => {
            filtros.push(["contains", coluna, valor]);
            return e;
          },
          in: (_coluna: string, ids: string[]) => {
            bancoFalso.tamanhosDosLotes.push(ids.length);
            bancoFalso.idsDosLotes.push([...ids]);
            return e;
          },
          // biome-ignore lint/suspicious/noThenProperty: dubla o query builder thenable do Supabase
          then: (resolve: (v: { error: null }) => void) =>
            Promise.resolve({ error: null }).then(resolve),
        };
        return e;
      },
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class BroadcastChannelStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage() {}
  close() {}
}

type Centro = ReturnType<typeof useNotificationCenter>;
// A sonda REPORTA o contexto por callback; mutar uma variável de fora do
// componente em render é o que `react-hooks/globals` reprova.
const ponte: { atual: Centro | undefined } = { atual: undefined };
const guardar = (c: Centro) => {
  ponte.atual = c;
};
const centro = () => ponte.atual as Centro;
function Sonda({ aoLer }: { readonly aoLer: (c: Centro) => void }) {
  aoLer(useNotificationCenter());
  return null;
}

function avisos(quantidade: number, jaLidos: number[] = []) {
  return Array.from({ length: quantidade }, (_, i) => ({
    id: `n${String(i).padStart(4, "0")}`,
    usuario_id: DONA.id,
    titulo: `Aviso ${i}`,
    mensagem: "Seu pedido mudou",
    tipo: "info",
    lida: jaLidos.includes(i),
    created_at: new Date(
      Date.UTC(2026, 10, 24, 10, 0, 0) - i * 1000,
    ).toISOString(),
    acao: null,
    dados: { order_id: "ped-1" },
  }));
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montarCom(quantidade: number, jaLidos: number[] = []) {
  bancoFalso.linhas = avisos(quantidade, jaLidos);
  await act(async () => {
    raiz.render(
      <NotificationProvider>
        <Sonda aoLer={guardar} />
      </NotificationProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(centro().notifications).toHaveLength(
    quantidade + bancoFalso.campanha.length,
  );
}

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", BroadcastChannelStub);
  bancoFalso.tamanhosDosLotes = [];
  bancoFalso.idsDosLotes = [];
  bancoFalso.filtrosDosUpdates = [];
  bancoFalso.campanha = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("marcar como lidas — fronteira do lote de 100 ids", () => {
  it("marcar todas: exatamente 100 avisos saem em UM pedido de 100 ids", async () => {
    await montarCom(100);

    await act(async () => {
      await centro().markAllAsRead();
    });

    expect(bancoFalso.tamanhosDosLotes).toEqual([100]);
    expect(centro().unreadCount).toBe(0);
  });

  it("marcar todas: 101 avisos saem em dois pedidos, de 100 e de 1", async () => {
    await montarCom(101);

    await act(async () => {
      await centro().markAllAsRead();
    });

    expect(bancoFalso.tamanhosDosLotes).toEqual([100, 1]);
    expect(centro().unreadCount).toBe(0);
  });

  it("abrir o pedido: 100 avisos dele em UM pedido; 101 em dois (100 e 1)", async () => {
    await montarCom(101);

    await act(async () => {
      await centro().markOrderAsRead("ped-1");
    });

    expect(bancoFalso.tamanhosDosLotes).toEqual([100, 1]);
    expect(centro().unreadCount).toBe(0);
  });

  it("abrir o pedido: exatamente 100 avisos dele saem em UM pedido de 100 ids", async () => {
    await montarCom(100);

    await act(async () => {
      await centro().markOrderAsRead("ped-1");
    });

    expect(bancoFalso.tamanhosDosLotes).toEqual([100]);
    expect(centro().unreadCount).toBe(0);
  });

  it("abrir o pedido: o aviso dele que JA estava lido nao entra no UPDATE", async () => {
    await montarCom(5, [1, 3]);

    await act(async () => {
      await centro().markOrderAsRead("ped-1");
    });

    expect(bancoFalso.idsDosLotes).toEqual([["n0000", "n0002", "n0004"]]);
  });

  it("marcar todas: o UPDATE vai amarrado a dona e so ao que estava nao lido", async () => {
    await montarCom(3);

    await act(async () => {
      await centro().markAllAsRead();
    });

    expect(bancoFalso.filtrosDosUpdates).toEqual([
      [
        ["eq", "usuario_id", DONA.id],
        ["eq", "lida", false],
      ],
    ]);
  });

  it("abrir o pedido: o UPDATE vai amarrado a dona, ao nao lido e ao pedido", async () => {
    await montarCom(3);

    await act(async () => {
      await centro().markOrderAsRead("ped-1");
    });

    expect(bancoFalso.filtrosDosUpdates).toEqual([
      [
        ["eq", "usuario_id", DONA.id],
        ["eq", "lida", false],
        ["contains", "dados", { order_id: "ped-1" }],
      ],
    ]);
  });

  it("abrir o pedido: aviso de CAMPANHA do mesmo order_id nao entra no UPDATE (a linha nao e dela)", async () => {
    bancoFalso.campanha = [
      {
        id: "campanha-do-pedido",
        usuario_id: null,
        titulo: "Campanha",
        mensagem: "Para todos",
        tipo: "campaign",
        lida: false,
        created_at: new Date(Date.UTC(2026, 10, 24, 9, 0, 0)).toISOString(),
        acao: null,
        dados: { order_id: "ped-1" },
      },
    ];
    // O relogio fica perto das linhas: a campanha so vale nos ultimos 30 dias.
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 10, 24, 12, 0, 0));
    await montarCom(2);
    expect(centro().notifications.map((n) => n.id)).toContain(
      "campanha-do-pedido",
    );

    await act(async () => {
      await centro().markOrderAsRead("ped-1");
    });

    expect(bancoFalso.idsDosLotes).toEqual([["n0000", "n0001"]]);
  });

  it("abrir o pedido duas vezes seguidas (antes de a primeira gravar): um UPDATE so", async () => {
    await montarCom(3);

    await act(async () => {
      await Promise.all([
        centro().markOrderAsRead("ped-1"),
        centro().markOrderAsRead("ped-1"),
      ]);
    });

    expect(bancoFalso.idsDosLotes).toHaveLength(1);
    expect(centro().unreadCount).toBe(0);
  });
});
