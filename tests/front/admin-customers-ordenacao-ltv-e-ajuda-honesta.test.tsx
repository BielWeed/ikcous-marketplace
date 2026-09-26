// @vitest-environment jsdom
//
// Tarefa AdminCustomersView-636.
//
// PARTE 1 — ORDENAÇÃO INICIAL DO LTV
//   `handleSort(field)` (AdminCustomersView.tsx:359-368) sempre iniciava um
//   campo novo em "asc". O chip de atalho "Maior LTV" (ORDENACOES_CLIENTES)
//   usa "desc" pra esse mesmo campo (`total_spent`) — e o estado inicial da
//   tela (`sortField`/`sortDirection`, linhas 111-112) TAMBÉM já nasce como
//   `total_spent`/"desc", igual ao chip. Só que, como o handler comparava
//   `sortField === field` contra esse estado pré-populado (não contra "o
//   lojista já clicou nisto"), o PRIMEIRO clique no cabeçalho "LTV (Gasto)"
//   caía no ramo de alternância e invertia direto pra "asc" — a lista virava
//   menor→maior gasto na primeira tentativa, ao contrário do chip
//   equivalente. Um segundo defeito, no mesmo handler: trocar para um campo
//   diferente do que já estava ativo sempre usava "asc" fixo, mesmo pra
//   campos cujo chip usa "desc" (total_spent, orders_count).
//
// PARTE 2 — TEXTO DE AJUDA HONESTO EM "PEDIDOS TOTAIS"
//   O modal de ajuda dizia que "Pedidos Totais" conta "independentemente do
//   status atual do pagamento". Isso já não é verdade: o card lê
//   `analyticsStats.executive.totalOrders`, que vem de
//   `get_admin_analytics_v2` (migration 20261062000000) e SÓ conta pedido
//   com `payment_status IN ('pago', 'pago_apos_expirar',
//   'recebido_na_entrega')` — exatamente o oposto de "independente do
//   status do pagamento". `get_admin_customers_paged` (a RPC citada na
//   tarefa) tem seu próprio `global_orders`, que não filtra pagamento, mas
//   esse card não lê aquele campo (ver comentário em
//   AdminCustomersView.tsx:322-345) — só o texto de ajuda ainda descrevia a
//   fonte errada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaRpc, chamadasRpc } = vi.hoisted(() => ({
  // Os cabeçalhos clicáveis (com o handler de ordenação) só aparecem quando
  // a lista tem clientes — lista vazia mostra o estado "Nenhum cliente
  // retornado" no lugar da tabela.
  estadoDaRpc: {
    data: [
      {
        id: "cli-1",
        email: "cliente@teste.com",
        full_name: "Cliente Teste",
        phone: "34999999999",
        role: "customer",
        created_at: new Date().toISOString(),
        orders_count: 3,
        total_spent: 150.5,
        last_order_date: new Date().toISOString(),
      },
    ] as unknown[],
    total_count: 1,
    stats: {
      total_customers: 2,
      global_ltv: 300,
      global_orders: 5,
      new_customers_30d: 0,
    },
  },
  chamadasRpc: [] as Array<{ nome: string; args: any }>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args: any) => {
      chamadasRpc.push({ nome, args });
      return Promise.resolve({ data: estadoDaRpc, error: null });
    },
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mesmos dublês de admin-customers-ticket-medio.test.tsx: o carrossel de
// KPIs chama matchMedia/ResizeObserver/IntersectionObserver no mount, que o
// jsdom deste projeto não implementa.
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

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminCustomersView — ordenação inicial do LTV e ajuda honesta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    chamadasRpc.length = 0;
    estadoDaRpc.total_count = 1;
    estadoDaRpc.data = [
      {
        id: "cli-1",
        email: "cliente@teste.com",
        full_name: "Cliente Teste",
        phone: "34999999999",
        role: "customer",
        created_at: new Date().toISOString(),
        orders_count: 3,
        total_spent: 150.5,
        last_order_date: new Date().toISOString(),
      },
    ];
    estadoDaRpc.stats = {
      total_customers: 2,
      global_ltv: 300,
      global_orders: 5,
      new_customers_30d: 0,
    };

    // Precisa do modo "detailed" — os cabeçalhos clicáveis (com o handler de
    // ordenação) só existem nessa visão; o modo "compact" (padrão) usa
    // cartões sem cabeçalho de coluna.
    armazem = new Map<string, string>([
      ["admin_customers_view_mode", "detailed"],
    ]);
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
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminCustomersView } = await import(
      "@/views/admin/AdminCustomersView"
    );
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    // O fetch da lista é disparado por um timer de 320 ms dentro da view.
    await act(async () => {
      await esperar(400);
    });
  }

  function cabecalho(rotulo: string): HTMLElement {
    const candidatos = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>('[role="button"]'),
    );
    const achado = candidatos.find((el) =>
      (el.textContent ?? "").includes(rotulo),
    );
    if (!achado) {
      throw new Error(`Cabeçalho "${rotulo}" não encontrado no DOM`);
    }
    return achado;
  }

  function ultimaChamada() {
    const chamada = chamadasRpc.at(-1);
    if (!chamada)
      throw new Error("Nenhuma chamada a get_admin_customers_paged");
    return chamada.args;
  }

  it("clicar em 'LTV (Gasto)' pela primeira vez mantém desc (maior gasto no topo), igual ao chip 'Maior LTV'", async () => {
    await abrirTela();

    // Estado inicial da tela: já nasce total_spent/desc (mesmo do chip).
    expect(ultimaChamada()).toMatchObject({
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
    });

    await act(async () => {
      cabecalho("LTV (Gasto)").click();
      await esperar(400);
    });

    // Antes da correção, este primeiro clique invertia pra "asc" (menor
    // gasto no topo) porque o handler comparava contra o `sortField` de
    // estado (que já nascia "total_spent") em vez de contra "o lojista já
    // escolheu esta coluna alguma vez".
    expect(ultimaChamada()).toMatchObject({
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
    });
  });

  it("trocar de coluna (Cliente → LTV) usa o padrão de CADA campo, não sempre 'asc'", async () => {
    await abrirTela();

    await act(async () => {
      cabecalho("Cliente").click();
      await esperar(400);
    });
    expect(ultimaChamada()).toMatchObject({
      p_sort_field: "full_name",
      p_sort_direction: "asc",
    });

    await act(async () => {
      cabecalho("LTV (Gasto)").click();
      await esperar(400);
    });

    // O chip "Maior LTV" usa desc para total_spent; o cabeçalho, ao ser
    // escolhido pela primeira vez depois de sair de outro campo, tem que
    // concordar — não "asc" fixo.
    expect(ultimaChamada()).toMatchObject({
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
    });
  });

  it("um segundo clique na MESMA coluna já escolhida continua alternando (comportamento de toggle preservado)", async () => {
    await abrirTela();

    await act(async () => {
      cabecalho("LTV (Gasto)").click(); // 1º clique: fica em desc (ver teste acima)
      await esperar(400);
    });
    await act(async () => {
      cabecalho("LTV (Gasto)").click(); // 2º clique: agora sim alterna
      await esperar(400);
    });

    expect(ultimaChamada()).toMatchObject({
      p_sort_field: "total_spent",
      p_sort_direction: "asc",
    });
  });

  it("o texto de ajuda de 'Pedidos Totais' não promete contagem independente do pagamento", async () => {
    await abrirTela();

    // O botão de ajuda mora no cabeçalho da página (AdminPageHeader) e não
    // tem aria-label — só `title="Guia de Clientes e Ajuda"`.
    const botaoDeAjuda = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Guia de Clientes e Ajuda"]',
    );
    expect(botaoDeAjuda).not.toBeNull();

    await act(async () => {
      botaoDeAjuda!.click();
      await esperar(0);
    });

    // O modal usa createPortal para document.body — não fica dentro do
    // `hospedeiro` que hospeda a árvore principal da tela. E "Pedidos
    // Totais" também é o RÓTULO do cartão KPI (fora do modal): pega a
    // ÚLTIMA ocorrência, que é a do modal (portal entra depois no DOM).
    const texto = document.body.textContent ?? "";
    const posicao = texto.lastIndexOf("Pedidos Totais");
    expect(posicao).toBeGreaterThan(-1);
    const trechoDoCard = texto.slice(posicao, posicao + 260);

    expect(trechoDoCard).not.toMatch(/independentemente do status/i);
    // A descrição honesta precisa mencionar que pagamento reconhecido é
    // exigido (o vocabulário já usado no resto do painel, ex.:
    // AdminDashboardView.tsx "pagamento reconhecido").
    expect(trechoDoCard).toMatch(/pagamento reconhecido/i);
  });
});
