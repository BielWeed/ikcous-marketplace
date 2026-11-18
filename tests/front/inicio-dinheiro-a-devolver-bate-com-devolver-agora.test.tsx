import { readFileSync } from "node:fs";
// @vitest-environment jsdom
//
// "Dinheiro a devolver" do Início tem de ser a MESMA conta da lista "Devolver agora" da tela de Pedidos.
// O Início lê o número do banco (painel_inicio().dinheiro_a_devolver, a conta portada para SQL em centavos); a tela de
// Pedidos calcula no navegador (baldeDeEstorno + valorDevolverAgora + o ledger de order_refunds lido por
// useEstornosEmCursoDosPedidos + valorDevolverAgoraDescontandoLedger). Os DOIS lados são provados contra os MESMOS
// cenários (tests/banco/dinheiro-a-devolver-cenarios.json), com o esperado escrito à mão: a prova de banco semeia cada um no
// Postgres efêmero (tests/banco/o-inicio-dinheiro-a-devolver-viva.cjs) e este arquivo passa cada um pelo código REAL da
// tela. Se um lado mudar a regra sem o outro, um dos dois fica vermelho.
//
// A composição abaixo é a de AlertasCancelados: só entra quem está no balde "devolver_agora"; o valor é o descontado do
// ledger quando a leitura voltou; o pedido cujo resto é zero continua na LISTA (o lojista vê "em andamento"), mas não é
// dinheiro a devolver, então não entra na soma nem na contagem do Início.
import { useEstornosEmCursoDosPedidos } from "@/hooks/useEstornosEmCursoDosPedidos";
import {
  valorDevolverAgora,
  valorDevolverAgoraDescontandoLedger,
} from "@/lib/valor-devolver-agora";
import type { Order, PaymentStatus } from "@/types";
import { baldeDeEstorno } from "@/views/admin/AdminOrdersView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface LinhaFake {
  order_id: string;
  amount: number;
  status: string;
  solicitado_por?: string;
  tentativas?: number;
}

let LINHAS_DO_LEDGER: LinhaFake[] = [];

function criarBuilderOrderRefunds() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve({ data: LINHAS_DO_LEDGER, error: null }).then(
      resolve as never,
      reject as never,
    );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn((tabela: string) => {
      if (tabela === "order_refunds") return criarBuilderOrderRefunds();
      throw new Error(`tabela inesperada neste teste: ${tabela}`);
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// A tela de Pedidos importa o resto do painel; só `baldeDeEstorno` (função pura) interessa aqui.
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  }),
}));

interface Cenario {
  id: string;
  descricao: string;
  pedido: {
    total: number;
    payment_status?: string | null;
    status?: string;
    cancelled_after_shipping?: boolean;
    voltou_ao_vendedor?: boolean;
    valor_estornado?: number;
  };
  devolucoes?: {
    status: string;
    reembolso_manual: boolean;
    valor_reembolso: number;
  }[];
  reembolsos?: {
    status: string;
    amount: number;
    solicitado_por: string;
    tentativas: number;
  }[];
  esperado: { pedidos: number; centavos: number };
}

const CENARIOS: readonly Cenario[] = (
  JSON.parse(
    readFileSync("tests/banco/dinheiro-a-devolver-cenarios.json", "utf8"),
  ) as { cenarios: Cenario[] }
).cenarios;

const centavosDe = (valor: number) => Math.round(valor * 100);

/** O pedido como a lista da tela o recebe (`get_admin_orders_cancelados_recentes`, já mapeado). */
function pedidoDaTela(c: Cenario): Order {
  const manual = (c.devolucoes ?? [])
    .filter((d) => d.status === "concluida" && d.reembolso_manual)
    .reduce((soma, d) => soma + centavosDe(d.valor_reembolso), 0);
  return {
    id: `pedido-${c.id}`,
    total: c.pedido.total,
    status: c.pedido.status ?? "cancelled",
    paymentStatus: (c.pedido.payment_status ?? null) as PaymentStatus | null,
    cancelledAfterShipping: Boolean(c.pedido.cancelled_after_shipping),
    returnedToSellerAt: c.pedido.voltou_ao_vendedor
      ? "2026-11-01T12:00:00Z"
      : null,
    valorEstornado: c.pedido.valor_estornado ?? 0,
    valorDevolvidoPorDevolucao: manual / 100,
  } as unknown as Order;
}

function linhasDoLedger(c: Cenario): LinhaFake[] {
  return (c.reembolsos ?? []).map((r) => ({
    order_id: `pedido-${c.id}`,
    amount: r.amount,
    status: r.status,
    solicitado_por: r.solicitado_por,
    tentativas: r.tentativas,
  }));
}

/** A conta de "Devolver agora" (AlertasCancelados), somada: o que o Início promete mostrar. */
function Medidor({ pedidos }: Readonly<{ pedidos: readonly Order[] }>) {
  const noBalde = pedidos.filter((o) => baldeDeEstorno(o) === "devolver_agora");
  const { porPedido } = useEstornosEmCursoDosPedidos(noBalde);
  let quantos = 0;
  let centavos = 0;
  let conferindo = 0;
  for (const pedido of noBalde) {
    const ledger = porPedido.get(pedido.id) ?? { tipo: "conferindo" as const };
    if (ledger.tipo === "conferindo") conferindo += 1;
    const valor =
      ledger.tipo === "conferido"
        ? valorDevolverAgoraDescontandoLedger(pedido, ledger)
        : valorDevolverAgora(pedido);
    if (valor > 0) {
      quantos += 1;
      centavos += centavosDe(valor);
    }
  }
  return (
    <output
      data-pedidos={quantos}
      data-centavos={centavos}
      data-conferindo={conferindo}
    />
  );
}

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  LINHAS_DO_LEDGER = [];
});

async function medir(cenarios: readonly Cenario[]) {
  LINHAS_DO_LEDGER = cenarios.flatMap(linhasDoLedger);
  const pedidos = cenarios.map(pedidoDaTela);
  await act(async () => {
    raiz.render(<Medidor pedidos={pedidos} />);
  });
  // A leitura do ledger é assíncrona: espera ela voltar antes de ler o número.
  await act(async () => {
    await Promise.resolve();
  });
  const saida = tela.querySelector("output");
  return {
    pedidos: Number(saida?.getAttribute("data-pedidos")),
    centavos: Number(saida?.getAttribute("data-centavos")),
    conferindo: Number(saida?.getAttribute("data-conferindo")),
  };
}

describe("o dinheiro a devolver do Início é a conta da lista 'Devolver agora'", () => {
  it("os cenários compartilhados com a prova de banco existem (não é um arquivo vazio)", () => {
    expect(CENARIOS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CENARIOS.map((c) => c.id)).size).toBe(CENARIOS.length);
  });

  for (const c of CENARIOS) {
    it(`${c.id}: ${c.descricao}`, async () => {
      const r = await medir([c]);
      // Se a leitura do ledger não voltou, o número seria o de "ainda conferindo", não o da regra.
      expect(r.conferindo).toBe(0);
      expect({ pedidos: r.pedidos, centavos: r.centavos }).toEqual(c.esperado);
    });
  }

  it("a soma de todos os cenários de uma vez bate com a soma do esperado (um pedido não mascara o outro)", async () => {
    const r = await medir(CENARIOS);
    expect(r.conferindo).toBe(0);
    expect({ pedidos: r.pedidos, centavos: r.centavos }).toEqual({
      pedidos: CENARIOS.reduce((s, c) => s + c.esperado.pedidos, 0),
      centavos: CENARIOS.reduce((s, c) => s + c.esperado.centavos, 0),
    });
  });

  it("controle: sem desconto do ledger (a conta antiga do balde) o estorno em andamento voltaria a ser cobrado", async () => {
    // Prova de que o teste enxerga o ledger: o cenário 'em andamento total' só dá 0 por causa dele.
    const c = CENARIOS.find((x) => x.id === "estorno-em-andamento-total");
    expect(c).toBeDefined();
    if (!c) return;
    const pedido = pedidoDaTela(c);
    expect(baldeDeEstorno(pedido)).toBe("devolver_agora");
    expect(centavosDe(valorDevolverAgora(pedido))).toBeGreaterThan(0);
    expect(c.esperado).toEqual({ pedidos: 0, centavos: 0 });
  });
});
