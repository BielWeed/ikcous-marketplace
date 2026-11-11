// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
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
  updates: 0,
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
      const mutacao = {
        in: () => mutacao,
        eq: () => mutacao,
        contains: () => rede.mutacao,
      };
      return {
        select: () => consulta,
        update: () => {
          rede.updates++;
          return mutacao;
        },
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

// Uma referência temporal só, com ordem estável e campanha dentro dos 30 dias.
const AGORA = Date.now();
function aviso(id: string, usuario: string | null) {
  return {
    id,
    usuario_id: usuario,
    titulo: id,
    mensagem: "Seu pedido foi atualizado.",
    tipo: "system",
    lida: false,
    created_at: new Date(
      AGORA - (usuario ? 86_400_000 : 86_460_000),
    ).toISOString(),
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

describe("notificações — marcar o pedido de A não trava a lista de B", () => {
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
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    rede.user = { id: "cliente-a" };
    rede.respostas = new Map([
      ["cliente-a", { data: [aviso("aviso-a", "cliente-a")], error: null }],
      ["cliente-b", { data: [aviso("aviso-b", "cliente-b")], error: null }],
    ]);
    rede.campanhas = [aviso("campanha", null)];
    rede.consulta = null;
    rede.mutacao = Promise.resolve({ error: null });
    rede.updates = 0;
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

  it("a conclusão do UPDATE de A não invalida a busca pendente de B", async () => {
    const bancoDeA = pendente<ResultadoMutacao>();
    rede.mutacao = bancoDeA.promessa;
    const centroDeA = espelho.atual!;
    let acao: Promise<void> | undefined;
    await act(async () => {
      acao = centroDeA.markOrderAsRead!("pedido-cliente-a");
    });
    // Controle: a ação entrou no UPDATE, não saiu antes por falta de aviso.
    expect(rede.updates).toBe(1);

    const consultaDeB = pendente<ResultadoConsulta>();
    rede.consulta = consultaDeB.promessa;
    const buscasAntes = rede.buscasDosProprios;
    rede.user = { id: "cliente-b" };
    await renderizar();
    expect(rede.buscasDosProprios).toBe(buscasAntes + 1);
    expect(espelho.atual!.loading).toBe(true);

    // A termina enquanto B ainda espera o banco. Sem a guarda de dona da
    // operação, invalidarConsultasEmVoo descarta justamente essa resposta de B.
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
});
