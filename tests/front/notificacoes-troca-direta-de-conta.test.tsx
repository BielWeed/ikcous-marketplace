// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ResultadoConsulta = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

const rede = vi.hoisted(() => ({
  user: { id: "cliente-a" },
  respostas: new Map<string, ResultadoConsulta>(),
  campanhas: [] as Record<string, unknown>[],
  consulta: null as Promise<ResultadoConsulta> | null,
  mutacao: Promise.resolve({ error: null }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: rede.user }) }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let usuarioId = "";
      let campanha = false;
      const consulta = {
        eq: (_campo: string, valor: string) => {
          usuarioId = valor;
          return consulta;
        },
        is: () => {
          campanha = true;
          return consulta;
        },
        order: () => consulta,
        limit: () => {
          if (campanha) {
            return Promise.resolve({ data: rede.campanhas, error: null });
          }
          const pendente = rede.consulta;
          rede.consulta = null;
          return (
            pendente ??
            Promise.resolve(
              rede.respostas.get(usuarioId) ?? { data: [], error: null },
            )
          );
        },
      };
      const mutacao = Object.assign(rede.mutacao, { eq: () => mutacao });
      return {
        select: () => consulta,
        update: () => mutacao,
      };
    },
  },
}));

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

function aviso(id: string, usuario: string | null) {
  return {
    id,
    usuario_id: usuario,
    titulo: id,
    mensagem: "Seu pedido foi atualizado.",
    tipo: "system",
    lida: false,
    created_at: "2026-10-16T10:00:00Z",
    dados: usuario ? { order_id: `pedido-${usuario}` } : null,
  };
}

const espelho: { atual: ReturnType<typeof useNotificationCenter> | null } = {
  atual: null,
};
const quadros: {
  dono: string;
  ids: string[];
  naoLidas: number;
  loading: boolean;
  erro: string | null;
}[] = [];
function Sonda() {
  const contexto = useNotificationCenter();
  quadros.push({
    dono: rede.user?.id ?? "",
    ids: contexto.notifications.map((n) => n.id),
    naoLidas: contexto.unreadCount,
    loading: contexto.loading,
    erro: contexto.erro,
  });
  useEffect(() => {
    espelho.atual = contexto;
  });
  return null;
}

describe("notificações — troca direta de conta não mistura dados", () => {
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

  beforeEach(async () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        close() {}
      },
    );
    const armazenamento = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazenamento.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazenamento.set(chave, valor);
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    rede.user = { id: "cliente-a" };
    rede.respostas = new Map([
      ["cliente-a", { data: [aviso("aviso-a", "cliente-a")], error: null }],
      ["cliente-b", { data: [aviso("aviso-b", "cliente-b")], error: null }],
    ]);
    rede.campanhas = [aviso("campanha", null)];
    rede.consulta = null;
    rede.mutacao = Promise.resolve({ error: null });
    espelho.atual = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await renderizar();
    expect(espelho.atual!.notifications.map((n) => n.id)).toEqual([
      "aviso-a",
      "campanha",
    ]);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("remove os dados de A antes da consulta de B e mantém a lista vazia se B falhar", async () => {
    const consultaDeB = pendente<ResultadoConsulta>();
    rede.consulta = consultaDeB.promessa;
    quadros.length = 0;
    rede.user = { id: "cliente-b" };
    await renderizar();

    // Nenhuma renderização de B (nem o primeiro quadro) expõe o aviso de A.
    const quadrosDeB = quadros.filter((q) => q.dono === "cliente-b");
    expect(quadrosDeB.length).toBeGreaterThan(0);
    for (const quadro of quadrosDeB) {
      expect(quadro.ids).not.toContain("aviso-a");
      expect(quadro.naoLidas).toBe(0);
      // Nem o primeiro quadro de B anuncia "Tudo em ordem": ele já está carregando.
      expect(quadro.loading).toBe(true);
    }

    expect(espelho.atual!.loading).toBe(true);
    expect(espelho.atual!.notifications).toEqual([]);
    expect(espelho.atual!.unreadCount).toBe(0);
    expect(espelho.atual!.erro).toBeNull();

    await act(async () => {
      consultaDeB.resolver({ data: null, error: { message: "Sem conexão" } });
    });

    expect(espelho.atual!.notifications).toEqual([]);
    expect(espelho.atual!.loading).toBe(false);
    expect(espelho.atual!.erro).toBe(
      "Não conseguimos carregar suas notificações.",
    );
  });

  it("mostra só os avisos de B quando a consulta da nova conta dá certo", async () => {
    const consultaDeB = pendente<ResultadoConsulta>();
    rede.consulta = consultaDeB.promessa;
    rede.user = { id: "cliente-b" };
    await renderizar();
    expect(espelho.atual!.notifications).toEqual([]);

    await act(async () => {
      consultaDeB.resolver(rede.respostas.get("cliente-b")!);
    });

    expect(espelho.atual!.notifications.map((n) => n.id)).toEqual([
      "aviso-b",
      "campanha",
    ]);
    expect(espelho.atual!.notifications[0].order_id).toBe("pedido-cliente-b");
    expect(espelho.atual!.loading).toBe(false);
    expect(espelho.atual!.erro).toBeNull();
  });

  it("a resposta atrasada de marcar todas em A não marca nem a campanha compartilhada de B", async () => {
    const updateDeA = pendente<{ error: null }>();
    rede.mutacao = updateDeA.promessa;
    let acao: Promise<void> | undefined;
    await act(async () => {
      acao = espelho.atual!.markAllAsRead();
    });

    rede.user = { id: "cliente-b" };
    await renderizar();
    const avisosDeB = espelho.atual!.notifications;
    expect(avisosDeB.map((n) => n.id)).toEqual(["aviso-b", "campanha"]);
    expect(espelho.atual!.unreadCount).toBe(2);

    await act(async () => {
      updateDeA.resolver({ error: null });
      await acao;
    });

    expect(espelho.atual!.notifications).toBe(avisosDeB);
    expect(espelho.atual!.notifications.every((n) => !n.read)).toBe(true);
    expect(espelho.atual!.unreadCount).toBe(2);
    expect(espelho.atual!.loading).toBe(false);
    expect(
      localStorage.getItem("notificacoes-campanha-estado:cliente-b"),
    ).toBeNull();
    // O gesto foi de A: a leitura da campanha fica gravada na chave de A.
    expect(
      JSON.parse(
        localStorage.getItem("notificacoes-campanha-estado:cliente-a")!,
      ),
    ).toEqual({ lidas: ["campanha"], ocultas: [] });
  });

  it("a mesma conta mantém a lista enquanto recarrega e continua podendo marcar todas", async () => {
    const consulta = pendente<ResultadoConsulta>();
    rede.consulta = consulta.promessa;
    const avisosAntes = espelho.atual!.notifications;
    let busca: Promise<void> | undefined;
    await act(async () => {
      busca = espelho.atual!.refresh();
    });

    expect(espelho.atual!.loading).toBe(true);
    expect(espelho.atual!.notifications).toBe(avisosAntes);
    await act(async () => {
      consulta.resolver(rede.respostas.get("cliente-a")!);
      await busca;
    });
    expect(espelho.atual!.loading).toBe(false);
    expect(espelho.atual!.unreadCount).toBe(2);

    await act(async () => {
      await espelho.atual!.markAllAsRead();
    });
    expect(espelho.atual!.unreadCount).toBe(0);
    expect(espelho.atual!.notifications.every((n) => n.read)).toBe(true);
    expect(
      JSON.parse(
        localStorage.getItem("notificacoes-campanha-estado:cliente-a")!,
      ),
    ).toEqual({ lidas: ["campanha"], ocultas: [] });
  });

  it("um objeto de sessão novo com o mesmo id também preserva a lista durante a busca", async () => {
    const consulta = pendente<ResultadoConsulta>();
    rede.consulta = consulta.promessa;
    const avisosAntes = espelho.atual!.notifications;
    rede.user = { id: "cliente-a" };
    await renderizar();

    expect(espelho.atual!.loading).toBe(true);
    expect(espelho.atual!.notifications).toBe(avisosAntes);
    await act(async () => {
      consulta.resolver(rede.respostas.get("cliente-a")!);
    });
    expect(espelho.atual!.loading).toBe(false);
    expect(espelho.atual!.unreadCount).toBe(2);
  });

  it("limpa o erro de A antes de a consulta pendente de B responder", async () => {
    rede.respostas.set("cliente-a", {
      data: null,
      error: { message: "Sem conexão" },
    });
    await act(async () => {
      await espelho.atual!.refresh();
    });
    expect(espelho.atual!.erro).toBe(
      "Não conseguimos carregar suas notificações.",
    );

    const consultaDeB = pendente<ResultadoConsulta>();
    rede.consulta = consultaDeB.promessa;
    quadros.length = 0;
    rede.user = { id: "cliente-b" };
    await renderizar();

    // O erro de A não aparece para B nem no primeiro quadro.
    const quadrosDeB = quadros.filter((q) => q.dono === "cliente-b");
    expect(quadrosDeB.length).toBeGreaterThan(0);
    for (const quadro of quadrosDeB) {
      expect(quadro.erro).toBeNull();
    }
    expect(espelho.atual!.notifications).toEqual([]);
    expect(espelho.atual!.erro).toBeNull();
    expect(espelho.atual!.loading).toBe(true);
    await act(async () => {
      consultaDeB.resolver(rede.respostas.get("cliente-b")!);
    });
    expect(espelho.atual!.erro).toBeNull();
  });
});
