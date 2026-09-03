// @vitest-environment jsdom
//
// Laudo cliente-pós-compra 02/09, achado #3 — onda 2 (listas vivas).
//
// A aba "Meus Pedidos" do carrinho era CONGELADA: a lista vivia em estado
// local da view (CartView.tsx:139) e a busca só disparava ao ENTRAR na aba
// (:177-202). O realtime atualizava a lista INTERNA do hook `useOrders`
// (useOrders.ts:1247-1256 — handleRealtimeUpdate/Insert/Delete), mas a
// CartView só consumia `fetchUserOrders` — o cliente com a aba aberta via
// status velho até sair e voltar.
//
// O CONSERTO: a lista da aba passa a ser derivada do estado VIVO do hook —
// o mesmo estado que o realtime alimenta. A cara da aba não muda (mesmos
// contadores, mesmas sub-abas, mesma lista).
//
// COMO O TESTE PROVA: o dublê do `useOrders` guarda a lista em useState de
// verdade (igual ao hook real) e publica o setter para o teste. O teste monta
// a aba, confirma o pedido "pending", e então simula um evento realtime
// chegando ao estado do hook (pedido vai a "cancelled") SEM nenhuma busca
// nova. Antes do conserto a aba continuava mostrando o estado velho; depois,
// ela acompanha o hook na hora.
//
// LIÇÕES DE HARNESS DA CASA (dossiê da frente): (1) Node 25 traz um
// localStorage experimental que vence o do jsdom — stubGlobal antes de tocar
// carrinho; (2) dublê de hook instável (função nova por render) + efeito
// dependente = loop infinito — o `fetchUserOrders` do dublê é ESTÁVEL.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { duble } = vi.hoisted(() => ({
  duble: {
    // Lista que o hook "tem" — é o que a busca de entrada devolve e o que um
    // evento realtime passa a refletir no estado interno do hook.
    pedidosDaVez: [] as any[],
    // Contador de buscas: a prova de vida é atualizar a lista SEM busca nova.
    chamadasFetch: 0,
    fetchUserOrders: (() => {
      duble.chamadasFetch += 1;
      // Cópia rasa: a lista devolvida não pode ser a mesma referência que um
      // publish futuro troca.
      return Promise.resolve([...duble.pedidosDaVez]);
    }) as (silencioso?: boolean) => Promise<any[]>,
    // Setter publicado pelo dublê via useEffect (escrever em variável de
    // módulo DURANTE o render o react-compiler reprova).
    publicarPedidos: null as null | ((novos: any[]) => void),
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useOrders: () => {
      const [orders, setOrders] = useState(duble.pedidosDaVez);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- publicar o setter a CADA render é o propósito: o teste precisa da última instância viva do setter para simular o realtime chegando ao hook.
      useEffect(() => {
        duble.publicarPedidos = setOrders;
      });
      return { orders, fetchUserOrders: duble.fetchUserOrders };
    },
  };
});

// IDENTIDADES ESTÁVEIS de propósito (lição da casa, mesmo padrão de
// notificacoes-acao-que-falha-avisa-a-cliente.test.tsx): devolver objeto novo
// a cada render faz o `user` das dependências do efeito de busca da CartView
// mudar todo render — o efeito re-dispara, o setState re-renderiza, e o teste
// trava em laço infinito dentro do `act`. Custou uma rodada vermelha por
// timeout (15 s) para descobir.
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

// O OrderList falso expõe o que CHEGOU nele — o teste julga a fiação
// (view → hook vivo), não o desenho do card.
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: ({ orders }: { orders: any[] }) => (
    <ul data-testid="lista-pedidos">
      {orders.map((o: any) => (
        <li key={o.id} data-testid={`pedido-${o.id}`} data-status={o.status}>
          {o.status}
        </li>
      ))}
    </ul>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedidoPendente = {
  id: "ped-1",
  status: "pending",
  total: 100,
  createdAt: new Date(0).toISOString(),
  customer: { name: "Joana" },
  items: [],
} as unknown as Order;

const pedidoCancelado = { ...pedidoPendente, status: "cancelled" };

describe("CartView — a aba Meus Pedidos reflete o estado VIVO do hook (laudo #3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Lição da casa: Node 25 tem localStorage/sessionStorage experimentais
    // que vencem os do jsdom. Stub limpo por teste.
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

    duble.chamadasFetch = 0;
    duble.publicarPedidos = null;
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
    duble.pedidosDaVez = [pedidoPendente];
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} initialTab="orders" />);
    });
    // Duas voltas de microtask: a busca de entrada resolve e desliga o loading.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const contadores = () => hospedeiro.textContent ?? "";

  it("âncora: o pedido pendente entrou na aba e a busca de entrada aconteceu 1x", async () => {
    await montarAbaPedidos();

    expect(
      hospedeiro.querySelector('[data-testid="pedido-ped-1"]'),
    ).not.toBeNull();
    expect(
      hospedeiro
        .querySelector('[data-testid="pedido-ped-1"]')
        ?.getAttribute("data-status"),
    ).toBe("pending");
    expect(contadores()).toContain("Em Andamento (1)");
    expect(duble.chamadasFetch).toBe(1);
  });

  it("realtime chega ao hook SEM busca nova: a aba acompanha na hora", async () => {
    await montarAbaPedidos();
    expect(duble.chamadasFetch).toBe(1);

    // Simula o evento realtime atualizando o estado interno do hook
    // (handleRealtimeUpdate em useOrders.ts:1247-1256) — sem fetch novo.
    await act(async () => {
      duble.publicarPedidos?.([pedidoCancelado]);
    });

    // A aba VIU a mudança: o pedido saiu de "Em Andamento" para "Histórico".
    expect(hospedeiro.querySelector('[data-testid="pedido-ped-1"]')).toBeNull();
    expect(contadores()).toContain("Em Andamento (0)");
    expect(contadores()).toContain("Histórico (1)");

    // E a mudança veio do estado VIVO, não de uma nova busca.
    expect(duble.chamadasFetch).toBe(1);
  });
});
