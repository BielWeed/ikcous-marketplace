// @vitest-environment jsdom
//
// 27/11/2026 — "Meus pedidos" de quem ENTROU na conta e não tem pedidos nela.
//
// Antes: "Você ainda não fez nenhum pedido" e "Comprou com outro e-mail? Entre
// com o usado na compra." — falso para quem comprou SEM entrar na conta (o
// pedido não fica ligado a conta nenhuma) e depois criou a conta, e a busca de
// pedido sem conta só existia para quem estava fora da conta.
//
// Agora a lista diz a verdade para os dois casos e oferece, dentro da conta, o
// MESMO caminho de quem está fora dela (OrderSearch na aba "Rastrear sem
// Conta"). O que a consulta acha fica só nesta conta, nesta visita: sai da tela
// ao sair da conta, ao fechar e depois de 15 minutos (o mesmo prazo do
// retrato de quem consulta sem conta).
//
// Dublê: só o OrderSearch (botão que dispara `onOrdersFound` e expõe as props);
// a OrderList é a de verdade — é nela que mora a frase e o botão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { duble } = vi.hoisted(() => ({
  duble: {
    pedidosDoHook: [] as any[],
    achados: [] as any[],
    propsDaBusca: [] as any[],
    usuario: null as null | { id: string },
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useState } = await import("react");
  const fetchUserOrders = () => Promise.resolve([...duble.pedidosDoHook]);
  return {
    useOrders: () => {
      const [orders] = useState(duble.pedidosDoHook);
      return { orders, fetchUserOrders };
    },
  };
});

const configDaLoja = { shippingFee: 10, freeShippingMin: 0 };
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
  OrderSearch: (props: {
    onOrdersFound?: (pedidos: any[]) => void;
    abrirNoRastreio?: boolean;
    somenteRastreio?: boolean;
  }) => {
    duble.propsDaBusca.push(props);
    return (
      <div
        data-testid="busca-pedido"
        data-abre-no-rastreio={String(Boolean(props.abrirNoRastreio))}
        data-somente-rastreio={String(Boolean(props.somenteRastreio))}
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
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RETRATO = "guest_tracked_orders";
const CONSULTAR = "Consultar pedido feito sem conta";
const FRASE_FALSA = "Comprou com outro e-mail? Entre com o usado na compra.";
const achadoSemConta = {
  id: "00000000-0000-0000-0000-0000000abc12",
  status: "shipping",
  total: 100,
  createdAt: new Date(0).toISOString(),
  customer: { name: "Joana" },
  items: [],
} as unknown as Order;
const FRASE_DO_ACHADO = "A caminho do seu endereço";

describe("CartView — conta sem pedidos consulta o pedido feito sem conta", () => {
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
    duble.achados = [achadoSemConta];
    duble.propsDaBusca = [];
    duble.usuario = { id: "cliente-1" };
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
    vi.unstubAllGlobals();
  });

  async function esperar() {
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  // A troca de conteúdo passa por AnimatePresence (saída animada em tempo
  // real no jsdom): espera a condição em vez de supor.
  async function esperarAte(condicao: () => boolean) {
    for (let i = 0; i < 60; i++) {
      if (condicao()) return;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }
  }

  async function renderizar() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} initialTab="orders" />);
    });
    await esperar();
  }

  const botao = (texto: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === texto,
    ) as HTMLButtonElement | undefined;
  const texto = () => hospedeiro.textContent ?? "";
  const busca = () =>
    hospedeiro.querySelector('[data-testid="busca-pedido"]') as HTMLElement;

  async function clicar(b: HTMLButtonElement | undefined) {
    expect(b).toBeDefined();
    await act(async () => {
      b?.click();
    });
    await esperar();
  }

  async function abrirEAchar() {
    await renderizar();
    await clicar(botao(CONSULTAR));
    await clicar(
      hospedeiro.querySelector('[data-testid="achar"]') as HTMLButtonElement,
    );
    await esperarAte(() => texto().includes(FRASE_DO_ACHADO));
  }

  it("conta sem pedidos: frase verdadeira para quem comprou sem entrar ou com outro e-mail, e o caminho da consulta", async () => {
    await renderizar();

    expect(texto()).not.toContain(FRASE_FALSA);
    expect(texto()).not.toContain("Você ainda não fez nenhum pedido");
    expect(texto()).toContain("Nenhum pedido feito nesta conta");
    expect(texto()).toContain(
      "Comprou sem entrar na conta, ou com outro e-mail? Esse pedido não aparece aqui.",
    );
    expect(busca()).toBeNull();

    await clicar(botao(CONSULTAR));

    // A MESMA busca de quem está fora da conta, já no rastreio e sem a aba
    // "Entrar na Conta" (ela já entrou).
    expect(busca()).not.toBeNull();
    expect(busca().dataset.abreNoRastreio).toBe("true");
    expect(busca().dataset.somenteRastreio).toBe("true");
    // O foco não cai no corpo da página quando o botão tocado sai de cena.
    expect(document.activeElement?.contains(busca())).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("pedido achado aparece na conta com o horário da consulta; 'Consultar de novo' volta à busca", async () => {
    await abrirEAchar();

    expect(texto()).toContain(FRASE_DO_ACHADO);
    expect(texto()).toContain("pode ter mudado");
    expect(busca()).toBeNull();

    await clicar(botao("Consultar de novo"));
    await esperarAte(() => !texto().includes(FRASE_DO_ACHADO));
    expect(texto()).not.toContain(FRASE_DO_ACHADO);
    expect(busca()).not.toBeNull();
  });

  it("'Fechar consulta' tira a consulta da tela e esquece o que ela achou", async () => {
    armazemDaSessao.clear();
    await abrirEAchar();

    await clicar(botao("Fechar consulta"));
    await esperarAte(() => !texto().includes(FRASE_DO_ACHADO));
    expect(texto()).not.toContain(FRASE_DO_ACHADO);
    expect(busca()).toBeNull();
    expect(botao(CONSULTAR)).toBeDefined();
    expect(armazemDaSessao.has(RETRATO)).toBe(false);
  });

  it("LIMITE: sair da conta não deixa o pedido achado à vista de quem usar o aparelho depois", async () => {
    await abrirEAchar();

    // Sair da conta: o AuthContext apaga o retrato do aparelho no SIGNED_OUT
    // (`esquecerRastreioDeConvidado`); aqui o useAuth é dublê, então o teste
    // faz essa parte. O que se prova é que a CONSULTA (estado em memória da
    // tela) não sobrevive à saída.
    armazemDaSessao.delete(RETRATO);
    duble.usuario = null;
    await renderizar();
    await esperarAte(() => !texto().includes(FRASE_DO_ACHADO));
    expect(texto()).not.toContain(FRASE_DO_ACHADO);

    // Entrar de novo (mesma ou outra conta) não reabre a consulta antiga.
    for (const id of ["cliente-1", "cliente-2"]) {
      duble.usuario = { id };
      await renderizar();
      expect(texto(), id).not.toContain(FRASE_DO_ACHADO);
      expect(
        Array.from(
          hospedeiro.querySelectorAll('[data-testid="busca-pedido"]'),
        ).filter((b) => (b as HTMLElement).dataset.somenteRastreio === "true"),
        id,
      ).toHaveLength(0);
      duble.usuario = null;
      await renderizar();
    }
  });

  it("LIMITE: trocar direto de conta (sem sair) fecha a consulta da conta anterior", async () => {
    await abrirEAchar();
    duble.usuario = { id: "cliente-2" };
    await renderizar();
    await esperarAte(() => !texto().includes(FRASE_DO_ACHADO));
    expect(texto()).not.toContain(FRASE_DO_ACHADO);
    expect(busca()).toBeNull();
    expect(botao(CONSULTAR)).toBeDefined();
  });

  it("LIMITE: passados 15 minutos o pedido achado sai da tela e ela explica", async () => {
    const agora = Date.now();
    await abrirEAchar();

    vi.spyOn(Date, "now").mockReturnValue(agora + 16 * 60_000);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esperar();
    await esperarAte(() => !texto().includes(FRASE_DO_ACHADO));

    expect(texto()).not.toContain(FRASE_DO_ACHADO);
    expect(texto()).toContain("saem da tela depois de 15 minutos");
    expect(busca()).not.toBeNull();
  });

  it("quem está fora da conta não ganha o botão: a busca já está aberta acima da lista", async () => {
    duble.usuario = null;
    await renderizar();
    expect(botao(CONSULTAR)).toBeUndefined();
    expect(busca()?.dataset.somenteRastreio).toBe("false");
  });
});
