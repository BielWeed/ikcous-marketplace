// @vitest-environment jsdom
//
// O TOTAL COMPRADO DO CLIENTE E O MESMO NO CRM, NA LISTA E NA FICHA (17/11/2026, migration 20261403000000).
//
// O CRM atribui à conta as vendas de balcão (pedido sem conta) feitas com o mesmo WhatsApp: R$ 100 na conta mais R$ 100 no
// balcão é 2 pedidos e R$ 200. A lista de Clientes e a ficha só contavam o que estava ligado à conta (1 pedido, R$ 100).
// A ficha agora recebe o balcão num campo SEPARADO (`balcao_mesmo_whatsapp`, {pedidos, total}) e mostra
// "R$ 200,00 (R$ 100,00 pela conta + R$ 100,00 no balcão ou sem conta, com o mesmo WhatsApp)".
//
// O que este arquivo prova:
//   - a função pura (`calcularResumoFicha` e `lerBalcaoDoMesmoWhatsapp`): total, pedidos e valor médio com balcão;
//   - a tela montada: o número no ar e a frase da divisão SÓ quando o balcão é maior que zero;
//   - o limite: banco antigo (sem o campo), campo nulo, zero e lixo deixam a ficha EXATAMENTE como era;
//   - a ABA de pedidos continua só com os pedidos da conta (o balcão não vira linha na tabela).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  calcularResumoFicha,
  lerBalcaoDoMesmoWhatsapp,
} from "@/components/admin/users/ficha-resumo";
import type { Order } from "@/types";
import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";

function pedido(sobrescreve: Partial<Order>): Order {
  return {
    id: "pedido-prova",
    status: "delivered",
    total: 0,
    createdAt: "2026-08-01T12:00:00Z",
    ...sobrescreve,
  } as unknown as Order;
}

const PEDIDO_DA_CONTA = pedido({
  id: "da-conta",
  total: 100,
  paymentStatus: "pago",
});

// ---- Parte 1: a função pura ----------------------------------------------

describe("lerBalcaoDoMesmoWhatsapp — o que o servidor manda vira número seguro", () => {
  it("lê pedidos e total", () => {
    expect(lerBalcaoDoMesmoWhatsapp({ pedidos: 1, total: 100 })).toEqual({
      pedidos: 1,
      total: 100,
    });
  });

  it("numeric do banco pode chegar como texto: continua valendo", () => {
    expect(lerBalcaoDoMesmoWhatsapp({ pedidos: "2", total: "150.50" })).toEqual(
      {
        pedidos: 2,
        total: 150.5,
      },
    );
  });

  it("ausente (banco antigo), nulo, zero, negativo e lixo viram SEM balcão", () => {
    const sem = { pedidos: 0, total: 0 };
    for (const entrada of [
      undefined,
      null,
      "R$ 100",
      42,
      [],
      {},
      { pedidos: 0, total: 0 },
      { pedidos: 1, total: 0 },
      { pedidos: 0, total: 100 },
      { pedidos: -1, total: 100 },
      { pedidos: 1, total: -100 },
      { pedidos: 1, total: "abc" },
      { pedidos: Number.NaN, total: 100 },
      { pedidos: 1, total: Number.POSITIVE_INFINITY },
      { pedidos: 0.4, total: 100 },
    ])
      expect(
        lerBalcaoDoMesmoWhatsapp(entrada),
        JSON.stringify(entrada),
      ).toEqual(sem);
  });
});

describe("calcularResumoFicha — o balcão do mesmo WhatsApp entra como o CRM entra", () => {
  it("R$ 100 na conta + R$ 100 no balcão = 2 pedidos, R$ 200, valor médio R$ 100", () => {
    const resumo = calcularResumoFicha([PEDIDO_DA_CONTA], {
      pedidos: 1,
      total: 100,
    });

    expect(resumo.totalGasto).toBe(200);
    expect(resumo.totalDePedidos).toBe(2);
    expect(resumo.ticketMedio).toBe(100);
    expect(resumo.totalDaConta).toBe(100);
    expect(resumo.balcao).toEqual({ pedidos: 1, total: 100 });
  });

  it("o valor médio divide pelos pedidos pagos da conta MAIS os do balcão (nunca pelos da conta sozinhos)", () => {
    const resumo = calcularResumoFicha(
      [
        pedido({ id: "a", total: 100, paymentStatus: "pago" }),
        pedido({
          id: "pendente",
          status: "pending",
          total: 30,
          paymentStatus: "aguardando",
        }),
      ],
      { pedidos: 2, total: 50 },
    );

    // dinheiro 100 + 50 = 150; pagos 1 + 2 = 3; 150 / 3 = 50. O pendente conta como pedido (3 + 1 = 4), não como dinheiro.
    expect(resumo.totalGasto).toBe(150);
    expect(resumo.ticketMedio).toBe(50);
    expect(resumo.totalDePedidos).toBe(1 + 1 + 2);
  });

  it("sem balcão a ficha é a de sempre, byte a byte nos números", () => {
    const orders = [
      pedido({ id: "a", total: 100, paymentStatus: "pago" }),
      pedido({
        id: "c",
        status: "cancelled",
        total: 999,
        paymentStatus: "pago",
      }),
    ];
    const antes = calcularResumoFicha(orders);
    for (const balcao of [undefined, { pedidos: 0, total: 0 }]) {
      const depois = calcularResumoFicha(orders, balcao);
      expect(depois.totalGasto).toBe(antes.totalGasto);
      expect(depois.totalGasto).toBe(100);
      expect(depois.ticketMedio).toBe(100);
      expect(depois.totalDePedidos).toBe(antes.pedidosQueContam.length);
      expect(depois.pedidosQueContam).toEqual(antes.pedidosQueContam);
      expect(depois.pedidosDescartados).toBe(1);
    }
  });

  it("conta zerada (so balcão): o balcão sozinho já é o total e o valor médio", () => {
    const resumo = calcularResumoFicha([], { pedidos: 2, total: 80 });
    expect(resumo.totalGasto).toBe(80);
    expect(resumo.ticketMedio).toBe(40);
    expect(resumo.totalDePedidos).toBe(2);
    expect(resumo.ultimaCompra).toBeNull();
  });

  it("a lista de pedidos da conta e a última compra NÃO mudam por causa do balcão", () => {
    const orders = [
      pedido({
        id: "a",
        total: 100,
        paymentStatus: "pago",
        createdAt: "2026-08-10T12:00:00Z",
      }),
    ];
    const resumo = calcularResumoFicha(orders, { pedidos: 3, total: 300 });
    expect(resumo.pedidosQueContam).toHaveLength(1);
    expect(resumo.pedidosPagos).toHaveLength(1);
    expect(resumo.ultimaCompra?.toISOString()).toBe("2026-08-10T12:00:00.000Z");
  });
});

// ---- Parte 2: a tela --------------------------------------------------------

const { estado } = vi.hoisted(() => ({
  estado: { orders: [] as any[], balcao: undefined as unknown },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: estado.orders.map((o) => ({
            id: o.id,
            status: o.status,
            total: o.total,
            payment_status: o.paymentStatus ?? null,
            created_at: o.createdAt,
          })),
          cart_items: [],
          addresses: [],
          // `undefined` some do JSON: é o banco antigo, sem o campo.
          ...(estado.balcao === undefined
            ? {}
            : { balcao_mesmo_whatsapp: estado.balcao }),
        },
        error: null,
      }),
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let TelaFicha: typeof TipoTelaFicha;

beforeAll(async () => {
  ({ AdminUserDetailView: TelaFicha } = await import(
    "@/views/admin/AdminUserDetailView"
  ));
});

describe("AdminUserDetailView — o total com o balcão do mesmo WhatsApp, no ar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.orders = [PEDIDO_DA_CONTA];
    estado.balcao = undefined;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirFicha() {
    await act(async () => {
      raiz.render(
        <TelaFicha userId="cliente-1" onBack={vi.fn()} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  /** O valor do cartão: sobe do rótulo ao cartão e lê o primeiro texto que é dinheiro (nunca `toContain` no texto inteiro). */
  function valorDoCard(rotulo: string): string {
    const etiqueta = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === rotulo,
    );
    if (!etiqueta) throw new Error(`Card "${rotulo}" não está na tela.`);
    const cartao = etiqueta.parentElement?.parentElement;
    const valor = [...(cartao?.querySelectorAll("span") ?? [])]
      .map((s) => (s.textContent ?? "").replace(/\s+/g, " ").trim())
      .find((t) => /^R\$/.test(t));
    if (valor === undefined) {
      throw new Error(`Card "${rotulo}" não tem valor: ${cartao?.textContent}`);
    }
    return valor;
  }

  function pedidosFeitos(): string {
    const etiqueta = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === "Pedidos feitos",
    );
    if (!etiqueta) throw new Error("Card de pedidos não está na tela.");
    return (etiqueta.nextElementSibling?.textContent ?? "").trim();
  }

  const divisao = () =>
    hospedeiro.querySelector('[data-testid="ficha-total-dividido"]');

  it("R$ 100 na conta + R$ 100 no balcão: mostra R$ 200,00, 2 pedidos, valor médio R$ 100,00 e a divisão por extenso", async () => {
    estado.balcao = { pedidos: 1, total: 100 };
    await abrirFicha();

    expect(valorDoCard("Total já comprado")).toBe("R$ 200,00");
    expect(pedidosFeitos()).toBe("2");
    expect(valorDoCard("Valor médio por venda")).toBe("R$ 100,00");
    expect((divisao()?.textContent ?? "").replace(/\s+/g, " ").trim()).toBe(
      "(R$ 100,00 pela conta + R$ 100,00 no balcão ou sem conta, com o mesmo WhatsApp)",
    );
  });

  it("a aba de pedidos continua só com o pedido da conta (o balcão não vira linha na tabela)", async () => {
    estado.balcao = { pedidos: 1, total: 100 };
    await abrirFicha();

    // O selo da aba conta os pedidos da conta (1), nunca os do balcão (2 com o do balcão), e a tabela tem a linha da conta.
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Pedidos(1)");
    expect(texto).not.toContain("Pedidos(2)");
    expect(texto).toContain("-CONTA");
  });

  it("sem o campo (banco antigo): a ficha é a de sempre, sem a frase da divisão", async () => {
    estado.balcao = undefined;
    await abrirFicha();

    expect(valorDoCard("Total já comprado")).toBe("R$ 100,00");
    expect(pedidosFeitos()).toBe("1");
    expect(valorDoCard("Valor médio por venda")).toBe("R$ 100,00");
    expect(divisao()).toBeNull();
  });

  it("campo nulo, zerado ou lixo: nada muda e nada quebra", async () => {
    for (const balcao of [
      null,
      { pedidos: 0, total: 0 },
      { pedidos: 1, total: -5 },
      "quebrado",
    ]) {
      estado.balcao = balcao;
      await abrirFicha();

      expect(valorDoCard("Total já comprado"), JSON.stringify(balcao)).toBe(
        "R$ 100,00",
      );
      expect(pedidosFeitos(), JSON.stringify(balcao)).toBe("1");
      expect(divisao(), JSON.stringify(balcao)).toBeNull();

      act(() => {
        raiz.unmount();
      });
      hospedeiro.remove();
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    }
  });

  it("cliente sem pedido na conta e com balcão: o total é o do balcão e a divisão diz R$ 0,00 pela conta", async () => {
    estado.orders = [];
    estado.balcao = { pedidos: 1, total: 100 };
    await abrirFicha();

    expect(valorDoCard("Total já comprado")).toBe("R$ 100,00");
    expect(pedidosFeitos()).toBe("1");
    expect((divisao()?.textContent ?? "").replace(/\s+/g, " ").trim()).toBe(
      "(R$ 0,00 pela conta + R$ 100,00 no balcão ou sem conta, com o mesmo WhatsApp)",
    );
  });
});
