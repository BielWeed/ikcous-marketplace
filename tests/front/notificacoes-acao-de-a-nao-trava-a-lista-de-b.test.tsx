// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ResultadoConsulta = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};
type ResultadoMutacao = { error: { message: string } | null };

const rede = vi.hoisted(() => ({
  user: { id: "cliente-a" },
  respostas: new Map<string, ResultadoConsulta>(),
  campanhas: [] as Record<string, unknown>[],
  consulta: null as Promise<ResultadoConsulta> | null,
  mutacao: Promise.resolve({ error: null }) as Promise<ResultadoMutacao>,
  buscasDosProprios: 0,
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
          rede.buscasDosProprios++;
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
        delete: () => mutacao,
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

function aviso(id: string, usuario: string | null, lida = false) {
  return {
    id,
    usuario_id: usuario,
    titulo: id,
    mensagem: "Seu pedido foi atualizado.",
    tipo: "system",
    lida,
    // Relativa: a campanha so vale por 30 dias para quem criou a conta antes.
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    dados: usuario ? { order_id: `pedido-${usuario}` } : null,
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

// As duas ações que esperam o banco antes de mexer na tela.
const acoes = [
  {
    nome: "markAsRead",
    rodar: (c: ReturnType<typeof useNotificationCenter>, id: string) =>
      c.markAsRead(id),
  },
  {
    nome: "deleteNotification",
    rodar: (c: ReturnType<typeof useNotificationCenter>, id: string) =>
      c.deleteNotification(id),
  },
] as const;

describe("notificações — a resposta atrasada de uma ação de A não mexe em B", () => {
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
    vi.mocked(toast.error).mockClear();
    rede.user = { id: "cliente-a" };
    rede.respostas = new Map([
      ["cliente-a", { data: [aviso("aviso-a", "cliente-a")], error: null }],
      ["cliente-b", { data: [aviso("aviso-b", "cliente-b")], error: null }],
    ]);
    rede.campanhas = [aviso("campanha", null)];
    rede.consulta = null;
    rede.mutacao = Promise.resolve({ error: null });
    rede.buscasDosProprios = 0;
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

  describe.each(acoes)("$nome", ({ rodar }) => {
    it("a resposta de A, chegando com a busca de B no ar, não deixa a lista de B vazia nem carregando", async () => {
      const bancoDeA = pendente<ResultadoMutacao>();
      rede.mutacao = bancoDeA.promessa;
      // A função de A, guardada antes da troca: é a que ficou esperando o banco.
      const centroDeA = espelho.atual!;
      let acao: Promise<void> | undefined;
      await act(async () => {
        acao = rodar(centroDeA, "aviso-a");
      });

      const consultaDeB = pendente<ResultadoConsulta>();
      rede.consulta = consultaDeB.promessa;
      rede.user = { id: "cliente-b" };
      await renderizar();
      expect(espelho.atual!.loading).toBe(true);

      // A resposta de A chega por último, com a busca de B ainda no ar.
      await act(async () => {
        bancoDeA.resolver({ error: null });
        await acao;
      });
      await act(async () => {
        consultaDeB.resolver(rede.respostas.get("cliente-b")!);
      });

      expect(espelho.atual!.notifications.map((n) => n.id)).toEqual([
        "aviso-b",
        "campanha",
      ]);
      expect(espelho.atual!.unreadCount).toBe(2);
      expect(espelho.atual!.loading).toBe(false);
      expect(espelho.atual!.erro).toBeNull();
    });

    it("a falha de A depois da troca não mostra o aviso de erro de A para B", async () => {
      const bancoDeA = pendente<ResultadoMutacao>();
      rede.mutacao = bancoDeA.promessa;
      const centroDeA = espelho.atual!;
      let acao: Promise<void> | undefined;
      await act(async () => {
        acao = rodar(centroDeA, "aviso-a");
      });

      rede.user = { id: "cliente-b" };
      await renderizar();
      expect(espelho.atual!.notifications.map((n) => n.id)).toEqual([
        "aviso-b",
        "campanha",
      ]);

      await act(async () => {
        bancoDeA.resolver({ error: { message: "Sem conexão" } });
        await acao;
      });

      expect(toast.error).not.toHaveBeenCalled();
      expect(espelho.atual!.notifications.map((n) => n.id)).toEqual([
        "aviso-b",
        "campanha",
      ]);
      expect(espelho.atual!.loading).toBe(false);
    });

    it("controle: sem troca de conta, a falha continua avisando quem tocou", async () => {
      const bancoDeA = pendente<ResultadoMutacao>();
      rede.mutacao = bancoDeA.promessa;
      let acao: Promise<void> | undefined;
      await act(async () => {
        acao = rodar(espelho.atual!, "aviso-a");
      });
      await act(async () => {
        bancoDeA.resolver({ error: { message: "Sem conexão" } });
        await acao;
      });

      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(espelho.atual!.notifications.map((n) => n.id)).toEqual([
        "aviso-a",
        "campanha",
      ]);
    });
  });

  it("controle: sem troca de conta, marcar como lida invalida a busca que já estava no ar", async () => {
    // Busca anterior à leitura, ainda no ar: traria o aviso como não lido.
    const buscaAntiga = pendente<ResultadoConsulta>();
    rede.consulta = buscaAntiga.promessa;
    let busca: Promise<void> | undefined;
    await act(async () => {
      busca = espelho.atual!.refresh();
    });
    expect(espelho.atual!.loading).toBe(true);

    const bancoDeA = pendente<ResultadoMutacao>();
    rede.mutacao = bancoDeA.promessa;
    let acao: Promise<void> | undefined;
    await act(async () => {
      acao = espelho.atual!.markAsRead("aviso-a");
    });

    // O banco, depois da leitura, devolve o aviso como lido.
    rede.respostas.set("cliente-a", {
      data: [aviso("aviso-a", "cliente-a", true)],
      error: null,
    });
    const buscasAntes = rede.buscasDosProprios;
    await act(async () => {
      bancoDeA.resolver({ error: null });
      await acao;
    });
    // A leitura reconcilia com uma busca nova.
    expect(rede.buscasDosProprios).toBe(buscasAntes + 1);
    expect(espelho.atual!.loading).toBe(false);

    // A resposta velha chega depois e é descartada: o aviso não volta a não lido.
    await act(async () => {
      buscaAntiga.resolver({
        data: [aviso("aviso-a", "cliente-a", false)],
        error: null,
      });
      await busca;
    });
    const avisoDeA = espelho.atual!.notifications.find(
      (n) => n.id === "aviso-a",
    );
    expect(avisoDeA?.read).toBe(true);
    expect(espelho.atual!.unreadCount).toBe(1);
    expect(espelho.atual!.loading).toBe(false);
  });

  it("controle: sem troca de conta, excluir tira o aviso e invalida a busca que estava no ar", async () => {
    const buscaAntiga = pendente<ResultadoConsulta>();
    rede.consulta = buscaAntiga.promessa;
    let busca: Promise<void> | undefined;
    await act(async () => {
      busca = espelho.atual!.refresh();
    });

    const bancoDeA = pendente<ResultadoMutacao>();
    rede.mutacao = bancoDeA.promessa;
    let acao: Promise<void> | undefined;
    await act(async () => {
      acao = espelho.atual!.deleteNotification("aviso-a");
    });

    rede.respostas.set("cliente-a", { data: [], error: null });
    const buscasAntes = rede.buscasDosProprios;
    await act(async () => {
      bancoDeA.resolver({ error: null });
      await acao;
    });
    expect(rede.buscasDosProprios).toBe(buscasAntes + 1);

    // A resposta velha ainda traria o aviso apagado: é descartada.
    await act(async () => {
      buscaAntiga.resolver({
        data: [aviso("aviso-a", "cliente-a", false)],
        error: null,
      });
      await busca;
    });
    expect(espelho.atual!.notifications.map((n) => n.id)).toEqual(["campanha"]);
    expect(espelho.atual!.loading).toBe(false);
  });
});
