// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
let admin = true;
let evento: ((payload: unknown) => Promise<void>) | undefined;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    channel: () => {
      const canal: any = {
        on: (_tipo: string, _filtro: unknown, handler: typeof evento) => {
          evento = handler;
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "usuario-c2" }, isAdmin: admin }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
import { useOrders } from "@/hooks/useOrders";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(
  id: string,
  status = "pending",
  updated_at = "2026-10-16T10:00:00Z",
) {
  return {
    id,
    status,
    updated_at,
    created_at: "2026-10-16T09:00:00Z",
    user_id: "usuario-c2",
    customer_name: "Cliente Teste",
    items: [],
    payment_method: "cash",
    payment_status: null,
  };
}
type Resposta = { data: unknown; error: unknown };
function adiada() {
  let concluir!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    concluir = resolve;
  });
  return { promessa, concluir };
}
function pagina(linhas: ReturnType<typeof linha>[]): Resposta {
  return { data: { data: linhas, total_count: linhas.length }, error: null };
}

let atuais: ReturnType<typeof useOrders>;
let consulta: () => Promise<Resposta>;
let gravacao: () => Promise<Resposta>;
let linhas = [linha("A"), linha("B")];
function Sonda() {
  const retorno = useOrders(true, admin);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}
async function emitir(eventType: string, novaLinha: ReturnType<typeof linha>) {
  expect(evento).toBeDefined();
  await act(async () => {
    await evento!({ eventType, new: novaLinha, old: {} });
  });
}
async function carregar(filtro = "all") {
  await act(async () => {
    if (admin) await atuais.loadOrders(0, 12, filtro);
    else await atuais.fetchUserOrders();
  });
}

describe("C2 — concorrência na lista de pedidos", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    admin = true;
    evento = undefined;
    linhas = [linha("A"), linha("B")];
    consulta = async () => pagina(linhas);
    gravacao = async () => ({ data: null, error: null });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      nome === "get_admin_orders_paged"
        ? { abortSignal: () => consulta() }
        : gravacao(),
    );
    from.mockReset();
    from.mockImplementation(() => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        abortSignal: () => consulta(),
        single: () => Promise.resolve({ data: linha("C"), error: null }),
      };
      return builder;
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      // O canal compartilhado só é removido após o debounce de desmonte.
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  async function montar() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
  }

  it("B — falha de A reverte só A e preserva B atualizado e C recém-chegado", async () => {
    // A releitura de status precisa confirmar o status anterior de A.
    from.mockImplementation(() => ({
      select: () => ({
        eq: (_campo: string, id: string) => ({
          single: () => Promise.resolve({ data: linha(id), error: null }),
        }),
      }),
    }));
    await montar();
    await carregar();
    const envio = adiada();
    gravacao = () => envio.promessa;
    let resultado!: Promise<unknown>;
    await act(async () => {
      resultado = atuais
        .updateOrderStatus("A", "processing")
        .catch((erro: unknown) => erro);
    });
    expect(atuais.orders.find((o) => o.id === "A")?.status).toBe("processing");
    await emitir("UPDATE", linha("B", "shipping", "2026-10-16T10:02:00Z"));
    await emitir("INSERT", linha("C"));
    expect(atuais.orders.map((o) => o.id)).toContain("C");
    await act(async () => {
      envio.concluir({ data: null, error: new Error("Falha simulada") });
      await resultado;
    });
    expect(atuais.orders.find((o) => o.id === "A")?.status).toBe("pending");
    expect(atuais.orders.find((o) => o.id === "B")?.status).toBe("shipping");
    expect(atuais.orders.map((o) => o.id)).toContain("C");
  });

  it.each([true, false])(
    "C — consulta lenta preserva realtime mais recente (admin=%s)",
    async (modoAdmin) => {
      admin = modoAdmin;
      if (!admin) consulta = async () => ({ data: linhas, error: null });
      await montar();
      await carregar();
      const leitura = adiada();
      consulta = () => leitura.promessa;
      let resultado!: Promise<unknown>;
      await act(async () => {
        resultado = admin
          ? atuais.loadOrders(0, 12, "all")
          : atuais.fetchUserOrders();
      });
      await emitir("UPDATE", linha("A", "shipping", "2026-10-16T10:02:00Z"));
      await emitir("INSERT", linha("C"));
      await act(async () => {
        leitura.concluir(
          admin ? pagina(linhas) : { data: linhas, error: null },
        );
        await resultado;
      });
      expect(atuais.orders.find((o) => o.id === "A")?.status).toBe("shipping");
      expect(atuais.orders.map((o) => o.id)).toContain("C");
    },
  );

  it.each(["2026-10-16T10:00:00Z", "2026-10-16T10:03:00Z"])(
    "C — a resposta substitui o item se updatedAt é igual ou posterior (%s)",
    async (data) => {
      // Id próprio: o cache de módulo do admin sobrevive entre testes e traria
      // o "A" já adiantado pelo realtime de um teste anterior.
      const id = `P-${data}`;
      await montar();
      await carregar();
      linhas = [linha(id, "processing", data)];
      await carregar();
      expect(atuais.orders.find((o) => o.id === id)?.status).toBe("processing");
    },
  );

  it.each(["pending", "open"])(
    "D — UPDATE remove quem sai de %s e recarrega quem entra",
    async (filtro) => {
      linhas = [linha("A")];
      await montar();
      await carregar(filtro);
      rpc.mockClear();
      await emitir(
        "UPDATE",
        linha("A", filtro === "open" ? "delivered" : "shipping"),
      );
      expect(atuais.orders.map((o) => o.id)).not.toContain("A");
      linhas = [linha("B")];
      await emitir("UPDATE", linha("B"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(401);
      });
      expect(atuais.orders.map((o) => o.id)).toEqual(["B"]);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith(
        "get_admin_orders_paged",
        expect.objectContaining({
          p_status: filtro,
          p_page: 0,
          p_page_size: 12,
        }),
      );
    },
  );
});
