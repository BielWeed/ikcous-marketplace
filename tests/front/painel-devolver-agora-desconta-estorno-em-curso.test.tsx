// @vitest-environment jsdom
//
// L3e' (lacunas de pagamento, 02/10/2026): cancelar um pedido PAGO que
// ainda não saiu grava uma linha `solicitado` em `order_refunds`, e o cron
// `reconciliar-pagamentos` pede o estorno ao Mercado Pago sozinho em alguns
// minutos. Enquanto isso, o balde "Devolver agora" pedia ao lojista o TOTAL
// do pedido (`valorDevolverAgora` desconta só o que já CONCLUIU) e a frase
// do balde dizia "esta tela não devolve dinheiro nenhum" — o lojista que
// devolvia por fora (PIX do banco, dinheiro) pagava o cliente duas vezes.
//
// Este arquivo prende:
//   1. o valor de "Devolver agora" desconta as linhas EM CURSO
//      (`solicitado`/`em_processamento`) e as CONCLUÍDAS que o retrato da
//      lista ainda não mostra (rodada 2, R2), lidas da tabela que já existe
//      (`order_refunds`, mesma leitura de `useEstornosDoPedido`);
//   2. um aviso por ORIGEM: pedido pelo app, aberto pelo próprio MP
//      (`sistema`, R1) e travado sem confirmação (5+ tentativas, R3) —
//      cada um nomeando o VALOR que não se devolve por fora;
//   3. linha morta (`falhou`/`recusado`) NÃO conta;
//   4. "não sei" nunca vira "nada em curso" calado (conferindo / falhou);
//   5. a frase do balde é verdadeira nos dois casos e usa o mesmo termo dos
//      avisos (G3);
//   6. o confirm de "Já estornei" com devolução em curso pede o TOTAL (R1);
//   7. a recusa de negócio do servidor chega ao lojista como veio (R4);
//   8. o hook: corrida de voos (T2), releitura depois de falha (T3) e o
//      intervalo que só vive enquanto há o que mudar (G1).
//
// Mesmo padrão de mocks de painel-lista-estorno-devido.test.tsx.
import type { Order, PaymentStatus } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface LinhaFake {
  order_id: string;
  amount: number;
  status: string;
  solicitado_por?: string;
  tentativas?: number;
}

interface RespostaFake {
  data: LinhaFake[] | null;
  error: unknown;
}

interface RegistroDeConsulta {
  select: unknown;
  filtros: Array<[string, unknown]>;
}

let RESPOSTA_ORDER_REFUNDS: RespostaFake = { data: [], error: null };
// Quando definido, decide a resposta de CADA consulta (promessa pendente,
// ordem de resolução) — T1/T2.
let RESPONDER:
  | ((registro: RegistroDeConsulta) => Promise<RespostaFake>)
  | null = null;
let consultasOrderRefunds: RegistroDeConsulta[] = [];

function criarBuilderOrderRefunds() {
  const registro: RegistroDeConsulta = { select: undefined, filtros: [] };
  consultasOrderRefunds.push(registro);
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn((colunas: unknown) => {
    registro.select = colunas;
    return builder;
  });
  builder.in = vi.fn((coluna: string, valores: unknown) => {
    registro.filtros.push([coluna, valores]);
    return builder;
  });
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
  builder.then = (resolve: unknown, reject?: unknown) =>
    (RESPONDER
      ? RESPONDER(registro)
      : Promise.resolve(RESPOSTA_ORDER_REFUNDS)
    ).then(resolve as never, reject as never);
  return builder;
}

const rpcMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((tabela: string) => {
      if (tabela === "order_refunds") return criarBuilderOrderRefunds();
      throw new Error(`tabela inesperada neste teste: ${tabela}`);
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastInfoMock = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
    info: (...args: unknown[]) => toastInfoMock(...args),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

let mockPedidosCancelados: Order[] = [];
const fetchPedidosCanceladosMock = vi.fn().mockResolvedValue([]);

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    confirmarRetornoDoProduto: vi.fn(),
    totalOrders: 0,
    isLoaded: true,
    loading: false,
    pedidosCancelados: mockPedidosCancelados,
    carregandoPedidosCancelados: false,
    fetchPedidosCancelados: fetchPedidosCanceladosMock,
    pedidosCanceladosIncompleto: false,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// As recusas EXATAS da migration C-S (20261189000000, outra worktree, lida
// só para copiar o texto — ainda em revisão lá; por isso a tela não casa
// TEXTO, casa o SQLSTATE 22023 que as três usam): `em_processamento` do
// app, `em_processamento` do sistema (disputa) e a de saldo (20261176).
const RECUSA_C_S =
  "O Mercado Pago já está devolvendo este dinheiro ao cliente (o app já pediu a devolução). Não registre nem faça outra devolução: se ela não aparecer no painel do Mercado Pago, faça-a pelo painel do Mercado Pago, nunca por outro caminho.";
const RECUSA_C_S_DISPUTA =
  "Há uma disputa ou devolução do Mercado Pago em andamento para este pedido. Acompanhe pelo painel do Mercado Pago; não devolva por outro meio.";
const RECUSA_SALDO =
  "Este pedido não tem mais nada a devolver: o valor já saiu por outro caminho (devolução ou estorno).";

function pedidoCanceladoPago(overrides: {
  id: string;
  paymentStatus?: PaymentStatus;
  valorEstornado?: number;
  total?: number;
}): Order {
  const total = overrides.total ?? 100;
  return {
    id: overrides.id,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: total,
    shipping: 0,
    discount: 0,
    total,
    paymentMethod: "online",
    status: "cancelled",
    paymentStatus: overrides.paymentStatus ?? "pago",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    returnedToSellerAt: null,
    valorEstornado: overrides.valorEstornado,
  };
}

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

function reiniciarDubles() {
  RESPOSTA_ORDER_REFUNDS = { data: [], error: null };
  RESPONDER = null;
  consultasOrderRefunds = [];
  rpcMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  toastInfoMock.mockReset();
}

describe("'Devolver agora' desconta o que o Mercado Pago já está devolvendo (L3e')", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    reiniciarDubles();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockPedidosCancelados = [];
    fetchPedidosCanceladosMock.mockClear();
  });

  async function montarEAbrir() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    const alavanca = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="alertas-cancelados-alavanca"]',
    );
    expect(alavanca).toBeTruthy();
    await act(async () => {
      alavanca!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function valorPedidoNaLista(idPedido: string): string {
    const item = hospedeiro.querySelector(
      `[data-testid="devolver-agora-item-${idPedido}"]`,
    );
    expect(item, `item ${idPedido} na lista`).toBeTruthy();
    return (
      item!.querySelector('[data-testid="devolver-agora-valor"]')
        ?.textContent ?? ""
    );
  }

  function avisoDoPedido(idPedido: string, testid: string) {
    return hospedeiro.querySelector(
      `[data-testid="devolver-agora-item-${idPedido}"] [data-testid="${testid}"]`,
    );
  }

  const AVISOS = [
    "estorno-em-curso",
    "estorno-em-curso-sistema",
    "estorno-sem-confirmacao",
    "estorno-concluido-recente",
  ];

  async function esperarConferido(idPedido: string) {
    await esperarAte(() => consultasOrderRefunds.length > 0);
    await esperarAte(
      () =>
        avisoDoPedido(idPedido, "estorno-conferindo") === null &&
        avisoDoPedido(idPedido, "estorno-nao-conferido") === null,
    );
  }

  it("estorno automático do valor inteiro em curso: pede R$ 0,00 e o aviso nomeia o valor que não se devolve por fora", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-auto-total" })];
    RESPOSTA_ORDER_REFUNDS = {
      data: [
        {
          order_id: "ped-auto-total",
          amount: 100,
          status: "solicitado",
          solicitado_por: "lojista",
          tentativas: 0,
        },
      ],
      error: null,
    };

    await montarEAbrir();
    await esperarConferido("ped-auto-total");

    expect(valorPedidoNaLista("ped-auto-total")).toContain("0,00");
    expect(valorPedidoNaLista("ped-auto-total")).not.toContain("100,00");
    const aviso = avisoDoPedido("ped-auto-total", "estorno-em-curso")!;
    expect(aviso).toBeTruthy();
    expect(aviso!.closest('[role="status"]')?.getAttribute("data-testid")).toBe(
      "avisos-do-estorno",
    );
    expect(aviso.textContent).toContain("Devolução em andamento");
    expect(aviso.textContent).toContain("o app já pediu ao Mercado Pago");
    expect(aviso.textContent).toContain("Não devolva por fora estes R$ 100,00");
    // O pedido continua na lista: é dali que sai o "Já estornei" de quem já
    // devolveu por fora antes de ler o aviso.
    expect(hospedeiro.textContent).toContain("Já estornei no Mercado Pago");
  });

  it("estorno parcial em curso (duas linhas, centavos): pede só o que falta, somado em centavos", async () => {
    mockPedidosCancelados = [
      pedidoCanceladoPago({ id: "ped-parcial", valorEstornado: 10 }),
    ];
    RESPOSTA_ORDER_REFUNDS = {
      data: [
        { order_id: "ped-parcial", amount: 0.1, status: "solicitado" },
        { order_id: "ped-parcial", amount: 0.2, status: "em_processamento" },
        // Linha de OUTRO pedido não pode vazar para este.
        { order_id: "outro-pedido", amount: 50, status: "solicitado" },
      ],
      error: null,
    };

    await montarEAbrir();
    await esperarConferido("ped-parcial");

    // 100 - 10 (já estornado) - 0,30 (em curso) = 89,70
    expect(valorPedidoNaLista("ped-parcial")).toContain("89,70");
    expect(
      avisoDoPedido("ped-parcial", "estorno-em-curso")!.textContent,
    ).toContain("estes R$ 0,30");
  });

  it("linha que falhou ou foi recusada NÃO conta: pede o valor cheio, sem aviso nenhum", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-falhou" })];
    RESPOSTA_ORDER_REFUNDS = {
      data: [
        { order_id: "ped-falhou", amount: 100, status: "falhou" },
        { order_id: "ped-falhou", amount: 100, status: "recusado" },
      ],
      error: null,
    };

    await montarEAbrir();
    await esperarConferido("ped-falhou");

    expect(valorPedidoNaLista("ped-falhou")).toContain("100,00");
    for (const aviso of AVISOS) {
      expect(avisoDoPedido("ped-falhou", aviso), aviso).toBeNull();
    }
  });

  // R2 (revisão financeira, rodada 2). Este teste INVERTE o da rodada 1
  // ("…ou concluída NÃO conta…", que pedia R$ 100 com uma linha concluída):
  // a linha que concluiu sai do "em curso", mas `valorEstornado` do pedido
  // na lista só muda quando a lista recarrega (realtime). Com o realtime
  // perdido, a rodada 1 voltava a pedir o total SEM aviso — o PIX em dobro.
  it("R2: devolução que CONCLUIU depois do retrato da lista continua descontada, com aviso de já devolvido", async () => {
    mockPedidosCancelados = [
      pedidoCanceladoPago({ id: "ped-concluiu", valorEstornado: 0 }),
    ];
    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-concluiu", amount: 100, status: "concluido" }],
      error: null,
    };

    await montarEAbrir();
    await esperarConferido("ped-concluiu");

    expect(valorPedidoNaLista("ped-concluiu")).toContain("0,00");
    expect(
      avisoDoPedido("ped-concluiu", "estorno-concluido-recente")!.textContent,
    ).toContain("Já devolvido pelo Mercado Pago: R$ 100,00");
  });

  it("R2: concluída que o pedido JÁ mostra (valorEstornado) não é descontada duas vezes", async () => {
    mockPedidosCancelados = [
      pedidoCanceladoPago({ id: "ped-refletido", valorEstornado: 10 }),
    ];
    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-refletido", amount: 10, status: "concluido" }],
      error: null,
    };

    await montarEAbrir();
    await esperarConferido("ped-refletido");

    expect(valorPedidoNaLista("ped-refletido")).toContain("90,00");
    expect(
      avisoDoPedido("ped-refletido", "estorno-concluido-recente"),
    ).toBeNull();
  });

  it("R1: linha do próprio Mercado Pago (sistema, contestação) — o aviso NÃO diz que o app pediu", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-disputa" })];
    RESPOSTA_ORDER_REFUNDS = {
      data: [
        {
          order_id: "ped-disputa",
          amount: 40,
          status: "em_processamento",
          solicitado_por: "sistema",
          tentativas: 0,
        },
      ],
      error: null,
    };

    await montarEAbrir();
    await esperarConferido("ped-disputa");

    expect(valorPedidoNaLista("ped-disputa")).toContain("60,00");
    const aviso = avisoDoPedido("ped-disputa", "estorno-em-curso-sistema")!;
    expect(aviso).toBeTruthy();
    expect(aviso.textContent).toContain("Devolução em andamento");
    expect(aviso.textContent).toContain("devolução ou disputa em andamento");
    expect(aviso.textContent).toContain("Não devolva por fora estes R$ 40,00");
    expect(hospedeiro.textContent).not.toContain("o app já pediu");
  });

  it("R3: linha travada (em_processamento, 5+ tentativas) — mantém o desconto, mas manda conferir no painel do MP", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-travado" })];
    RESPOSTA_ORDER_REFUNDS = {
      data: [
        {
          order_id: "ped-travado",
          amount: 100,
          status: "em_processamento",
          solicitado_por: "lojista",
          tentativas: 5,
        },
      ],
      error: null,
    };

    await montarEAbrir();
    await esperarConferido("ped-travado");

    expect(valorPedidoNaLista("ped-travado")).toContain("0,00");
    const aviso = avisoDoPedido("ped-travado", "estorno-sem-confirmacao")!;
    expect(aviso).toBeTruthy();
    expect(aviso.textContent).toContain(
      "não consegui confirmar esta devolução de R$ 100,00 — confira no painel do Mercado Pago antes de devolver por outro meio",
    );
    expect(avisoDoPedido("ped-travado", "estorno-em-curso")).toBeNull();
  });

  it("R3: 4 tentativas ainda é devolução andando (o teto do cron é 5)", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-quase" })];
    RESPOSTA_ORDER_REFUNDS = {
      data: [
        {
          order_id: "ped-quase",
          amount: 100,
          status: "em_processamento",
          solicitado_por: "lojista",
          tentativas: 4,
        },
      ],
      error: null,
    };

    await montarEAbrir();
    await esperarConferido("ped-quase");

    expect(avisoDoPedido("ped-quase", "estorno-em-curso")).toBeTruthy();
    expect(avisoDoPedido("ped-quase", "estorno-sem-confirmacao")).toBeNull();
  });

  it("a leitura pergunta à tabela que já existe, só pelos pedidos da lista, pelas linhas em curso e concluídas", async () => {
    mockPedidosCancelados = [
      pedidoCanceladoPago({ id: "ped-a" }),
      pedidoCanceladoPago({ id: "ped-b" }),
      // Estornado não está na lista: não entra na consulta.
      pedidoCanceladoPago({ id: "ped-fora", paymentStatus: "estornado" }),
    ];

    await montarEAbrir();
    await esperarAte(() => consultasOrderRefunds.length > 0);

    const consulta = consultasOrderRefunds[0]!;
    for (const coluna of [
      "order_id",
      "amount",
      "status",
      "solicitado_por",
      "tentativas",
    ]) {
      expect(String(consulta.select)).toContain(coluna);
    }
    const porColuna = new Map(consulta.filtros);
    expect([...(porColuna.get("order_id") as string[])].sort()).toEqual([
      "ped-a",
      "ped-b",
    ]);
    expect([...(porColuna.get("status") as string[])].sort()).toEqual([
      "concluido",
      "em_processamento",
      "solicitado",
    ]);
  });

  it("T1: leitura ainda pendente — mostra 'Conferindo…' e o valor CHEIO, sem aviso de andamento", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-pendente" })];
    RESPONDER = () => new Promise<RespostaFake>(() => {});

    await montarEAbrir();
    await esperarAte(() => consultasOrderRefunds.length > 0);

    const conferindo = avisoDoPedido("ped-pendente", "estorno-conferindo");
    expect(conferindo).toBeTruthy();
    expect(
      conferindo!.closest('[role="status"]')?.getAttribute("data-testid"),
    ).toBe("avisos-do-estorno");
    expect(conferindo!.textContent).toContain("Conferindo");
    expect(valorPedidoNaLista("ped-pendente")).toContain("100,00");
    for (const aviso of AVISOS) {
      expect(avisoDoPedido("ped-pendente", aviso), aviso).toBeNull();
    }
  });

  it("leitura que FALHOU: a tela diz que não conferiu, em vez de fingir que nada está em curso", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-erro" })];
    RESPOSTA_ORDER_REFUNDS = { data: null, error: { message: "rede caiu" } };

    await montarEAbrir();
    await esperarAte(
      () => avisoDoPedido("ped-erro", "estorno-nao-conferido") !== null,
    );

    const aviso = avisoDoPedido("ped-erro", "estorno-nao-conferido")!;
    expect(aviso.textContent).toMatch(/não deu para conferir/i);
    // B2b rodada 2: a devolução automática pode estar andando sem aviso —
    // o aviso manda abrir o pedido antes de ENVIAR, não só antes de devolver.
    expect(aviso.textContent).toContain(
      "Abra o pedido antes de enviar o produto ou de devolver por fora.",
    );
    expect(aviso!.closest('[role="status"]')?.getAttribute("data-testid")).toBe(
      "avisos-do-estorno",
    );
    expect(valorPedidoNaLista("ped-erro")).toContain("100,00");
    expect(avisoDoPedido("ped-erro", "estorno-em-curso")).toBeNull();
  });

  it("a frase do balde é verdadeira nos dois casos e usa o MESMO termo dos avisos (G3)", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-frase" })];
    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-frase", amount: 100, status: "solicitado" }],
      error: null,
    };

    await montarEAbrir();
    await esperarConferido("ped-frase");

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Estorno devido");
    expect(texto).not.toContain("não devolve dinheiro nenhum");
    expect(texto).not.toContain("Estornar é uma ação sua");
    expect(texto).toContain("Os pedidos marcados com “Devolução em andamento”");
    expect(texto).toContain("sozinho");
    expect(texto).toContain("NÃO devolva por outro meio");
    expect(texto).toContain("duas vezes");
    expect(texto).toContain("Os outros dependem de você");
    expect(avisoDoPedido("ped-frase", "estorno-em-curso")!.textContent).toMatch(
      /^Devolução em andamento/,
    );
  });

  it("F2a: devolução que COMEÇA depois da leitura, com os mesmos pedidos — abrir o painel relê e o aviso aparece", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-novo-ini" })];
    RESPOSTA_ORDER_REFUNDS = { data: [], error: null };

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await esperarAte(() => consultasOrderRefunds.length > 0);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const leiturasAntes = consultasOrderRefunds.length;

    // Sem mudança nenhuma em marketplace_orders (sem realtime, mesmos ids).
    RESPOSTA_ORDER_REFUNDS = {
      data: [
        {
          order_id: "ped-novo-ini",
          amount: 100,
          status: "em_processamento",
          solicitado_por: "lojista",
          tentativas: 1,
        },
      ],
      error: null,
    };
    const alavanca = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="alertas-cancelados-alavanca"]',
    )!;
    await act(async () => {
      alavanca.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await esperarAte(
      () => avisoDoPedido("ped-novo-ini", "estorno-em-curso") !== null,
    );
    expect(consultasOrderRefunds.length).toBeGreaterThan(leiturasAntes);
    expect(valorPedidoNaLista("ped-novo-ini")).toContain("0,00");
  });

  it("F2b: a lista recarrega valorEstornado (30) enquanto o hook guardava 30 em curso — NÃO desconta duas vezes", async () => {
    mockPedidosCancelados = [
      pedidoCanceladoPago({ id: "ped-dobra", valorEstornado: 0 }),
    ];
    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-dobra", amount: 30, status: "solicitado" }],
      error: null,
    };
    await montarEAbrir();
    await esperarConferido("ped-dobra");
    expect(valorPedidoNaLista("ped-dobra")).toContain("70,00");

    // O MP concluiu os 30; a lista (realtime) já traz valorEstornado = 30.
    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-dobra", amount: 30, status: "concluido" }],
      error: null,
    };
    mockPedidosCancelados = [
      pedidoCanceladoPago({ id: "ped-dobra", valorEstornado: 30 }),
    ];
    const leiturasAntes = consultasOrderRefunds.length;
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      // onNavigate novo: a view é memo, e é assim que o pai a re-renderiza.
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    // Nunca o retrato misturado (30 estornado + 30 "em curso" velho = 40).
    expect(valorPedidoNaLista("ped-dobra")).not.toContain("40,00");
    await esperarAte(() => consultasOrderRefunds.length > leiturasAntes);
    await esperarConferido("ped-dobra");
    expect(valorPedidoNaLista("ped-dobra")).toContain("70,00");
    expect(avisoDoPedido("ped-dobra", "estorno-em-curso")).toBeNull();
  });

  it("F3: a região viva de cada pedido nasce JUNTO com o item e continua montada quando o aviso muda", async () => {
    mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-vivo" })];
    let liberar: (r: RespostaFake) => void = () => {};
    RESPONDER = () =>
      new Promise<RespostaFake>((resolve) => {
        liberar = resolve;
      });

    await montarEAbrir();
    await esperarAte(() => consultasOrderRefunds.length > 0);
    const regiao = hospedeiro.querySelector(
      '[data-testid="devolver-agora-item-ped-vivo"] [data-testid="avisos-do-estorno"]',
    );
    expect(regiao).toBeTruthy();
    expect(regiao!.getAttribute("role")).toBe("status");

    await act(async () => {
      liberar({
        data: [{ order_id: "ped-vivo", amount: 100, status: "solicitado" }],
        error: null,
      });
    });
    await esperarAte(
      () => avisoDoPedido("ped-vivo", "estorno-em-curso") !== null,
    );
    // A MESMA região (não uma nova nascida já com texto).
    expect(
      hospedeiro.querySelector(
        '[data-testid="devolver-agora-item-ped-vivo"] [data-testid="avisos-do-estorno"]',
      ),
    ).toBe(regiao);
    expect(regiao!.textContent).toContain("Devolução em andamento");
    // Só uma região viva por pedido.
    expect(
      hospedeiro.querySelectorAll(
        '[data-testid="devolver-agora-item-ped-vivo"] [role="status"]',
      ).length,
    ).toBe(1);
  });

  describe("confirm de 'Já estornei no Mercado Pago'", () => {
    let confirmSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      confirmSpy = vi.fn(() => false);
      vi.stubGlobal("confirm", confirmSpy);
    });

    async function clicarJaEstornei() {
      const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Já estornei no Mercado Pago",
      );
      expect(botao).toBeTruthy();
      await act(async () => {
        botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      // Rodada 4 (F2c): a pergunta só sai DEPOIS da leitura fresca do pedido.
      await esperarAte(() => confirmSpy.mock.calls.length > 0);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      return String(confirmSpy.mock.calls[0]?.[0] ?? "");
    }

    function botaoJaEstornei() {
      return hospedeiro.querySelector<HTMLButtonElement>(
        '[data-testid^="devolver-agora-item-"] button',
      );
    }

    it("F1: linha TRAVADA (5+ tentativas) — o confirm NÃO diz que o dinheiro já está voltando; manda conferir no painel do MP", async () => {
      mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-trava-c" })];
      RESPOSTA_ORDER_REFUNDS = {
        data: [
          {
            order_id: "ped-trava-c",
            amount: 100,
            status: "em_processamento",
            solicitado_por: "lojista",
            tentativas: 5,
          },
        ],
        error: null,
      };

      await montarEAbrir();
      await esperarConferido("ped-trava-c");
      const pergunta = await clicarJaEstornei();

      expect(pergunta).toContain(
        "Não consegui confirmar a devolução de R$ 100,00 pelo Mercado Pago",
      );
      expect(pergunta).toContain(
        "Confira no painel do Mercado Pago antes de confirmar ou de devolver por outro meio",
      );
      expect(pergunta).not.toContain("já está voltando");
      expect(pergunta).not.toContain("espere a devolução");
      expect(pergunta).toContain("o valor TOTAL de R$ 100,00");
    });

    it("F2c: 'Já estornei' lê o pedido de NOVO antes de perguntar — a pergunta usa a leitura fresca, não a da lista", async () => {
      mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-fresco" })];
      // A lista leu: nada em curso.
      RESPOSTA_ORDER_REFUNDS = { data: [], error: null };

      await montarEAbrir();
      await esperarConferido("ped-fresco");
      expect(avisoDoPedido("ped-fresco", "estorno-em-curso")).toBeNull();

      // Outro admin tocou "Devolver R$ 30" no card: a linha nasceu depois.
      RESPOSTA_ORDER_REFUNDS = {
        data: [
          {
            order_id: "ped-fresco",
            amount: 30,
            status: "em_processamento",
            solicitado_por: "lojista",
            tentativas: 1,
          },
        ],
        error: null,
      };
      const leiturasAntes = consultasOrderRefunds.length;
      const pergunta = await clicarJaEstornei();

      expect(consultasOrderRefunds.length).toBeGreaterThan(leiturasAntes);
      expect(
        new Map(consultasOrderRefunds.at(leiturasAntes)!.filtros).get(
          "order_id",
        ),
      ).toEqual(["ped-fresco"]);
      expect(pergunta).toContain(
        "O app já pediu ao Mercado Pago a devolução de R$ 30,00",
      );
      expect(pergunta).toContain("o valor TOTAL de R$ 100,00");
      expect(pergunta).not.toContain("Confirma que você JÁ devolveu");
    });

    it("F2c: enquanto a leitura fresca não volta, o botão mostra 'Conferindo…' e fica desligado (nenhuma pergunta ainda)", async () => {
      mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-espera" })];
      let chamadas = 0;
      RESPONDER = () => {
        chamadas += 1;
        return chamadas === 1
          ? Promise.resolve({ data: [], error: null })
          : new Promise<RespostaFake>(() => {});
      };

      await montarEAbrir();
      await esperarConferido("ped-espera");
      await act(async () => {
        botaoJaEstornei()!.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });

      expect(botaoJaEstornei()!.textContent?.trim()).toBe("Conferindo…");
      // B1c (revisão do front): `aria-disabled` + `aria-busy`, NÃO
      // `disabled` — o botão desligado perde o foco do teclado.
      expect(botaoJaEstornei()!.disabled).toBe(false);
      expect(botaoJaEstornei()!.getAttribute("aria-disabled")).toBe("true");
      expect(botaoJaEstornei()!.getAttribute("aria-busy")).toBe("true");
      // ...e o "Conferindo…" é dito na região viva do pedido.
      expect(
        hospedeiro.querySelector(
          '[data-testid="devolver-agora-item-ped-espera"] [data-testid="avisos-do-estorno"]',
        )?.textContent,
      ).toContain("Conferindo este pedido no Mercado Pago");
      expect(confirmSpy).not.toHaveBeenCalled();

      // Clique de novo enquanto confere: nada (nenhuma leitura nova).
      const leiturasAntes = consultasOrderRefunds.length;
      await act(async () => {
        botaoJaEstornei()!.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      expect(consultasOrderRefunds.length).toBe(leiturasAntes);
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("B1c: a tela deixa de estar ativa DURANTE a leitura fresca — a pergunta não abre e nada é registrado", async () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }));
      confirmSpy.mockImplementation(() => true);
      mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-saiu" })];
      // As leituras da lista respondem na hora; a partir do clique, a
      // leitura (a fresca do "Já estornei") fica na mão do teste.
      let segurar = false;
      let liberarFresca: ((r: RespostaFake) => void) | null = null;
      RESPONDER = () =>
        segurar
          ? new Promise<RespostaFake>((resolve) => {
              liberarFresca = resolve;
            })
          : Promise.resolve({ data: [], error: null });

      const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
      await act(async () => {
        raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
      });
      const alavanca = hospedeiro.querySelector<HTMLButtonElement>(
        'button[data-testid="alertas-cancelados-alavanca"]',
      )!;
      await act(async () => {
        alavanca.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await esperarConferido("ped-saiu");
      // Deixa assentar a releitura de abrir o painel.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      segurar = true;
      await act(async () => {
        botaoJaEstornei()!.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      await esperarAte(() => liberarFresca !== null);
      expect(botaoJaEstornei()!.textContent?.trim()).toBe("Conferindo…");

      // O lojista saiu da tela de pedidos enquanto a leitura voava.
      await act(async () => {
        raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
      });
      segurar = false;
      await act(async () => {
        liberarFresca!({ data: [], error: null });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(confirmSpy).not.toHaveBeenCalled();
      // Com a tela ativa a view chama outras RPCs; a que importa é esta.
      expect(rpcMock).not.toHaveBeenCalledWith(
        "registrar_estorno_manual",
        expect.anything(),
      );
      // B2b: abandonar não é silencioso — o aviso fica para quando ele voltar.
      expect(toastInfoMock).toHaveBeenCalledWith(
        "Conferência interrompida: nada foi registrado. Para registrar o estorno, volte em “Pedidos” e toque de novo em “Já estornei no Mercado Pago”.",
        { duration: 10_000 },
      );
      // Abandonado sem registrar: o botão volta ao normal para outro toque.
      await esperarAte(
        () =>
          botaoJaEstornei()?.textContent?.trim() ===
          "Já estornei no Mercado Pago",
      );
    });

    it("R1: R$ 30 em curso num pedido de R$ 100 — pede confirmação do TOTAL (R$ 100) e manda esperar quem devolveu só R$ 70", async () => {
      mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-confirm" })];
      RESPOSTA_ORDER_REFUNDS = {
        data: [
          {
            order_id: "ped-confirm",
            amount: 30,
            status: "solicitado",
            solicitado_por: "lojista",
          },
        ],
        error: null,
      };

      await montarEAbrir();
      await esperarConferido("ped-confirm");
      expect(valorPedidoNaLista("ped-confirm")).toContain("70,00");
      const pergunta = await clicarJaEstornei();

      expect(pergunta).toContain(
        "O app já pediu ao Mercado Pago a devolução de R$ 30,00",
      );
      expect(pergunta).toContain(
        "o pedido inteiro passa a contar como devolvido",
      );
      expect(pergunta).toContain("pode ser cancelada");
      expect(pergunta).toContain("o app pode recusar o registro");
      expect(pergunta).toContain("o valor TOTAL de R$ 100,00");
      expect(pergunta).toContain("Se você devolveu só R$ 70,00 (ou nada)");
      expect(pergunta).toContain("toque em Cancelar");
      // A pergunta antiga ("JÁ devolveu R$ 100 no painel?") não aparece:
      // ela não dizia que confirmar cancela os R$ 30 em curso.
      expect(pergunta).not.toContain("Confirma que você JÁ devolveu");
      // Recusou o confirm: nada foi registrado.
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("R1: valor inteiro em curso — quem não devolveu nada por fora é mandado cancelar", async () => {
      mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-inteiro" })];
      RESPOSTA_ORDER_REFUNDS = {
        data: [{ order_id: "ped-inteiro", amount: 100, status: "solicitado" }],
        error: null,
      };

      await montarEAbrir();
      await esperarConferido("ped-inteiro");
      const pergunta = await clicarJaEstornei();

      expect(pergunta).toContain("o valor TOTAL de R$ 100,00");
      expect(pergunta).toContain(
        "Se você não devolveu nada por fora, toque em Cancelar",
      );
      expect(pergunta).not.toContain("Se você devolveu só R$ 0,00");
    });

    it("R1: linha do próprio MP (sistema) — o confirm NÃO diz que o app pediu", async () => {
      mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-cb" })];
      RESPOSTA_ORDER_REFUNDS = {
        data: [
          {
            order_id: "ped-cb",
            amount: 100,
            status: "em_processamento",
            solicitado_por: "sistema",
          },
        ],
        error: null,
      };

      await montarEAbrir();
      await esperarConferido("ped-cb");
      const pergunta = await clicarJaEstornei();

      expect(pergunta).not.toContain("O app já pediu");
      expect(pergunta).toContain(
        "O Mercado Pago tem uma devolução ou disputa em andamento de R$ 100,00",
      );
    });

    it("sem nada em curso: a pergunta de sempre, sem o aviso de devolução automática", async () => {
      mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-manual" })];

      await montarEAbrir();
      await esperarConferido("ped-manual");
      const pergunta = await clicarJaEstornei();

      expect(pergunta).toContain("Confirma que você JÁ devolveu R$ 100,00");
      expect(pergunta).not.toContain("ATENÇÃO");
      // Conferido e sem nada em curso: nenhum aviso de "não conferi" (sem ruído).
      expect(pergunta).not.toContain("Não consegui conferir");
      // B2b: a tela seguiu ativa — o aviso de "conferência interrompida" é
      // só do abandono, nunca do caminho normal.
      expect(
        toastInfoMock.mock.calls.filter((c) =>
          String(c[0]).includes("Conferência interrompida"),
        ),
      ).toEqual([]);
    });

    // Rodada 3: no estado DESCONHECIDO (leitura pendente ou falha) o lojista
    // não tem como saber se o Mercado Pago já está devolvendo — a pergunta
    // de sempre ("JÁ devolveu R$ 100 no painel?") calava exatamente isso.
    it.each([
      [
        "conferindo (lista pendente, leitura fresca falhou)",
        () => {
          // Leitura da montagem e a releitura de abrir o painel ficam
          // pendentes (a lista segue "conferindo"); a leitura FRESCA do
          // "Já estornei" (3ª) falha.
          let chamadas = 0;
          RESPONDER = () => {
            chamadas += 1;
            return chamadas <= 2
              ? new Promise<RespostaFake>(() => {})
              : Promise.resolve({ data: null, error: { message: "rede" } });
          };
        },
        "estorno-conferindo",
      ],
      [
        "não conferido (leitura falhou)",
        () => {
          RESPOSTA_ORDER_REFUNDS = {
            data: null,
            error: { message: "rede caiu" },
          };
        },
        "estorno-nao-conferido",
      ],
    ])(
      "estado desconhecido — %s: a pergunta abre avisando que não deu para conferir e pede o TOTAL",
      async (_caso, preparar, avisoEsperado) => {
        mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-incerto" })];
        preparar();

        await montarEAbrir();
        await esperarAte(
          () => avisoDoPedido("ped-incerto", avisoEsperado) !== null,
        );
        const pergunta = await clicarJaEstornei();

        expect(pergunta).toMatch(
          /^ATENÇÃO: Não consegui conferir agora se o Mercado Pago já está devolvendo/,
        );
        expect(pergunta).toContain("painel do Mercado Pago");
        expect(pergunta).toContain("toque em Cancelar");
        expect(pergunta).toContain("o valor TOTAL de R$ 100,00");
        expect(rpcMock).not.toHaveBeenCalled();
      },
    );

    describe("R4: a resposta do servidor ao 'Já estornei'", () => {
      beforeEach(() => {
        confirmSpy.mockImplementation(() => true);
      });

      it.each([
        ["em_processamento do app (C-S)", RECUSA_C_S],
        ["disputa do sistema (C-S)", RECUSA_C_S_DISPUTA],
        ["nada mais a devolver (20261176)", RECUSA_SALDO],
      ])(
        "recusa 22023 — %s: o lojista lê a frase do servidor, NUNCA 'Tente de novo'",
        async (_caso, mensagem) => {
          mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-recusa" })];
          rpcMock.mockResolvedValue({
            data: null,
            error: { code: "22023", message: mensagem },
          });

          await montarEAbrir();
          await esperarConferido("ped-recusa");
          await clicarJaEstornei();
          await esperarAte(() => toastErrorMock.mock.calls.length > 0);

          expect(rpcMock).toHaveBeenCalledWith("registrar_estorno_manual", {
            p_order_id: "ped-recusa",
          });
          expect(toastErrorMock).toHaveBeenCalledWith(mensagem);
          expect(String(toastErrorMock.mock.calls[0]?.[0])).not.toContain(
            "Tente de novo",
          );
          expect(toastSuccessMock).not.toHaveBeenCalled();
        },
      );

      it("erro que não é recusa de negócio (permissão/rede): continua o aviso genérico", async () => {
        mockPedidosCancelados = [pedidoCanceladoPago({ id: "ped-rede" })];
        rpcMock.mockResolvedValue({
          data: null,
          error: {
            code: "42501",
            message: "somente a loja registra o estorno",
          },
        });

        await montarEAbrir();
        await esperarConferido("ped-rede");
        await clicarJaEstornei();
        await esperarAte(() => toastErrorMock.mock.calls.length > 0);

        expect(toastErrorMock).toHaveBeenCalledWith(
          "Não consegui registrar o estorno. Tente de novo.",
        );
      });
    });
  });
});

describe("useEstornosEmCursoDosPedidos — o hook", () => {
  beforeEach(() => {
    reiniciarDubles();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  type Situacao = { tipo: string; [k: string]: unknown } | undefined;

  async function montarSonda(
    idsIniciais: string[],
    opcoes: { ativo?: boolean } = {},
  ) {
    const { useEstornosEmCursoDosPedidos } = await import(
      "@/hooks/useEstornosEmCursoDosPedidos"
    );
    const vistos: Map<string, unknown>[] = [];
    let api: {
      conferirAgora: (id: string) => Promise<unknown>;
      recarregar: () => void;
    } | null = null;
    function Sonda({
      ids,
      aoVer,
    }: {
      ids: string[];
      aoVer: (r: {
        porPedido: ReadonlyMap<string, unknown>;
        conferirAgora: (id: string) => Promise<unknown>;
        recarregar: () => void;
      }) => void;
    }) {
      const resultado = useEstornosEmCursoDosPedidos(
        ids.map((id) => ({ id })),
        opcoes,
      );
      useEffect(() => {
        aoVer(resultado);
      }, [resultado, aoVer]);
      return null;
    }
    const aoVer = (r: {
      porPedido: ReadonlyMap<string, unknown>;
      conferirAgora: (id: string) => Promise<unknown>;
      recarregar: () => void;
    }) => {
      vistos.push(new Map(r.porPedido));
      api = r;
    };
    const hospedeiro = document.createElement("div");
    const raiz = createRoot(hospedeiro);
    const render = async (ids: string[]) => {
      await act(async () => {
        raiz.render(<Sonda ids={ids} aoVer={aoVer} />);
      });
    };
    await render(idsIniciais);
    return {
      render,
      api: () => api!,
      ultimo: (id: string) => vistos[vistos.length - 1]?.get(id) as Situacao,
      desmontar: () =>
        act(() => {
          raiz.unmount();
        }),
    };
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("F2c: conferirAgora lê SÓ o pedido pedido e devolve a situação fresca", async () => {
    RESPOSTA_ORDER_REFUNDS = { data: [], error: null };
    const sonda = await montarSonda(["ped-f1", "ped-f2"]);
    await esperarAte(() => sonda.ultimo("ped-f1")?.tipo === "conferido");
    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-f1", amount: 25, status: "solicitado" }],
      error: null,
    };
    const antes = consultasOrderRefunds.length;
    let fresco: unknown;
    await act(async () => {
      fresco = await sonda.api().conferirAgora("ped-f1");
    });
    expect(
      new Map(consultasOrderRefunds.at(antes)!.filtros).get("order_id"),
    ).toEqual(["ped-f1"]);
    expect(fresco).toMatchObject({ tipo: "conferido", emCurso: 25 });
    sonda.desmontar();
  });

  it("F2c: conferirAgora que não volta em 8 s vira 'não conferido' (nunca prende o botão)", async () => {
    vi.useFakeTimers();
    RESPOSTA_ORDER_REFUNDS = { data: [], error: null };
    const sonda = await montarSonda(["ped-lento"]);
    await avancar(0);
    RESPONDER = () => new Promise<RespostaFake>(() => {});
    let fresco: unknown = "pendente";
    void sonda
      .api()
      .conferirAgora("ped-lento")
      .then((r) => {
        fresco = r;
      });
    await avancar(7_000);
    expect(fresco).toBe("pendente");
    await avancar(1_500);
    expect(fresco).toEqual({ tipo: "nao_conferido" });
    sonda.desmontar();
  });

  it("R2: a linha em curso CONCLUI — a próxima releitura mostra o concluído, e o intervalo para", async () => {
    vi.useFakeTimers();
    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-poll", amount: 100, status: "solicitado" }],
      error: null,
    };
    const sonda = await montarSonda(["ped-poll"]);
    await avancar(0);
    expect(sonda.ultimo("ped-poll")).toMatchObject({
      tipo: "conferido",
      emCurso: 100,
      concluido: 0,
    });

    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-poll", amount: 100, status: "concluido" }],
      error: null,
    };
    await avancar(15_000);
    expect(sonda.ultimo("ped-poll")).toMatchObject({
      tipo: "conferido",
      emCurso: 0,
      concluido: 100,
    });

    // Nada mais em curso: o intervalo some e não relê de novo.
    const leiturasAteAqui = consultasOrderRefunds.length;
    await avancar(60_000);
    expect(consultasOrderRefunds.length).toBe(leiturasAteAqui);
    sonda.desmontar();
  });

  it("T3: depois de uma leitura que FALHOU, relê sozinho em 15s", async () => {
    vi.useFakeTimers();
    RESPOSTA_ORDER_REFUNDS = { data: null, error: { message: "rede caiu" } };
    const sonda = await montarSonda(["ped-falha"]);
    await avancar(0);
    expect(sonda.ultimo("ped-falha")).toEqual({ tipo: "nao_conferido" });
    const leiturasAteAqui = consultasOrderRefunds.length;

    RESPOSTA_ORDER_REFUNDS = { data: [], error: null };
    await avancar(15_000);
    expect(consultasOrderRefunds.length).toBeGreaterThan(leiturasAteAqui);
    expect(sonda.ultimo("ped-falha")).toMatchObject({
      tipo: "conferido",
      emCurso: 0,
    });
    sonda.desmontar();
  });

  it("T2: a resposta VELHA (lista anterior) que chega por último não sobrescreve a nova", async () => {
    const pendentes: Array<{
      ids: string[];
      resolver: (r: RespostaFake) => void;
    }> = [];
    RESPONDER = (registro) =>
      new Promise<RespostaFake>((resolve) => {
        const ids = (new Map(registro.filtros).get("order_id") ??
          []) as string[];
        pendentes.push({ ids, resolver: resolve });
      });

    const sonda = await montarSonda(["ped-velho"]);
    await esperarAte(() => pendentes.length === 1);
    await sonda.render(["ped-novo"]);
    await esperarAte(() => pendentes.length === 2);
    expect(pendentes[1]!.ids).toEqual(["ped-novo"]);

    // A nova chega primeiro…
    await act(async () => {
      pendentes[1]!.resolver({
        data: [{ order_id: "ped-novo", amount: 20, status: "solicitado" }],
        error: null,
      });
    });
    await esperarAte(() => sonda.ultimo("ped-novo")?.tipo === "conferido");
    // …a velha por último.
    await act(async () => {
      pendentes[0]!.resolver({
        data: [{ order_id: "ped-velho", amount: 99, status: "solicitado" }],
        error: null,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(sonda.ultimo("ped-novo")).toMatchObject({
      tipo: "conferido",
      emCurso: 20,
    });
    sonda.desmontar();
  });

  it("G1: linha TRAVADA (5+ tentativas) sozinha não mantém o intervalo vivo", async () => {
    vi.useFakeTimers();
    RESPOSTA_ORDER_REFUNDS = {
      data: [
        {
          order_id: "ped-trava",
          amount: 100,
          status: "em_processamento",
          tentativas: 7,
        },
      ],
      error: null,
    };
    const sonda = await montarSonda(["ped-trava"]);
    await avancar(0);
    expect(sonda.ultimo("ped-trava")).toMatchObject({
      tipo: "conferido",
      semConfirmacao: 100,
      emCurso: 100,
    });
    const leiturasAteAqui = consultasOrderRefunds.length;
    await avancar(60_000);
    expect(consultasOrderRefunds.length).toBe(leiturasAteAqui);
    sonda.desmontar();
  });

  it("G1: tela inativa não relê, mesmo com devolução andando", async () => {
    vi.useFakeTimers();
    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-inativo", amount: 100, status: "solicitado" }],
      error: null,
    };
    const sonda = await montarSonda(["ped-inativo"], { ativo: false });
    await avancar(0);
    expect(sonda.ultimo("ped-inativo")).toMatchObject({ emCurso: 100 });
    const leiturasAteAqui = consultasOrderRefunds.length;
    await avancar(60_000);
    expect(consultasOrderRefunds.length).toBe(leiturasAteAqui);
    sonda.desmontar();
  });

  it("G1: lista que esvazia derruba o intervalo", async () => {
    vi.useFakeTimers();
    RESPOSTA_ORDER_REFUNDS = {
      data: [{ order_id: "ped-sai", amount: 100, status: "solicitado" }],
      error: null,
    };
    const sonda = await montarSonda(["ped-sai"]);
    await avancar(0);
    await sonda.render([]);
    const leiturasAteAqui = consultasOrderRefunds.length;
    await avancar(60_000);
    expect(consultasOrderRefunds.length).toBe(leiturasAteAqui);
    sonda.desmontar();
  });
});
