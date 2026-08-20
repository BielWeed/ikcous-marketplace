// @vitest-environment jsdom
//
// Auditoria do painel do lojista, lote 1 — o menu de gestão de cada cliente
// tinha um item vermelho "Congelar Acesso" que só mostrava "Funcionalidade
// em desenvolvimento" e não fazia nada. Botão vermelho que não faz nada é
// pior que botão nenhum: só se descobre no dia em que precisava funcionar.
//
// Decisão já tomada (não desta tarefa): não implementar bloqueio de
// cliente — isso mexeria em login e permissão. O item sai da tela, nos dois
// modos de visualização (detalhado e compacto), sem sobrar manipulador,
// estado ou ícone órfão.
//
// Segue o mesmo padrão de admin-products-view-toast-de-exclusao.test.tsx:
// mocka os componentes Radix de `dropdown-menu` para não depender de
// PointerEvent/pointer capture que o jsdom não implementa — os itens do
// menu passam a renderizar sempre, sem precisar abrir o dropdown de
// verdade.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clienteFake = {
  id: "cli-1",
  email: "cliente@teste.com",
  full_name: "Cliente Teste",
  phone: "34999999999",
  role: "customer",
  created_at: new Date().toISOString(),
  orders_count: 3,
  total_spent: 150.5,
  last_order_date: new Date().toISOString(),
};

const rpcMock = vi.fn(() =>
  Promise.resolve({
    data: {
      data: [clienteFake],
      total_count: 1,
      stats: {
        total_customers: 1,
        global_ltv: 150.5,
        global_orders: 3,
        new_customers_30d: 0,
      },
    },
    error: null,
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: () => rpcMock() },
}));

vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: vi.fn(),
    prefetchAll: vi.fn(),
    prefetchViewPromise: vi.fn(),
    prefetchImage: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Mesmo mock de admin-products-view-toast-de-exclusao.test.tsx: renderiza os
// itens sempre, preservando `onClick`, sem depender de abrir/fechar via
// pointer capture.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function stubLocalStorage(viewMode: "detailed" | "compact") {
  const armazem = new Map<string, string>([
    ["admin_customers_view_mode", viewMode],
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
}

/** Dorme um tempo fixo dentro de um único `act()` — mesmo padrão de
 * `admin-customers-ticket-medio.test.tsx` (`esperar(400)`), que já cobre
 * exatamente este cenário: fetch real via `supabase.rpc` atrás do timer de
 * debounce de 320ms da view. Um loop de poll com `act()` reaberto a cada
 * passo (o `esperarAte` usado em testes que mockam o HOOK direto, sem
 * timer real) não flusha de forma confiável aqui — medido nesta tarefa. */
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminCustomersView — 'Congelar Acesso' sai do menu de gestão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcMock.mockClear();
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
  });

  async function abrirTela() {
    const { AdminCustomersView } = await import(
      "@/views/admin/AdminCustomersView"
    );
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    // O fetch de clientes é disparado por um timer de 320 ms dentro da view.
    await act(async () => {
      await esperar(500);
    });
  }

  it("modo compacto (padrão): 'Congelar Acesso' não existe mais, os outros itens continuam", async () => {
    stubLocalStorage("compact");

    await abrirTela();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Congelar Acesso");
    expect(texto).toContain("Ver Perfil Elite");
    expect(texto).toContain("Notificação Push");
  });

  it("modo detalhado: 'Congelar Acesso' não existe mais, os outros itens continuam", async () => {
    stubLocalStorage("detailed");

    await abrirTela();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Congelar Acesso");
    expect(texto).toContain("Ver Perfil Elite");
    expect(texto).toContain("Notificação Push");
  });

  it("nada mais na tela chama 'Funcionalidade em desenvolvimento' (o único uso era o item removido)", async () => {
    stubLocalStorage("compact");

    await abrirTela();

    expect(hospedeiro.textContent ?? "").not.toContain(
      "Funcionalidade em desenvolvimento",
    );
  });
});
