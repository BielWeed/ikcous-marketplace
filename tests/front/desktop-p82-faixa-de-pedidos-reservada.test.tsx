// @vitest-environment jsdom
//
// P82 (B): a reserva só acompanha o esqueleto, nunca o erro prioritário.
// As transições usam a mesma montagem de CartView e respostas controladas.
// O jsdom prova a estrutura e as classes mobile, não posições ou CLS.
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

interface RespostaDaConsulta {
  pedidos: import("@/types").Order[];
  erro: string | null;
}

const { duble } = vi.hoisted(() => ({
  duble: {
    usuario: null as null | { id: string },
    pedidosDaVez: [] as import("@/types").Order[],
    consultas: [] as ((resposta: RespostaDaConsulta) => void)[],
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useState } = await import("react");
  return {
    useOrders: () => {
      const [orders, setOrders] = useState(duble.pedidosDaVez);
      const [ordersLoadError, setOrdersLoadError] = useState<string | null>(
        null,
      );
      const [loading, setLoading] = useState(false);
      const [fetchUserOrders] = useState(() => () => {
        setLoading(true);
        return new Promise<import("@/types").Order[]>((resolve) => {
          duble.consultas.push((resposta) => {
            // Como o hook real: falha preserva pedidos e erro só sai no sucesso.
            if (!resposta.erro) setOrders(resposta.pedidos);
            setOrdersLoadError(resposta.erro);
            setLoading(false);
            resolve(resposta.erro ? [] : resposta.pedidos);
          });
        });
      });
      return { orders, ordersLoadError, loading, fetchUserOrders };
    },
  };
});
// A saída animada da aba anterior não é objeto desta prova de estrutura.
// Sem esperar frames de animação no jsdom, a troca de chave segue o React.
vi.mock("framer-motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("framer-motion")>();
  return {
    ...real,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 10, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    shippingFee: 10,
    freteIndefinido: false,
    freteGratis: false,
    updateQuantity: () => {},
    removeFromCart: () => {},
    selectedShippingOption: null as null,
    setSelectedShippingOption: () => {},
    setShippingCep: () => {},
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: duble.usuario }),
}));
vi.mock("@/hooks/useAddresses", () => {
  const resultado = {
    addresses: [],
    fetchAddresses: vi.fn(async () => []),
    loading: false,
    erroAoCarregar: false,
  };
  return { useAddresses: () => resultado };
});
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
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
  OrderSearch: () => <div data-testid="busca-pedido">Rastrear Pedido</div>,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("P82 B — a faixa de abas de Meus pedidos tem o lugar reservado enquanto a lista carrega", () => {
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
    duble.usuario = { id: "cliente-1" };
    duble.pedidosDaVez = [];
    duble.consultas = [];
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

  async function montar() {
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

  const reserva = () =>
    hospedeiro.querySelector<HTMLElement>(
      '#painel-orders > [aria-hidden="true"]',
    );

  const involucro = () =>
    hospedeiro.querySelector<HTMLElement>("#painel-orders > .overflow-hidden");
  const esqueletos = () =>
    hospedeiro.querySelectorAll('[data-testid="order-card-skeleton"]');
  const pedido = (status: "pending" | "delivered") =>
    ({
      id: "11111111-2222-3333-4444-555555555555",
      customer: { name: "Cliente Teste", whatsapp: "34999999999" },
      items: [
        { productId: "p", name: "Blusa", price: 100, quantity: 1, image: "" },
      ],
      subtotal: 100,
      shipping: 0,
      discount: 0,
      total: 100,
      paymentMethod: "pix",
      status,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      cancelledAfterShipping: false,
    }) as import("@/types").Order;

  async function responder(resposta: RespostaDaConsulta) {
    expect(duble.consultas).toHaveLength(1);
    const resolver = duble.consultas.shift()!;
    await act(async () => {
      resolver(resposta);
      await Promise.resolve();
    });
  }

  it("carregando sem pedidos: reserva irmã antes do invólucro, sem altura no celular", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain("Carregando pedidos");
    const espaco = reserva();
    expect(espaco).not.toBeNull();
    expect(espaco!.children).toHaveLength(0);
    expect(espaco!.textContent).toBe("");
    expect(classesDoCelular(espaco!.className)).toBe("");
    expect(espaco!.className.split(/\s+/).sort()).toEqual([
      "lg:h-11",
      "lg:mb-4",
    ]);
    expect(espaco!.nextElementSibling).toBe(involucro());
    expect(involucro()!.contains(espaco)).toBe(false);
    expect(esqueletos()).toHaveLength(2);
    await responder({ pedidos: [], erro: null });
  });

  it.each([
    ["pending", "Em andamento (1)", "Histórico (0)"],
    ["delivered", "Histórico (1)", "Em andamento (0)"],
  ] as const)(
    "resposta %s troca reserva por abas antes do mesmo invólucro",
    async (status, abaAtiva, outraAba) => {
      await montar();
      const listaAntes = involucro();
      expect(reserva()!.nextElementSibling).toBe(listaAntes);
      await responder({ pedidos: [pedido(status)], erro: null });
      expect(reserva()).toBeNull();
      expect(involucro()).toBe(listaAntes);
      const faixa = listaAntes!.previousElementSibling!;
      const botoes = [...faixa.querySelectorAll("button")];
      expect(botoes).toHaveLength(2);
      expect(
        botoes
          .find((b) => b.textContent === abaAtiva)
          ?.getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        botoes
          .find((b) => b.textContent === outraAba)
          ?.getAttribute("aria-pressed"),
      ).toBe("false");
      expect(esqueletos()).toHaveLength(0);
      expect(hospedeiro.textContent).not.toContain(
        "Nenhum pedido em andamento",
      );
    },
  );

  it("resposta vazia remove reserva e esqueleto sem criar abas na mesma montagem", async () => {
    await montar();
    const listaAntes = involucro();
    expect(reserva()).not.toBeNull();
    await responder({ pedidos: [], erro: null });
    expect(involucro()).toBe(listaAntes);
    expect(reserva()).toBeNull();
    expect(esqueletos()).toHaveLength(0);
    expect(hospedeiro.textContent).toContain("Nenhum pedido");
    expect(hospedeiro.textContent).not.toContain("Em andamento (");
    expect(hospedeiro.textContent).not.toContain("Histórico (");
  });

  it("pedidos em memória mantêm abas e lista sem reserva durante releitura", async () => {
    duble.pedidosDaVez = [pedido("pending")];
    await montar();
    const listaAntes = involucro();
    expect(reserva()).toBeNull();
    expect(esqueletos()).toHaveLength(0);
    expect(hospedeiro.textContent).toContain("Em andamento (1)");
    await responder({ pedidos: [], erro: "Falha inventada" });
    expect(involucro()).toBe(listaAntes);
    expect(reserva()).toBeNull();
    expect(hospedeiro.textContent).toContain("Mostrando o que já tínhamos.");
    expect(hospedeiro.textContent).toContain("Em andamento (1)");
  });

  it.each([false, true])(
    "retry com erro ativo não insere reserva nem esqueleto (sucesso depois: %s)",
    async (sucesso) => {
      await montar();
      const listaAntes = involucro();
      await responder({ pedidos: [], erro: "Falha inventada" });
      const aviso = hospedeiro.querySelector('[role="alert"]');
      const botao = aviso!.querySelector("button")!;
      expect(botao.textContent).toBe("Tentar de novo");
      expect(reserva()).toBeNull();
      await act(async () => {
        botao.focus();
        botao.click();
      });
      expect(hospedeiro.querySelector('[role="alert"]')).toBe(aviso);
      expect(aviso!.querySelector("button")).toBe(botao);
      expect(botao.textContent).toBe("Carregando…");
      expect(botao.getAttribute("aria-disabled")).toBe("true");
      expect(involucro()).toBe(listaAntes);
      expect(esqueletos()).toHaveLength(0);
      expect(reserva()).toBeNull();
      await responder({
        pedidos: [],
        erro: sucesso ? null : "Falha inventada",
      });
      expect(reserva()).toBeNull();
      expect(esqueletos()).toHaveLength(0);
      if (sucesso) {
        expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
        expect(hospedeiro.textContent).toContain("Nenhum pedido");
      } else {
        expect(hospedeiro.querySelector('[role="alert"]')).toBe(aviso);
        expect(botao.textContent).toBe("Tentar de novo");
      }
    },
  );
});
