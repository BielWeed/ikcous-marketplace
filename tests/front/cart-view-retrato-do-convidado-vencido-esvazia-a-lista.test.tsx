// @vitest-environment jsdom
//
// Rodada 84 (lote E), rastreio sem conta: quem consultou o pedido por e-mail +
// código vê a lista na aba Pedidos. O retrato que a sustenta vale 60 min e some
// do aparelho, mas a lista guardada em MEMÓRIA na CartView (que fica montada o
// tempo todo) continuava na tela. Ao tocar em "Ver detalhes", a pessoa caía em
// "Entre na conta... seu pedido está salvo na sua conta" — falso: nunca teve
// conta. Agora a lista sai da tela junto com o retrato (e o aparelho para de
// guardar o dado pessoal em memória), com a orientação de consultar de novo.
//
// Dois caminhos fecham a janela: o relógio (a pessoa fica olhando a lista) e a
// volta à aba (o relógio dormiu com o app em segundo plano). Cada um tem seu
// teste; o do relógio fake só o Date quando o outro precisa do tempo real.
//
// Dublês: iguais aos de cart-view-pedido-achado-abre-na-aba-certa-e-avisa-do-retrato.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_DO_RETRATO_MS } from "@/lib/retrato-do-convidado";
import type { Order } from "@/types";

const { duble } = vi.hoisted(() => ({
  duble: {
    pedidosDoHook: [] as any[],
    achados: [] as any[],
    usuario: null as null | { id: string },
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useState } = await import("react");
  // Estável de propósito: o efeito de busca da CartView depende dele.
  const fetchUserOrders = () => Promise.resolve([...duble.pedidosDoHook]);
  return {
    useOrders: () => {
      const [orders] = useState(duble.pedidosDoHook);
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
  OrderSearch: (props: { onOrdersFound?: (pedidos: any[]) => void }) => (
    <div data-testid="busca-pedido">
      <button
        type="button"
        data-testid="achar"
        onClick={() => props.onOrdersFound?.(duble.achados)}
      >
        achar
      </button>
    </div>
  ),
}));
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

const enviando = {
  total: 100,
  createdAt: new Date(0).toISOString(),
  customer: { name: "Joana" },
  items: [],
  id: "ped-enviando",
  status: "shipping",
} as unknown as Order;

const RETRATO = "guest_tracked_orders";
const MIN = 60_000;

describe("CartView — retrato do rastreio sem conta vencido tira a lista da tela", () => {
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Os relógios são sempre fakes aqui (o Date, e nos testes do relógio também
  // o setTimeout): avança em passos pequenos para o React e a animação assentarem.
  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  async function assentar() {
    for (let i = 0; i < 4; i++) await passar(20);
  }

  const lista = () =>
    hospedeiro.querySelector('[data-testid="pedido-ped-enviando"]');
  const texto = () => hospedeiro.textContent ?? "";

  async function montar(isActive = true) {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(
        <CartView
          onNavigate={() => {}}
          initialTab="orders"
          isActive={isActive}
        />,
      );
    });
    await assentar();
  }

  async function remontarComIsActive(isActive: boolean) {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(
        <CartView
          onNavigate={() => {}}
          initialTab="orders"
          isActive={isActive}
        />,
      );
    });
    await assentar();
  }

  async function achar() {
    await act(async () => {
      (
        hospedeiro.querySelector('[data-testid="achar"]') as HTMLButtonElement
      ).click();
    });
    await assentar();
  }

  describe("o relógio: a pessoa fica olhando a lista até o retrato vencer", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    });

    it("passados 60 min a lista some e a tela manda consultar de novo", async () => {
      duble.achados = [enviando];
      await montar();
      await achar();
      expect(lista()).not.toBeNull();
      expect(texto()).toMatch(/Status de \d{2}:\d{2} — pode ter mudado/);

      await passar(PRAZO_DO_RETRATO_MS + 1_000);
      await assentar();

      expect(lista()).toBeNull();
      expect(texto()).not.toContain("pode ter mudado");
      expect(texto()).toContain("Consulte de novo");
      expect(
        hospedeiro.querySelector('[data-testid="busca-pedido"]'),
      ).not.toBeNull();
    });

    it("CONTROLE: antes do prazo a lista continua igual (59 min)", async () => {
      duble.achados = [enviando];
      await montar();
      await achar();

      await passar(59 * MIN);
      await assentar();

      expect(lista()).not.toBeNull();
      expect(texto()).toMatch(/Status de \d{2}:\d{2} — pode ter mudado/);
      expect(texto()).not.toContain("Consulte de novo");
    });

    it("LIMITE: consultar de novo depois do vencimento reabre a lista e o prazo recomeça", async () => {
      duble.achados = [enviando];
      await montar();
      await achar();
      await passar(PRAZO_DO_RETRATO_MS + 1_000);
      await assentar();
      expect(lista()).toBeNull();

      await achar();
      expect(lista()).not.toBeNull();
      expect(texto()).not.toContain("Consulte de novo");

      // O relógio da consulta VELHA não pode apagar a nova: 30 min depois dela
      // a lista segue, 61 min depois some.
      await passar(30 * MIN);
      await assentar();
      expect(lista()).not.toBeNull();
      await passar(31 * MIN);
      await assentar();
      expect(lista()).toBeNull();
    });

    it("CONTROLE: conta aberta não é tocada (a lista dela é viva e nunca vence)", async () => {
      duble.usuario = usuarioLogado;
      duble.pedidosDoHook = [enviando];
      await montar();
      expect(lista()).not.toBeNull();

      await passar(3 * 60 * MIN);
      await assentar();

      expect(lista()).not.toBeNull();
      expect(texto()).not.toContain("Consulte de novo");
    });
  });

  describe("a volta à aba: o relógio dormiu com o app em segundo plano", () => {
    beforeEach(() => {
      // Só o Date: o setTimeout real nunca dispara em 60 min, então quem tira a
      // lista aqui é a releitura ao voltar para a aba, não o relógio.
      vi.useFakeTimers({ toFake: ["Date"] });
    });

    it("ao voltar à aba depois de 60 min, a lista velha não fica na tela", async () => {
      duble.achados = [enviando];
      await montar();
      await achar();
      expect(lista()).not.toBeNull();

      await remontarComIsActive(false);
      vi.setSystemTime(Date.now() + PRAZO_DO_RETRATO_MS + 5_000);
      await remontarComIsActive(true);

      expect(lista()).toBeNull();
      expect(texto()).toContain("Consulte de novo");
    });

    it("voltar ao app (sem trocar de aba) depois de 60 min também solta a lista", async () => {
      duble.achados = [enviando];
      await montar();
      await achar();
      expect(lista()).not.toBeNull();

      vi.setSystemTime(Date.now() + PRAZO_DO_RETRATO_MS + 5_000);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await assentar();

      expect(lista()).toBeNull();
      expect(texto()).toContain("Consulte de novo");
    });

    it("CONTROLE: voltar ao app antes do prazo mantém a lista", async () => {
      duble.achados = [enviando];
      await montar();
      await achar();

      vi.setSystemTime(Date.now() + 10 * MIN);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await assentar();

      expect(lista()).not.toBeNull();
    });

    it("CONTROLE: voltar à aba antes do prazo mantém a lista", async () => {
      duble.achados = [enviando];
      await montar();
      await achar();

      await remontarComIsActive(false);
      vi.setSystemTime(Date.now() + 10 * MIN);
      await remontarComIsActive(true);

      expect(lista()).not.toBeNull();
      expect(texto()).not.toContain("Consulte de novo");
    });

    it("CONTROLE: retrato guardado e ainda válido continua abrindo a lista", async () => {
      armazemDaSessao.set(
        RETRATO,
        JSON.stringify({
          consultadoEm: Date.now() - 5 * MIN,
          pedidos: [enviando],
        }),
      );
      await montar();

      expect(lista()).not.toBeNull();
      expect(texto()).toMatch(/Status de \d{2}:\d{2} — pode ter mudado/);
    });

    it("retrato guardado já vencido: a lista nem abre e o dado sai do aparelho", async () => {
      armazemDaSessao.set(
        RETRATO,
        JSON.stringify({
          consultadoEm: Date.now() - PRAZO_DO_RETRATO_MS - 1_000,
          pedidos: [enviando],
        }),
      );
      await montar();

      expect(lista()).toBeNull();
      expect(armazemDaSessao.has(RETRATO)).toBe(false);
    });
  });
});
