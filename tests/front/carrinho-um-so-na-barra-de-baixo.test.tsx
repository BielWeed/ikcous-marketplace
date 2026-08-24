// @vitest-environment jsdom
//
// Em tela larga a cliente via DOIS carrinhos ao mesmo tempo: um no canto
// superior direito (Header.tsx, `id="header-cart"`, escondido no celular por
// `hidden ... md:flex`) e outro na barra de baixo (BottomNav, que em `md`
// vira uma barra flutuante e NUNCA some). Medido no navegador, em
// http://localhost:5173, antes do conserto:
//
//     largura 1280 -> header_cart visivel em (1176, 6)
//                     bottom_nav_cart visivel em (663, 716)   -> DOIS
//     largura  606 -> header_cart escondido                   -> um so
//
// O Gabriel decidiu em 24/08/2026: fica so o da barra de baixo.
//
// A ARMADILHA QUE VEM JUNTO, e o motivo deste arquivo ter duas metades:
// `cartAnimation.ts` mirava `#header-cart` sempre que a janela tivesse
// >= 768px (`const isDesktop = window.innerWidth >= 768`). Apagar o botao do
// topo sem mexer nela deixaria a animacao de "voar para o carrinho" mirando
// um elemento que nao existe mais — ela cai no `if (!target)`, escreve um
// console.warn e NAO ANIMA NADA em tela larga. O defeito trocaria de lugar
// em vez de sumir.
//
// Por isso a assercao da animacao e' sobre o EFEITO no elemento certo (a
// classe `cart-pop` cai no `#bottom-nav-cart`), com os DOIS elementos
// presentes no DOM: se ela so checasse "achou algum alvo", o teste passaria
// com a implementacao velha assim que `#header-cart` existisse.
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
    definirLargura(larguraOriginal);
    document.body.innerHTML = "";
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
