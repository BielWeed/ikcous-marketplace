// @vitest-environment jsdom
//
// Promover a administrador, na LISTA de Clientes: depois de dar (ou tirar) o
// acesso, o selo do cartão muda na hora, sem recarregar a tela, e o cache de
// módulo da lista acompanha (senão voltar à tela mostraria o cargo velho).
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

import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  paraOnde: "admin" as "admin" | "customer",
}));

function conta(id: string, nome: string, role: string) {
  return {
    id,
    email: `${id}@teste.com`,
    full_name: nome,
    phone: null,
    role,
    created_at: "2026-08-01T00:00:00Z",
    orders_count: 0,
    total_spent: 0,
    last_order_date: null,
  };
}

const clientes = [
  conta("a1", "Paulo Lima", "customer"),
  conta("a2", "Rita Gomes", "admin"),
  conta("a3", "Caio Alves", "gerente"),
];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args: unknown) => {
      if (nome === "get_admin_customers_paged") {
        return Promise.resolve({
          data: {
            data: clientes,
            total_count: 3,
            stats: {
              total_customers: 3,
              global_ltv: 0,
              global_orders: 0,
              new_customers_30d: 0,
            },
          },
          error: null,
        });
      }
      return h.rpc(nome, args);
    },
    from: () => ({
      select: () => {
        const resposta = Promise.resolve({ data: [], error: null });
        return Object.assign(resposta, {
          in: () => resposta,
          eq: () => resposta,
          order: () => resposta,
          maybeSingle: () =>
            Promise.resolve({ data: { user_id: "dono-1" }, error: null }),
        });
      },
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "dono-1" } }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
const cache = vi.hoisted(() => ({ gravar: vi.fn() }));
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: cache.gravar,
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: vi.fn(),
    prefetchAll: vi.fn(),
    prefetchViewPromise: vi.fn(),
    prefetchImage: vi.fn(),
  }),
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

let AdminCustomersView: typeof TipoClientes;
let limparDonoDaLoja: () => void;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
  ({ limparDonoDaLoja } = await import("@/hooks/useDonoDaLoja"));
}, 60_000);

describe("promover: a lista reflete o novo cargo na hora", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    limparDonoDaLoja();
    h.rpc.mockReset();
    cache.gravar.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.stubGlobal("localStorage", {
      getItem: (c: string) =>
        c === "admin_customers_view_mode" ? "compact" : null,
      setItem: () => {},
      removeItem: () => {},
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function selo(nome: string): string | undefined {
    for (const h4 of hospedeiro.querySelectorAll("h4")) {
      if (h4.textContent?.trim() === nome) {
        return (
          h4.parentElement?.querySelector('[data-slot="badge"]')?.textContent ??
          undefined
        );
      }
    }
    return undefined;
  }

  async function clicar(el: Element | undefined | null) {
    if (!el) throw new Error("elemento não achado");
    await act(async () => {
      (el as HTMLElement).click();
    });
    await act(async () => {
      await esperar(5);
    });
  }

  async function abrirLista() {
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(500);
    });
  }

  const botao = (texto: string) =>
    [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );

  async function abrirFolhaDe(nome: string) {
    await clicar(
      hospedeiro.querySelector(`[aria-label="Gestão de Cliente: ${nome}"]`),
    );
  }

  it("promover: o selo do cartão muda de Cliente para Administrador, só nele, e o cache acompanha", async () => {
    h.rpc.mockResolvedValue({
      data: { user_id: "a1", de: "customer", para: "admin", mudou: true },
      error: null,
    });
    await abrirLista();
    expect(selo("Paulo Lima")).toBe("Cliente");
    expect(selo("Rita Gomes")).toBe("Administrador");

    await abrirFolhaDe("Paulo Lima");
    await clicar(botao("Tornar administrador"));
    await clicar(botao("Dar acesso de administrador"));

    expect(h.rpc).toHaveBeenCalledWith("definir_cargo", {
      p_user_id: "a1",
      p_cargo: "admin",
    });
    expect(selo("Paulo Lima")).toBe("Administrador");
    expect(selo("Rita Gomes")).toBe("Administrador");
    expect(selo("Caio Alves")).toBe("Gerente");
    // o cache de módulo recebe a lista nova (e mantém o resto intacto)
    const ultimo = cache.gravar.mock.calls.at(-1)?.[0];
    expect(
      ultimo.customers.map((c: { id: string; role: string }) => [c.id, c.role]),
    ).toEqual([
      ["a1", "admin"],
      ["a2", "admin"],
      ["a3", "gerente"],
    ]);
    expect(ultimo.total).toBe(3);
  });

  it("remover: o selo volta de Administrador para Cliente", async () => {
    h.rpc.mockResolvedValue({
      data: { user_id: "a2", de: "admin", para: "customer", mudou: true },
      error: null,
    });
    await abrirLista();
    await abrirFolhaDe("Rita Gomes");
    await clicar(botao("Remover acesso de administrador"));
    await clicar(botao("Tirar acesso"));
    expect(selo("Rita Gomes")).toBe("Cliente");
    expect(selo("Paulo Lima")).toBe("Cliente");
  });

  it("erro do banco: o selo NÃO muda e o cache não é tocado", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message: "Acesso negado: só o dono da loja define cargos.",
      },
    });
    await abrirLista();
    await abrirFolhaDe("Paulo Lima");
    await clicar(botao("Tornar administrador"));
    await clicar(botao("Dar acesso de administrador"));
    expect(selo("Paulo Lima")).toBe("Cliente");
    expect(cache.gravar).not.toHaveBeenCalledWith(
      expect.objectContaining({
        customers: expect.arrayContaining([
          expect.objectContaining({ id: "a1", role: "admin" }),
        ]),
      }),
    );
  });
});
