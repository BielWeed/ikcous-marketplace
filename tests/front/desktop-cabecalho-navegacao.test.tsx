import { Header } from "@/components/ui/custom/Header";
import { CONSULTA_TELA_DE_COMPUTADOR } from "@/hooks/useTelaDeComputador";
import type { View } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  user: null as null | { user_metadata: { name: string } },
  isAdmin: false,
  logout: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ ...estado, profile: null }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja" } }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 2 }),
}));
vi.mock("@/hooks/useCart", () => ({ useCartState: () => ({ cartCount: 3 }) }));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: ["a"] }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({ SearchBar: () => null }));

// @ts-expect-error flag interna do React para act.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const navegar = vi.fn();
beforeEach(() => {
  estado.user = null;
  estado.isAdmin = false;
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === CONSULTA_TELA_DE_COMPUTADOR,
  }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function montar(hideSearch = false, currentView?: View) {
  await import("@/components/desktop/NavegacaoDoTopo");
  await act(async () => {
    root.render(
      <Header
        onNavigate={navegar}
        hideSearch={hideSearch}
        currentView={currentView}
      />,
    );
  });
}

it.each(["cart", "orders", "checkout"] as View[])(
  "o carrinho indica a rota atual %s",
  async (view) => {
    await montar(false, view);
    expect(
      host.querySelector("#header-cart")?.getAttribute("aria-current"),
    ).toBe("page");
  },
);
function botao(nome: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === nome || b.getAttribute("aria-label") === nome,
  )!;
}
async function abrirConta() {
  await act(async () =>
    botao("Ana").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}

it("F1.8/9 mostra um carrinho no topo, favoritos e entrar com os destinos corretos", async () => {
  await montar();
  const nav = host.querySelector(
    'header nav[aria-label="Navegação principal"]',
  );
  expect(nav).not.toBeNull();
  expect(nav!.querySelector("#header-cart")?.getAttribute("aria-label")).toBe(
    "Carrinho, 3 itens",
  );
  expect(nav!.querySelector('[aria-label="Favoritos, 1 item"]')).not.toBeNull();
  for (const [nome, view] of [
    ["Favoritos, 1 item", "favorites"],
    ["Carrinho, 3 itens", "cart"],
    ["Entrar", "auth"],
  ]) {
    act(() => botao(nome).click());
    expect(navegar).toHaveBeenLastCalledWith(view);
  }
  expect(botao("Painel da loja")).toBeUndefined();
});
it("F1.9 o aviso não desmonta o carrinho nem o sino do computador", async () => {
  await montar();
  await act(async () =>
    globalThis.dispatchEvent(
      new CustomEvent("header-toast-event", {
        detail: {
          id: "desktop",
          type: "success",
          message: "Adicionado",
          duration: 100,
        },
      }),
    ),
  );
  expect(host.querySelector("#header-cart")).not.toBeNull();
  expect(
    host.querySelector('[aria-label="Notificações, 2 não lidas"]'),
  ).not.toBeNull();
});
it("F1.9/13 sem desktop não monta nav nem selo e preserva o slot vazio", async () => {
  vi.stubGlobal("matchMedia", undefined);
  await montar(true);
  expect(host.querySelector("nav")).toBeNull();
  expect(host.textContent).not.toContain("Compra segura");
  expect(
    host.querySelector("#checkout-header-center-slot")?.childElementCount,
  ).toBe(0);
});
it("F1.13 desktop com hideSearch preserva o slot e mostra Compra segura", async () => {
  await montar(true);
  expect(host.querySelector("#checkout-header-center-slot")).not.toBeNull();
  expect(host.textContent).toContain("Compra segura");
});
it("F1.11 o menu usa o logout existente e os destinos da conta; Esc fecha", async () => {
  estado.user = { user_metadata: { name: "Ana Silva" } };
  await montar();
  await abrirConta();
  for (const nome of [
    "Minha conta",
    "Meus pedidos",
    "Configurações da conta",
    "Sobre a loja",
    "Sair",
  ])
    expect(document.body.textContent).toContain(nome);
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(
    "Painel da loja",
  );
  await act(async () =>
    document
      .querySelector('[role="menu"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  expect(document.querySelector('[role="menu"]')).toBeNull();
  for (const [nome, view] of [
    ["Minha conta", "profile"],
    ["Meus pedidos", "orders"],
    ["Configurações da conta", "account-settings"],
    ["Sobre a loja", "about-store"],
  ]) {
    await abrirConta();
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((el) => el.textContent === nome)!
        .click(),
    );
    expect(navegar).toHaveBeenLastCalledWith(view);
  }
  await abrirConta();
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((el) => el.textContent === "Sair")!
      .click(),
  );
  expect(estado.logout).toHaveBeenCalledTimes(1);
});
it("F1.8/11 o admin tem acesso ao Painel da loja", async () => {
  estado.user = { user_metadata: { name: "Ana Silva" } };
  estado.isAdmin = true;
  await montar();
  act(() => botao("Painel da loja").click());
  expect(navegar).toHaveBeenLastCalledWith("admin-dashboard");
  await abrirConta();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain(
    "Painel da loja",
  );
});
