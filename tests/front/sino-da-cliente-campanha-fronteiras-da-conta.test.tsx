// @vitest-environment jsdom
//
// A campanha "para todos" (linha sem dono) so vale para quem ja existia quando
// ela saiu. As fronteiras dessa regra nao tinham prova:
//  - campanha criada NO MESMO INSTANTE em que a conta nasceu: vale (a conta
//    ja existia, `>=`). Trocar por `>` escondia a campanha da cliente que
//    acabou de se cadastrar pelo mesmo gatilho que a enviou.
//  - 1 ms ANTES da conta: nao vale (a cliente nunca poderia te-la recebido).
//  - data da campanha ilegivel: nao vale, nem quando a conta tambem nao tem
//    data (sem esta guarda, "ilegivel + ilegivel" virava "vale" e uma linha com
//    data corrompida aparecia como nao lida para sempre).
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const AGORA = new Date("2026-11-24T12:00:00.000Z").getTime();
const DIA = 24 * 60 * 60 * 1000;
const CONTA_NASCEU = new Date(AGORA - 2 * DIA).toISOString();

const usuario: {
  user: { id: string; created_at?: string } | null;
  loading?: boolean;
} = { user: { id: "cliente-1", created_at: CONTA_NASCEU } };
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
    from: () => builder(fila.shift() ?? []),
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
  let capturado: { ids: string[]; naoLidas: number } | null = null;
  function Sonda() {
    const { notifications, unreadCount } = useNotificationCenter();
    useEffect(() => {
      capturado = {
        ids: notifications.map((n) => n.id),
        naoLidas: unreadCount,
      };
    }, [notifications, unreadCount]);
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
  const resultado = capturado as unknown as { ids: string[]; naoLidas: number };
  act(() => root.unmount());
  container.remove();
  return resultado;
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(AGORA);
  usuario.user = { id: "cliente-1", created_at: CONTA_NASCEU };
  usuario.loading = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  fila = [];
  localStorage.clear();
});

describe("sino da cliente — fronteiras da regra da campanha para todos", () => {
  it("campanha criada no mesmo instante da conta vale; 1 ms antes da conta nao vale", async () => {
    const umMsAntes = new Date(Date.parse(CONTA_NASCEU) - 1).toISOString();
    fila = [
      [],
      [
        campanha("no-mesmo-instante", CONTA_NASCEU),
        campanha("um-ms-antes", umMsAntes),
      ],
    ];

    const r = await montar();

    expect(r.ids).toEqual(["no-mesmo-instante"]);
    expect(r.naoLidas).toBe(1);
  });

  it("campanha com data ilegivel nao aparece, nem quando a conta tambem esta sem data", async () => {
    usuario.user = { id: "cliente-1" };
    fila = [
      [],
      [
        campanha("data-quebrada", "isto-nao-e-uma-data"),
        campanha("de-ontem", new Date(AGORA - DIA).toISOString()),
      ],
    ];

    const r = await montar();

    // Conta sem data: a regra de "depois da conta" nao tem como valer, e a
    // campanha de data valida (dentro dos 30 dias) segue aparecendo.
    expect(r.ids).toEqual(["de-ontem"]);
    expect(r.naoLidas).toBe(1);
  });
});
