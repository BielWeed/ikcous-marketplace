import type { Order } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const carregar = vi.fn();
const anular = vi.fn();
let pedidos: Order[] = [];
let erro: string | null = null;
let offline = false;
let carregado = true;
let preparar: number | null = 4;
let root: Root;
let host: HTMLDivElement;
let armazem: Map<string, string>;
const stats = { deliveredTotal: 1 };
vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: pedidos,
    totalOrders: pedidos.length,
    isLoaded: carregado,
    loading: !carregado,
    erroDaListagem: erro,
    loadOrders: carregar,
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => offline }));
vi.mock("@/hooks/useAnularVendaDoBalcao", () => ({
  useAnularVendaDoBalcao: () => ({ anular }),
}));
vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({
    paraPreparar: preparar,
    aguardandoPagamento: 0,
    aCaminho: 2,
    abertosComPagamentoAConferir: 0,
    pedirRecarga: vi.fn(),
  }),
}));
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useEstornosEmCursoDosPedidos", () => ({
  useEstornosEmCursoDosPedidos: () => ({ porPedido: {}, recarregar: vi.fn() }),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  erro = null;
  offline = false;
  carregado = true;
  preparar = 4;
  carregar.mockClear();
  pedidos = [];
  anular.mockReset();
  armazem = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => armazem.get(k) ?? null,
    setItem: (k: string, v: string) => armazem.set(k, v),
    removeItem: (k: string) => armazem.delete(k),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function montar() {
  const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
  await act(async () =>
    root.render(<AdminOrdersView active onNavigate={vi.fn()} />),
  );
}
async function clicar(nome: string) {
  const contexto = document.querySelector('[role="dialog"]') ?? document.body;
  const botao = [...contexto.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
  );
  expect(botao, nome).toBeTruthy();
  await act(async () => botao!.click());
}

it("métrica de pagamento fica inteira e fora das setas; expandir preserva as quatro fontes", async () => {
  await montar();
  await clicar("Próxima métrica");
  const rotulo = [...host.querySelectorAll("p")].find(
    (p) => p.textContent === "Aguardando pagamento",
  )!;
  expect(rotulo.closest("[hidden]")?.hasAttribute("hidden")).not.toBe(true);
  expect(rotulo.className).not.toMatch(/truncate|line-clamp/);
  expect(rotulo.parentElement?.querySelector("h3")?.textContent).toBe("0");
  await clicar("Expandir");
  const cartoes = host.querySelectorAll(
    'section[aria-label="Métricas de Pedidos"] article',
  );
  expect([...cartoes].map((c) => c.querySelector("h3")?.textContent)).toEqual([
    "4",
    "0",
    "2",
    "1",
  ]);
});

it("dado não carregado continua travessão, nunca inventa zero", async () => {
  preparar = null;
  await montar();
  expect(
    host.querySelector('section[aria-label="Métricas de Pedidos"] h3')
      ?.textContent,
  ).toBe("—");
});

it("filtros mantêm a ordem aprovada e mostram todas as opções de pagamento", async () => {
  await montar();
  await clicar("Status do pedido: Em Aberto");
  const campos = [...document.querySelectorAll('[role="dialog"] legend')].map(
    (el) => el.textContent,
  );
  expect(campos).toEqual([
    "Status do pedido",
    "Filtro Temporal",
    "Canal da venda",
    "Status de Pagamento",
  ]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Pago fora do fluxo — precisa de atenção",
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Sem cobrança online",
  );
});

it("ferramentas expõem modo e CSV, e chips removem somente o filtro escolhido", async () => {
  armazem.set("admin_orders_canal_filter", '"online"');
  armazem.set("admin_orders_payment_filter", '"pago"');
  await montar();
  await clicar("Limpar Canal da Venda");
  expect(armazem.get("admin_orders_canal_filter")).toBe('"all"');
  expect(armazem.get("admin_orders_payment_filter")).toBe('"pago"');
  await clicar("Filtros e ferramentas");
  expect(
    document.querySelector('button[aria-label="Exportar CSV"]'),
  ).toBeTruthy();
  await clicar("Visualização Detalhada");
  expect(
    document.querySelector('button[aria-pressed="true"]')?.textContent,
  ).toBe("Visualização Detalhada");
});

it("erro oferece nova tentativa sem afirmar loja vazia; botão chama o carregamento existente", async () => {
  erro = "Tente novamente para atualizar a lista.";
  await montar();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Não foi possível carregar",
  );
  expect(host.textContent).not.toContain("Seus pedidos vão aparecer aqui");
  carregar.mockClear();
  await clicar("Tentar de novo");
  expect(carregar).toHaveBeenCalledWith(
    0,
    12,
    "open",
    "",
    undefined,
    undefined,
    false,
    "all",
    "all",
  );
});

it("vazio filtrado permite limpar o recorte completo e voltar à primeira página", async () => {
  armazem.set("admin_orders_search_query", '"Maria"');
  await montar();
  expect(host.textContent).toContain("Nenhum pedido neste recorte");
  await clicar("Limpar busca e filtros");
  expect(armazem.get("admin_orders_filter_v2")).toBe('"all"');
  expect(armazem.get("admin_orders_search_query")).toBe('""');
  expect(armazem.get("admin_orders_current_page")).toBe("0");
});

it("sem conexão e carregando têm explicações próprias", async () => {
  offline = true;
  carregado = false;
  await montar();
  expect(host.textContent).toContain("Sem internet agora");
  expect(host.textContent).toContain("Carregando pedidos...");
  expect(host.textContent).not.toContain("Seus pedidos vão aparecer aqui");
});

it("o resultado da anulação sobrevive à remoção do cartão pelo realtime em Finalizados", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T15:00:00Z"));
  pedidos = [
    {
      id: "venda-abc123",
      customer: { name: "Maria", whatsapp: "" },
      items: [],
      subtotal: 20,
      total: 20,
      shipping: 0,
      discount: 0,
      status: "delivered",
      canal: "presencial",
      paymentMethod: "cash",
      paymentStatus: "recebido_na_entrega",
      pagamentoRecebidoEm: "2026-10-17T12:00:00Z",
      createdAt: "2026-10-17T12:00:00Z",
      updatedAt: "2026-10-17T12:00:00Z",
      cancelledAfterShipping: false,
    },
  ];
  armazem.set("admin_orders_filter_v2", '"delivered"');
  let concluir!: (v: unknown) => void;
  anular.mockImplementation(
    () =>
      new Promise((resolve) => {
        concluir = resolve;
      }),
  );
  await montar();
  await clicar("Ações do pedido #ABC123");
  await clicar("Anular venda");
  const campo = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(campo, "Venda duplicada");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clicar("Confirmar anulação");
  expect(anular).toHaveBeenCalledTimes(1);
  pedidos = [];
  await montar();
  expect(host.querySelector('[data-testid="pedido-card"]')).toBeNull();
  await act(async () =>
    concluir({ orderId: "venda-abc123", jaAnulada: false }),
  );
  expect(host.textContent).toContain("Venda anulada: o estoque voltou");
  expect(host.textContent).toContain("O app não devolve o dinheiro.");
  expect(host.textContent).toContain("em dinheiro ao cliente.");
});
