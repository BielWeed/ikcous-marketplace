// @vitest-environment jsdom
// F1.10: sem matchMedia mantém os quatro casos de largura originais no alvo
// de baixo. Com a consulta de desktop, só o alvo visível do topo recebe o pop.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { logoUrl: null, storeName: "Loja" } }),
}));

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: 3 }),
}));

vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

import { Header } from "@/components/ui/custom/Header";
import { triggerFlyingCartAnimation } from "@/utils/cartAnimation";

describe("o carrinho do topo saiu, e so o da barra de baixo ficou", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<Header onNavigate={() => {}} />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("o Header nao renderiza mais nenhum botao de carrinho", () => {
    expect(container.querySelector('[aria-label="Carrinho"]')).toBeNull();
    expect(container.querySelector("#header-cart")).toBeNull();
  });

  it("o sino continua no Header — a remocao foi cirurgica", () => {
    expect(
      container.querySelector('[aria-label="Notificações"]'),
    ).not.toBeNull();
  });
});

describe("a animacao de voar para o carrinho mira a barra de baixo", () => {
  let alvoDeBaixo: HTMLElement;
  let alvoDoTopo: HTMLElement;
  let origem: HTMLElement;
  let avisos: string[];

  const larguraOriginal = window.innerWidth;

  function definirLargura(px: number) {
    Object.defineProperty(window, "innerWidth", {
      value: px,
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    // Os DOIS presentes de proposito: com so o de baixo no DOM, a
    // implementacao velha tambem "passaria" por falta de alternativa.
    alvoDoTopo = document.createElement("button");
    alvoDoTopo.id = "header-cart";
    alvoDeBaixo = document.createElement("button");
    alvoDeBaixo.id = "bottom-nav-cart";
    origem = document.createElement("div");
    document.body.append(alvoDoTopo, alvoDeBaixo, origem);

    avisos = [];
    vi.spyOn(console, "warn").mockImplementation((m: unknown) => {
      avisos.push(String(m));
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    definirLargura(larguraOriginal);
    document.body.innerHTML = "";
  });

  it("com a consulta de desktop ativa, o pop cai só no #header-cart", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(min-width: 1024px)" }));
    triggerFlyingCartAnimation(origem, "");
    vi.advanceTimersByTime(760);
    expect(alvoDoTopo.classList.contains("cart-pop")).toBe(true);
    expect(alvoDeBaixo.classList.contains("cart-pop")).toBe(false);
  });

  it("no desktop sem alvo do topo, usa a barra de baixo ainda montada", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    alvoDoTopo.remove();
    triggerFlyingCartAnimation(origem, "");
    vi.advanceTimersByTime(760);
    expect(alvoDeBaixo.classList.contains("cart-pop")).toBe(true);
  });

  for (const largura of [1440, 1280, 768, 375]) {
    it(`em ${largura}px o pop cai no #bottom-nav-cart, nunca no #header-cart`, () => {
      definirLargura(largura);

      triggerFlyingCartAnimation(origem, "");
      vi.advanceTimersByTime(760);

      expect(alvoDeBaixo.classList.contains("cart-pop")).toBe(true);
      expect(alvoDoTopo.classList.contains("cart-pop")).toBe(false);
      expect(avisos).toEqual([]);
    });
  }

  it("sem a barra de baixo no DOM ela avisa e nao quebra", () => {
    definirLargura(1280);
    alvoDeBaixo.remove();

    expect(() => triggerFlyingCartAnimation(origem, "")).not.toThrow();
    expect(avisos.join(" ")).toContain("bottom-nav-cart");
  });
});
