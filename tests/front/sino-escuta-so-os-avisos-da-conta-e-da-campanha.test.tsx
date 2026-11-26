// @vitest-environment jsdom
//
// Loja grande (50 mil pedidos): o canal ao vivo do sino escutava a tabela
// `notificacoes` INTEIRA, sem filtro. Para a cliente, a RLS já barrava a
// linha alheia, mas o servidor conferia cada mudança contra cada aparelho
// conectado; para a lojista (a RLS deixa o admin ler tudo), CADA aviso de
// QUALQUER cliente acordava todos os aparelhos dela numa releitura que nem
// mostrava aquele aviso (a lista do sino só traz os dela e a campanha).
//
// O canal tem de escutar exatamente o que o sino mostra: as linhas da conta
// (`usuario_id = <id>`) e as de campanha (`usuario_id IS NULL`), cada uma
// com o seu filtro de UMA condição, e as duas relendo a lista.
import { NotificationProvider } from "@/contexts/NotificationContext";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/hooks/useAuth", () => {
  const sessao = { user: { id: "cliente-1" } };
  return { useAuth: () => sessao };
});

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

type Escuta = {
  evento: string;
  opcoes: {
    event?: string;
    schema?: string;
    table?: string;
    filter?: string;
  };
  aoMudar: () => void;
};

const h = vi.hoisted(() => ({
  consultas: 0,
  escutas: [] as Escuta[],
}));

function builder() {
  const b = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(async () => ({ data: [], error: null })),
  };
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      h.consultas += 1;
      return builder();
    },
    channel: () => {
      const canal = {
        on: (evento: string, opcoes: Escuta["opcoes"], aoMudar: () => void) => {
          h.escutas.push({ evento, opcoes, aoMudar });
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("sino: o canal ao vivo escuta só os avisos da conta e a campanha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.consultas = 0;
    h.escutas = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage: unknown = null;
        postMessage() {}
        close() {}
      },
    );
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
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <span />
        </NotificationProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  it("nenhuma escuta da tabela fica sem filtro", async () => {
    await montar();
    const daTabela = h.escutas.filter(
      (e) =>
        e.evento === "postgres_changes" && e.opcoes.table === "notificacoes",
    );
    expect(daTabela.length).toBeGreaterThan(0);
    for (const escuta of daTabela) {
      expect(escuta.opcoes.filter).toBeTruthy();
    }
  });

  it("escuta as linhas da conta e as de campanha, todos os eventos", async () => {
    await montar();
    const daTabela = h.escutas.filter(
      (e) =>
        e.evento === "postgres_changes" && e.opcoes.table === "notificacoes",
    );
    expect(daTabela.map((e) => e.opcoes.filter).sort()).toEqual([
      "usuario_id=eq.cliente-1",
      "usuario_id=is.null",
    ]);
    for (const escuta of daTabela) {
      expect(escuta.opcoes.event).toBe("*");
      expect(escuta.opcoes.schema).toBe("public");
    }
  });

  it("aviso de campanha ao vivo também relê a lista", async () => {
    await montar();
    const daCampanha = h.escutas.find(
      (e) => e.opcoes.filter === "usuario_id=is.null",
    );
    expect(daCampanha).toBeDefined();
    const antes = h.consultas;

    await act(async () => {
      daCampanha?.aoMudar();
      await new Promise((r) => setTimeout(r, 900));
    });

    // Uma releitura = as duas consultas (avisos da conta + campanha).
    expect(h.consultas - antes).toBe(2);
  });
});
