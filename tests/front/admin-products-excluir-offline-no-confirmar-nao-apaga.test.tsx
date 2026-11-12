// @vitest-environment jsdom
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  offline: false,
  excluir: vi.fn(),
  carregar: vi.fn(),
  erro: vi.fn(),
}));
const produtos = [
  {
    id: "prod-1",
    name: "Camiseta",
    category: "Geral",
    images: [],
    isActive: true,
    stock: 10,
    price: 100,
    costPrice: 50,
  },
];
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtos,
    loading: false,
    deleteProduct: h.excluir,
    loadProducts: h.carregar,
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
// Só o menu é dublado; a confirmação de exclusão continua sendo a real.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("sonner", () => ({
  toast: { error: h.erro, success: vi.fn(), loading: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let hospedeiro: HTMLDivElement;
const navegar = vi.fn();
const esperar = () => new Promise((resolve) => setTimeout(resolve, 30));
const confirmar = () =>
  document.querySelector<HTMLButtonElement>(
    '[aria-label="Excluir Produto: confirmar exclusão"]',
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.offline = false;
  h.excluir.mockResolvedValue(true);
  h.carregar.mockResolvedValue({ products: produtos, total: 1 });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function montar() {
  const { AdminProductsView } = await import("@/views/admin/AdminProductsView");
  await act(async () => {
    // A tela usa memo: uma prop nova garante que o dublê do hook seja relido.
    raiz.render(
      <AdminProductsView onNavigate={(...args) => navegar(...args)} active />,
    );
    await esperar();
  });
}
async function abrirConfirmacao() {
  const excluir = [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Excluir Produto"),
  );
  expect(excluir).toBeDefined();
  expect(excluir!.disabled).toBe(false);
  await act(async () => {
    excluir!.click();
    await esperar();
  });
  expect(confirmar()).not.toBeNull();
}

it("perder a conexão depois de abrir a confirmação não apaga; reconectado pode excluir", async () => {
  await montar();
  await abrirConfirmacao();
  h.offline = true;
  await montar();
  expect(confirmar()).not.toBeNull();
  await act(async () => {
    confirmar()!.click();
    await esperar();
  });

  expect(h.excluir).not.toHaveBeenCalled();
  expect(h.erro).toHaveBeenCalledExactlyOnceWith("Você está offline", {
    description: "Não é possível confirmar a exclusão sem conexão.",
  });
  expect(confirmar()).toBeNull();

  // Controle positivo: o mesmo produto pode ser excluído quando há conexão.
  h.offline = false;
  await montar();
  await abrirConfirmacao();
  await act(async () => {
    confirmar()!.click();
    await esperar();
  });
  expect(h.excluir).toHaveBeenCalledExactlyOnceWith("prod-1");
});
