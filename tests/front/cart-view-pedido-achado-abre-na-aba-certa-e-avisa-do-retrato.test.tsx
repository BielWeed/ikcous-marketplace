// @vitest-environment jsdom
//
// Rodada 21 (lote C2), achados A e B da aba "Meus Pedidos".
//
// A: a pessoa rastreava o pedido pelo código, via "1 pedido encontrado!" e a
// lista dizia "Nenhum pedido em andamento" — o pedido (entregue ou cancelado)
// só aparecia em "Histórico (1)", uma aba que ela não tinha motivo para abrir.
// Agora a aba muda sozinha para onde o pedido está. Vale também para a conta
// que só tem pedido antigo (uma vez, e só se ela ainda não tocou numa aba).
//
// B: quem rastreia sem conta vê o status de QUANDO consultou, e ele nunca
// atualiza. A lista passa a dizer de que hora é o retrato e oferece "Consultar
// de novo". O retrato guardado no formato ANTIGO (só a lista) continua legível.
//
// Dublês: OrderSearch (botão que dispara `onOrdersFound` e expõe se foi
// remontado para o rastreio) e OrderList (expõe o que chegou). O teste julga a
// fiação da CartView, não o desenho dos cartões.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { duble } = vi.hoisted(() => ({
  duble: {
    pedidosDoHook: [] as any[],
    achados: [] as any[],
    montagensDaBusca: 0,
    publicarPedidos: null as null | ((novos: any[]) => void),
    usuario: null as null | { id: string },
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useEffect, useState } = await import("react");
  // Estável de propósito: o efeito de busca da CartView depende dele.
  const fetchUserOrders = () => Promise.resolve([...duble.pedidosDoHook]);
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
vi.mock("@/components/ui/custom/OrderSearch", async () => {
  const { useEffect } = await import("react");
  return {
    OrderSearch: (props: {
      onOrdersFound?: (pedidos: any[]) => void;
      abrirNoRastreio?: boolean;
    }) => {
      useEffect(() => {
        duble.montagensDaBusca += 1;
      }, []);
      return (
        <div
          data-testid="busca-pedido"
          data-abre-no-rastreio={String(Boolean(props.abrirNoRastreio))}
        >
          <button
            type="button"
            data-testid="achar"
            onClick={() => props.onOrdersFound?.(duble.achados)}
          >
            achar
          </button>
        </div>
      );
    },
  };
});
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: ({ orders }: { orders: any[] }) => (
    <ul data-testid="lista-pedidos">
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

const base = {
  total: 100,
  createdAt: new Date(0).toISOString(),
  customer: { name: "Joana" },
  items: [],
};
const entregue = {
  ...base,
  id: "ped-entregue",
  status: "delivered",
} as unknown as Order;
const cancelado = {
  ...base,
  id: "ped-cancelado",
  status: "cancelled",
} as unknown as Order;
const enviando = {
  ...base,
  id: "ped-enviando",
  status: "shipping",
} as unknown as Order;

const RETRATO = "guest_tracked_orders";

describe("CartView — aba Meus Pedidos: pedido achado abre na aba certa e avisa do retrato", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazemDaSessao: Map<string, string>;

  beforeEach(() => {
    armazemDaSessao = new Map<string, string>();
    const local = new Map<string, string>();
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
    vi.stubGlobal("localStorage", dubleDe(local));
    vi.stubGlobal("sessionStorage", dubleDe(armazemDaSessao));

    duble.pedidosDoHook = [];
    duble.achados = [];
    duble.montagensDaBusca = 0;
    duble.publicarPedidos = null;
    duble.usuario = null;
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

  // A troca de sub-aba passa por AnimatePresence (a saída da lista antiga é
  // animada, em tempo real no jsdom): espera o pedido aparecer em vez de supor.
  async function esperarPedido(id: string) {
    for (let i = 0; i < 60; i++) {
      if (hospedeiro.querySelector(`[data-testid="pedido-${id}"]`)) return;
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
  const texto = () => hospedeiro.textContent ?? "";

  async function achar() {
    await act(async () => {
      (
        hospedeiro.querySelector('[data-testid="achar"]') as HTMLButtonElement
      ).click();
    });
    await esperar();
  }

  describe("A: o pedido achado aparece na aba onde ele está", () => {
    it("rastreio acha só pedido ENTREGUE: abre no Histórico, com o pedido na lista", async () => {
      duble.achados = [entregue];
      await montar();
      await achar();

      expect(botaoDaAba("Histórico")?.getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(botaoDaAba("Em andamento")?.getAttribute("aria-pressed")).toBe(
        "false",
      );
      await esperarPedido("ped-entregue");
      expect(
        hospedeiro.querySelector('[data-testid="pedido-ped-entregue"]'),
      ).not.toBeNull();
    });

    it("rastreio acha só pedido CANCELADO: abre no Histórico", async () => {
      duble.achados = [cancelado];
      await montar();
      await achar();

      expect(botaoDaAba("Histórico")?.getAttribute("aria-pressed")).toBe(
        "true",
      );
      await esperarPedido("ped-cancelado");
      expect(
        hospedeiro.querySelector('[data-testid="pedido-ped-cancelado"]'),
      ).not.toBeNull();
    });

    it("rastreio acha pedido EM ANDAMENTO (mesmo com um antigo junto): fica em Em andamento", async () => {
      duble.achados = [entregue, enviando];
      await montar();
      await achar();

      expect(botaoDaAba("Em andamento")?.getAttribute("aria-pressed")).toBe(
        "true",
      );
      await esperarPedido("ped-enviando");
      expect(
        hospedeiro.querySelector('[data-testid="pedido-ped-enviando"]'),
      ).not.toBeNull();
    });

    it("conta que só tem pedido antigo abre no Histórico quando a primeira busca termina", async () => {
      duble.usuario = usuarioLogado;
      duble.pedidosDoHook = [entregue, cancelado];
      await montar();

      expect(botaoDaAba("Histórico")?.getAttribute("aria-pressed")).toBe(
        "true",
      );
      await esperarPedido("ped-entregue");
      expect(
        hospedeiro.querySelector('[data-testid="pedido-ped-entregue"]'),
      ).not.toBeNull();
    });

    it("conta com pedido em andamento continua abrindo em Em andamento", async () => {
      duble.usuario = usuarioLogado;
      duble.pedidosDoHook = [entregue, enviando];
      await montar();

      expect(botaoDaAba("Em andamento")?.getAttribute("aria-pressed")).toBe(
        "true",
      );
    });

    it("LIMITE: quem tocou numa aba não é puxada de volta quando a lista muda", async () => {
      duble.usuario = usuarioLogado;
      duble.pedidosDoHook = [entregue];
      await montar();
      expect(botaoDaAba("Histórico")?.getAttribute("aria-pressed")).toBe(
        "true",
      );

      await act(async () => {
        botaoDaAba("Em andamento")?.click();
      });
      await esperar();
      expect(botaoDaAba("Em andamento")?.getAttribute("aria-pressed")).toBe(
        "true",
      );

      // A lista do hook muda (tempo real): continua só com pedido antigo.
      await act(async () => {
        duble.publicarPedidos?.([entregue, cancelado]);
      });
      await esperar();
      expect(botaoDaAba("Em andamento")?.getAttribute("aria-pressed")).toBe(
        "true",
      );
    });

    it("retrato guardado de pedido entregue também reabre no Histórico", async () => {
      armazemDaSessao.set(RETRATO, JSON.stringify([entregue]));
      await montar();

      expect(botaoDaAba("Histórico")?.getAttribute("aria-pressed")).toBe(
        "true",
      );
      await esperarPedido("ped-entregue");
      expect(
        hospedeiro.querySelector('[data-testid="pedido-ped-entregue"]'),
      ).not.toBeNull();
    });
  });

  describe("B: o status do rastreio sem conta diz de quando é", () => {
    it("depois de achar pelo código, a lista diz 'Status de HH:MM — pode ter mudado'", async () => {
      duble.achados = [enviando];
      await montar();
      expect(texto()).not.toContain("pode ter mudado");
      await achar();

      expect(texto()).toMatch(/Status de \d{2}:\d{2} — pode ter mudado/);
      expect(botaoDaAba("Consultar de novo")).toBeDefined();
    });

    it("retrato no formato ANTIGO (só a lista) continua legível, sem horário inventado", async () => {
      armazemDaSessao.set(RETRATO, JSON.stringify([enviando]));
      await montar();

      await esperarPedido("ped-enviando");
      expect(
        hospedeiro.querySelector('[data-testid="pedido-ped-enviando"]'),
      ).not.toBeNull();
      expect(texto()).toContain(
        "Status de quando você consultou — pode ter mudado",
      );
      expect(texto()).not.toMatch(/Status de \d{2}:\d{2}/);
    });

    it("retrato no formato NOVO (com o horário) é lido e mostra a hora gravada", async () => {
      armazemDaSessao.set(
        RETRATO,
        JSON.stringify({ consultadoEm: Date.now(), pedidos: [enviando] }),
      );
      await montar();

      await esperarPedido("ped-enviando");
      expect(
        hospedeiro.querySelector('[data-testid="pedido-ped-enviando"]'),
      ).not.toBeNull();
      expect(texto()).toMatch(/Status de \d{2}:\d{2} — pode ter mudado/);
    });

    it("conta aberta não vê o aviso (a lista dela é viva)", async () => {
      duble.usuario = usuarioLogado;
      duble.pedidosDoHook = [enviando];
      await montar();

      expect(texto()).not.toContain("pode ter mudado");
      expect(botaoDaAba("Consultar de novo")).toBeUndefined();
    });

    it("'Consultar de novo' apaga o retrato, esvazia a lista e reabre o rastreio do zero", async () => {
      armazemDaSessao.set(RETRATO, JSON.stringify([enviando]));
      await montar();
      const montagensAntes = duble.montagensDaBusca;
      expect(
        hospedeiro
          .querySelector('[data-testid="busca-pedido"]')
          ?.getAttribute("data-abre-no-rastreio"),
      ).toBe("false");

      await act(async () => {
        botaoDaAba("Consultar de novo")?.click();
      });
      await esperar();

      expect(armazemDaSessao.has(RETRATO)).toBe(false);
      expect(
        hospedeiro.querySelector('[data-testid="pedido-ped-enviando"]'),
      ).toBeNull();
      expect(texto()).not.toContain("pode ter mudado");
      // A busca foi remontada (passos e campos do zero) já na aba "Rastrear sem Conta".
      expect(duble.montagensDaBusca).toBe(montagensAntes + 1);
      expect(
        hospedeiro
          .querySelector('[data-testid="busca-pedido"]')
          ?.getAttribute("data-abre-no-rastreio"),
      ).toBe("true");
    });
  });
});
