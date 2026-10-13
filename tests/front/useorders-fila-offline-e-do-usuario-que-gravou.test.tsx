// @vitest-environment jsdom
//
// L10 da auditoria de segurança (12/10/2026) — a fila offline de pedidos
// (`orders_offline_updates_queue`) sobrevivia à saída da conta e era enviada
// com o login de QUEM ESTIVESSE ENTRANDO: tablet de balcão, o admin A grava
// uma mudança de pedido sem rede e sai; o admin B entra; a mudança de A ia
// ao servidor assinada por B.
//
// Desenho (decisão da hub após crítica de desenho): a CHAVE é por usuário —
// `orders_offline_updates_queue:<uid>` —, não um carimbo dentro de uma chave
// compartilhada. Cada passada só enxerga a lista do próprio dono; a fila do
// outro fica intacta até ele voltar. Antes de CADA envio confere-se que a
// sessão ainda é a do dono. Item com mais de 72 h não é enviado. A fila
// ANTIGA (sem `:<uid>`) só migra para a chave de um admin CONFIRMADO.
//
// Mesma sonda dos outros testes de useOrders (sem @testing-library/react).
import { useOrders } from "@/hooks/useOrders";
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, sessao, rpcMock } = vi.hoisted(() => ({
  // O que o CONTEXTO de auth diz (de onde sai o uid de guardar e o de enviar).
  auth: { id: null as string | null, admin: false },
  // O que o cliente Supabase diz AGORA (`getSession`), conferido antes de
  // cada envio. Quase sempre igual a `auth.id`; os testes de troca no meio da
  // passada separam os dois.
  sessao: { id: null as string | null },
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: rpcMock,
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: sessao.id ? { user: { id: sessao.id } } : null },
      })),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            abortSignal: () => Promise.resolve({ data: [], error: null }),
          }),
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "t"),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: auth.id ? { id: auth.id } : null,
    isAdmin: auth.admin,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — padrão do projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "orders_offline_updates_queue";
const chaveDe = (uid: string) => `${BASE}:${uid}`;
const AGORA = new Date("2026-10-13T12:00:00Z").getTime();
const HORA = 60 * 60 * 1000;

const itemDeA = {
  orderId: "pedido-1",
  status: "cancelled",
  silent: false,
  timestamp: AGORA - HORA,
};
const itemDeB = {
  orderId: "pedido-2",
  status: "cancelled",
  silent: false,
  timestamp: AGORA - HORA,
};

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;

function filaDe(uid: string): any[] | null {
  const bruto = armazem.get(chaveDe(uid));
  return bruto === undefined ? null : JSON.parse(bruto);
}

function guardarFila(uid: string, itens: unknown[]) {
  armazem.set(chaveDe(uid), JSON.stringify(itens));
}

/** Entra na conta: o contexto de auth e a sessão do cliente concordam. */
function entrarComo(uid: string | null, admin = false) {
  auth.id = uid;
  auth.admin = admin;
  sessao.id = uid;
}

let atualizarStatus: (
  id: string,
  status: any,
  notes?: string,
  silent?: boolean,
) => Promise<void> = async () => {};
function Sonda() {
  const { updateOrderStatus } = useOrders(false, auth.admin);
  useEffect(() => {
    atualizarStatus = updateOrderStatus as typeof atualizarStatus;
  });
  return null;
}

async function renderizar() {
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

async function reconectar() {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => true,
  });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1000);
  });
}

function pedidosEnviados(): string[] {
  return rpcMock.mock.calls.map(([, args]) => args.p_order_id);
}

describe("fila offline de pedidos — uma chave por usuário", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    entrarComo(null);
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    for (const t of [
      toast.loading,
      toast.success,
      toast.error,
      toast.info,
      toast.warning,
      toast.dismiss,
    ]) {
      vi.mocked(t).mockClear();
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a fila de A NÃO é enviada com a sessão de B e continua intacta; B não ganha fila nenhuma", async () => {
    guardarFila("admin-a", [itemDeA]);
    entrarComo("admin-b");
    await renderizar();
    await reconectar();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(filaDe("admin-a")).toEqual([itemDeA]);
    expect(armazem.has(chaveDe("admin-b"))).toBe(false);
    // Nada de "Sincronizando…" nem de aviso por algo que não é desta sessão.
    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("quando A volta, só o dele é enviado e a fila dele esvazia", async () => {
    guardarFila("admin-a", [itemDeA]);
    entrarComo("admin-b");
    await renderizar();
    await reconectar();
    expect(rpcMock).not.toHaveBeenCalled();

    entrarComo("admin-a");
    await renderizar();
    await reconectar();

    expect(pedidosEnviados()).toEqual(["pedido-1"]);
    expect(armazem.has(chaveDe("admin-a"))).toBe(false);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("as filas de A e de B coexistem: B envia só a dele, sem aviso falso, e a de A fica", async () => {
    guardarFila("admin-a", [itemDeA]);
    guardarFila("admin-b", [itemDeB]);
    entrarComo("admin-b");
    await renderizar();
    await reconectar();

    expect(pedidosEnviados()).toEqual(["pedido-2"]);
    expect(armazem.has(chaveDe("admin-b"))).toBe(false);
    expect(filaDe("admin-a")).toEqual([itemDeA]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("MESMO pedido nas duas filas: enviar o de B não leva o de A junto", async () => {
    const antigoDeA = { ...itemDeA, orderId: "pedido-9" };
    const novoDeB = {
      ...itemDeB,
      orderId: "pedido-9",
      timestamp: AGORA - HORA / 2,
    };
    guardarFila("admin-a", [antigoDeA]);
    guardarFila("admin-b", [novoDeB]);
    entrarComo("admin-b");
    await renderizar();
    await reconectar();

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(filaDe("admin-a")).toEqual([antigoDeA]);
  });

  it("sem sessão (user nulo) nada é enviado e nenhuma fila é tocada", async () => {
    guardarFila("admin-a", [itemDeA]);
    entrarComo(null);
    await renderizar();
    await reconectar();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(filaDe("admin-a")).toEqual([itemDeA]);
  });

  describe("a sessão é conferida antes de CADA envio", () => {
    it("troca de conta no MEIO da passada: o que já saiu sai da fila de A, o resto fica, e nada é gravado na chave de B", async () => {
      const primeiro = { ...itemDeA, orderId: "pedido-a1" };
      const segundo = { ...itemDeA, orderId: "pedido-a2" };
      guardarFila("admin-a", [primeiro, segundo]);
      // A sessão do cliente vira B assim que o primeiro envio acontece.
      rpcMock.mockImplementationOnce(async () => {
        sessao.id = "admin-b";
        return { data: null, error: null };
      });
      entrarComo("admin-a");
      await renderizar();
      await reconectar();

      expect(pedidosEnviados()).toEqual(["pedido-a1"]);
      expect(filaDe("admin-a")).toEqual([segundo]);
      expect(armazem.has(chaveDe("admin-b"))).toBe(false);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("a sessão já é outra quando a passada ia começar: nenhum envio, fila intacta", async () => {
      guardarFila("admin-a", [itemDeA]);
      // O contexto ainda mostra A (a tela não re-renderizou), o cliente já é B.
      auth.id = "admin-a";
      sessao.id = "admin-b";
      await renderizar();
      await reconectar();

      expect(rpcMock).not.toHaveBeenCalled();
      expect(filaDe("admin-a")).toEqual([itemDeA]);
    });
  });

  describe("validade: 72 h", () => {
    it("item velho NÃO é enviado, é descartado com aviso; o recente sai", async () => {
      const velho = {
        ...itemDeA,
        orderId: "pedido-velho",
        timestamp: AGORA - 73 * HORA,
      };
      const recente = { ...itemDeA, orderId: "pedido-novo" };
      guardarFila("admin-a", [velho, recente]);
      entrarComo("admin-a");
      await renderizar();
      await reconectar();

      expect(pedidosEnviados()).toEqual(["pedido-novo"]);
      expect(armazem.has(chaveDe("admin-a"))).toBe(false);
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain(
        "1 alteração offline antiga foi descartada",
      );
    });

    it("só itens velhos: nada é enviado, a fila some e o aviso é dado", async () => {
      guardarFila("admin-a", [
        { ...itemDeA, timestamp: AGORA - 100 * HORA },
        { ...itemDeB, timestamp: AGORA - 200 * HORA },
      ]);
      entrarComo("admin-a");
      await renderizar();
      await reconectar();

      expect(rpcMock).not.toHaveBeenCalled();
      expect(armazem.has(chaveDe("admin-a"))).toBe(false);
      expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain(
        "2 alterações offline antigas foram descartadas",
      );
    });

    it("pouco antes de 72 h ainda vale (a borda; o relógio anda 1 s até o envio)", async () => {
      guardarFila("admin-a", [
        { ...itemDeA, timestamp: AGORA - 72 * HORA + 5000 },
      ]);
      entrarComo("admin-a");
      await renderizar();
      await reconectar();

      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it("item sem timestamp (formato antigo) continua valendo: o envio relê o servidor", async () => {
      const semData = {
        orderId: "pedido-s",
        status: "cancelled",
        silent: false,
      };
      guardarFila("admin-a", [semData]);
      entrarComo("admin-a");
      await renderizar();
      await reconectar();

      expect(pedidosEnviados()).toEqual(["pedido-s"]);
    });
  });

  describe("fila ANTIGA (chave sem :<uid>)", () => {
    const legado = {
      orderId: "pedido-legado",
      status: "cancelled",
      silent: false,
      timestamp: AGORA - HORA,
    };

    it("admin CONFIRMADO: migra para a chave dele e envia; a chave antiga some", async () => {
      armazem.set(BASE, JSON.stringify([legado]));
      entrarComo("admin-b", true);
      await renderizar();
      await reconectar();

      expect(pedidosEnviados()).toEqual(["pedido-legado"]);
      expect(armazem.has(BASE)).toBe(false);
      expect(armazem.has(chaveDe("admin-b"))).toBe(false);
    });

    it("cliente (não admin): a chave antiga fica INTOCADA e nada é enviado", async () => {
      armazem.set(BASE, JSON.stringify([legado]));
      entrarComo("cliente-1", false);
      await renderizar();
      await reconectar();

      expect(rpcMock).not.toHaveBeenCalled();
      expect(JSON.parse(armazem.get(BASE) ?? "null")).toEqual([legado]);
      expect(armazem.has(chaveDe("cliente-1"))).toBe(false);
    });

    it("admin com falha transitória: o item migrado fica na chave DELE, não na antiga", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      armazem.set(BASE, JSON.stringify([legado]));
      rpcMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      entrarComo("admin-b", true);
      await renderizar();
      await reconectar();

      expect(armazem.has(BASE)).toBe(false);
      expect(filaDe("admin-b")).toEqual([legado]);
    });

    it("migrar junta com o que o admin já tinha, ficando o item mais novo do mesmo pedido", async () => {
      const novo = {
        ...legado,
        status: "delivered",
        timestamp: AGORA - HORA / 2,
      };
      armazem.set(BASE, JSON.stringify([legado]));
      guardarFila("admin-b", [novo]);
      rpcMock.mockRejectedValue(new TypeError("Failed to fetch"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      entrarComo("admin-b", true);
      await renderizar();
      await reconectar();

      expect(filaDe("admin-b")).toEqual([novo]);
      expect(armazem.has(BASE)).toBe(false);
    });
  });

  describe("gravação offline (updateOrderStatus)", () => {
    it("grava na chave do usuário e não toca a fila de OUTRO usuário no mesmo pedido", async () => {
      const deOutro = { ...itemDeA, orderId: "pedido-1", status: "processing" };
      guardarFila("admin-a", [deOutro]);
      entrarComo("lojista-1", true);
      await renderizar();

      await act(async () => {
        await atualizarStatus("pedido-1", "shipping", undefined, true);
      });

      expect(filaDe("admin-a")).toEqual([deOutro]);
      const minha = filaDe("lojista-1") ?? [];
      expect(minha).toHaveLength(1);
      expect(minha[0]).toMatchObject({
        orderId: "pedido-1",
        status: "shipping",
      });
      expect(minha[0]).not.toHaveProperty("userId");
      // Nada na chave antiga, compartilhada.
      expect(armazem.has(BASE)).toBe(false);
    });

    it("regravar o MESMO pedido pelo mesmo usuário substitui o item dele (sem duplicar)", async () => {
      entrarComo("lojista-1", true);
      await renderizar();

      await act(async () => {
        await atualizarStatus("pedido-1", "shipping", undefined, true);
      });
      await act(async () => {
        await atualizarStatus("pedido-1", "delivered", undefined, true);
      });

      const fila = filaDe("lojista-1") ?? [];
      expect(fila).toHaveLength(1);
      expect(fila[0]).toMatchObject({ status: "delivered" });
    });

    it("SEM uid: não guarda nada, recusa com aviso e não grava userId undefined", async () => {
      entrarComo(null, true);
      await renderizar();

      let erro: unknown;
      await act(async () => {
        try {
          await atualizarStatus("pedido-1", "shipping", undefined, false);
        } catch (e) {
          erro = e;
        }
      });

      expect(erro).toBeDefined();
      expect([...armazem.keys()]).toEqual([]);
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(toast.info).not.toHaveBeenCalled();
    });
  });

  describe("a purga de atualização não apaga as chaves novas", () => {
    it("a whitelist (por prefixo) cobre a chave com :<uid>", () => {
      expect(chaveSobreviveAPurga(chaveDe("qualquer-uid"))).toBe(true);
      expect(
        chaveSobreviveAPurga("products_offline_updates_queue:qualquer-uid"),
      ).toBe(true);
      expect(chaveSobreviveAPurga("admin_banner_form_draft:qualquer-uid")).toBe(
        true,
      );
      expect(chaveSobreviveAPurga("admin_pdv_venda_draft:qualquer-uid")).toBe(
        true,
      );
      expect(
        chaveSobreviveAPurga("ikcous_product_form_draft_edit_p1:qualquer-uid"),
      ).toBe(true);
    });
  });
});
