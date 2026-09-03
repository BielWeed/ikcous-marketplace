// @vitest-environment jsdom
//
// Defeito: o selo "Economizou R$ X" do resumo do pedido (coluna direita,
// desktop) usava `text-emerald-600`, que mede 3,58-3,77:1 contra o mínimo AA
// (4,5:1) de texto normal. `text-emerald-700` mede 5,21:1 e passa.
//
// POR QUE RENDER DE VERDADE: a classe de cor vive no elemento renderizado.
//
// FRETE V2 (onda D-1, 03/09): o caminho para `shipping === 0` mudou — a
// cópia antiga da regra (`hasFreeShippingItem`, item marcado incondicional)
// morreu e o grátis do carrinho agora é o veredito ÚNICO do CartContext
// (`freteGratis`, presets de presets-de-frete-gratis.ts). O dublê do
// `useCart` entrega o veredito GRÁTIS diretamente, que é o cenário honesto
// mais curto para o selo aparecer sem sessão nem limiar de valor.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 15, freeShippingMin: 0 },
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    getFreeShippingEligibleProducts: () => [],
  }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    shippingFee: 0,
    // FRETE V2 (onda D-1): o selo aparece quando o VEREDITO do CartContext
    // é grátis (`freteGratis`) — a leitura antiga de `product.freeShipping`
    // na CartView morreu com o modelo de presets.
    freteGratis: true,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: null,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn() }),
}));

// Convidado (user=null): evita montar `ShippingProgress` (fora do escopo
// desta tarefa, editado em paralelo por outra frente) -- o selo "Economizou"
// não depende de sessão.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

// ShippingCalculator (importado por CartView, mesmo não renderizando com
// `hasFreeShippingItem=true`) importa `@/lib/supabase` no topo do módulo --
// o import estático roda ao carregar o arquivo, não só quando o componente
// monta. Sem este dublê, `createClient` tentaria abrir um client de verdade
// (Web Worker, indisponível no jsdom).
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const itemComFreteGratis: CartItem = {
  product: {
    id: "prod-frete-gratis",
    name: "Produto Frete Grátis",
    description: "",
    price: 100,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: true,
    createdAt: new Date().toISOString(),
  },
  quantity: 1,
};

describe("CartView — selo 'Economizou R$ X' usa text-emerald-700 (contraste AA), não mais text-emerald-600", () => {
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
  });

  it("item com freeShipping: o selo 'Economizou' troca de tom", async () => {
    const { CartView } = await import("@/views/customer/CartView");

    await act(async () => {
      raiz.render(
        <CartView cart={[itemComFreteGratis]} onNavigate={() => {}} />,
      );
    });

    // A armadilha precisa estar de fato presente: sem o selo renderizado de
    // verdade, o par abaixo não prova nada sobre este defeito.
    expect(hospedeiro.textContent).toContain("Economizou");

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const selo = spans.find((el) => el.textContent?.startsWith("Economizou"));
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("text-emerald-600")).toBe(false);
  });
});
