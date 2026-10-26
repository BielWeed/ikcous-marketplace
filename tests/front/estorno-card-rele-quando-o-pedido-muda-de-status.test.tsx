// @vitest-environment jsdom
//
// Cancelar um pedido PAGO que ainda não saiu: o banco grava na hora uma
// devolução do valor total (migration `cliente_nao_cancela_com_cartao_vivo`),
// mas o cartão "Devolução de dinheiro" lia o saldo UMA vez ao abrir a ficha.
// Com a ficha aberta, o status mudava de "processing" para "cancelled" e o
// cartão seguia mostrando "Disponível R$ 100" com o botão "Devolver" ligado,
// sem a linha "em andamento" — o lojista devolvia por fora e o cliente
// recebia duas vezes.
//
// Aqui o hook de verdade roda (só o Supabase é dublê): mudar o status do
// pedido tem de reler o saldo, e enquanto a releitura não volta o botão
// "Devolver" não pode estar na tela com o saldo velho.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const SALDO_ABERTO = {
  total: 100,
  valor_estornado: 0,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel: 100,
  reservado_por_fora: 0,
  linhas: [],
};
// O que o servidor devolve depois do cancelamento: a devolução total já está
// no ledger, em andamento — nada disponível.
const SALDO_APOS_CANCELAR = {
  ...SALDO_ABERTO,
  em_voo: 100,
  disponivel: 0,
  linhas: [
    {
      id: "refund-auto",
      amount: 100,
      status: "solicitado",
      pode_ter_saido: false,
      por_fora_liberado_em: null,
      por_fora_apos_espera_liberado: false,
      substituida_por_manual: false,
      eh_pix: false,
    },
  ],
};
const LINHA_APOS_CANCELAR = {
  id: "refund-auto",
  amount: 100,
  status: "solicitado",
  solicitado_por: "sistema",
  mp_status: null,
  mp_status_detail: null,
  tentativas: 0,
  ultimo_erro: null,
  motivo: null,
  created_at: "2026-10-26T10:00:00.000Z",
  concluido_em: null,
};

let respostasDoSaldo: Array<{ data: unknown; error: null }> = [];
let leiturasDoSaldo = 0;
// Segura a segunda leitura para provar o que a tela mostra ENQUANTO ela não
// voltou.
let soltarSaldo: (() => void) | null = null;
let segurarSegunda = false;
let linhasDaVez: unknown[] = [];

function criarBuilderLinhas() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve({ data: linhasDaVez, error: null }).then(
      resolve as never,
      reject as never,
    );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => criarBuilderLinhas()),
    rpc: vi.fn((nome: string) => {
      if (nome !== "pedido_reembolsos_e_saldo") {
        return Promise.resolve({ data: null, error: null });
      }
      leiturasDoSaldo += 1;
      const resposta = respostasDoSaldo.shift() ?? {
        data: SALDO_APOS_CANCELAR,
        error: null,
      };
      if (segurarSegunda && leiturasDoSaldo === 2) {
        return new Promise((resolver) => {
          soltarSaldo = () => resolver(resposta);
        });
      }
      return Promise.resolve(resposta);
    }),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedidoBase: Order = {
  id: "pedido-muda-status",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "processing",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  respostasDoSaldo = [
    { data: SALDO_ABERTO, error: null },
    { data: SALDO_APOS_CANCELAR, error: null },
  ];
  leiturasDoSaldo = 0;
  soltarSaldo = null;
  segurarSegunda = false;
  linhasDaVez = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

async function renderizar(order: Order) {
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={order} />);
  });
}

function botaoDevolver() {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    /Devolver\s/.test(b.textContent ?? ""),
  );
}

describe("EstornoCard — o saldo é relido quando o pedido muda de status", () => {
  it("processing -> cancelled: relê o saldo e passa a mostrar a devolução em andamento", async () => {
    await renderizar(pedidoBase);
    expect(leiturasDoSaldo).toBe(1);

    linhasDaVez = [LINHA_APOS_CANCELAR];
    await renderizar({ ...pedidoBase, status: "cancelled" });

    expect(leiturasDoSaldo).toBe(2);
    expect(hospedeiro.textContent).toContain("em andamento");
    // Nada disponível: o botão de devolver não pode estar ligado.
    const botao = botaoDevolver();
    expect(botao === undefined || botao.disabled).toBe(true);
    expect(hospedeiro.textContent).not.toMatch(/Disponível:\sR\$\s100/);
  });

  it("enquanto a releitura não volta, o saldo velho não vira botão ligado", async () => {
    segurarSegunda = true;
    await renderizar(pedidoBase);
    expect(leiturasDoSaldo).toBe(1);

    linhasDaVez = [LINHA_APOS_CANCELAR];
    await renderizar({ ...pedidoBase, status: "cancelled" });
    // Segunda leitura em voo: a tela NÃO mostra o "Disponível R$ 100" velho
    // nem o botão de devolver ligado.
    expect(leiturasDoSaldo).toBe(2);
    expect(hospedeiro.textContent).not.toMatch(/Disponível:\sR\$\s100/);
    const botao = botaoDevolver();
    expect(botao === undefined || botao.disabled).toBe(true);

    await act(async () => {
      soltarSaldo?.();
    });
    expect(hospedeiro.textContent).toContain("em andamento");
  });

  it("re-renderizar com o MESMO status não relê (nada de leitura a cada atualização da lista)", async () => {
    await renderizar({ ...pedidoBase, status: "cancelled" });
    await renderizar({
      ...pedidoBase,
      status: "cancelled",
      updatedAt: "2026-10-26T10:00:00.000Z",
    });
    expect(leiturasDoSaldo).toBe(1);
  });

  it("a forma de pagamento mudando (pago -> estornado) também relê", async () => {
    await renderizar({ ...pedidoBase, status: "cancelled" });
    await renderizar({
      ...pedidoBase,
      status: "cancelled",
      paymentStatus: "estornado",
    });
    expect(leiturasDoSaldo).toBe(2);
  });
});
