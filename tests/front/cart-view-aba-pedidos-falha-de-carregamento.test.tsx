// @vitest-environment jsdom
//
// Falha de rede não é "Nenhum pedido" — a FIAÇÃO da aba Meus Pedidos.
//
// O hook agora expõe `ordersLoadError` (useorders-falha-de-carregamento-
// expoe-erro.test.tsx) e a lista sabe desenhar a falha (order-list-falha-de-
// carregamento-nao-e-lista-vazia.test.tsx). Este arquivo prova a LIGAÇÃO
// entre os dois dentro da CartView, com a OrderList de verdade: quem acabou
// de pagar um PIX num aparelho sem cache e sem rede vê "Não conseguimos
// carregar seus pedidos agora" + "Tentar de novo" — que refaz a leitura — e
// nunca "Nenhum pedido — Que tal começar a comprar?".
//
// Harness copiado de cart-aba-pedidos-viva.test.tsx (identidades estáveis,
// localStorage stubado, dublê de hook com useState de verdade).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const FALHA = "Não conseguimos carregar seus pedidos agora.";

const { duble } = vi.hoisted(() => ({
  duble: {
    pedidosDaVez: [] as any[],
    // O que a PRÓXIMA busca faz: falha (erro no hook) ou dá certo (limpa).
    proximaFalha: false,
    chamadasFetch: 0,
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useState } = await import("react");
  return {
    useOrders: () => {
      const [orders] = useState(duble.pedidosDaVez);
      const [ordersLoadError, setErro] = useState<string | null>(null);
      // Estável de propósito (lição da casa: função nova por render + efeito
      // dependente = laço infinito dentro do `act`).
      const [fetchUserOrders] = useState(() => () => {
        duble.chamadasFetch += 1;
        setErro(duble.proximaFalha ? FALHA : null);
        return Promise.resolve([] as any[]);
      });
      return { orders, ordersLoadError, fetchUserOrders };
    },
  };
});

const configDaLoja = { shippingFee: 10, freeShippingMin: 0 };
const usuarioLogado = { id: "cliente-1" };
const valorDoCarrinho = {
  cart: [],
  shippingFee: 10,
  updateQuantity: () => {},
  removeFromCart: () => {},
  selectedShippingOption: null as null,
  setSelectedShippingOption: () => {},
  setShippingCep: () => {},
};
const produtosDeFreteGratis = () => [];

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    getFreeShippingEligibleProducts: produtosDeFreteGratis,
  }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => valorDoCarrinho,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioLogado }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

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
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido" />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedidoPendente = {
  id: "ped-1",
  status: "pending",
  total: 100,
  paymentMethod: "pix",
  createdAt: new Date(0).toISOString(),
  customer: { name: "Joana" },
  items: [
    {
      productId: "p1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
} as unknown as Order;

describe("CartView — aba Meus Pedidos: falha de carregamento não é lista vazia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    const dubleDeArmazem = {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
      clear: () => {
        armazem.clear();
      },
    };
    vi.stubGlobal("localStorage", { ...dubleDeArmazem });
    vi.stubGlobal("sessionStorage", { ...dubleDeArmazem });

    duble.pedidosDaVez = [];
    duble.proximaFalha = false;
    duble.chamadasFetch = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montarAbaPedidos() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} initialTab="orders" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const texto = () => hospedeiro.textContent ?? "";
  const botaoTentar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    ) as HTMLButtonElement | undefined;

  it("busca de entrada falha, sem pedido em memória: erro + retry, nunca 'Nenhum pedido'", async () => {
    duble.proximaFalha = true;
    await montarAbaPedidos();

    expect(texto()).toContain("Não conseguimos carregar seus pedidos agora");
    expect(texto()).not.toContain("Nenhum pedido");
    expect(texto()).not.toContain("Que tal começar a comprar");
    expect(botaoTentar()).toBeDefined();
    expect(duble.chamadasFetch).toBe(1);
  });

  it("'Tentar de novo' refaz a leitura e, dando certo, o erro some", async () => {
    duble.proximaFalha = true;
    await montarAbaPedidos();
    expect(botaoTentar()).toBeDefined();

    duble.proximaFalha = false;
    await act(async () => {
      botaoTentar()!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(duble.chamadasFetch).toBe(2);
    expect(texto()).not.toContain("Não conseguimos carregar");
    expect(botaoTentar()).toBeUndefined();
    // Resposta ok com 0 pedidos = vazio de verdade.
    expect(texto()).toContain("Nenhum pedido");
  });

  it("foco: releitura que dá certo leva o foco ao painel da aba, não ao corpo da página", async () => {
    duble.proximaFalha = true;
    await montarAbaPedidos();
    const botao = botaoTentar()!;
    botao.focus();

    duble.proximaFalha = false;
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(botao.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.id).toBe("painel-orders");
  });

  it("foco: releitura que falha de novo mantém o MESMO botão montado e focado", async () => {
    duble.proximaFalha = true;
    await montarAbaPedidos();
    const botao = botaoTentar()!;
    botao.focus();

    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(duble.chamadasFetch).toBe(2);
    expect(botao.isConnected).toBe(true);
    expect(document.activeElement).toBe(botao);
    expect(botao.textContent).toContain("Tentar de novo");
  });

  it("lista vazia de verdade (busca ok, 0 pedidos): 'Nenhum pedido' segue lá", async () => {
    await montarAbaPedidos();

    expect(texto()).toContain("Nenhum pedido");
    expect(texto()).not.toContain("Não conseguimos carregar");
  });

  it("com pedidos em memória e a recarga falha: a lista fica e só há um aviso discreto", async () => {
    duble.pedidosDaVez = [pedidoPendente];
    duble.proximaFalha = true;
    await montarAbaPedidos();

    expect(texto()).toContain("Blusa Teste");
    expect(texto()).toContain("Em Andamento (1)");
    expect(texto()).toContain("Não foi possível atualizar");
    expect(texto()).not.toContain(
      "Não conseguimos carregar seus pedidos agora",
    );
    expect(texto()).not.toContain("Nenhum pedido");
  });

  it("aba 'Em andamento' vazia (só há pedido entregue) com falha: não vira tela de erro", async () => {
    // A lista da aba (`filteredOrders`) fica vazia, mas há pedido em memória:
    // quem decide é `hasAnyOrders`, não o tamanho da lista filtrada.
    duble.pedidosDaVez = [{ ...pedidoPendente, status: "delivered" } as Order];
    duble.proximaFalha = true;
    await montarAbaPedidos();

    expect(texto()).toContain("Sem pedidos ativos");
    expect(texto()).not.toContain(
      "Não conseguimos carregar seus pedidos agora",
    );
    expect(texto()).not.toContain("Nenhum pedido");
  });
});
