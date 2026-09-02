// @vitest-environment jsdom
//
// Task 5 do plano
// docs/superpowers/plans/2026-08-24-cancelamento-com-estorno.md — o lojista
// passa a ver o que precisa estornar. A lista é DERIVADA (nunca gravada):
// `baldeDeEstorno(pedido)` separa pedido cancelado E pago em dois baldes —
// "devolver_agora" (não enviado, ou já enviado e o produto já voltou) e
// "esperando_o_produto" (enviado, produto ainda não voltou). `estornado` e
// "nunca foi pago" não entram em balde nenhum: são os dois casos que
// impedem a lista de virar ruído permanente.
//
// A HONESTIDADE DA TELA é a parte que não pode falhar (ver o prompt da
// tarefa): o app NÃO estorna sozinho. A lista existe para o lojista SABER o
// que deve, não para prometer que o app devolve o dinheiro.
//
// Mesmo padrão de mock de admin-orders-payment-filter.test.tsx:
// `@/lib/supabase` mocado porque AdminOrdersView.tsx importa `supabase` no
// topo (fetch de pedido avulso por deep link); `useOrders` mocado porque a
// RPC paginada, o canal realtime e o `useAnalytics` não são o que esta
// tarefa muda.
import type { Order, OrderStatus, PaymentStatus } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// A-3 (laudo varredura 01/09): AdminOrdersView passou a ler o nome da loja
// (config.storeName) para o recibo impresso — mock mínimo do contexto, mesmo
// padrão de admin-coupons-view-expirado.test.tsx. Sem ele o useStore lança
// 'must be used within a StoreProvider' em toda montagem da view.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

// `orders` (a página FILTRADA/paginada da tela principal) e
// `pedidosCancelados` (a consulta PRÓPRIA e independente do painel de
// mercadoria/estorno) são dois campos DIFERENTES do hook desde o BLOQUEIA 1
// da revisão de 26/08/2026 — ver o docstring de
// `useOrders.fetchPedidosCancelados`. Por padrão `mockOrders` fica vazio
// nestes testes: é exatamente o que acontece na tela de verdade com o
// filtro padrão "Em Aberto" (exclui `cancelled`), e é isso que prova que os
// baldes não dependem mais dele.
let mockOrders: Order[] = [];
let mockTotalOrders = 0;
let mockPedidosCancelados: Order[] = [];
// Achados B/D da revisão de 26/08/2026 (rodada 4): erro engolido pela RPC e
// truncagem pelo teto de páginas têm o MESMO efeito na tela — a lista fica
// menor que a realidade — e precisam do MESMO sinal. `false` por padrão:
// nenhum teste pré-existente deste arquivo esperava banner nenhum.
let mockPedidosCanceladosIncompleto = false;
const confirmarRetornoDoProdutoMock = vi.fn().mockResolvedValue({ ok: true });
const fetchPedidosCanceladosMock = vi.fn().mockResolvedValue([]);

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    confirmarRetornoDoProduto: confirmarRetornoDoProdutoMock,
    totalOrders: mockTotalOrders,
    isLoaded: true,
    loading: false,
    pedidosCancelados: mockPedidosCancelados,
    carregandoPedidosCancelados: false,
    fetchPedidosCancelados: fetchPedidosCanceladosMock,
    pedidosCanceladosIncompleto: mockPedidosCanceladosIncompleto,
  }),
}));

// `let`, não `const`: o Item 1 da revisão de 27/08/2026 precisa de um
// `paidOnCancelled` configurável para testar o banner âmbar (linha ~1025 de
// AdminOrdersView.tsx) — mesmo padrão de
// admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx. `null` por
// padrão preserva o comportamento de todos os testes já existentes neste
// arquivo, que nunca configuram isto.
let mockAnalyticsStats: { paidOnCancelled?: number } | null = null;

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: mockAnalyticsStats,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(overrides: {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus | null;
  cancelledAfterShipping?: boolean;
  returnedToSellerAt?: string | null;
}): Order {
  return {
    id: overrides.id,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [
      {
        productId: "prod-1",
        name: "Produto Teste",
        price: 100,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: overrides.status,
    paymentStatus: overrides.paymentStatus,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: overrides.cancelledAfterShipping ?? false,
    returnedToSellerAt: overrides.returnedToSellerAt ?? null,
  };
}

// embla-carousel-react (usado pelo AdminKpiCarousel, que só monta quando
// active=true) usa ResizeObserver/IntersectionObserver e chama
// `window.matchMedia` no mount — ausentes no jsdom deste projeto. Mesmo
// padrão de admin-orders-filtro-que-filtra.test.tsx — só precisamos disso
// nos testes de "fetchPedidosCancelados", que exigem `active={true}`.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Pílula colapsável dos alertas (pedido do Gabriel, 02/09): o conteúdo dos
 * baldes só existe com a alavanca expandida. No-op quando não há pendência
 * nenhuma (a alavanca nem nasce). Recebe o hospedeiro do describe que
 * chama — cada describe tem o seu. */
async function expandirAlertas(alvo: HTMLElement) {
  const alavanca = alvo.querySelector<HTMLButtonElement>(
    'button[data-testid="alertas-cancelados-alavanca"]',
  );
  if (!alavanca) return;
  await act(async () => {
    alavanca.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` — sem
 * `@testing-library/react` (não instalado neste projeto). Mesmo helper de
 * admin-orders-filtro-que-filtra.test.tsx. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
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

function botaoComTexto(hospedeiro: HTMLElement, texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

describe("baldeDeEstorno — a lista é derivada, nunca gravada", () => {
  it("cancelado e pago, NÃO enviado: 'devolver_agora'", async () => {
    const { baldeDeEstorno } = await import("@/views/admin/AdminOrdersView");
    const pedido = pedidoFake({
      id: "p1",
      status: "cancelled",
      paymentStatus: "pago",
      cancelledAfterShipping: false,
    });
    expect(baldeDeEstorno(pedido)).toBe("devolver_agora");
  });

  it("cancelado e pago, ENVIADO e sem retorno: 'esperando_o_produto'", async () => {
    const { baldeDeEstorno } = await import("@/views/admin/AdminOrdersView");
    const pedido = pedidoFake({
      id: "p2",
      status: "cancelled",
      paymentStatus: "pago",
      cancelledAfterShipping: true,
      returnedToSellerAt: null,
    });
    expect(baldeDeEstorno(pedido)).toBe("esperando_o_produto");
  });

  it("cancelado e pago, ENVIADO com retorno confirmado: 'devolver_agora'", async () => {
    const { baldeDeEstorno } = await import("@/views/admin/AdminOrdersView");
    const pedido = pedidoFake({
      id: "p3",
      status: "cancelled",
      paymentStatus: "pago",
      cancelledAfterShipping: true,
      returnedToSellerAt: "2026-08-25T10:00:00Z",
    });
    expect(baldeDeEstorno(pedido)).toBe("devolver_agora");
  });

  it("cancelado com pagamento 'estornado': NÃO aparece em lugar nenhum", async () => {
    const { baldeDeEstorno } = await import("@/views/admin/AdminOrdersView");
    const pedido = pedidoFake({
      id: "p4",
      status: "cancelled",
      paymentStatus: "estornado",
    });
    expect(baldeDeEstorno(pedido)).toBeNull();
  });

  it("cancelado que nunca foi pago: NÃO aparece em lugar nenhum", async () => {
    const { baldeDeEstorno } = await import("@/views/admin/AdminOrdersView");
    const pedido = pedidoFake({
      id: "p5",
      status: "cancelled",
      paymentStatus: "aguardando",
    });
    expect(baldeDeEstorno(pedido)).toBeNull();

    const pedidoSemCobranca = pedidoFake({
      id: "p5b",
      status: "cancelled",
      paymentStatus: null,
    });
    expect(baldeDeEstorno(pedidoSemCobranca)).toBeNull();
  });

  it("pago_apos_expirar conta como dinheiro que entrou (segunda porta do balde)", async () => {
    const { baldeDeEstorno } = await import("@/views/admin/AdminOrdersView");
    const pedido = pedidoFake({
      id: "p6",
      status: "cancelled",
      paymentStatus: "pago_apos_expirar",
      cancelledAfterShipping: false,
    });
    expect(baldeDeEstorno(pedido)).toBe("devolver_agora");
  });

  // Task 3b do plano docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md
  // (ponto 2) — o caso que prova a gravidade do problema: a Task 2 já fez o
  // aviso âmbar "N pedidos receberam pagamento e estão cancelados" contar
  // `recebido_na_entrega` (regra do SERVIDOR, `get_admin_analytics_v2`), mas
  // `baldeDeEstorno` (regra do CLIENTE, aqui) continuava cego a esse valor.
  // Um pedido recebido na entrega e depois cancelado fazia o aviso dizer
  // "1 pedido" e a lista de estorno abaixo dele mostrar NENHUM.
  it("recebido_na_entrega conta como dinheiro que entrou (terceira porta do balde)", async () => {
    const { baldeDeEstorno } = await import("@/views/admin/AdminOrdersView");
    const pedido = pedidoFake({
      id: "p7",
      status: "cancelled",
      paymentStatus: "recebido_na_entrega",
      cancelledAfterShipping: false,
    });
    expect(baldeDeEstorno(pedido)).toBe("devolver_agora");
  });
});

// ITEM 3 da revisão de 26/08/2026 (segunda mutação sobrevivente): apagar
// `pedido.status === "cancelled"` de `precisaConfirmarRetornoDoProduto`
// sobrevivia à suíte inteira antes deste bloco — nenhum dublê existente
// tinha `cancelledAfterShipping: true` com `status` diferente de
// "cancelled". A guarda é LOAD-BEARING: a migration `20260970000000`
// existe por um incidente medido ("estoque 499 → 500 com o produto
// entregue") — um pedido AINDA em trânsito (`status: "shipping"`) não pode
// pedir confirmação de retorno antes mesmo de ser cancelado.
describe("precisaConfirmarRetornoDoProduto — a guarda de status é load-bearing", () => {
  it("pedido cancelado, enviado e sem retorno: precisa confirmar", async () => {
    const { precisaConfirmarRetornoDoProduto } = await import(
      "@/views/admin/AdminOrdersView"
    );
    const pedido = pedidoFake({
      id: "guarda-1",
      status: "cancelled",
      paymentStatus: null,
      cancelledAfterShipping: true,
      returnedToSellerAt: null,
    });
    expect(precisaConfirmarRetornoDoProduto(pedido)).toBe(true);
  });

  it("pedido AINDA em trânsito (status='shipping', nunca cancelado): NÃO precisa confirmar, mesmo com cancelledAfterShipping=true", async () => {
    const { precisaConfirmarRetornoDoProduto } = await import(
      "@/views/admin/AdminOrdersView"
    );
    // Combinação que não deveria existir na prática (cancelledAfterShipping
    // é gravado só no momento do cancelamento), mas é exatamente o caso que
    // a mutação "apagar o `status === 'cancelled'`" deixaria passar — sem
    // este teste, remover a guarda não derruba a suíte.
    const pedido = pedidoFake({
      id: "guarda-2",
      status: "shipping",
      paymentStatus: null,
      cancelledAfterShipping: true,
      returnedToSellerAt: null,
    });
    expect(precisaConfirmarRetornoDoProduto(pedido)).toBe(false);
  });

  it("pedido cancelado com o retorno já confirmado: não precisa mais confirmar", async () => {
    const { precisaConfirmarRetornoDoProduto } = await import(
      "@/views/admin/AdminOrdersView"
    );
    const pedido = pedidoFake({
      id: "guarda-3",
      status: "cancelled",
      paymentStatus: "pago",
      cancelledAfterShipping: true,
      returnedToSellerAt: "2026-08-25T10:00:00Z",
    });
    expect(precisaConfirmarRetornoDoProduto(pedido)).toBe(false);
  });
});

describe("AdminOrdersView — os dois baldes de estorno na tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // jsdom deste ambiente não traz localStorage utilizável, mesmo dublê em
    // Map usado em admin-orders-payment-filter.test.tsx.
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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
    mockPedidosCancelados = [];
    mockPedidosCanceladosIncompleto = false;
    confirmarRetornoDoProdutoMock.mockClear();
    fetchPedidosCanceladosMock.mockClear();
  });

  it("pedido esperando o produto voltar: aparece o balde com o botão 'O produto voltou'", async () => {
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-esperando",
        status: "cancelled",
        paymentStatus: "pago",
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    expect(hospedeiro.textContent).toContain("Esperando o produto voltar");
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "O produto voltou",
    );
    expect(botao).toBeTruthy();

    // Item 2 da revisão de 27/08/2026: a metade que protege DINHEIRO. Sem
    // esta linha, a mutação que troca o ramo "esperando_o_produto" por
    // "devolver_agora" em `baldeDeEstorno` só morria no teste de função pura
    // — o teste de TELA (este bloco) continuava verde mesmo pondo o pedido
    // no balde errado, porque nenhuma asserção aqui olhava "Estorno devido".
    expect(hospedeiro.textContent).not.toContain("Estorno devido");
  });

  // BLOQUEIA 1 da revisão de 26/08/2026: com o filtro padrão "Em Aberto",
  // `orders` (a página filtrada/paginada da tela) NUNCA traz pedido
  // cancelado — o servidor exclui `cancelled` de `p_status='open'`
  // (supabase/migrations/20260961000000_busca_por_telefone_normaliza_digitos.sql:108).
  // Este teste força exatamente esse estado: `mockOrders` fica com um
  // pedido IRRELEVANTE (pending, sem nada a ver com os baldes) — se os
  // baldes ainda lessem `orders` por engano, este pedido pending não
  // apareceria, mas o teste também não provaria nada; o que prova é o
  // pedido cancelado só existir em `mockPedidosCancelados`, e mesmo assim
  // aparecer na tela.
  it("BLOQUEIA 1: o balde de mercadoria aparece mesmo com a página filtrada (`orders`) vazia de pedido cancelado", async () => {
    mockOrders = [
      pedidoFake({
        id: "ped-em-aberto",
        status: "pending",
        paymentStatus: null,
      }),
    ];
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-cancelado-fora-do-filtro",
        status: "cancelled",
        paymentStatus: null,
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
      }),
    ];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    expect(hospedeiro.textContent).toContain("Produtos que ainda não voltaram");
    expect(hospedeiro.textContent).toContain("Esperando o produto voltar");
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "O produto voltou",
    );
    expect(botao).toBeTruthy();
  });

  it("pedido não enviado (devolver agora): aparece no balde certo, SEM o botão de confirmar retorno", async () => {
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-devolver",
        status: "cancelled",
        paymentStatus: "pago",
        cancelledAfterShipping: false,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    expect(hospedeiro.textContent).toContain("Devolver agora");
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "O produto voltou",
    );
    expect(botao).toBeUndefined();
  });

  it("clicar em 'O produto voltou' chama confirmarRetornoDoProduto com o id do pedido certo", async () => {
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-clique",
        status: "cancelled",
        paymentStatus: "pago",
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "O produto voltou",
    );
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(confirmarRetornoDoProdutoMock).toHaveBeenCalledTimes(1);
    expect(confirmarRetornoDoProdutoMock).toHaveBeenCalledWith("ped-clique");
  });

  it("o texto NUNCA promete estorno automático — manda o lojista ao painel do Mercado Pago", async () => {
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-honesto",
        status: "cancelled",
        paymentStatus: "pago",
        cancelledAfterShipping: false,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    const texto = hospedeiro.textContent || "";
    expect(texto).toContain("Mercado Pago");
    expect(texto).not.toMatch(/estorno automático/i);
    expect(texto).not.toMatch(/o app (devolve|estorna)/i);
  });

  it("nenhum pedido cancelado e pago: nenhum balde aparece", async () => {
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-pendente",
        status: "pending",
        paymentStatus: "pago",
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    expect(hospedeiro.textContent).not.toContain("Esperando o produto voltar");
    expect(hospedeiro.textContent).not.toContain("Devolver agora");
  });

  // Achado da revisão (26/08/2026): `baldeDeEstorno` só calculava a
  // alavanca de mercadoria DEPOIS de confirmar `entrou` (pagamento). Pedido
  // fechado "na entrega" nunca grava `payment_status` (fica NULL) — então
  // um pedido cancelado-após-envio sem pagamento caía fora dos dois baldes
  // e a mercadoria ficava fora do estoque para sempre, sem nenhum sinal na
  // tela. A alavanca de MERCADORIA tem que independer da de DINHEIRO.
  it("pedido cancelado-após-envio SEM pagamento (payment_status NULL): o botão 'O produto voltou' aparece, sem promessa de estorno", async () => {
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-sem-pagamento",
        status: "cancelled",
        paymentStatus: null,
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    expect(hospedeiro.textContent).toContain("Esperando o produto voltar");
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "O produto voltou",
    );
    expect(botao).toBeTruthy();

    // Nenhum texto na tela pode prometer devolver dinheiro que nunca
    // entrou: este pedido não tem `payment_status` nenhum.
    const texto = hospedeiro.textContent || "";
    expect(texto).not.toMatch(/estorno automático/i);
    expect(texto).not.toMatch(/o app (devolve|estorna)/i);
    expect(texto).not.toMatch(/devolva o dinheiro/i);

    // BLOQUEIA 2 da revisão de 26/08/2026: o cabeçalho "Estorno devido" (uma
    // AFIRMAÇÃO de dívida) não pode aparecer para um pedido que nunca foi
    // cobrado — só o balde de mercadoria, com título próprio, aparece.
    expect(texto).not.toContain("Estorno devido");
  });

  // BLOQUEIA 2 da revisão de 26/08/2026: os dois containers têm título
  // PRÓPRIO e cada pedido só entra no que responde à pergunta certa. Este
  // teste tem os DOIS baldes não vazios ao mesmo tempo (dois pedidos
  // distintos) para provar que os títulos não vazam um para o outro.
  it("BLOQUEIA 2: os dois containers têm título próprio — 'Estorno devido' só quando há dinheiro, mercadoria nunca herda esse título", async () => {
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-so-mercadoria",
        status: "cancelled",
        paymentStatus: null,
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
      }),
      pedidoFake({
        id: "ped-so-dinheiro",
        status: "cancelled",
        paymentStatus: "pago",
        cancelledAfterShipping: false,
      }),
    ];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    const texto = hospedeiro.textContent || "";
    expect(texto).toContain("Produtos que ainda não voltaram");
    expect(texto).toContain("Estorno devido");

    const cabecalhos = Array.from(hospedeiro.querySelectorAll("h3")).map((h) =>
      h.textContent?.trim(),
    );
    // Cada título aparece EXATAMENTE UMA vez — não é o mesmo container
    // reaproveitado para as duas perguntas.
    expect(
      cabecalhos.filter((t) => t === "Produtos que ainda não voltaram"),
    ).toHaveLength(1);
    expect(cabecalhos.filter((t) => t === "Estorno devido")).toHaveLength(1);
  });

  it("pedido cancelado-após-envio SEM pagamento não entra no balde de dinheiro 'Devolver agora'", async () => {
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-sem-pagamento-2",
        status: "cancelled",
        paymentStatus: null,
        cancelledAfterShipping: false,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    // Não enviado e nunca pago: nenhum dos dois baldes deve mostrar este
    // pedido (nem "esperando" — não há mercadoria fora — nem "devolver
    // agora" — não há dinheiro a devolver).
    expect(hospedeiro.textContent).not.toContain("Esperando o produto voltar");
    expect(hospedeiro.textContent).not.toContain("Devolver agora");
  });
});

// Achados B e D da revisão de 26/08/2026 (rodada 4 — BLOQUEIA): o `catch` de
// `fetchPedidosCancelados` engole erro sem toast (correto, não pode
// derrubar a lista principal) e o teto `MAX_PAGES` pode truncar antes de
// cobrir `total_count` (o teto em si está certo) — mas os DOIS containers
// só existiam com `{lista.length > 0 && (...)}`. Sem sinal nenhum, "falhou"
// e "não há nada pendente" tinham a MESMA cara: nenhum card na tela. Este
// bloco prova que `pedidosCanceladosIncompleto` (novo campo do hook) muda o
// que a tela mostra, mesmo com as duas listas vazias.
describe("pedidosCanceladosIncompleto — ausência do card não pode significar 'falhou'", () => {
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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
    mockPedidosCancelados = [];
    mockPedidosCanceladosIncompleto = false;
    confirmarRetornoDoProdutoMock.mockClear();
    fetchPedidosCanceladosMock.mockClear();
  });

  it("incompleto=true e as duas listas vazias: aparece um aviso, não silêncio", async () => {
    mockPedidosCancelados = [];
    mockPedidosCanceladosIncompleto = true;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    const texto = hospedeiro.textContent || "";
    expect(texto).toMatch(/incompleto|não foi possível/i);
    // O aviso não pode se disfarçar de card de produto/dinheiro: os dois
    // continuam ausentes, porque a lista realmente não tem item nenhum
    // (`pedidosCancelados = []`) — o aviso é uma TERCEIRA coisa.
    expect(texto).not.toContain("Esperando o produto voltar");
    expect(texto).not.toContain("Devolver agora");
  });

  it("incompleto=false e as duas listas vazias: continua sem nenhum card, sem aviso — silêncio aqui É a verdade", async () => {
    mockPedidosCancelados = [];
    mockPedidosCanceladosIncompleto = false;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    const texto = hospedeiro.textContent || "";
    expect(texto).not.toMatch(/incompleto|não foi possível/i);
  });

  it("incompleto=true MESMO com um dos dois baldes não vazio: o aviso ainda aparece — o que falta pode estar no outro balde", async () => {
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-parcial",
        status: "cancelled",
        paymentStatus: "pago",
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
      }),
    ];
    mockPedidosCanceladosIncompleto = true;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    const texto = hospedeiro.textContent || "";
    expect(texto).toContain("Esperando o produto voltar");
    expect(texto).toMatch(/incompleto|não foi possível/i);
  });
});

// BLOQUEIA 1 da revisão de 26/08/2026 — a metade "carregamento" da correção
// (a metade "derivação" já é coberta acima): `fetchPedidosCancelados` tem
// que ser chamado quando a tela fica ativa, e as dependências do efeito que
// o chama NUNCA podem incluir `filter`/`searchQuery`/`dateRange`/
// `currentPage` — são exatamente esses quatro que faziam o painel antigo
// (derivado de `orders`) sumir sozinho. `active={true}` é necessário aqui
// (o efeito só dispara com a tela ativa), por isso os stubs de
// ResizeObserver/IntersectionObserver/matchMedia que o AdminKpiCarousel
// exige nesse modo.
describe("fetchPedidosCancelados — carregamento independente do filtro, busca, período e página", () => {
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
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
    mockPedidosCancelados = [];
    mockPedidosCanceladosIncompleto = false;
    confirmarRetornoDoProdutoMock.mockClear();
    fetchPedidosCanceladosMock.mockClear();
  });

  it("é chamado quando a tela fica ativa", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await esperarAte(() => fetchPedidosCanceladosMock.mock.calls.length > 0);
    expect(fetchPedidosCanceladosMock).toHaveBeenCalledTimes(1);
  });

  it("NÃO é chamado de novo ao trocar de filtro — a chamada continua em 1", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => fetchPedidosCanceladosMock.mock.calls.length > 0);
    expect(fetchPedidosCanceladosMock).toHaveBeenCalledTimes(1);

    const botaoTodos = botaoComTexto(hospedeiro, "Todos");
    expect(botaoTodos).toBeTruthy();
    await act(async () => {
      botaoTodos!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Dá tempo do debounce de 320ms de `loadAllData` (que reage a `filter`)
    // rodar, para provar que o efeito de `fetchPedidosCancelados` — que NÃO
    // depende de `filter` — realmente não reagiu.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(fetchPedidosCanceladosMock).toHaveBeenCalledTimes(1);
  });
});

// Item 1 da revisão de 27/08/2026 — o mais caro: o banner âmbar antigo
// (linha ~1025 de AdminOrdersView.tsx, um bloco PRÉ-EXISTENTE que o
// trabalho dos dois cards não tocou) mandava "entregue o pedido, ou estorne
// pelo painel do Mercado Pago" para TODO pedido que a RPC conta — inclusive
// o que ainda espera a mercadoria voltar (cancelado depois de enviado,
// `returnedToSellerAt` nulo). Isso contradiz a regra do Gabriel de
// 24/08/2026 (cancelado depois de enviado: só se estorna DEPOIS do produto
// voltar) e o estrago é concreto: a lojista lê a instrução mais visível e
// mais antiga da tela e devolve o dinheiro com o produto ainda na mão da
// cliente.
describe("Item 1 (27/08/2026): o banner de dinheiro em pedido cancelado não pode mandar estornar agora", () => {
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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
    mockPedidosCancelados = [];
    mockPedidosCanceladosIncompleto = false;
    mockAnalyticsStats = null;
    confirmarRetornoDoProdutoMock.mockClear();
    fetchPedidosCanceladosMock.mockClear();
  });

  it("pedido cancelled + pago + cancelledAfterShipping=true + returnedToSellerAt=NULL: a tela não traz nenhuma instrução de estornar agora", async () => {
    // A contagem da RPC (`paidOnCancelled`) e a lista de
    // `pedidosCancelados` são consultas DIFERENTES no app real, mas contam
    // o MESMO pedido — é assim que o banner e os dois cards aparecem juntos
    // na tela de verdade para este caso.
    mockAnalyticsStats = { paidOnCancelled: 1 };
    mockPedidosCancelados = [
      pedidoFake({
        id: "ped-em-transito",
        status: "cancelled",
        paymentStatus: "pago",
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    await expandirAlertas(hospedeiro);

    const texto = hospedeiro.textContent || "";
    // O NÚMERO do banner continua verdadeiro: o dinheiro entrou e o pedido
    // está cancelado.
    expect(texto).toContain("O dinheiro entrou e o pedido está cancelado");
    // A INSTRUÇÃO antiga não pode sobreviver: ela mandava estornar AGORA,
    // mesmo para quem ainda espera a mercadoria voltar.
    expect(texto).not.toContain(
      "Entregue o pedido, ou estorne pelo painel do Mercado Pago",
    );
    expect(texto).not.toMatch(/estorne (agora|pelo painel)/i);
    // A tela aponta para o card certo — mercadoria, não dinheiro — porque
    // este pedido específico ainda não pode ser devolvido. A frase do
    // banner CITA "Estorno devido" pelo nome (para apontar para o card), o
    // que faria uma checagem por substring falhar por motivo errado —
    // então a asserção real é sobre o CARD (h3) em si, não sobre a
    // ocorrência crua da palavra.
    expect(texto).toContain("Produtos que ainda não voltaram");
    const cabecalhos = Array.from(hospedeiro.querySelectorAll("h3")).map((h) =>
      h.textContent?.trim(),
    );
    expect(cabecalhos).not.toContain("Estorno devido");

    // 🔴 A METADE ÚTIL DA FRASE, presa por asserção.
    //
    // Todas as asserções acima são de AUSÊNCIA (a instrução velha não está
    // lá) ou vêm do card, não do banner. Medido em 27/08/2026: apagar a
    // segunda frase do banner — deixando só "O dinheiro entrou e o pedido
    // está cancelado." — passava 24/24. A lojista ficaria com um número e
    // NENHUMA instrução, e a suíte diria que está tudo bem.
    //
    // A asserção é sobre o <p> do banner, não sobre `textContent` inteiro:
    // "Estorno devido" também é o <h3> de um card, e medir no todo passaria
    // pelo motivo errado (verde por causa do card, não do ponteiro).
    const paragrafos = Array.from(hospedeiro.querySelectorAll("p")).map((el) =>
      (el.textContent || "").replace(/\s+/g, " ").trim(),
    );
    const paragrafoDoBanner = paragrafos.find((t) =>
      t.includes("O dinheiro entrou e o pedido está cancelado"),
    );
    expect(paragrafoDoBanner).toBeDefined();
    expect(paragrafoDoBanner).toMatch(/Estorno devido/);
    expect(paragrafoDoBanner).toMatch(/Produtos que ainda não voltaram/);
  });
});
