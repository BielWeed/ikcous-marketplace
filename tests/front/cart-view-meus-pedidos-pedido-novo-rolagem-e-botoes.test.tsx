// @vitest-environment jsdom
//
// Rodada 56 (lote a), três achados da aba "Meus Pedidos" (CartView).
//
// 1) A cliente só tinha pedido entregue: a aba abriu sozinha em "Histórico". Ela
//    compra de novo, toca em "Ver meus pedidos" e cai no Histórico, só com
//    pedidos antigos — o pedido recém-pago está escondido atrás do botão "Em
//    andamento (1)". A escolha automática valia uma vez só e nunca era refeita.
//    Agora um pedido em andamento que a tela nunca tinha visto reabre a aba
//    "Em andamento" — exceto para quem tocou numa aba NESTA visita e está
//    olhando a lista agora (a escolha dela vale até ela sair da tela).
// 2) Voltar do detalhe do pedido jogava a lista de volta ao topo: ao abrir o
//    detalhe a tela do carrinho trocava de aba por baixo e, na volta, o efeito
//    de "rolar ao topo" apagava a posição que o App tinha guardado. Agora a aba
//    só acompanha o `initialTab` quando a tela está visível.
// 3) Rede lenta: os botões "Em andamento"/"Histórico" sumiam enquanto a lista
//    do aparelho era relida em segundo plano, e voltavam empurrando os cartões.
//
// Dublês: `useOrders` guarda a lista em useState de verdade (igual ao hook) e a
// busca da aba publica a lista da vez nesse estado; OrderList expõe o que chegou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { duble } = vi.hoisted(() => ({
  duble: {
    pedidosDaVez: [] as any[],
    publicarPedidos: null as null | ((novos: any[]) => void),
    buscaPendente: false,
    chamadasFetch: 0,
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useEffect, useState } = await import("react");
  // Estável de propósito: o efeito de busca da CartView depende dele.
  const fetchUserOrders = () => {
    duble.chamadasFetch += 1;
    // Rede pendurada: a busca nunca responde (o hook real tem prazo de 20 s).
    if (duble.buscaPendente) return new Promise<any[]>(() => {});
    duble.publicarPedidos?.([...duble.pedidosDaVez]);
    return Promise.resolve([...duble.pedidosDaVez]);
  };
  return {
    useOrders: () => {
      const [orders, setOrders] = useState(duble.pedidosDaVez);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- publicar o setter a cada render é o propósito: o teste precisa da instância viva para simular o realtime.
      useEffect(() => {
        duble.publicarPedidos = setOrders;
      });
      return { orders, fetchUserOrders };
    },
  };
});

// Identidades estáveis de propósito (lição da casa): objeto novo por render faz
// o efeito de busca da CartView disparar a cada render.
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
  useAuth: () => ({ user: usuarioLogado }),
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
  OrderSearch: () => <div />,
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
const emAndamentoAntigo = {
  ...base,
  id: "ped-antigo-em-andamento",
  status: "shipping",
} as unknown as Order;
const novoPedido = {
  ...base,
  id: "ped-novo",
  status: "pending",
} as unknown as Order;

describe("CartView — Meus Pedidos: pedido novo, rolagem na volta e botões na rede lenta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let principal: HTMLElement;
  let rolagem: number;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    const dubleDeArmazem = {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, String(v));
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
      clear: () => {
        armazem.clear();
      },
    };
    vi.stubGlobal("localStorage", { ...dubleDeArmazem });
    vi.stubGlobal("sessionStorage", { ...dubleDeArmazem });

    duble.pedidosDaVez = [];
    duble.publicarPedidos = null;
    duble.buscaPendente = false;
    duble.chamadasFetch = 0;

    // O <main> é a área que rola no App. O jsdom não rola de verdade: o
    // `scrollTop` vira uma propriedade comum, que o teste lê e escreve.
    rolagem = 0;
    principal = document.createElement("main");
    Object.defineProperty(principal, "scrollTop", {
      configurable: true,
      get: () => rolagem,
      set: (v: number) => {
        rolagem = v;
      },
    });
    document.body.appendChild(principal);
    hospedeiro = document.createElement("div");
    principal.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    principal.remove();
    vi.unstubAllGlobals();
  });

  async function esperar() {
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  // Os atrasos de rolagem da CartView são 50 e 150 ms: 300 ms cobre os dois.
  async function esperarOsAtrasosDeRolagem() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  async function mostrar(initialTab: "cart" | "orders", isActive: boolean) {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(
        <CartView
          onNavigate={() => {}}
          initialTab={initialTab}
          isActive={isActive}
        />,
      );
    });
    await esperar();
  }

  const botaoDaAba = (inicio: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.trim().startsWith(inicio),
    ) as HTMLButtonElement | undefined;
  const aba = (inicio: string) =>
    botaoDaAba(inicio)?.getAttribute("aria-pressed");

  async function publicar(lista: Order[]) {
    duble.pedidosDaVez = lista;
    await act(async () => {
      duble.publicarPedidos?.([...lista]);
    });
    await esperar();
  }

  describe("1: o pedido novo não fica escondido atrás do Histórico", () => {
    it("chegou pelo tempo real enquanto a pessoa comprava: ao voltar para Meus pedidos, abre em Em andamento", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("orders", true);
      expect(aba("Histórico")).toBe("true");

      // Saiu da tela para comprar (checkout) e o pedido novo chegou à lista.
      await mostrar("cart", false);
      await publicar([entregue, novoPedido]);
      await mostrar("orders", true);

      expect(aba("Em andamento")).toBe("true");
      expect(aba("Histórico")).toBe("false");
      expect(hospedeiro.textContent).toContain("Em andamento (1)");
    });

    it("sem tempo real: o pedido só chega na busca que a aba faz ao voltar, e mesmo assim abre em Em andamento", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("orders", true);
      expect(aba("Histórico")).toBe("true");

      await mostrar("cart", false);
      // Só o servidor sabe do pedido novo: a busca da volta o traz para o hook.
      duble.pedidosDaVez = [entregue, novoPedido];
      await mostrar("orders", true);

      expect(aba("Em andamento")).toBe("true");
      expect(hospedeiro.textContent).toContain("Em andamento (1)");
    });

    it("quem tocou em Histórico e está lendo a lista não é arrancada quando chega um pedido novo", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("orders", true);
      await act(async () => {
        botaoDaAba("Histórico")?.click();
      });
      await esperar();
      expect(aba("Histórico")).toBe("true");

      await publicar([entregue, novoPedido]);

      // Continua onde ela escolheu; o botão ao lado já mostra o pedido novo.
      expect(aba("Histórico")).toBe("true");
      expect(hospedeiro.textContent).toContain("Em andamento (1)");
    });

    it("a escolha por toque vale só enquanto ela está na tela: pedido novo que chegou enquanto ela estava fora abre em Em andamento", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("orders", true);
      await act(async () => {
        botaoDaAba("Histórico")?.click();
      });
      await esperar();

      await mostrar("cart", false);
      await publicar([entregue, novoPedido]);
      await mostrar("orders", true);

      expect(aba("Em andamento")).toBe("true");
    });

    it("a escolha por toque de uma visita antiga não vale na seguinte: pedido novo que só chega na busca da volta abre em Em andamento", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("orders", true);
      await act(async () => {
        botaoDaAba("Histórico")?.click();
      });
      await esperar();

      await mostrar("cart", false);
      duble.pedidosDaVez = [entregue, novoPedido];
      await mostrar("orders", true);

      expect(aba("Em andamento")).toBe("true");
    });

    it("LIMITE: pedido novo já entregue/cancelado não tira do Histórico quem tem OUTRO pedido em andamento que já conhecia", async () => {
      duble.pedidosDaVez = [entregue, emAndamentoAntigo];
      await mostrar("orders", true);
      await act(async () => {
        botaoDaAba("Histórico")?.click();
      });
      await esperar();

      await mostrar("cart", false);
      await publicar([entregue, emAndamentoAntigo, cancelado]);
      await mostrar("orders", true);

      expect(aba("Histórico")).toBe("true");
    });

    it("LIMITE: o pedido que ela já viu não a puxa de novo a cada visita", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("orders", true);
      await mostrar("cart", false);
      await publicar([entregue, novoPedido]);
      await mostrar("orders", true);
      expect(aba("Em andamento")).toBe("true");

      // Ela escolhe Histórico de propósito e sai; nada novo chegou.
      await act(async () => {
        botaoDaAba("Histórico")?.click();
      });
      await esperar();
      await mostrar("cart", false);
      await mostrar("orders", true);

      expect(aba("Histórico")).toBe("true");
    });

    it("LIMITE: a lista que pisca vazia e volta com os mesmos pedidos não é pedido novo", async () => {
      duble.pedidosDaVez = [entregue, cancelado];
      await mostrar("orders", true);
      expect(aba("Histórico")).toBe("true");

      await mostrar("cart", false);
      await publicar([]);
      await publicar([entregue, cancelado]);
      await mostrar("orders", true);

      expect(aba("Histórico")).toBe("true");
    });

    it("LIMITE: pedido novo que já nasce entregue/cancelado não tira ninguém do Histórico", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("orders", true);
      await mostrar("cart", false);
      await publicar([entregue, cancelado]);
      await mostrar("orders", true);

      expect(aba("Histórico")).toBe("true");
    });
  });

  describe("2: voltar do detalhe do pedido não joga a lista de volta ao topo", () => {
    it("rola a lista, abre o detalhe (a tela fica por baixo) e volta: a posição fica", async () => {
      duble.pedidosDaVez = [entregue, cancelado];
      await mostrar("orders", true);
      await esperarOsAtrasosDeRolagem();

      // Rolou até o 30º pedido.
      rolagem = 1800;

      // Ver detalhes: o App passa initialTab="cart" e isActive=false.
      await mostrar("cart", false);
      await esperarOsAtrasosDeRolagem();
      expect(rolagem).toBe(1800);

      // Voltar: o App restaura a posição guardada e reativa a tela.
      await mostrar("orders", true);
      rolagem = 1800;
      await esperarOsAtrasosDeRolagem();

      expect(rolagem).toBe(1800);
    });

    it("a lista continua sendo relida ao voltar (a leitura da volta não depende da troca de aba)", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("orders", true);
      const antes = duble.chamadasFetch;

      await mostrar("cart", false);
      expect(duble.chamadasFetch).toBe(antes);
      await mostrar("orders", true);

      expect(duble.chamadasFetch).toBeGreaterThan(antes);
    });

    it("LIMITE: a troca REAL de aba (Carrinho para Pedidos, tela visível) continua rolando ao topo", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("cart", true);
      await esperarOsAtrasosDeRolagem();
      rolagem = 500;

      await mostrar("orders", true);
      await esperarOsAtrasosDeRolagem();

      expect(rolagem).toBe(0);
    });

    it("LIMITE: tela escondida em Pedidos que volta como Carrinho vai ao topo e mostra o Carrinho", async () => {
      duble.pedidosDaVez = [entregue];
      await mostrar("orders", true);
      await esperarOsAtrasosDeRolagem();
      rolagem = 700;

      await mostrar("cart", false);
      await mostrar("cart", true);
      await esperarOsAtrasosDeRolagem();

      expect(rolagem).toBe(0);
      expect(hospedeiro.querySelector("h1")?.textContent).toBe("Carrinho");
    });
  });

  describe("3: rede lenta não esconde os botões nem empurra os cartões", () => {
    it("com a lista do aparelho na tela e a busca pendurada, Em andamento e Histórico continuam lá", async () => {
      duble.pedidosDaVez = [entregue, novoPedido];
      duble.buscaPendente = true;
      await mostrar("orders", true);

      expect(duble.chamadasFetch).toBe(1);
      expect(botaoDaAba("Em andamento")).toBeDefined();
      expect(botaoDaAba("Histórico")).toBeDefined();
      expect(hospedeiro.textContent).toContain("Em andamento (1)");
      expect(hospedeiro.textContent).toContain("Histórico (1)");
    });

    it("LIMITE: sem nenhum pedido em memória e a primeira busca pendurada, não há botões (nada para filtrar)", async () => {
      duble.pedidosDaVez = [];
      duble.buscaPendente = true;
      await mostrar("orders", true);

      expect(botaoDaAba("Em andamento")).toBeUndefined();
      expect(botaoDaAba("Histórico")).toBeUndefined();
    });
  });
});
