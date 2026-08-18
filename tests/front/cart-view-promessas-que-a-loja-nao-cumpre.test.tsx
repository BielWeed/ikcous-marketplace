// @vitest-environment jsdom
//
// O carrinho não pode prometer o que a loja não faz.
//
// Até 18/08/2026 o rodapé do resumo do carrinho trazia três selos de confiança,
// e dois deles descreviam recursos que NÃO EXISTEM em lugar nenhum do app:
//
//   - "Envio expresso e código de rastreio automático" — não há envio expresso,
//     e o código de rastreio é digitado à mão pela lojista no painel. Nada é
//     automático, e até a issue #105 o comprador sequer via o código.
//   - "Garantia de devolução fácil em até 7 dias" — não existe fluxo de
//     devolução: os status de devolução/estorno são a issue #108, ainda aberta,
//     e a política de troca (#46) é decisão que não foi tomada.
//
// Promessa não cumprida no carrinho não gera reclamação: gera cliente que paga,
// espera o que foi prometido, não recebe e some sem avisar. Este teste é a
// trava para o texto não voltar.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), E NÃO ler o arquivo
// fonte com grep: um teste que só varre string do arquivo continuaria verde se
// o bloco inteiro deixasse de renderizar por outro motivo. Aqui a ausência das
// duas frases é medida NA ÁRVORE RENDERIZADA, junto com a presença do que deve
// continuar aparecendo ("Finalizar Compra" e o selo de pagamento seguro) — é
// isso que impede o teste de passar por acidente.
//
// POR QUE OS SUBCOMPONENTES SÃO DUBLÊS: os selos moram no corpo do CartView,
// não nos filhos. Trocar CartItemsList/ShippingCalculator/etc. por marcadores
// mantém o teste medindo o que ele afirma medir, sem arrastar Supabase, Web
// Worker e cálculo de frete para dentro de uma prova sobre texto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const itemNoCarrinho: CartItem = {
  product: {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
  quantity: 1,
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0 },
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [itemNoCarrinho],
    shippingFee: 10,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    selectedShippingOption: null,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

// O bloco do resumo (onde ficam os selos) só monta depois de
// `useDeferredRender(380)` virar true. Sem este dublê o teste mediria uma tela
// que ainda não desenhou o trecho em julgamento — e passaria por acidente.
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso" />,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => <div data-testid="rodape" />,
}));
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: () => <div data-testid="pedidos" />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido" />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-view-flag-off.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartView — o carrinho não promete o que a loja não cumpre", () => {
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

  async function renderizarCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("a âncora: o resumo do carrinho renderizou de verdade", async () => {
    const texto = await renderizarCarrinho();

    // Sem esta prova, as duas asserções de ausência abaixo passariam mesmo com
    // a tela em branco.
    expect(texto).toContain("Finalizar Compra");
    expect(texto).toContain("Ambiente de pagamento 100% seguro");
  });

  it("não promete envio expresso nem rastreio automático", async () => {
    const texto = await renderizarCarrinho();

    expect(texto).not.toContain("Envio expresso");
    expect(texto).not.toContain("rastreio automático");
  });

  it("não promete garantia de devolução em 7 dias", async () => {
    const texto = await renderizarCarrinho();

    expect(texto).not.toContain("devolução fácil");
    expect(texto).not.toContain("7 dias");
  });
});
