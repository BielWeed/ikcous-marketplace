// @vitest-environment jsdom
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const pedidos: Order[] = [];
const carregar = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: pedidos,
    totalOrders: 0,
    isLoaded: true,
    loading: false,
    loadOrders: carregar,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({ pedirRecarga: vi.fn() }),
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

const produtos = "/admin-products";
const pedidosUrl = "/admin-orders";
const onNavigate = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  globalThis.localStorage.clear();
  onNavigate.mockClear();
  globalThis.history.replaceState({ view: "admin-products" }, "", produtos);
  globalThis.history.pushState({ view: "admin-orders" }, "", pedidosUrl);
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  globalThis.localStorage.clear();
});

async function montarPedidos() {
  const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
  await act(async () => {
    raiz.render(<AdminOrdersView active onNavigate={onNavigate} />);
  });
}

const janela = () => document.querySelector('[role="dialog"]');

async function clicar(nome: string) {
  const botao = [...(janela() ?? hospedeiro).querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
  );
  if (!botao) throw new Error(`Botão não encontrado: ${nome}`);
  await act(async () => botao.click());
}

async function voltarDoAparelho() {
  // O jsdom percorre o histórico de verdade e atualiza a URL antes do popstate.
  // No App é essa URL, não o estado visual da janela, que determina a tela.
  const anterior = globalThis.history.state;
  await act(async () => {
    globalThis.history.back();
    await vi.waitFor(() => {
      expect(globalThis.history.state).not.toEqual(anterior);
    });
  });
}

it("Voltar fecha só os filtros, fica em Pedidos e mantém o filtro aplicado", async () => {
  await montarPedidos();
  await clicar("Filtros e ferramentas");
  await clicar("Abrir filtros");
  await clicar("Site");
  expect(
    janela()?.querySelector('button[aria-pressed="true"]:not([aria-label])')
      ?.textContent,
  ).toBe("Site");

  await voltarDoAparelho();

  expect(globalThis.location.pathname).toBe(pedidosUrl);
  expect(janela()).toBeNull();
  expect(onNavigate).not.toHaveBeenCalled();
  expect(
    hospedeiro.querySelector('button[aria-label="Limpar Canal da Venda"]'),
  ).not.toBeNull();
  expect(globalThis.localStorage.getItem("admin_orders_canal_filter")).toBe(
    '"online"',
  );

  // A entrada da janela foi consumida: o próximo Voltar sai normalmente.
  await voltarDoAparelho();
  expect(globalThis.location.pathname).toBe(produtos);
});

it("sem abrir a janela, Voltar vai direto para Produtos", async () => {
  await montarPedidos();
  expect(janela()).toBeNull();

  await voltarDoAparelho();

  expect(globalThis.location.pathname).toBe(produtos);
});
