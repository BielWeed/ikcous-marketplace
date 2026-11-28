// @vitest-environment jsdom
/**
 * Rotina de despachar pelo celular (28/11/2026): o "Status atualizado com
 * sucesso" do hook era igual quando a cliente seria avisada e quando ninguém
 * seria (pedido sem conta). Quem sabe para quem vai o aviso é a ficha
 * (AdminOrdersView.handleStatusChange): com `avancoConfirmadoPorQuemChamou`,
 * o hook fica calado no SUCESSO do avanço e a ficha dá a confirmação certa
 * (com a ação de WhatsApp). Erros, fila offline e cancelamento seguem com o
 * hook.
 *
 * Mesma sonda de use-orders-avanco-gravado-sem-resposta-avisa.test.tsx.
 */
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    channel: () => {
      const canal: any = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "usuario-quem-confirma" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
import {
  MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA,
  PRAZO_DO_AVANCO_DE_STATUS_MS,
  useOrders,
} from "@/hooks/useOrders";
import type { OrderStatus } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(id: string, status = "pending") {
  return {
    id,
    status,
    updated_at: "2026-11-27T10:00:00Z",
    created_at: "2026-11-27T09:00:00Z",
    user_id: "cliente-1",
    customer_name: "Cliente Teste",
    items: [],
    payment_method: "cash",
    payment_status: null,
    cancelled_after_shipping: false,
  };
}
type Resposta = { data: unknown; error: unknown };

let atuais: ReturnType<typeof useOrders>;
/** O que o banco tem de verdade (lido pela releitura). */
let statusNoBanco: string;
let gravacao: () => Promise<Resposta>;
let releitura: () => Promise<Resposta>;
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

const ID = "PED-1";

const gravacoes = () =>
  rpc.mock.calls.filter(([nome]) => nome === "avancar_status_do_pedido");
/** A releitura de ANTES da gravação responde; a conferência depois, não. */
function redeCaiDepoisDaPrimeiraLeitura() {
  let leituras = 0;
  releitura = () =>
    leituras++ === 0
      ? Promise.resolve({ data: { status: statusNoBanco }, error: null })
      : new Promise(() => {});
}

/** Clica e devolve o desfecho (a chamada termina dentro do `act`). */
async function avancar(
  status: OrderStatus,
  statusEsperado?: OrderStatus,
  avancoConfirmadoPorQuemChamou?: boolean,
): Promise<{ ok: boolean; erro: unknown }> {
  const desfecho = { ok: false, erro: null as unknown };
  await act(async () => {
    const promessa = atuais
      .updateOrderStatus(ID, status, undefined, false, statusEsperado, {
        avancoConfirmadoPorQuemChamou,
      })
      .then(
        () => {
          desfecho.ok = true;
        },
        (erro: unknown) => {
          desfecho.erro = erro;
        },
      );
    // Prazo da gravação + prazo da conferência: o suficiente para qualquer
    // espera pendurada terminar.
    await vi.advanceTimersByTimeAsync(PRAZO_DO_AVANCO_DE_STATUS_MS * 2);
    await promessa;
  });
  return desfecho;
}

describe("Avançar status: quem chama confirma o avanço", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    statusNoBanco = "pending";
    gravacao = async () => ({ data: null, error: null });
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      nome === "get_admin_orders_paged"
        ? {
            abortSignal: () =>
              Promise.resolve({
                data: { data: [linha(ID, statusNoBanco)], total_count: 1 },
                error: null,
              }),
          }
        : gravacao(),
    );
    from.mockReset();
    from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: () => releitura() }) }),
    }));
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
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, "all");
    });
    vi.clearAllMocks();
  });
  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("avanço que grava: com a opção, o hook não dá o 'Status atualizado com sucesso' (resolve igual)", async () => {
    gravacao = async () => {
      statusNoBanco = "processing";
      return { data: linha(ID, "processing"), error: null };
    };

    const r = await avancar("processing", "pending", true);

    expect(r.ok).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
    expect(gravacoes()).toHaveLength(1);
  });

  it("controle: sem a opção, o hook confirma como sempre", async () => {
    gravacao = async () => {
      statusNoBanco = "processing";
      return { data: linha(ID, "processing"), error: null };
    };

    const r = await avancar("processing", "pending");

    expect(r.ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Status atualizado com sucesso");
  });

  it("gravação perdida reconhecida na nova tentativa: com a opção, também fica calado", async () => {
    gravacao = () => new Promise(() => {});
    redeCaiDepoisDaPrimeiraLeitura();
    await avancar("processing", "pending", true);

    statusNoBanco = "processing";
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    vi.clearAllMocks();

    const r2 = await avancar("processing", "pending", true);

    expect(r2.ok).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
    expect(gravacoes()).toHaveLength(0);
  });

  it("erro continua com o hook: com a opção, a recusa ainda avisa", async () => {
    gravacao = () => new Promise(() => {});

    const r = await avancar("processing", "pending", true);

    expect(r.ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA,
    );
  });
});
