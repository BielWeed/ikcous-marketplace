// @vitest-environment jsdom
//
// A campanha "para todos" é uma linha sem dono (usuario_id nulo). Sem filtro
// de data, cliente NOVA abria o app e via até 20 campanhas antigas como "não
// lidas" (cupom vencido incluso), e o contador as contava. Vale só a campanha
// criada DEPOIS da conta e dentro dos últimos 30 dias.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const DIA = 24 * 60 * 60 * 1000;
const atras = (dias: number) => new Date(Date.now() - dias * DIA).toISOString();

const usuario: {
  user: { id: string; created_at: string } | null;
  loading?: boolean;
} = {
  user: { id: "cliente-nova", created_at: atras(0.1) },
};
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => usuario }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

type Linha = Record<string, unknown>;
let fila: Linha[][] = [];

function builder(linhas: Linha[]) {
  const b = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(async () => ({ data: linhas, error: null })),
  };
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => builder(fila.shift()!),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const campanha = (id: string, criada: string): Linha => ({
  id,
  usuario_id: null,
  titulo: id,
  mensagem: "x",
  tipo: "campaign",
  lida: false,
  created_at: criada,
});

async function montar() {
  let capturado: {
    ids: string[];
    naoLidas: number;
    semConta?: boolean;
  } | null = null;
  function Sonda() {
    const { notifications, unreadCount, semConta } = useNotificationCenter();
    useEffect(() => {
      capturado = {
        ids: notifications.map((n) => n.id),
        naoLidas: unreadCount,
        semConta,
      };
    }, [notifications, unreadCount, semConta]);
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const resultado = capturado!;
  act(() => root.unmount());
  container.remove();
  return resultado;
}

beforeEach(() => {
  usuario.user = { id: "cliente-nova", created_at: atras(0.1) };
  usuario.loading = false;
});
afterEach(() => {
  fila = [];
  localStorage.clear();
});

describe("sino da cliente nova — campanha velha", () => {
  it("campanha de 40 dias atrás não aparece na lista nem no contador", async () => {
    usuario.user = { id: "cliente-nova", created_at: atras(90) };
    fila = [[], [campanha("velha", atras(40))]];
    const r = await montar();
    expect(r.ids).toEqual([]);
    expect(r.naoLidas).toBe(0);
  });

  it("campanha de ontem aparece (conta antiga)", async () => {
    usuario.user = { id: "cliente-nova", created_at: atras(90) };
    fila = [[], [campanha("ontem", atras(1))]];
    const r = await montar();
    expect(r.ids).toEqual(["ontem"]);
    expect(r.naoLidas).toBe(1);
  });

  it("campanha anterior à criação da conta não aparece, mesmo dentro de 30 dias", async () => {
    usuario.user = { id: "cliente-nova", created_at: atras(2) };
    fila = [
      [],
      [campanha("antes-da-conta", atras(5)), campanha("depois", atras(1))],
    ];
    const r = await montar();
    expect(r.ids).toEqual(["depois"]);
    expect(r.naoLidas).toBe(1);
  });

  it("sem conta: o contexto diz semConta (e com conta, nao)", async () => {
    fila = [[], []];
    expect((await montar()).semConta).toBe(false);
    usuario.user = null;
    expect((await montar()).semConta).toBe(true);
    usuario.loading = true;
    expect((await montar()).semConta).toBe(false);
  });
});
