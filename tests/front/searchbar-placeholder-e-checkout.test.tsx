// @vitest-environment jsdom
//
// Cobre a correção do letreiro ilegível do campo de busca (ver
// `.unlighthouse/127.0.0.1/a4af/reports/lighthouse.json`, accessibility 0.81,
// `color-contrast` reprovado em SearchBar.tsx): o texto de apoio do campo
// precisa estar no atributo `placeholder` de verdade do `<input>`, não num
// `<div>` com `animate-marquee-x` que rola de lado e nunca cabe.
//
// E cobre o segundo ponto da tarefa: o Header, com `hideSearch`, não deve
// renderizar o campo de busca — é o que impede o alçapão de navegação para
// `product-detail` na tela de finalizar compra (o formulário do checkout só
// persiste o CEP; sair da tela apaga o resto).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { logoUrl: null }, isLoaded: true }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: 0 }),
}));

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-guest-cep.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchBar — placeholder de verdade, sem letreiro animado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("o texto de apoio fica no atributo placeholder do input, não num elemento animado à parte", async () => {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");

    await act(async () => {
      raiz.render(
        <SearchBar
          value=""
          onChange={() => {}}
          placeholder="Buscar produtos"
        />,
      );
    });

    const input = document.getElementById("global-search") as HTMLInputElement;
    expect(input.getAttribute("placeholder")).toBe("Buscar produtos");
    expect(hospedeiro.querySelector(".animate-marquee-x")).toBeNull();
  });
});

describe("Header — hideSearch esconde o campo de busca", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("com hideSearch, o input de busca não é renderizado", async () => {
    const { Header } = await import("@/components/ui/custom/Header");

    await act(async () => {
      raiz.render(<Header onNavigate={() => {}} hideSearch />);
    });

    expect(document.getElementById("global-search")).toBeNull();
  });

  it("sem hideSearch, o input de busca é renderizado", async () => {
    const { Header } = await import("@/components/ui/custom/Header");

    await act(async () => {
      raiz.render(<Header onNavigate={() => {}} />);
    });

    expect(document.getElementById("global-search")).not.toBeNull();
  });
});
