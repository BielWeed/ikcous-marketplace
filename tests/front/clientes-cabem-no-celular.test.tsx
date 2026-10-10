// @vitest-environment jsdom
//
// Painel simples, onda J (J4) — Clientes no celular de 360px:
//   - o número de "Pedidos" do cartão compacto fica DENTRO do cartão (a linha
//     de baixo é uma grade `minmax(0,1fr)_auto`: o rótulo do total cede, o
//     número não é empurrado para fora);
//   - o tipo de conta aparece em português na lista e na ficha, nunca o valor
//     cru do banco ("customer");
//   - o menu diz "Ver ficha do cliente" e a ficha fala "carrinho"/"itens".
import { act } from "react";
import type { ReactNode } from "react";
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
import type { AdminUserDetailView as TipoFicha } from "@/views/admin/AdminUserDetailView";

const h = vi.hoisted(() => ({
  modo: "compact" as "compact" | "detailed",
}));

const clientes = [
  {
    id: "cli-1",
    email: "cliente@teste.com",
    full_name: "Cliente Teste",
    phone: "34999999999",
    role: "customer",
    created_at: "2026-08-01T00:00:00Z",
    orders_count: 3,
    total_spent: 150.5,
    last_order_date: "2026-09-01T00:00:00Z",
  },
  {
    id: "adm-1",
    email: "dono@teste.com",
    full_name: "Dona da Loja",
    phone: null,
    role: "admin",
    created_at: "2026-01-01T00:00:00Z",
    orders_count: 0,
    total_spent: 0,
    last_order_date: null,
  },
];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome === "get_admin_customers_paged") {
        return Promise.resolve({
          data: {
            data: clientes,
            total_count: 2,
            stats: {
              total_customers: 2,
              global_ltv: 150.5,
              global_orders: 3,
              new_customers_30d: 0,
            },
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: [],
          cart_items: [
            {
              id: "ci-1",
              product_id: "p-1",
              quantity: 1,
              created_at: "2026-09-01T00:00:00Z",
            },
          ],
          addresses: [],
        },
        error: null,
      });
    },
    from: () => ({
      select: () => {
        const resposta = Promise.resolve({ data: [], error: null });
        return Object.assign(resposta, {
          in: () => resposta,
          eq: () => resposta,
          order: () => resposta,
        });
      },
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
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
// Os itens do menu renderizam sempre (sem abrir o dropdown por pointer).
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

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

let AdminCustomersView: typeof TipoClientes;
let AdminUserDetailView: typeof TipoFicha;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
  ({ AdminUserDetailView } = await import("@/views/admin/AdminUserDetailView"));
}, 60_000);

describe("Clientes no celular (J4)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    // O modo é lido na montagem da tela (depois do `beforeEach`): o
    // `getItem` consulta `h.modo` na hora, não uma cópia feita aqui.
    vi.stubGlobal("localStorage", {
      getItem: (c: string) =>
        c === "admin_customers_view_mode" ? h.modo : null,
      setItem: () => {},
      removeItem: () => {},
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
  });

  async function abrirLista() {
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    // O fetch sai de um timer de 320 ms dentro da tela.
    await act(async () => {
      await esperar(500);
    });
  }

  async function abrirFicha() {
    await act(async () => {
      raiz.render(
        <AdminUserDetailView
          userId="cliente-1"
          onBack={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
  }

  it("(a) a lista mostra o tipo de conta em português, nunca o valor cru", async () => {
    h.modo = "compact";
    await abrirLista();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Cliente");
    expect(texto).toContain("Administrador");
    expect(texto).not.toMatch(/customer/i);
    expect(texto).not.toMatch(/\badmin\b/);
  });

  it("(a) o modo detalhado também fala português", async () => {
    h.modo = "detailed";
    await abrirLista();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Administrador");
    expect(texto).not.toMatch(/customer/i);
  });

  it("(b) a linha de baixo do cartão compacto é uma grade que não empurra 'Pedidos' para fora", async () => {
    h.modo = "compact";
    await abrirLista();

    // Sobe do rótulo "Total já comprado" (span > coluna > linha de KPIs).
    const rotuloTotal = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === "Total já comprado",
    );
    expect(rotuloTotal).toBeDefined();
    const linha = rotuloTotal!.parentElement?.parentElement;
    expect(linha?.className).toContain("grid-cols-[minmax(0,1fr)_auto]");

    const rotuloPedidos = [...linha!.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === "Pedidos",
    );
    expect(rotuloPedidos).toBeDefined();
    expect(rotuloTotal!.className).not.toContain("tracking-[0.2em]");
    expect(rotuloTotal!.className).toContain("break-words");
    expect(rotuloTotal!.className).toContain("min-w-0");
  });

  it("o menu diz 'Ver ficha do cliente' e não mais 'Ver Perfil Elite'", async () => {
    h.modo = "compact";
    await abrirLista();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Ver ficha do cliente");
    expect(texto).not.toContain("Perfil Elite");
  });

  it("(c) a ficha mostra o tipo de conta em português e fala 'carrinho' e 'itens'", async () => {
    await abrirFicha();

    const antes = hospedeiro.textContent ?? "";
    expect(antes).toContain("Cliente");
    expect(antes).not.toMatch(/customer/i);

    // Abre a aba do carrinho (Radix troca no mousedown).
    const aba = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Carrinho"),
    );
    expect(aba).toBeDefined();
    await act(async () => {
      aba!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      aba!.click();
      await esperar(20);
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Carrinho do cliente");
    expect(texto).toContain("O que está no carrinho agora");
    expect(texto).toContain("1 itens");
    expect(texto).not.toContain("estrutura de checkout");
    expect(texto).not.toContain("Elementos");
    expect(texto).not.toContain("Auditoria de Carrinho");
  });
});
