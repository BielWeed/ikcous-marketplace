// @vitest-environment jsdom
//
// "Reenviar comprovante" (ficha do pedido da cliente) com rede "pendurada": a
// conexão abre e não responde. Sem prazo, `functions.invoke(
// "send-order-confirmation")` nunca terminava, o `finally` da tela nunca rodava
// e o botão ficava em "Reenviando…", desabilitado e girando, sem nenhum aviso.
//
// O prazo só encerra a ESPERA DA TELA: a edge pode ter enviado o e-mail (e já
// gasto a vaga única de e-mail do pedido). Por isso o desfecho NÃO é nem
// "enviado" nem "falhou": é `sem_resposta`, e a frase manda conferir a caixa de
// entrada e o spam antes de tentar de novo. A resposta que chega DEPOIS do
// prazo não muda o desfecho já entregue (a tela não pode mostrar "reenviado"
// depois de ter dito "sem resposta").
//
// Mesma sonda de use-orders-cancelar-pedido-com-prazo.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const invoke = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
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
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const usuario = { id: "cliente-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO_ESPERADO_MS = 20_000;

type Desfecho = { ok: boolean; motivo?: string };
type Reenviar = (orderId: string) => Promise<Desfecho>;

let host: HTMLDivElement;
let raiz: Root;

async function montarSonda(): Promise<Reenviar> {
  const { useOrders } = await import("@/hooks/useOrders");
  const captura: { reenviar: Reenviar | null } = { reenviar: null };
  function Sonda() {
    const { reenviarComprovante } = useOrders(false, false);
    useEffect(() => {
      captura.reenviar = reenviarComprovante as Reenviar;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  if (!captura.reenviar)
    throw new Error("a sonda não expôs reenviarComprovante");
  return captura.reenviar;
}

/** Dispara o reenvio e devolve o que a chamada fez até agora. */
function reenviar(fn: Reenviar) {
  const estado: { terminou: boolean; desfecho: Desfecho | null } = {
    terminou: false,
    desfecho: null,
  };
  const promessa = fn("pedido-1").then((d) => {
    estado.terminou = true;
    estado.desfecho = d;
  });
  return { estado, promessa };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  rpc.mockReset();
  invoke.mockReset();
  vi.stubGlobal("navigator", { ...navigator, onLine: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
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

describe("reenviar comprovante: a espera da tela tem prazo", () => {
  it("a edge nunca responde: depois do prazo a chamada TERMINA com `sem_resposta` (nem enviado, nem falhou)", async () => {
    invoke.mockReturnValue(new Promise(() => {})); // pendurada para sempre
    const reenviarComprovante = await montarSonda();

    let clique!: ReturnType<typeof reenviar>;
    await act(async () => {
      clique = reenviar(reenviarComprovante);
      // um instante antes do prazo: ainda "Reenviando…"
      await vi.advanceTimersByTimeAsync(PRAZO_ESPERADO_MS - 1);
    });
    expect(clique.estado.terminou).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(clique.estado.terminou).toBe(true);
    expect(clique.estado.desfecho).toEqual({
      ok: false,
      motivo: "sem_resposta",
    });
    // uma única chamada, com o corpo de sempre
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("send-order-confirmation", {
      body: { orderId: "pedido-1" },
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("borda: a resposta que chega DEPOIS do prazo não muda o desfecho já entregue e não solta aviso de sucesso", async () => {
    let responder!: (v: unknown) => void;
    invoke.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    const reenviarComprovante = await montarSonda();

    let clique!: ReturnType<typeof reenviar>;
    await act(async () => {
      clique = reenviar(reenviarComprovante);
      await vi.advanceTimersByTimeAsync(PRAZO_ESPERADO_MS);
    });
    expect(clique.estado.desfecho).toEqual({
      ok: false,
      motivo: "sem_resposta",
    });

    await act(async () => {
      responder({ data: { ok: true }, error: null });
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(clique.estado.desfecho).toEqual({
      ok: false,
      motivo: "sem_resposta",
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("borda: erro HTTP cujo corpo nunca termina de chegar também respeita o prazo (a leitura do corpo está sob o mesmo prazo)", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: { json: () => new Promise(() => {}) } },
    });
    const reenviarComprovante = await montarSonda();

    let clique!: ReturnType<typeof reenviar>;
    await act(async () => {
      clique = reenviar(reenviarComprovante);
      await vi.advanceTimersByTimeAsync(PRAZO_ESPERADO_MS - 1);
    });
    expect(clique.estado.terminou).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(clique.estado.desfecho).toEqual({
      ok: false,
      motivo: "sem_resposta",
    });
  });

  it("controle: a resposta que chega ANTES do prazo vale, e passar do prazo depois não a desfaz", async () => {
    let responder!: (v: unknown) => void;
    invoke.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    const reenviarComprovante = await montarSonda();

    let clique!: ReturnType<typeof reenviar>;
    await act(async () => {
      clique = reenviar(reenviarComprovante);
      await vi.advanceTimersByTimeAsync(PRAZO_ESPERADO_MS - 1000);
    });
    expect(clique.estado.terminou).toBe(false);

    await act(async () => {
      responder({ data: { ok: true }, error: null });
      await clique.promessa;
    });
    expect(clique.estado.desfecho).toEqual({ ok: true });

    // o relógio do prazo não pode derrubar um desfecho já entregue
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_ESPERADO_MS * 2);
    });
    expect(clique.estado.desfecho).toEqual({ ok: true });
  });

  it("controle: motivo da loja chega inteiro antes do prazo (ja_enviado)", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "ja_enviado" },
      error: null,
    });
    const reenviarComprovante = await montarSonda();

    let clique!: ReturnType<typeof reenviar>;
    await act(async () => {
      clique = reenviar(reenviarComprovante);
      await clique.promessa;
    });
    expect(clique.estado.desfecho).toEqual({ ok: false, motivo: "ja_enviado" });
  });

  it("controle: rede que FALHA na hora (a chamada lança) continua sendo `envio_falhou`, não `sem_resposta`", async () => {
    invoke.mockRejectedValue(new TypeError("Failed to fetch"));
    const reenviarComprovante = await montarSonda();

    let clique!: ReturnType<typeof reenviar>;
    await act(async () => {
      clique = reenviar(reenviarComprovante);
      await clique.promessa;
    });
    expect(clique.estado.desfecho).toEqual({
      ok: false,
      motivo: "envio_falhou",
    });
  });
});
