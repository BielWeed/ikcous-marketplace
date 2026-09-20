// @vitest-environment jsdom
//
// Peça 24 (achado P2 do PR #605): a rota "about-store" abre a partir do
// Perfil, mas não constava do grupo de rotas ativas da aba — com a página
// da loja no ar, a barra ficava sem NENHUMA aba selecionada (sem
// aria-current), e o leitor de tela perdia o "atual" da aba.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: 0 }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [] }),
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: () => {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { BottomNav } from "@/components/ui/custom/BottomNav";

describe("BottomNav — a aba Perfil segue ativa na rota Sobre a Loja", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function abaAtiva() {
    const atual = container.querySelector<HTMLButtonElement>(
      "button[aria-current='page']",
    );
    return atual?.textContent ?? null;
  }

  function montarBarra(currentView: string) {
    act(() => {
      root.render(
        <BottomNav
          currentView={
            currentView as Parameters<typeof BottomNav>[0]["currentView"]
          }
          onNavigate={() => {}}
        />,
      );
    });
  }

  it("rota about-store mantém o Perfil selecionado (aria-current)", () => {
    montarBarra("about-store");
    expect(abaAtiva()).toBe("Perfil");
  });

  it("demais rotas do grupo Perfil continuam no mesmo grupo (regressão)", () => {
    for (const rota of [
      "profile",
      "account-settings",
      "address-form",
      "login",
      "auth",
    ]) {
      montarBarra(rota);
      expect(abaAtiva()).toBe("Perfil");
    }
  });

  it("grupos vizinhos intocados: Início e o grupo do Carrinho mapeiam como antes", () => {
    montarBarra("home");
    expect(abaAtiva()).toBe("Início");

    montarBarra("orders");
    expect(abaAtiva()).toBe("Carrinho");

    montarBarra("cart");
    expect(abaAtiva()).toBe("Carrinho");
  });
});
