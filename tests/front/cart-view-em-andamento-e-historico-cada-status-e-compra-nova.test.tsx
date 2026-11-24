// @vitest-environment jsdom
//
// "Meus Pedidos": quais status são "Em andamento" e quais são "Histórico", o
// que cada aba lista, e a reabertura de "Em andamento" quando chega compra
// nova. Caça por mutação: tirar "processing" de "em andamento", deixar o
// Histórico listar também os pedidos em andamento, ou fazer a primeira carga
// passar por "compra nova" não derrubava nenhum teste. Os dublês são os de
// `cart-view-pedido-achado-abre-na-aba-certa-e-avisa-do-retrato.test.tsx`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { duble } = vi.hoisted(() => ({
  duble: {
    pedidosDoHook: [] as any[],
    publicarPedidos: null as null | ((novos: any[]) => void),
    usuario: null as null | { id: string },
    segurarBusca: false,
    soltarBusca: null as null | (() => void),
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useEffect, useState } = await import("react");
  // Estável de propósito: o efeito de busca da CartView depende dele.
  const fetchUserOrders = () =>
    duble.segurarBusca
      ? new Promise<any[]>((resolver) => {
          duble.soltarBusca = () => resolver([...duble.pedidosDoHook]);
        })
      : Promise.resolve([...duble.pedidosDoHook]);
  return {
    useOrders: () => {
      const [orders, setOrders] = useState(duble.pedidosDoHook);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- publicar o setter a cada render é o propósito: o teste precisa da instância viva para simular o realtime.
      useEffect(() => {
        duble.publicarPedidos = setOrders;
      });
      return { orders, fetchUserOrders };
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
vi.mock("@/hooks/useCart", () => ({ useCart: () => valorDoCarrinho }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: duble.usuario }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div />,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => <div />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido" />,
}));
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: ({
    orders,
    isLoadingOrders,
  }: { orders: any[]; isLoadingOrders?: boolean }) => (
    <ul
      data-testid="lista-pedidos"
      data-carregando={String(Boolean(isLoadingOrders))}
    >
      {orders.map((o: any) => (
        <li key={o.id} data-testid={`pedido-${o.id}`}>
          {o.status}
        </li>
      ))}
    </ul>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido = (id: string, status: string) =>
  ({
    total: 100,
    createdAt: new Date(0).toISOString(),
    customer: { name: "Joana" },
    items: [],
    id,
    status,
  }) as unknown as Order;

describe("CartView — Meus Pedidos: em andamento x histórico", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const dubleDe = (m: Map<string, string>) => ({
      getItem: (c: string) => m.get(c) ?? null,
      setItem: (c: string, v: string) => {
        m.set(c, String(v));
      },
      removeItem: (c: string) => {
        m.delete(c);
      },
      clear: () => {
        m.clear();
      },
    });
    vi.stubGlobal("localStorage", dubleDe(new Map()));
    vi.stubGlobal("sessionStorage", dubleDe(new Map()));
    duble.pedidosDoHook = [];
    duble.publicarPedidos = null;
    duble.segurarBusca = false;
    duble.soltarBusca = null;
    duble.usuario = usuarioLogado;
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

  async function esperar() {
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }
  // A troca de sub-aba passa por AnimatePresence: espera a lista estabilizar.
  async function esperarAnimacao() {
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }
  }
  async function montar() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} initialTab="orders" />);
    });
    await esperar();
  }
  const botaoDaAba = (inicio: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.trim().startsWith(inicio),
    ) as HTMLButtonElement | undefined;
  const abaAberta = () =>
    botaoDaAba("Em andamento")?.getAttribute("aria-pressed") === "true"
      ? "Em andamento"
      : "Histórico";
  const idsNaLista = () =>
    Array.from(hospedeiro.querySelectorAll('[data-testid^="pedido-"]')).map(
      (li) => li.getAttribute("data-testid")?.replace("pedido-", ""),
    );
  async function tocar(aba: string) {
    await act(async () => {
      botaoDaAba(aba)?.click();
    });
    await esperarAnimacao();
  }

  describe("qual status é de qual aba", () => {
    it.each([
      ["new", 1, 0],
      ["pending", 1, 0],
      ["processing", 1, 0],
      ["shipping", 1, 0],
      ["delivered", 0, 1],
      ["cancelled", 0, 1],
    ])(
      "%s: Em andamento (%i), Histórico (%i)",
      async (status, andamento, historico) => {
        duble.pedidosDoHook = [pedido("p1", status)];
        await montar();
        expect(botaoDaAba("Em andamento")?.textContent).toContain(
          `(${andamento})`,
        );
        expect(botaoDaAba("Histórico")?.textContent).toContain(
          `(${historico})`,
        );
        expect(abaAberta()).toBe(andamento ? "Em andamento" : "Histórico");
      },
    );

    it("a conta com vários status conta cada um na sua aba", async () => {
      duble.pedidosDoHook = [
        pedido("a", "processing"),
        pedido("b", "shipping"),
        pedido("c", "delivered"),
        pedido("d", "cancelled"),
        pedido("e", "delivered"),
      ];
      await montar();
      expect(botaoDaAba("Em andamento")?.textContent).toContain("(2)");
      expect(botaoDaAba("Histórico")?.textContent).toContain("(3)");
    });
  });

  describe("a conta só decide a aba depois da primeira resposta do servidor", () => {
    it("com a busca ainda pendente (só o cache do aparelho), não troca de aba; ao chegar, abre onde os pedidos estão", async () => {
      duble.pedidosDoHook = [pedido("antigo", "delivered")];
      duble.segurarBusca = true;
      await montar();
      // Antes da resposta a lista pode ser só o cache velho: a aba não é decidida.
      expect(abaAberta()).toBe("Em andamento");

      await act(async () => {
        duble.soltarBusca?.();
      });
      await esperar();
      expect(abaAberta()).toBe("Histórico");
    });

    it("conta sem nenhum pedido: 'carregando' só até a primeira resposta; depois a lista vazia de verdade", async () => {
      duble.pedidosDoHook = [];
      duble.segurarBusca = true;
      await montar();
      const lista = () =>
        hospedeiro.querySelector('[data-testid="lista-pedidos"]');
      expect(lista()?.getAttribute("data-carregando")).toBe("true");

      await act(async () => {
        duble.soltarBusca?.();
      });
      await esperar();
      expect(lista()?.getAttribute("data-carregando")).toBe("false");
    });
  });

  describe("o que cada aba lista", () => {
    const misto = () => [
      pedido("andando", "shipping"),
      pedido("separando", "processing"),
      pedido("entregue", "delivered"),
      pedido("cancelado", "cancelled"),
    ];

    it("Em andamento lista só os em andamento", async () => {
      duble.pedidosDoHook = misto();
      await montar();
      await esperarAnimacao();
      expect(abaAberta()).toBe("Em andamento");
      expect(idsNaLista().sort()).toEqual(["andando", "separando"]);
    });

    it("Histórico lista só os entregues e cancelados, nunca os em andamento", async () => {
      duble.pedidosDoHook = misto();
      await montar();
      await tocar("Histórico");
      expect(abaAberta()).toBe("Histórico");
      expect(idsNaLista().sort()).toEqual(["cancelado", "entregue"]);
    });
  });

  describe("compra nova com a aba Histórico aberta", () => {
    it("a conta só tem pedido antigo; chega um pedido EM ANDAMENTO novo: volta para Em andamento", async () => {
      duble.pedidosDoHook = [pedido("antigo", "delivered")];
      await montar();
      expect(abaAberta()).toBe("Histórico");

      await act(async () => {
        duble.publicarPedidos?.([
          pedido("antigo", "delivered"),
          pedido("novo", "pending"),
        ]);
      });
      await esperarAnimacao();
      expect(abaAberta()).toBe("Em andamento");
      expect(idsNaLista()).toEqual(["novo"]);
    });

    it("chega um pedido novo que JÁ nasce entregue/cancelado: continua no Histórico", async () => {
      duble.pedidosDoHook = [pedido("antigo", "delivered")];
      await montar();
      await act(async () => {
        duble.publicarPedidos?.([
          pedido("antigo", "delivered"),
          pedido("outro-antigo", "cancelled"),
        ]);
      });
      await esperarAnimacao();
      expect(abaAberta()).toBe("Histórico");
    });

    it("pedido conhecido que muda para em andamento NÃO conta como compra nova", async () => {
      duble.pedidosDoHook = [pedido("p1", "delivered")];
      await montar();
      await act(async () => {
        duble.publicarPedidos?.([pedido("p1", "shipping")]);
      });
      await esperarAnimacao();
      // O id já tinha sido visto: a decisão automática não é reaberta.
      expect(abaAberta()).toBe("Histórico");
    });

    it("quem tocou em Histórico de propósito e está lendo a lista não é arrancada da aba", async () => {
      duble.pedidosDoHook = [
        pedido("andando", "shipping"),
        pedido("antigo", "delivered"),
      ];
      await montar();
      await tocar("Histórico");
      expect(abaAberta()).toBe("Histórico");

      await act(async () => {
        duble.publicarPedidos?.([
          pedido("andando", "shipping"),
          pedido("antigo", "delivered"),
          pedido("novo", "pending"),
        ]);
      });
      await esperarAnimacao();
      expect(abaAberta()).toBe("Histórico");
    });

    const clicarNaAba = async (id: "tab-cart" | "tab-orders") => {
      await act(async () => {
        hospedeiro.querySelector<HTMLButtonElement>(`#${id}`)?.click();
      });
      await esperarAnimacao();
    };
    const doisPedidos = [
      pedido("andando", "shipping"),
      pedido("antigo", "delivered"),
    ];
    const comPedidoNovo = [...doisPedidos, pedido("novo", "pending")];

    it("quem escolheu Histórico, saiu para o Carrinho e a compra nova chegou lá: ao voltar, vê Em andamento", async () => {
      duble.pedidosDoHook = doisPedidos;
      await montar();
      await tocar("Histórico");
      await clicarNaAba("tab-cart");

      // Fora da lista de pedidos a escolha não protege a aba: a compra nova a reabre.
      await act(async () => {
        duble.publicarPedidos?.(comPedidoNovo);
      });
      await esperar();
      await clicarNaAba("tab-orders");
      expect(abaAberta()).toBe("Em andamento");
    });

    it("a escolha vale só para a visita: sair e voltar à lista de pedidos a zera", async () => {
      duble.pedidosDoHook = doisPedidos;
      await montar();
      await tocar("Histórico");
      await clicarNaAba("tab-cart");
      await clicarNaAba("tab-orders");
      expect(abaAberta()).toBe("Histórico");

      // Voltou à lista, mas não tocou em aba NESTA visita: compra nova reabre.
      await act(async () => {
        duble.publicarPedidos?.(comPedidoNovo);
      });
      await esperarAnimacao();
      expect(abaAberta()).toBe("Em andamento");
    });
  });
});
