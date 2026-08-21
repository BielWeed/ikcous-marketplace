// @vitest-environment jsdom
//
// Achado 10 da auditoria de 20/08/2026: o crachá de "Pedidos" na navegação
// (AdminLayout) e o cartão "Ações Pendentes" (AdminOrdersView) contam a
// mesma coisa de dois jeitos diferentes — o crachá só `status = 'pending'`,
// o cartão `status IN ('pending','new','processing')` (é a definição de
// `today_pending` na RPC `get_admin_analytics_v2`). Um pedido em "Em
// Separação" ainda precisa ser embalado e enviado, então a conta ampla é a
// correta; é o crachá que estava contando de menos.
//
// Este teste prova o crachá: ele tem que aplicar o MESMO filtro amplo, não
// só `pending`. Simula a diferença no builder do Supabase — `.eq(status,
// "pending")` "devolveria" 6 (a conta velha), `.in(status, [...])`
// "devolveria" 7 (a conta certa, igual ao cartão) — para que o teste caia
// se a implementação voltar a usar `.eq`.
//
// `@/lib/supabase` é mocado pelo mesmo motivo dos vizinhos deste diretório:
// AdminLayout.tsx importa `supabase` no topo, e sem o mock a leitura de
// VITE_SUPABASE_URL/ANON_KEY explode por design.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Conta que o crachá aplicava ANTES da correção (só "pending").
const CONTAGEM_ANTIGA_SO_PENDING = 6;
// Conta que a RPC `get_admin_analytics_v2` já devolve para "Ações
// Pendentes" hoje (pending + new + processing) — é o alvo do crachá.
const CONTAGEM_AMPLA_IGUAL_AO_CARTAO = 7;

let contagemDevolvidaPeloBanco = CONTAGEM_ANTIGA_SO_PENDING;

function criarOrdersCountBuilder() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((_coluna: string, _valor: string) => {
    // Simula o banco: filtrar só por "pending" devolve a conta antiga.
    contagemDevolvidaPeloBanco = CONTAGEM_ANTIGA_SO_PENDING;
    return builder;
  });
  builder.in = vi.fn((_coluna: string, _valores: readonly string[]) => {
    // Simula o banco: filtrar pela lista ampla devolve a mesma conta do
    // cartão "Ações Pendentes".
    contagemDevolvidaPeloBanco = CONTAGEM_AMPLA_IGUAL_AO_CARTAO;
    return builder;
  });
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: contagemDevolvidaPeloBanco, error: null }).then(
      resolve,
      reject,
    );
  return builder;
}

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

describe("AdminLayout — crachá de Pedidos usa a mesma conta ampla do cartão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    contagemDevolvidaPeloBanco = CONTAGEM_ANTIGA_SO_PENDING;
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

  it("mostra 7 (pending+new+processing), não 6 (só pending)", async () => {
    const { AdminLayout } = await import(
      "@/components/layouts/AdminLayout"
    );

    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    const botaoPedidos = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Pedidos"));
    expect(botaoPedidos).toBeTruthy();

    await esperarAte(
      () => botaoPedidos!.textContent?.includes(String(CONTAGEM_AMPLA_IGUAL_AO_CARTAO)) ?? false,
    );

    expect(botaoPedidos!.textContent).toContain(
      String(CONTAGEM_AMPLA_IGUAL_AO_CARTAO),
    );
    expect(botaoPedidos!.textContent).not.toContain(
      `Pedidos${CONTAGEM_ANTIGA_SO_PENDING}`,
    );
  });
});
