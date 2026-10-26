// @vitest-environment jsdom
//
// Achado 5 da caçada de 26/10/2026: o cartão "Devolução de dinheiro" mostrava
// `error.message` CRU. Quando a internet cai, o navegador entrega
// "TypeError: Failed to fetch" e era isso que o lojista lia no aviso. A frase
// que a RPC escreve de propósito em português (valor maior que o disponível,
// "Cancele o pedido antes…") continua passando como veio — só a falha de rede,
// que chega em inglês, vira frase nossa (a mesma das outras telas de
// devolução: `mensagemDoErro`).
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SALDO = {
  total: 100,
  valor_estornado: 0,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel: 100,
  reservado_por_fora: 0,
  linhas: [],
};
let respostaSolicitar: unknown;
let respostaPorFora: unknown;

function builderDeLinhas() {
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.order = vi.fn(() => b);
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
  b.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve({ data: [], error: null }).then(
      resolve as never,
      reject as never,
    );
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => builderDeLinhas()),
    rpc: vi.fn((nome: string) => {
      if (nome === "pedido_reembolsos_e_saldo") {
        return Promise.resolve({ data: SALDO, error: null });
      }
      if (nome === "registrar_estorno_manual_apos_espera") {
        return Promise.resolve(respostaPorFora);
      }
      return Promise.resolve(respostaSolicitar);
    }),
    functions: { invoke: vi.fn() },
  },
}));

const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};
vi.mock("sonner", () => ({ toast: toastMock }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Leitura {
  solicitarEstorno: (a: { amount: number; motivo: string }) => Promise<void>;
  registrarPorForaAposEspera: (id: string) => Promise<boolean>;
}
const raizes: Array<{ unmount: () => void }> = [];

async function montarSonda(orderId = "pedido-1") {
  const { useEstornosDoPedido } = await import("@/hooks/useEstornosDoPedido");
  const leituras: Leitura[] = [];
  function Sonda() {
    leituras.push(useEstornosDoPedido(orderId) as unknown as Leitura);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  raizes.push(root);
  await act(async () => {
    root.render(createElement(Sonda));
  });
  await act(async () => {});
  return () => leituras[leituras.length - 1];
}

const FRASE_SEM_REDE =
  "Sem conexão com a internet. Confira a rede e tente de novo.";

beforeEach(() => {
  vi.clearAllMocks();
  respostaSolicitar = { data: { refund_id: "r-1" }, error: null };
  respostaPorFora = { data: null, error: null };
});

afterEach(() => {
  for (const r of raizes.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

describe("useEstornosDoPedido — erro de rede vira frase em português", () => {
  it("devolver: 'TypeError: Failed to fetch' não chega ao lojista cru", async () => {
    respostaSolicitar = {
      data: null,
      error: { message: "TypeError: Failed to fetch" },
    };
    const atual = await montarSonda();

    await act(async () => {
      await atual().solicitarEstorno({ amount: 50, motivo: "" });
    });

    expect(toastMock.error).toHaveBeenCalledWith(
      `Devolução do pedido #${numeroDoPedido("pedido-1")}: ${FRASE_SEM_REDE}`,
    );
    const dito = toastMock.error.mock.calls.map((c) => String(c[0])).join("\n");
    expect(dito).not.toMatch(/Failed to fetch|TypeError/);
  });

  it("devolver: a frase em português da própria RPC passa como veio (não é trocada por genérica)", async () => {
    respostaSolicitar = {
      data: null,
      error: { message: "Cancele o pedido antes de devolver o dinheiro." },
    };
    const atual = await montarSonda();

    await act(async () => {
      await atual().solicitarEstorno({ amount: 50, motivo: "" });
    });

    expect(toastMock.error).toHaveBeenCalledWith(
      `Devolução do pedido #${numeroDoPedido("pedido-1")}: Cancele o pedido antes de devolver o dinheiro.`,
    );
  });

  it("'Já devolvi por fora (depois de 7 dias)': o erro de rede também vira frase", async () => {
    respostaPorFora = {
      data: null,
      error: { message: "NetworkError when attempting to fetch resource." },
    };
    const atual = await montarSonda();

    let gravou: boolean | undefined;
    await act(async () => {
      gravou = await atual().registrarPorForaAposEspera("r-9");
    });

    expect(gravou).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith(
      `Devolução do pedido #${numeroDoPedido("pedido-1")}: ${FRASE_SEM_REDE}`,
    );
  });

  it("erro sem mensagem nenhuma: cai numa frase nossa, não em 'undefined'", async () => {
    respostaSolicitar = { data: null, error: {} };
    const atual = await montarSonda();

    await act(async () => {
      await atual().solicitarEstorno({ amount: 50, motivo: "" });
    });

    const dito = String(toastMock.error.mock.calls[0]?.[0]);
    expect(dito).toContain(`#${numeroDoPedido("pedido-1")}`);
    expect(dito).not.toContain("undefined");
  });
});
