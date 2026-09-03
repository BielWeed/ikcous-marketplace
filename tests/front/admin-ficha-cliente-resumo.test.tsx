// @vitest-environment jsdom
//
// Frente "ficha do cliente" (03/09): o resumo do topo responde "quem é este
// cliente" com quatro números — total gasto, nº de pedidos, última compra e
// ticket médio.
//
// A REGRA, decidida e DOCUMENTADA na tela (ver comentário do resumo em
// AdminUserDetailView e as regras numeradas em
// src/components/admin/users/ficha-resumo.ts):
//
//   PEDIDO CANCELADO NÃO ENTRA NO TOTAL GASTO — nem na contagem. Nem quando
//   a cobrança dele está paga: cancelado é dinheiro que voltou, e a regra da
//   casa (`get_admin_customers_paged`, `status NOT IN
//   ('cancelled','returned')`) o tira de todas as contagens. Devolvido
//   (returned), idem. O mesmo vale para a ÚLTIMA COMPRA: um cancelado de
//   ontem não prova que o cliente está ativo.
//
//   DINHEIRO só com cobrança reconhecida ('pago', 'pago_apos_expirar',
//   'recebido_na_entrega') — pedidos 'aguardando', com cobrança nula,
//   'recusado', 'expirado' e 'estornado' CONTAM como pedido (para bater com
//   a coluna "Pedidos" da lista de Clientes) mas não entram no dinheiro.
//
//   TICKET MÉDIO = total gasto ÷ pedidos COM dinheiro reconhecido — a mesma
//   fórmula do `get_admin_analytics_v2` (numerador e denominador na MESMA
//   base), aplicada ao recorte deste cliente. Não divide por "pedidos que
//   contam" de propósito: pedido aguardando pagamento no denominador
//   diluiria o ticket (o mesmo cenário do PIX pendente que
//   admin-customers-ticket-medio.test.tsx flagra na lista de Clientes).
//
// Este arquivo testa as duas metades: a função pura
// (`calcularResumoFicha`, onde a regra vive em UM lugar) e a TELA montada
// (os cartões mostrando o que a função calculou — o número no ar).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
} from "@/components/admin/users/ficha-resumo";
import type { Order } from "@/types";
import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";

// ---- Parte 1: a função pura ----------------------------------------------

/** Pedido com só os campos que a regra lê — o resto do tipo `Order` é
 * preenchimento que o mapper do banco cuida na vida real. */
function pedido(sobrescreve: Partial<Order>): Order {
  return {
    id: "pedido-prova",
    status: "delivered",
    total: 0,
    createdAt: "2026-08-01T12:00:00Z",
    ...sobrescreve,
  } as unknown as Order;
}

describe("calcularResumoFicha — a regra dos quatro números", () => {
  it("pedido cancelado (mesmo PAGO) não entra no total gasto nem na contagem", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "bom", total: 100, paymentStatus: "pago" }),
      // O caso do critério de pronto: cancelado com cobrança CONFIRMADA.
      // Dinheiro reconhecido não salva pedido cancelado — ele voltou.
      pedido({
        id: "cancelado-pago",
        status: "cancelled",
        total: 999,
        paymentStatus: "pago",
      }),
    ]);

    expect(resumo.totalGasto).toBe(100);
    expect(resumo.pedidosQueContam).toHaveLength(1);
    expect(resumo.pedidosDescartados).toBe(1);
  });

  it("devolvido (returned) também sai de tudo, igual ao servidor", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "bom", total: 40, paymentStatus: "recebido_na_entrega" }),
      pedido({
        id: "devolvido",
        status: "returned" as Order["status"],
        total: 90,
        paymentStatus: "pago",
      }),
    ]);

    expect(resumo.totalGasto).toBe(40);
    expect(resumo.pedidosQueContam).toHaveLength(1);
  });

  it("aguardando e cobrança nula contam como pedido, mas não viram dinheiro", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "pago", total: 100, paymentStatus: "pago" }),
      pedido({
        id: "pix-pendente",
        status: "pending",
        total: 30,
        paymentStatus: "aguardando",
      }),
      pedido({ id: "sem-cobranca", total: 40, paymentStatus: null }),
    ]);

    // 3 pedidos que contam, só R$ 100 de dinheiro reconhecido.
    expect(resumo.pedidosQueContam).toHaveLength(3);
    expect(resumo.totalGasto).toBe(100);
  });

  it("ticket médio divide o dinheiro só pelos pedidos PAGOS, não pelos que contam", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "a", total: 100, paymentStatus: "pago" }),
      pedido({ id: "b", total: 50, paymentStatus: "pago_apos_expirar" }),
      pedido({
        id: "pendente",
        status: "pending",
        total: 30,
        paymentStatus: "aguardando",
      }),
    ]);

    // 150 ÷ 2 = 75. Dividir por 3 (os que contam) daria 50 — o número
    // diluído que a regra proíbe.
    expect(resumo.totalGasto).toBe(150);
    expect(resumo.ticketMedio).toBe(75);
  });

  it("ticket médio de cliente sem nenhum pedido pago é zero MEDIDO, não um traco", () => {
    const resumo = calcularResumoFicha([
      pedido({
        id: "so-pendente",
        status: "pending",
        total: 30,
        paymentStatus: "aguardando",
      }),
    ]);

    expect(resumo.ticketMedio).toBe(0);
  });

  it("última compra é o pedido que conta mais recente: cancelado mais novo não engana", () => {
    const resumo = calcularResumoFicha([
      pedido({
        id: "antigo-valido",
        total: 10,
        createdAt: "2026-03-10T12:00:00Z",
        paymentStatus: "pago",
      }),
      pedido({
        id: "pendente-recente",
        status: "pending",
        total: 10,
        createdAt: "2026-09-12T12:00:00Z",
        paymentStatus: "aguardando",
      }),
      pedido({
        id: "cancelado-mais-novo",
        status: "cancelled",
        total: 10,
        createdAt: "2026-09-20T12:00:00Z",
      }),
    ]);

    // O aguardando CONTA (cliente ativo); o cancelado de dia 20 não prova
    // nada — mesma regra do `last_order_date` do servidor.
    expect(resumo.ultimaCompra?.toISOString()).toBe(
      "2026-09-12T12:00:00.000Z",
    );
  });

  it("cliente que nunca comprou (só cancelados) não tem última compra", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "c1", status: "cancelled", createdAt: "2026-05-01T12:00:00Z" }),
    ]);

    expect(resumo.ultimaCompra).toBeNull();
  });
});

// ---- Parte 2: os cartões na tela ------------------------------------------

const { estado } = vi.hoisted(() => ({
  estado: { orders: [] as any[] },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

// O mesmo recorte de mock dos testes vivos da tela: a ficha vem da RPC e as
// demais consultas devolvem vazio. A consulta da aba "Voz" (nova) falha
// dentro do try/catch dela e não atrapalha os cartões — o teste destas
// linhas é o dinheiro, não a voz.
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
          // A RPC fala snake_case (é o mapper da tela que traduz para
          // camelCase) — o mock precisa chegar ao mapper como o banco chega,
          // senão `created_at` vira undefined e o extrato explode em
          // Invalid time value (defeito do DUBLÊ, não da tela).
          orders: estado.orders.map((o) => ({
            id: o.id,
            status: o.status,
            total: o.total,
            payment_status: o.paymentStatus ?? null,
            created_at: o.createdAt,
          })),
          cart_items: [],
          addresses: [],
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

// Mesmo motivo do teste irmão (admin-user-detail-pedidos-que-contam): o
// `await import()` da tela custa segundos e não pode virar flakiness de
// timeout dentro de cada `it`.
let TelaFicha: typeof TipoTelaFicha;

beforeAll(async () => {
  ({ AdminUserDetailView: TelaFicha } = await import(
    "@/views/admin/AdminUserDetailView"
  ));
});

describe("AdminUserDetailView — os cartões do resumo no ar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // O caso completo: pago, recebido na entrega, aguardando, sem cobrança,
    // cancelado PAGO e devolvido.
    estado.orders = [
      pedido({
        id: "pago",
        total: 100,
        createdAt: "2026-08-10T12:00:00Z",
        paymentStatus: "pago",
      }),
      pedido({
        id: "entrega",
        total: 50,
        createdAt: "2026-07-05T12:00:00Z",
        paymentStatus: "recebido_na_entrega",
      }),
      pedido({
        id: "cancelado-pago",
        status: "cancelled",
        total: 999,
        createdAt: "2026-09-20T12:00:00Z",
        paymentStatus: "pago",
      }),
      pedido({
        id: "pix-pendente",
        status: "pending",
        total: 30,
        createdAt: "2026-09-12T12:00:00Z",
        paymentStatus: "aguardando",
      }),
      pedido({
        id: "devolvido",
        status: "returned" as Order["status"],
        total: 90,
        createdAt: "2026-06-01T12:00:00Z",
      }),
      pedido({
        id: "sem-cobranca",
        total: 40,
        createdAt: "2026-05-01T12:00:00Z",
        paymentStatus: null,
      }),
    ];
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

  /** O valor em reais do cartão, lido EXATO (mesma técnica do teste irmão:
   * sobe do rótulo ao cartão, nunca `toContain` no texto inteiro — a tabela
   * do extrato imprime o total de cada pedido, inclusive o cancelado). */
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

  it("Total Gasto (LTV) ignora o cancelado pago e soma só dinheiro reconhecido", async () => {
    await abrirFicha();

    // 100 + 50. Nem 999 (cancelado pago), nem 30 (aguardando), nem 40 (nulo),
    // nem 90 (devolvido) entram.
    expect(valorDoCard("LTV Total")).toBe("R$ 150,00");
  });

  it("Ticket Médio é o dinheiro dividido pelos pedidos pagos", async () => {
    await abrirFicha();

    // 150 ÷ 2 = 75. Não é 150 ÷ 4 (os que contam) — pedido sem dinheiro no
    // denominador diluiria o tíquete.
    expect(valorDoCard("Ticket Médio")).toBe("R$ 75,00");
  });

  it("Última Compra é a data do pedido que conta mais recente, não a do cancelado", async () => {
    await abrirFicha();

    const esperado = format(new Date("2026-09-12T12:00:00Z"), "dd MMM yy", {
      locale: ptBR,
    });
    const cancelado = format(new Date("2026-09-20T12:00:00Z"), "dd MMM yy", {
      locale: ptBR,
    });

    const etiqueta = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === "Última Compra",
    );
    expect(etiqueta).toBeDefined();
    const cartao = etiqueta!.parentElement?.parentElement;
    const data = [...(cartao?.querySelectorAll("span") ?? [])]
      .map((s) => s.textContent?.trim() ?? "")
      .find((t) => /\d/.test(t));
    expect(data).toBe(esperado);
    // A prova do engano: o cancelado é o MAIS recente de todos (20/09) e não
    // pode aparecer como última compra.
    expect(data).not.toBe(cancelado);
  });

  it("cliente que só tem pedidos cancelados mostra '—' na última compra e R$ 0,00 no dinheiro", async () => {
    estado.orders = [
      pedido({
        id: "unico",
        status: "cancelled",
        total: 500,
        createdAt: "2026-08-01T12:00:00Z",
        paymentStatus: "pago",
      }),
    ];
    await abrirFicha();

    expect(valorDoCard("LTV Total")).toBe("R$ 0,00");
    expect(valorDoCard("Ticket Médio")).toBe("R$ 0,00");

    const etiqueta = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === "Última Compra",
    );
    const cartao = etiqueta!.parentElement?.parentElement;
    expect(cartao?.textContent).toContain("—");
  });
});
