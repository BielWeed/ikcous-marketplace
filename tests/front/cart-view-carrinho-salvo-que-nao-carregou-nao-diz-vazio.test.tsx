// @vitest-environment jsdom
//
// "Seu carrinho está vazio" é mentira quando o carrinho SALVO da conta não foi
// lido. Cliente com conta abre o app num aparelho novo (sem carrinho local); a
// leitura de `cart_items` falha ou passa de 8 s, o carregamento destrava de
// propósito e a tela dizia "vazio ... você ainda não adicionou nenhum item": a
// cliente achava que tinha perdido o carrinho (os dados seguem salvos, só a
// frase era falsa).
//
// Aqui o CartProvider é o de verdade (leitura de `cart_items` simulada) e a
// CartView também: o que se prova é o que a cliente VÊ.
import { CartProvider } from "@/contexts/CartContext";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  falhaNoCarrinho: "nenhuma" as "nenhuma" | "erro-do-banco",
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0 },
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));
// Referência ESTÁVEL da lista (um array novo por render reativaria, em laço, os
// efeitos que dependem dela).
const { pedidos, buscarPedidos } = vi.hoisted(() => ({
  pedidos: [] as unknown[],
  buscarPedidos: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    fetchUserOrders: buscarPedidos,
    orders: pedidos,
    ordersLoadError: null,
    loading: false,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    loading: false,
    erroAoCarregar: false,
  }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => {
          if (tabela === "cart_items" && mundo.falhaNoCarrinho !== "nenhuma") {
            return Promise.resolve({
              data: null,
              error: { message: "permissão negada" },
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
        in: async () => ({ data: [], error: null }),
      }),
    }),
    rpc: () => Promise.resolve({ error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => Promise.resolve(),
  },
}));

vi.mock("sonner", () => {
  const registrar = () => {};
  return {
    toast: Object.assign(vi.fn(registrar), {
      error: registrar,
      info: registrar,
      success: registrar,
      warning: registrar,
    }),
  };
});

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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE_DO_VAZIO = "Seu carrinho está vazio";
const AVISO =
  "Não conseguimos carregar seu carrinho salvo agora. Estamos tentando de novo.";

describe("CartView — carrinho salvo que não carregou não é carrinho vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    mundo.usuario = { id: "u1" };
    mundo.falhaNoCarrinho = "nenhuma";
    onNavigate.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrirOCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(
        <CartProvider>
          <CartView onNavigate={onNavigate} />
        </CartProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
  }

  const texto = () => hospedeiro.textContent ?? "";
  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === rotulo,
    ) as HTMLButtonElement | undefined;

  it("conta + leitura do carrinho salvo falhou + nada neste aparelho: avisa e oferece 'Tentar de novo' (nunca 'vazio')", async () => {
    mundo.falhaNoCarrinho = "erro-do-banco";
    await abrirOCarrinho();

    expect(texto()).not.toContain(FRASE_DO_VAZIO);
    expect(texto()).not.toContain("Carregando seu carrinho");
    expect(texto()).toContain(AVISO);
    expect(botao("Tentar de novo")).toBeDefined();
    // O caminho para a loja continua: não é um beco.
    expect(botao("Explorar Produtos")).toBeDefined();
  });

  it("'Tentar de novo' com a leitura dando certo (carrinho da conta vazio): o aviso cai e aparece o vazio de verdade", async () => {
    mundo.falhaNoCarrinho = "erro-do-banco";
    await abrirOCarrinho();
    expect(texto()).toContain(AVISO);

    mundo.falhaNoCarrinho = "nenhuma";
    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(texto()).not.toContain(AVISO);
    expect(texto()).toContain(FRASE_DO_VAZIO);
  });

  it("'Tentar de novo' com a leitura falhando de novo: o aviso fica e o botão volta a ficar disponível", async () => {
    mundo.falhaNoCarrinho = "erro-do-banco";
    await abrirOCarrinho();

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(texto()).toContain(AVISO);
    expect(texto()).not.toContain(FRASE_DO_VAZIO);
    expect(botao("Tentar de novo")?.disabled).toBe(false);
  });

  it("o caminho para a loja funciona no aviso", async () => {
    mundo.falhaNoCarrinho = "erro-do-banco";
    await abrirOCarrinho();

    await act(async () => {
      botao("Explorar Produtos")?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("controle: conta + leitura boa + carrinho da conta vazio: o vazio de sempre, sem aviso", async () => {
    await abrirOCarrinho();

    expect(texto()).toContain(FRASE_DO_VAZIO);
    expect(texto()).not.toContain(AVISO);
    expect(botao("Tentar de novo")).toBeUndefined();
  });

  it("convidado (sem conta) com carrinho vazio: o vazio de sempre, sem aviso", async () => {
    mundo.usuario = null;
    mundo.falhaNoCarrinho = "erro-do-banco";
    await abrirOCarrinho();

    expect(texto()).toContain(FRASE_DO_VAZIO);
    expect(texto()).not.toContain(AVISO);
    expect(botao("Tentar de novo")).toBeUndefined();
  });
});
