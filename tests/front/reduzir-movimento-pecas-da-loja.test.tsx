// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { BottomNav } from "@/components/ui/custom/BottomNav";
import { ProductList } from "@/components/ui/custom/ProductList";
import { QuantitySelector } from "@/components/ui/custom/QuantitySelector";
import type { Product } from "@/types";
import { AuthView } from "@/views/shared/AuthView";
import postcss from "postcss";
import { type ReactNode, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// O dublê observa as opções enviadas à biblioteca, não simula sua animação.
vi.mock("framer-motion", async () => {
  const { createElement } = await import("react");
  const componentes = new Map();
  return {
    useReducedMotion: () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy(
      {},
      {
        get: (_, tag: string) => {
          if (!componentes.has(tag))
            componentes.set(
              tag,
              ({
                children,
                initial,
                animate,
                exit,
                transition,
                variants,
                layoutId,
                whileTap,
                whileHover,
                ...props
              }: Record<string, unknown>) =>
                createElement(
                  tag,
                  {
                    ...props,
                    "data-motion": JSON.stringify({
                      initial,
                      animate,
                      exit,
                      transition,
                      variants,
                      layoutId,
                      whileTap,
                      whileHover,
                    }),
                  },
                  children as ReactNode,
                ),
            );
          return componentes.get(tag);
        },
      },
    ),
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useCart", () => ({ useCartState: () => ({ cartCount: 0 }) }));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [] }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: () => createElement("span", null, "Produto de teste"),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let reduzir = true;
beforeEach(() => {
  reduzir = true;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduzir })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function montar(no: ReactNode) {
  act(() => root.render(no));
}
function movimentos() {
  return Array.from(host.querySelectorAll("[data-motion]")).map(
    (no) =>
      JSON.parse(no.getAttribute("data-motion")!) as Record<string, unknown>,
  );
}
it("barra de baixo não desliza o ponto ao trocar de aba quando reduz movimento", () => {
  montar(<BottomNav currentView="home" onNavigate={vi.fn()} />);
  expect(movimentos()[0]?.layoutId).toBeUndefined();
  montar(<BottomNav currentView="cart" onNavigate={vi.fn()} />);
  expect(movimentos()[0]?.layoutId).toBeUndefined();
  reduzir = false;
  montar(<BottomNav currentView="favorites" onNavigate={vi.fn()} />);
  expect(movimentos()[0]?.layoutId).toBe("activeBottomNavDot");
});
it("quantidade muda na hora, sem o número deslizar, mas mantém a animação normal sem preferência", () => {
  montar(<QuantitySelector quantity={1} maxQuantity={5} onChange={vi.fn()} />);
  expect(movimentos()).toHaveLength(0);
  montar(<QuantitySelector quantity={2} maxQuantity={5} onChange={vi.fn()} />);
  expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("2");
  reduzir = false;
  montar(<QuantitySelector quantity={3} maxQuantity={5} onChange={vi.fn()} />);
  expect(movimentos()[0]?.initial).toEqual({ y: 8, opacity: 0 });
});
it("lista mostra os produtos sem entrada ou saída animada", () => {
  const props = {
    products: [{ id: "p1" } as Product],
    isLoading: false,
    favorites: [],
    onToggleFavorite: vi.fn(),
    onProductClick: vi.fn(),
  };
  montar(<ProductList {...props} />);
  expect(movimentos()[0]?.initial).toBe(false);
  expect(movimentos()[0]?.exit).toBeUndefined();
  expect(movimentos()[0]?.transition).toEqual({ duration: 0 });
  reduzir = false;
  montar(<ProductList {...props} favorites={["p1"]} />);
  expect(movimentos()[0]?.initial).toEqual({ opacity: 0, y: 12 });
});
it("tela de entrada não faz a cascata de campos deslizando", () => {
  montar(<AuthView onNavigate={vi.fn()} />);
  const dados = movimentos();
  expect(dados.length).toBeGreaterThan(2);
  for (const movimento of dados.filter((item) => item.variants !== undefined)) {
    expect(movimento.variants).toEqual({});
    expect(movimento.whileTap).toBeUndefined();
    expect(movimento.whileHover).toBeUndefined();
  }
  reduzir = false;
  montar(<AuthView onNavigate={vi.fn()} />);
  expect(movimentos()[0]?.variants).toMatchObject({ hidden: { y: 30 } });
});
it("a regra CSS desliga a rolagem suave inclusive nas abas do painel", () => {
  const css = postcss.parse(readFileSync("src/index.css", "utf8"));
  const cobertos = new Set<string>();
  css.walkAtRules("media", (regra) => {
    if (!regra.params.includes("prefers-reduced-motion: reduce")) return;
    regra.walkRules((seletor) => {
      seletor.walkDecls("scroll-behavior", (declaracao) => {
        if (declaracao.value === "auto" && declaracao.important)
          for (const nome of seletor.selectors) cobertos.add(nome);
      });
    });
  });
  for (const seletor of [
    "html",
    ".admin-scroll-container",
    ".admin-tab-pane",
    ".scroll-smooth",
  ])
    expect(cobertos.has(seletor), seletor).toBe(true);
});
