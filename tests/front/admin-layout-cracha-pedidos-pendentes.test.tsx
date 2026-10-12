// @vitest-environment jsdom
//
// Achado 10 da auditoria de 20/08/2026: o crachá de "Pedidos" na navegação
// (AdminLayout) contava só `status = 'pending'`; um pedido em "Em Separação"
// ainda precisa ser embalado e enviado, então a conta certa é a ampla
// (`status IN ('pending','new','processing')`).
//
// Onda F do painel simples (F2): a conta ampla ainda mentia num ponto — um
// PIX gerado e ainda não pago espera a CLIENTE, não o lojista, e o
// "Pedidos para preparar" do Início (`painel_inicio`) já o tirava. Agora o
// crachá aplica a MESMA regra (`src/lib/pedidos-para-preparar.ts`): a lista
// de status E o `.or` do pagamento. O builder do Supabase simula as três
// contas — `.eq(status,"pending")` "devolveria" 6 (a conta velha),
// `.in(status,[...])` sozinho 7 (conta o PIX aguardando), `.in` + o `.or`
// da regra 5 — para o teste cair se a implementação perder qualquer pedaço.
//
// `@/lib/supabase` é mocado pelo mesmo motivo dos vizinhos deste diretório:
// AdminLayout.tsx importa `supabase` no topo, e sem o mock a leitura de
// VITE_SUPABASE_URL/ANON_KEY explode por design.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FILTRO_POSTGREST_PARA_PREPARAR,
  STATUS_PARA_PREPARAR,
} from "@/lib/pedidos-para-preparar";

// Conta que o crachá aplicava ANTES do achado 10 (só "pending").
const CONTAGEM_ANTIGA_SO_PENDING = 6;
// Conta ampla SEM olhar o pagamento — inclui 2 PIX aguardando a cliente.
const CONTAGEM_COM_PIX_AGUARDANDO = 7;
// Conta da regra única "para preparar" (a mesma do Início).
const CONTAGEM_PARA_PREPARAR = 5;

let contagemDevolvidaPeloBanco = CONTAGEM_ANTIGA_SO_PENDING;
let argumentosDoIn: unknown[] | null = null;
let argumentoDoOr: string | null = null;

function criarOrdersCountBuilder() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((_coluna: string, _valor: string) => {
    // Simula o banco: filtrar só por "pending" devolve a conta antiga.
    contagemDevolvidaPeloBanco = CONTAGEM_ANTIGA_SO_PENDING;
    return builder;
  });
  builder.in = vi.fn((coluna: string, valores: readonly string[]) => {
    // Simula o banco: a lista ampla sem filtro de pagamento ainda conta o
    // PIX que espera a cliente.
    argumentosDoIn = [coluna, [...valores]];
    contagemDevolvidaPeloBanco = CONTAGEM_COM_PIX_AGUARDANDO;
    return builder;
  });
  builder.or = vi.fn((filtro: string) => {
    // Grava o argumento e só tira os PIX aguardando se o filtro for o da
    // regra única — um `.or` escrito à mão que divergir não ganha o 5.
    argumentoDoOr = filtro;
    if (filtro === FILTRO_POSTGREST_PARA_PREPARAR) {
      contagemDevolvidaPeloBanco = CONTAGEM_PARA_PREPARAR;
    }
    return builder;
  });
  // O query builder do Supabase É thenable por desenho — é isso que faz
  // `await supabase.from(...).select(...)` funcionar sem um `.execute()`. O
  // mock precisa desta propriedade para imitar o objeto real; tirá-la deixaria
  // o teste passando contra um duplo que não se parece com o que a produção
  // usa, que é pior que o aviso da regra.
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase, ver acima
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: contagemDevolvidaPeloBanco, error: null }).then(
      resolve,
      reject,
    );
  return builder;
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => criarOrdersCountBuilder()),
    rpc: vi.fn(() =>
      Promise.resolve({ data: { total_count: 0 }, error: null }),
    ),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn(),
    fetchCategoryAnalytics: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ loadOrders: vi.fn() }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` em
 * vez de dormir um tempo fixo — mesmo helper usado nos vizinhos deste
 * diretório (ex.: admin-orders-total-concluido-e-aviso-pago-cancelado). */
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

describe("AdminLayout — crachá de Pedidos conta os pedidos para preparar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    contagemDevolvidaPeloBanco = CONTAGEM_ANTIGA_SO_PENDING;
    argumentosDoIn = null;
    argumentoDoOr = null;
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    // AdminLayout chama `window.matchMedia` direto no mount (detecção de
    // modo standalone do PWA) — ausente no jsdom deste projeto, mesmo
    // achado documentado em admin-orders-total-concluido-e-aviso-pago-cancelado.
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
  });

  async function montarEAcharPedidos() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");

    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    const botaoPedidos = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Pedidos"),
    );
    expect(botaoPedidos).toBeTruthy();
    return botaoPedidos!;
  }

  it("filtra pela lista ampla de status (pending+new+processing), não só pending", async () => {
    const botaoPedidos = await montarEAcharPedidos();

    await esperarAte(() => argumentosDoIn !== null);

    expect(argumentosDoIn).toEqual(["status", [...STATUS_PARA_PREPARAR]]);
    expect(botaoPedidos.textContent).not.toContain(
      `Pedidos${CONTAGEM_ANTIGA_SO_PENDING}`,
    );
  });

  it("PIX aguardando não conta: mostra 5 (para preparar), não 7", async () => {
    const botaoPedidos = await montarEAcharPedidos();

    await esperarAte(
      () =>
        botaoPedidos.textContent?.includes(String(CONTAGEM_PARA_PREPARAR)) ??
        false,
    );

    expect(argumentoDoOr).toBe(FILTRO_POSTGREST_PARA_PREPARAR);
    // O aviso de pagamento recusado/estornado do topo de Pedidos (revisão,
    // S3) NÃO entra no selo: o último `.in` é o de status, nenhum
    // `.in("payment_status", ...)` encadeado depois.
    expect(argumentosDoIn).toEqual(["status", [...STATUS_PARA_PREPARAR]]);
    expect(botaoPedidos.textContent).toContain(
      `Pedidos${CONTAGEM_PARA_PREPARAR}`,
    );
    expect(botaoPedidos.textContent).not.toContain(
      `Pedidos${CONTAGEM_COM_PIX_AGUARDANDO}`,
    );
  });

  it("o nome acessível da aba diz 'para preparar'", async () => {
    await montarEAcharPedidos();

    await esperarAte(
      () =>
        hospedeiro.querySelector(
          `[aria-label="Pedidos, ${CONTAGEM_PARA_PREPARAR} para preparar"]`,
        ) !== null,
    );
    expect(
      hospedeiro.querySelector(
        '[aria-label^="Pedidos, "][aria-label$="pendentes"]',
      ),
    ).toBeNull();
  });
});
