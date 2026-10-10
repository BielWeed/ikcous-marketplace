// @vitest-environment jsdom
//
// Painel simples, onda J2 (J2-D) — Clientes e a ficha do cliente:
//   - Clientes escreve os números em milhar pt-BR ("1.289", não "1289") e diz
//     "Novos (30 dias)" por extenso;
//   - a aba Carrinho da ficha não rola na lateral no celular: cada item vira
//     um BLOCO (a tabela só é tabela a partir de `sm:`), com o botão de
//     remover de 44px e o cabeçalho só para leitor de tela até `sm:`;
//   - sem jargão ("Standby", "Identificador do Ativo", "Densidade",
//     "Precificação Base", "Estimativa (BRL)", "pre-checkout");
//   - a aba, o selo e o resumo do topo contam a MESMA coisa: produtos
//     diferentes (3 linhas com 4 unidades dizem "3", nunca "4").
// `display: block` na tabela tira a semântica de tabela do leitor de tela:
// por isso os papéis ARIA estão escritos no HTML.
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
import type { AdminUserDetailView as TipoFicha } from "@/views/admin/AdminUserDetailView";

// 3 produtos diferentes, 4 unidades no total (2 + 1 + 1).
const LINHAS_DO_CARRINHO = [
  { product_id: "p-1", quantity: 2 },
  { product_id: "p-2", quantity: 1 },
  { product_id: "p-3", quantity: 1 },
];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome === "get_admin_customers_paged") {
        return Promise.resolve({
          data: {
            data: [
              {
                id: "a1",
                email: "a1@teste.com",
                full_name: "Paulo Lima",
                phone: null,
                role: "customer",
                created_at: "2026-08-01T00:00:00Z",
                orders_count: 1289,
                total_spent: 150.5,
                last_order_date: null,
              },
            ],
            total_count: 1,
            stats: {
              total_customers: 2345,
              global_ltv: 150.5,
              global_orders: 1289,
              new_customers_30d: 1500,
            },
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Marina Souza",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: [],
          cart_items: LINHAS_DO_CARRINHO.map((l, i) => ({
            id: `ci-${i}`,
            product_id: l.product_id,
            quantity: l.quantity,
            created_at: "2026-09-01T00:00:00Z",
          })),
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
  useAnalytics: () => ({
    stats: { executive: { totalOrders: 1289, avgTicket: 120 } },
    fetchExecutiveSummary: vi.fn(),
  }),
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
let AdminUserDetailView: typeof TipoFicha;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
  ({ AdminUserDetailView } = await import("@/views/admin/AdminUserDetailView"));
}, 60_000);

const JARGAO = [
  "Standby",
  "Identificador do Ativo",
  "Densidade",
  "Precificação Base",
  "Estimativa (BRL)",
  "pre-checkout",
];

describe("Clientes e ficha do cliente — J2-D", () => {
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

  async function abrirFichaNaAbaCarrinho() {
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
    const aba = [...hospedeiro.querySelectorAll('[role="tab"]')].find((b) =>
      b.textContent?.includes("Carr"),
    );
    expect(aba).toBeDefined();
    await act(async () => {
      // Radix troca a aba no mousedown, não no click.
      aba!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      await esperar(20);
    });
    return aba!;
  }

  describe("Clientes", () => {
    it("os números inteiros saem em milhar pt-BR e '30D' vira '30 dias'", async () => {
      await abrirLista();

      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("1.289");
      expect(texto).not.toMatch(/(^|\D)1289(\D|$)/);
      expect(texto).toContain("2.345");
      expect(texto).not.toMatch(/(^|\D)2345(\D|$)/);
      expect(texto).toContain("1.500");
      expect(texto).toContain("Novos (30 dias)");
      expect(texto).not.toMatch(/30d\)/i);
    });
  });

  describe("Ficha — aba Carrinho", () => {
    it("não usa o jargão de antes, nem na aba nem no resumo do topo", async () => {
      await abrirFichaNaAbaCarrinho();

      const texto = hospedeiro.textContent ?? "";
      for (const termo of JARGAO) {
        expect(texto, termo).not.toContain(termo);
      }
      expect(texto).toContain("Quantidade");
      expect(texto).toContain("Preço");
    });

    it("aba, selo e resumo do topo contam produtos diferentes (3), não unidades (4)", async () => {
      const aba = await abrirFichaNaAbaCarrinho();

      expect(aba.textContent).toContain("(3)");
      expect(aba.textContent).not.toContain("(4)");

      const selo = [...hospedeiro.querySelectorAll('[data-slot="badge"]')].find(
        (b) => /produtos?$/.test(b.textContent?.trim() ?? ""),
      );
      expect(selo?.textContent?.trim()).toBe("3 produtos");

      // O resumo do topo diz a mesma coisa que o selo.
      const texto = hospedeiro.textContent ?? "";
      // (sem `\b`: o rótulo do cartão vem colado ao número no textContent.)
      expect(texto).not.toMatch(/4\s*itens/i);
      expect(texto.match(/3\s*produtos/gi) ?? []).toHaveLength(2);
    });

    it("a tabela é bloco no celular, com papéis ARIA, cabeçalho só para leitor de tela e remover de 44px", async () => {
      await abrirFichaNaAbaCarrinho();

      const painel = hospedeiro.querySelector(
        '[role="tabpanel"][data-state="active"]',
      );
      const tabela = painel?.querySelector("table");
      expect(tabela).not.toBeNull();
      expect(tabela!.getAttribute("role")).toBe("table");
      expect(tabela!.classList.contains("block")).toBe(true);
      expect(tabela!.classList.contains("sm:table")).toBe(true);

      // Sem rolagem lateral no celular: nenhum ancestral da tabela, dentro
      // do painel, rola na horizontal abaixo de `sm:`.
      for (
        let pai = tabela!.parentElement;
        pai && pai !== painel;
        pai = pai.parentElement
      ) {
        expect(
          /(^|\s)overflow-x-auto(\s|$)/.test(pai.className),
          pai.className,
        ).toBe(false);
      }

      const cabecalho = tabela!.querySelector("thead");
      expect(cabecalho?.getAttribute("role")).toBe("rowgroup");
      expect(cabecalho?.classList.contains("sr-only")).toBe(true);
      expect(cabecalho?.classList.contains("sm:not-sr-only")).toBe(true);
      expect(cabecalho?.classList.contains("sm:table-header-group")).toBe(true);
      const colunas = [...tabela!.querySelectorAll("th")];
      expect(colunas.length).toBeGreaterThan(0);
      expect(
        colunas.every((th) => th.getAttribute("role") === "columnheader"),
      ).toBe(true);

      expect(tabela!.querySelector("tbody")?.getAttribute("role")).toBe(
        "rowgroup",
      );
      const linhas = [...tabela!.querySelectorAll("tbody tr")];
      expect(linhas.length).toBe(4); // 3 itens + a linha do total
      for (const linha of linhas) {
        expect(linha.getAttribute("role")).toBe("row");
        for (const td of linha.querySelectorAll("td")) {
          expect(td.getAttribute("role")).toBe("cell");
        }
      }
      // Cada item é um bloco no celular e volta a ser linha de tabela em `sm:`.
      expect(linhas[0].className).toContain("grid");
      expect(linhas[0].className).toContain("sm:table-row");

      const remover = [...tabela!.querySelectorAll("button")].filter((b) =>
        b.getAttribute("title")?.includes("Remover do Carrinho"),
      );
      expect(remover).toHaveLength(3);
      for (const botao of remover) {
        expect(botao.className).toContain("size-11");
      }
    });
  });
});
