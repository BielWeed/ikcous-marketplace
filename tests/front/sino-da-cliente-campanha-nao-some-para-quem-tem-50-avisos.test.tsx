// @vitest-environment jsdom
//
// Laudo 0109 (A9): a consulta do sino do cliente misturava avisos próprios
// com campanha (`usuario_id` nulo) num ÚNICO `.limit(50)` por created_at.
// Cada mudança de status insere um aviso e não existe retenção em lugar
// nenhum: cliente frequente chega em 50 avisos próprios e a campanha que o
// lojista mandou "para todos" NUNCA aparece para ela — nem no contador de
// não lidas. O lojista não tem como saber.
//
// O conserto divide a consulta em duas pontas em paralelo, cada uma com o
// seu limite, e mescla por created_at. Este teste monta o provider real com
// o banco dublê: 50 avisos próprios + 1 campanha, e a campanha tem que
// APARECER — contra o HEAD ela era cortada pelo limite único.
//
// Molde de montagem: tests/front/notificacoes-acao-que-falha-avisa-a-cliente
// .test.tsx (provider real + sonda com useNotificationCenter; IDENTIDADES
// estáveis nos mocks para o efeito de carga não entrar em laço).
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import type { Notification } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const usuarioDeTeste = { user: { id: "cliente-sino-50" } };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => usuarioDeTeste,
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

// O `.from()` é chamado DUAS vezes em paralelo (Promise.all): 1ª ponta =
// avisos próprios (.eq usuario_id), 2ª = campanha (.is usuario_id null). A
// fila abaixo devolve o builder certo para cada chamada, na ordem; os
// builders usados ficam registrados para as asserções de filtro.
type Linha = Record<string, unknown>;
let filaDeConsultas: { builder: Record<string, unknown> }[] = [];
let buildersUsados: {
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}[] = [];

function builderDeConsulta(linhas: Linha[]) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({ data: linhas, error: null })),
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const builder = filaDeConsultas.shift()!.builder;
      buildersUsados.push(builder as never);
      return builder;
    },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

function avisoProprio(i: number): Linha {
  return {
    id: `proprio-${i}`,
    usuario_id: "cliente-sino-50",
    titulo: "Pedido atualizado",
    mensagem: "Seu pedido saiu para entrega.",
    tipo: "order",
    lida: false,
    created_at: new Date(2026, 7, 1, 0, i).toISOString(),
  };
}

const campanha: Linha = {
  id: "campanha-1",
  usuario_id: null,
  titulo: "Frete grátis hoje",
  mensagem: "Hoje o frete é por nossa conta.",
  tipo: "campaign",
  lida: false,
  // MAIS NOVA que os 50 avisos próprios: no código antigo era a primeira
  // vítima do `.limit(50)` único.
  created_at: new Date(2026, 7, 2, 12, 0).toISOString(),
};

beforeEach(() => {
  buildersUsados = [];
  const proprias = Array.from({ length: 50 }, (_, i) => avisoProprio(i));
  filaDeConsultas = [
    { builder: builderDeConsulta(proprias) },
    { builder: builderDeConsulta([campanha]) },
  ];
});

afterEach(() => {
  filaDeConsultas = [];
});

describe("sino da cliente — campanha fora do limite dos avisos próprios", () => {
  it("cliente com 50 avisos próprios ainda recebe a campanha", async () => {
    let capturadas: Notification[] | null = null;
    function Sonda() {
      const { notifications } = useNotificationCenter();
      useEffect(() => {
        capturadas = notifications;
      }, [notifications]);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <NotificationProvider>
          <Sonda />
        </NotificationProvider>,
      );
    });
    await act(async () => {});
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(capturadas).not.toBeNull();
    expect(capturadas!.length).toBe(51);
    const ids = capturadas!.map((n) => n.id);
    expect(ids).toContain("campanha-1");
    // E a campanha, sendo a mais nova, encabeça a lista por created_at.
    expect(ids[0]).toBe("campanha-1");

    act(() => root.unmount());
    container.remove();
  });

  it("as duas pontas consultam com filtros próprios — não mais o `.or` único", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <NotificationProvider>
          <div />
        </NotificationProvider>,
      );
    });
    await act(async () => {});
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const [propria, deCampanha] = buildersUsados;
    expect(propria.eq).toHaveBeenCalledWith("usuario_id", "cliente-sino-50");
    expect(propria.limit).toHaveBeenCalledWith(50);
    expect(deCampanha.is).toHaveBeenCalledWith("usuario_id", null);
    expect(deCampanha.limit).toHaveBeenCalledWith(20);
    expect(propria.or).not.toHaveBeenCalled();
    expect(deCampanha.or).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
