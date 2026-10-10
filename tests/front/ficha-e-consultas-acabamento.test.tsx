// @vitest-environment jsdom
//
// Painel simples, onda K (K-C) — acabamento da ficha do cliente, de Clientes e
// do histórico de consultas de frete:
//   - a ficha fala a língua da loja: "Pedidos feitos" (não "Cesta / Pedidos"),
//     "Nenhum pedido ainda" (não "Fluxo Zerado"/"integralizou aquisições") e
//     "Esta variação não existe mais" (não "Variante Indisponível (ID: …)", com
//     o id só no `title` do selo);
//   - toque de 44px: WhatsApp `h-11`, "Limpar Carrinho" `min-h-11`, abrir o
//     pedido `size-11` com nome acessível, ajuda da ficha e de Clientes
//     `min-h-11 min-w-11`, "Tentar novamente" `min-h-11`;
//   - o tempo de resposta das consultas de frete sai em segundos ("0,3 s"),
//     nunca em milissegundos de programador ("320ms").
// O jsdom não aplica CSS: a prova de toque é sobre a classe; a medida real é do
// render.
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

import type { HistoricoCotacoesSection as TipoHistorico } from "@/components/admin/settings/HistoricoCotacoesCard";
import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";
import type { AdminUserDetailView as TipoFicha } from "@/views/admin/AdminUserDetailView";

const { estado } = vi.hoisted(() => ({
  estado: {
    falhaDaFicha: false,
    pedidos: [] as Array<Record<string, unknown>>,
    carrinho: [] as Array<Record<string, unknown>>,
    logs: [] as Array<Record<string, unknown>>,
  },
}));

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
                orders_count: 3,
                total_spent: 150.5,
                last_order_date: null,
              },
            ],
            total_count: 1,
            stats: {
              total_customers: 1,
              global_ltv: 150.5,
              global_orders: 3,
              new_customers_30d: 1,
            },
          },
          error: null,
        });
      }
      if (estado.falhaDaFicha) {
        return Promise.resolve({ data: null, error: { message: "falhou" } });
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
          orders: estado.pedidos,
          cart_items: estado.carrinho,
          addresses: [],
        },
        error: null,
      });
    },
    from: (tabela: string) => {
      if (tabela === "shipping_calculation_logs") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: estado.logs, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => {
          const resposta = Promise.resolve({ data: [], error: null });
          return Object.assign(resposta, {
            in: () => resposta,
            eq: () => resposta,
            order: () => resposta,
          });
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
    functions: {
      invoke: () =>
        Promise.resolve({
          data: {
            success: true,
            modo: "multi",
            ligados: ["melhor_envio"],
            provedores: {},
          },
          error: null,
        }),
    },
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
    stats: { executive: { totalOrders: 3, avgTicket: 120 } },
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
let HistoricoCotacoesSection: typeof TipoHistorico;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
  ({ AdminUserDetailView } = await import("@/views/admin/AdminUserDetailView"));
  ({ HistoricoCotacoesSection } = await import(
    "@/components/admin/settings/HistoricoCotacoesCard"
  ));
}, 60_000);

function log(sobrescreve: Record<string, unknown>) {
  return {
    id: "1",
    created_at: new Date().toISOString(),
    destination_cep: "38400000",
    provider: "melhor_envio",
    response_time_ms: 320,
    status: "success",
    error_message: null,
    ...sobrescreve,
  };
}

describe("ficha, Clientes e consultas — acabamento da onda K", () => {
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
    estado.falhaDaFicha = false;
    estado.pedidos = [];
    estado.carrinho = [];
    estado.logs = [];
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
    vi.restoreAllMocks();
  });

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

  async function abrirAba(trecho: string) {
    const aba = [...hospedeiro.querySelectorAll('[role="tab"]')].find((b) =>
      b.textContent?.includes(trecho),
    );
    expect(aba, `aba ${trecho}`).toBeDefined();
    await act(async () => {
      // Radix troca a aba no mousedown, não no click.
      aba!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      await esperar(20);
    });
  }

  const classesDe = (el: Element | undefined | null) =>
    (el?.className ?? "").toString().split(/\s+/);

  const botaoPorTexto = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );

  describe("ficha do cliente", () => {
    it("o cartão diz 'Pedidos feitos' e o histórico vazio diz 'Nenhum pedido ainda'", async () => {
      await abrirFicha();

      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("Pedidos feitos");
      expect(texto).not.toContain("Cesta / Pedidos");

      await abrirAba("Ped");
      const depois = hospedeiro.textContent ?? "";
      expect(depois).toContain("Nenhum pedido ainda");
      expect(depois).toContain(
        "Quando este cliente comprar, os pedidos aparecem aqui.",
      );
      expect(depois).not.toContain("Fluxo Zerado");
      expect(depois).not.toContain("integralizou");
    });

    it("variação que sumiu diz 'Esta variação não existe mais', com o código visível e no title", async () => {
      estado.carrinho = [
        {
          id: "ci-1",
          product_id: "p-1",
          variant_id: "var-sumida-123",
          quantity: 1,
          created_at: "2026-09-01T00:00:00Z",
        },
      ];
      await abrirFicha();
      await abrirAba("Carr");

      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("Esta variação não existe mais");
      expect(texto).not.toContain("Variante Indisponível");
      expect(texto).not.toContain("(ID:");
      // O código aparece em texto (no celular o title não existe): a lojista
      // o lê ao falar com o suporte.
      expect(texto).toContain("Código: var-sumida-123");

      const selo = [...hospedeiro.querySelectorAll("span")].find(
        (s) => s.textContent?.trim() === "Esta variação não existe mais",
      );
      expect(selo?.getAttribute("title")).toContain("var-sumida-123");

      const codigo = [...hospedeiro.querySelectorAll("span")].find(
        (s) => s.textContent?.trim() === "Código: var-sumida-123",
      );
      expect(codigo, "código em linha própria").toBeDefined();
      // Quebra em qualquer ponto para não estourar a coluna a 360px; letra >= 11px.
      expect(classesDe(codigo)).toContain("break-all");
      expect(codigo?.className).not.toMatch(/text-\[(?:[6-9]|10(?:\.5)?)px\]/);
    });

    it("o toque tem 44px: WhatsApp, Limpar Carrinho, ajuda e abrir o pedido", async () => {
      estado.pedidos = [
        {
          id: "pedido-aaa111",
          status: "delivered",
          total: 20,
          created_at: "2026-08-01T00:00:00Z",
          items: [],
        },
        {
          id: "pedido-bbb222",
          status: "delivered",
          total: 30,
          created_at: "2026-08-02T00:00:00Z",
          items: [],
        },
      ];
      estado.carrinho = [
        {
          id: "ci-1",
          product_id: "p-1",
          quantity: 1,
          created_at: "2026-09-01T00:00:00Z",
        },
      ];
      await abrirFicha();

      expect(classesDe(botaoPorTexto("Contato Direto"))).toContain("h-11");
      expect(classesDe(botaoPorTexto("Contato Direto"))).not.toContain("h-10");

      const ajuda = hospedeiro.querySelector(
        'button[title="Guia da ficha do cliente e ajuda"]',
      );
      expect(classesDe(ajuda)).toEqual(
        expect.arrayContaining(["min-h-11", "min-w-11"]),
      );

      await abrirAba("Ped");
      // O nome acessível leva o número do pedido: cada linha tem o seu.
      const abrirTodos = [
        ...hospedeiro.querySelectorAll('button[aria-label^="Abrir o pedido"]'),
      ];
      expect(
        abrirTodos.map((b) => b.getAttribute("aria-label")).sort(),
      ).toEqual(["Abrir o pedido AAA111", "Abrir o pedido BBB222"]);
      for (const abrir of abrirTodos) {
        expect(classesDe(abrir)).toContain("size-11");
        expect(classesDe(abrir)).not.toContain("size-8");
      }

      await abrirAba("Carr");
      const limpar = botaoPorTexto("Limpar Carrinho");
      expect(classesDe(limpar)).toContain("min-h-11");
      expect(classesDe(limpar)).not.toContain("h-7");
    });

    it("'Tentar novamente' do estado de erro tem 44px de altura", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      estado.falhaDaFicha = true;
      await abrirFicha();

      const tentar = botaoPorTexto("Tentar novamente");
      expect(tentar).toBeDefined();
      expect(classesDe(tentar)).toContain("min-h-11");
      expect(classesDe(tentar)).not.toContain("py-2");
    });
  });

  describe("Clientes", () => {
    it("o botão de ajuda tem 44px de toque", async () => {
      await act(async () => {
        raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
      });
      // O fetch sai de um timer de 320 ms dentro da tela.
      await act(async () => {
        await esperar(500);
      });

      const ajuda = hospedeiro.querySelector(
        'button[title="Guia de Clientes e Ajuda"]',
      );
      expect(ajuda).not.toBeNull();
      expect(classesDe(ajuda)).toEqual(
        expect.arrayContaining(["min-h-11", "min-w-11"]),
      );
    });
  });

  describe("histórico de consultas de frete", () => {
    async function abrirHistorico() {
      await act(async () => {
        raiz.render(<HistoricoCotacoesSection />);
      });
      await act(async () => {
        await esperar(0);
      });
      await act(async () => {
        await esperar(0);
      });
    }

    function tempoDaLinha(cep: string): string {
      const linha = [...hospedeiro.querySelectorAll("tbody tr")].find((tr) =>
        tr.textContent?.includes(cep),
      );
      const celulas = [...(linha?.querySelectorAll("td") ?? [])];
      // Ordem das colunas: Data, CEP, Transportadora, Tempo, Status.
      return celulas[3]?.textContent?.trim() ?? "";
    }

    it("o tempo sai em segundos pt-BR, sem 'ms'", async () => {
      estado.logs = [
        log({ id: "1", destination_cep: "11111000", response_time_ms: 320 }),
        log({ id: "2", destination_cep: "22222000", response_time_ms: 1500 }),
        log({ id: "3", destination_cep: "33333000", response_time_ms: 40 }),
        log({ id: "4", destination_cep: "44444000", response_time_ms: 0 }),
      ];
      await abrirHistorico();

      expect(tempoDaLinha("11111-000")).toBe("0,3 s");
      expect(tempoDaLinha("22222-000")).toBe("1,5 s");
      expect(tempoDaLinha("33333-000")).toBe("menos de 0,1 s");
      expect(tempoDaLinha("44444-000")).toBe("—");
      expect(hospedeiro.textContent ?? "").not.toMatch(/\d+ms\b/);
    });
  });
});
