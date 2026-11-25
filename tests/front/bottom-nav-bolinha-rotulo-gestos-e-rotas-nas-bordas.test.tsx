// @vitest-environment jsdom
//
// A barra de baixo da loja, nas bordas que nenhum outro teste segurava:
// - some nas telas do painel (admin*);
// - o grupo do Carrinho inclui a ficha do pedido e o checkout;
// - a bolinha passa de 99 para "99+" só a partir de 100 (99 continua "99");
// - o nome falado da aba diz "1 item" / "N itens", e some quando a conta é zero;
// - tocar numa aba vibra uma vez e navega; passar o mouse / encostar o dedo
//   aquece a tela daquela aba; só o Carrinho leva o id de ancoragem;
// - Favoritos conta os favoritos da pessoa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  cartCount: 0,
  favorites: [] as { id: string }[],
  prefetchView: vi.fn(),
}));

vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: estado.cartCount }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: estado.favorites }),
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: estado.prefetchView }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { BottomNav } from "@/components/ui/custom/BottomNav";
import { haptic } from "@/utils/haptic";

type Tela = Parameters<typeof BottomNav>[0]["currentView"];

describe("BottomNav — bordas da bolinha, do rótulo falado, dos gestos e das rotas", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onNavigate: ReturnType<typeof vi.fn<(view: Tela) => void>>;
  // A barra é `memo`: sem trocar a `key`, uma nova contagem vinda do hook
  // (mockado) não redesenharia a mesma tela.
  let remontagem = 0;
  let vibracao: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    estado.cartCount = 0;
    estado.favorites = [];
    estado.prefetchView.mockClear();
    onNavigate = vi.fn<(view: Tela) => void>();
    vibracao = vi.spyOn(haptic, "light").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vibracao.mockRestore();
  });

  function montar(currentView: string) {
    act(() => {
      root.render(
        <BottomNav
          key={++remontagem}
          currentView={currentView as Tela}
          onNavigate={onNavigate}
        />,
      );
    });
  }

  function aba(rotulo: string): HTMLButtonElement {
    const achada = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent?.includes(rotulo));
    if (!achada) throw new Error(`aba ${rotulo} não encontrada`);
    return achada;
  }

  function abaAtiva() {
    return (
      container.querySelector<HTMLButtonElement>("button[aria-current='page']")
        ?.textContent ?? null
    );
  }

  it("nas telas do painel (admin e admin-*) a barra nem existe", () => {
    montar("admin");
    expect(container.querySelector("nav")).toBeNull();
    montar("admin-dashboard");
    expect(container.querySelector("nav")).toBeNull();
    montar("admin-orders");
    expect(container.querySelector("nav")).toBeNull();
  });

  it("controle: numa tela da loja a barra existe, com as quatro abas", () => {
    montar("home");
    expect(container.querySelector("nav")).not.toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(4);
  });

  it("a ficha do pedido e o checkout mantêm a aba Carrinho marcada", () => {
    montar("order-details");
    expect(abaAtiva()).toBe("Carrinho");
    montar("checkout");
    expect(abaAtiva()).toBe("Carrinho");
  });

  it("99 itens continuam '99'; 100 itens viram '99+'", () => {
    estado.cartCount = 99;
    montar("home");
    expect(aba("Carrinho").textContent).toBe("99Carrinho");

    estado.cartCount = 100;
    montar("cart");
    expect(aba("Carrinho").textContent).toBe("99+Carrinho");

    estado.cartCount = 150;
    montar("cart");
    expect(aba("Carrinho").textContent).toBe("99+Carrinho");
  });

  it("o nome falado da aba diz '1 item' no singular e 'N itens' no plural", () => {
    estado.cartCount = 1;
    montar("home");
    expect(aba("Carrinho").getAttribute("aria-label")).toBe("Carrinho, 1 item");

    estado.cartCount = 2;
    montar("home");
    expect(aba("Carrinho").getAttribute("aria-label")).toBe(
      "Carrinho, 2 itens",
    );
  });

  it("conta zero: sem bolinha e sem nome falado extra (nada de 'Carrinho, 0 itens')", () => {
    estado.cartCount = 0;
    estado.favorites = [];
    montar("home");
    expect(aba("Carrinho").getAttribute("aria-label")).toBeNull();
    expect(aba("Favoritos").getAttribute("aria-label")).toBeNull();
    expect(aba("Carrinho").textContent).toBe("Carrinho");
    expect(aba("Favoritos").textContent).toBe("Favoritos");
  });

  it("Favoritos mostra e fala a quantidade de favoritos da pessoa", () => {
    estado.favorites = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    montar("home");
    expect(aba("Favoritos").getAttribute("aria-label")).toBe(
      "Favoritos, 3 itens",
    );
    expect(aba("Favoritos").textContent).toBe("3Favoritos");
  });

  it("tocar numa aba vibra UMA vez e navega para a tela daquela aba", () => {
    montar("home");
    act(() => {
      aba("Favoritos").click();
    });
    expect(vibracao).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("favorites");

    act(() => {
      aba("Perfil").click();
    });
    expect(vibracao).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenLastCalledWith("profile");
  });

  it("passar o mouse aquece a tela da aba sob o mouse", () => {
    montar("home");
    act(() => {
      aba("Carrinho").dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    expect(estado.prefetchView).toHaveBeenCalledWith("cart");
  });

  it("encostar o dedo aquece a tela da aba tocada", () => {
    montar("home");
    act(() => {
      aba("Favoritos").dispatchEvent(
        new Event("touchstart", { bubbles: true }),
      );
    });
    expect(estado.prefetchView).toHaveBeenCalledWith("favorites");
  });

  it("só a aba Carrinho leva o id de ancoragem", () => {
    montar("home");
    const comId = Array.from(container.querySelectorAll("button[id]"));
    expect(comId).toHaveLength(1);
    expect(comId[0].id).toBe("bottom-nav-cart");
    expect(comId[0].textContent).toBe("Carrinho");
  });
});
