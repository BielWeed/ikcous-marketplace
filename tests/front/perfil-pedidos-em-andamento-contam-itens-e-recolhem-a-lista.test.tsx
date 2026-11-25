// @vitest-environment jsdom
//
// Caça por mutação no Perfil ("Meu perfil"): o cartão "Pedidos em andamento"
// escreve DOIS números que a cliente lê como verdade, e nenhum teste os
// prendia:
//   1. "+N outro(s) item(ns)" ao lado do pedido: só aparece quando o pedido
//      tem MAIS de um item (com 1 item não pode dizer "+0 outros itens").
//   2. A lista fechada mostra UM pedido só, o botão "Ver mais (N outro/outros)"
//      conta os que ficaram escondidos, e com um único pedido o botão nem
//      existe.
//
// RENDER DE VERDADE da tela; só os hooks de dados e a lista de endereços são
// dublês (mesmo molde de perfil-pedidos-em-andamento-falam-a-verdade).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let pedidosAtuais: Order[] = [];
let erroDePedidos: string | null = null;
const buscarPedidos = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "cliente@ikcous.com", user_metadata: {} },
    profile: { full_name: "Cliente", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: async () => true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    deleteAddress: async () => true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: pedidosAtuais,
    ordersLoadError: erroDePedidos,
    fetchUserOrders: buscarPedidos,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja de Teste",
      businessHours: "Seg-Sex: 8h as 19h",
      whatsappNumber: "34999999999",
    },
  }),
}));

vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => <div data-testid="address-list-stub" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

function item(n: number) {
  return {
    productId: `prod-${n}`,
    name: `Produto ${n}`,
    price: 10,
    quantity: 1,
    image: "",
  };
}

function pedido(id: string, itens: number): Order {
  return {
    id,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: Array.from({ length: itens }, (_, i) => item(i + 1)),
    subtotal: 10 * itens,
    shipping: 0,
    discount: 0,
    total: 10 * itens,
    paymentMethod: "cash",
    paymentStatus: null,
    status: "processing",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
  };
}

describe("ProfileView — o cartão Pedidos em andamento conta itens e pedidos escondidos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/ProfileView");
  }, 60_000);

  beforeEach(() => {
    erroDePedidos = null;
    buscarPedidos.mockReset().mockImplementation(async () => pedidosAtuais);
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

  async function renderizar(pedidos: Order[]) {
    pedidosAtuais = pedidos;
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const botoesVerDetalhes = () =>
    [...hospedeiro.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Ver detalhes",
    );
  const botaoVerMais = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^Ver (mais|menos)/.test(b.textContent?.trim() ?? ""),
    );

  it("pedido com 1 item só: nenhuma frase de '+ outros itens'", async () => {
    await renderizar([pedido("11111111-aaaa-bbbb-cccc-000000000001", 1)]);

    expect(hospedeiro.textContent).not.toContain("outro item");
    expect(hospedeiro.textContent).not.toContain("outros itens");
    expect(hospedeiro.textContent).not.toContain("+0");
  });

  it("pedido com 2 itens diz '+1 outro item' (singular)", async () => {
    await renderizar([pedido("11111111-aaaa-bbbb-cccc-000000000002", 2)]);

    expect(hospedeiro.textContent).toContain("+1 outro item");
    expect(hospedeiro.textContent).not.toContain("outros itens");
  });

  it("pedido com 4 itens diz '+3 outros itens' (plural)", async () => {
    await renderizar([pedido("11111111-aaaa-bbbb-cccc-000000000004", 4)]);

    expect(hospedeiro.textContent).toContain("+3 outros itens");
  });

  it("item sem nome no pedido: o cartão chama o pedido de 'Pedido', nunca deixa o título vazio", async () => {
    const ordem = pedido("11111111-aaaa-bbbb-cccc-00000000000b", 1);
    ordem.items[0].name = "";
    await renderizar([ordem]);

    const titulo = hospedeiro.querySelector("h3");
    expect(titulo?.textContent).toBe("Pedido");
  });

  it("lista de pedidos falhou e está vazia: 'Tentar de novo' busca de novo, em silêncio (true), sem esconder o aviso", async () => {
    erroDePedidos = "Falha na consulta";
    await renderizar([]);

    expect(hospedeiro.textContent).toContain(
      "Não conseguimos carregar seus pedidos agora.",
    );
    // A busca de abertura também é silenciosa (cartão secundário).
    expect(buscarPedidos).toHaveBeenCalledWith(true);
    buscarPedidos.mockClear();

    const tentar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Tentar de novo",
    );
    expect(tentar).toBeDefined();
    await act(async () => tentar?.click());

    expect(buscarPedidos).toHaveBeenCalledTimes(1);
    expect(buscarPedidos).toHaveBeenCalledWith(true);
  });

  it("um único pedido ativo: sem botão 'Ver mais'", async () => {
    await renderizar([pedido("11111111-aaaa-bbbb-cccc-000000000005", 1)]);

    expect(botoesVerDetalhes()).toHaveLength(1);
    expect(botaoVerMais()).toBeUndefined();
  });

  it("dois pedidos ativos: lista fechada mostra UM e o botão diz 'Ver mais (1 outro)'", async () => {
    await renderizar([
      pedido("11111111-aaaa-bbbb-cccc-000000000006", 1),
      pedido("22222222-aaaa-bbbb-cccc-000000000007", 1),
    ]);

    expect(botoesVerDetalhes()).toHaveLength(1);
    expect(botaoVerMais()?.textContent?.trim()).toBe("Ver mais (1 outro)");
    expect(
      hospedeiro.querySelector('[data-testid="contagem-em-andamento"]')
        ?.textContent,
    ).toBe("2");
  });

  it("três pedidos ativos: fechada mostra UM, o botão diz 'Ver mais (2 outros)', aberta mostra os TRÊS e 'Ver menos' recolhe", async () => {
    await renderizar([
      pedido("11111111-aaaa-bbbb-cccc-000000000008", 1),
      pedido("22222222-aaaa-bbbb-cccc-000000000009", 1),
      pedido("33333333-aaaa-bbbb-cccc-00000000000a", 1),
    ]);

    expect(botoesVerDetalhes()).toHaveLength(1);
    expect(botaoVerMais()?.textContent?.trim()).toBe("Ver mais (2 outros)");

    await act(async () => botaoVerMais()?.click());
    expect(botoesVerDetalhes()).toHaveLength(3);
    expect(botaoVerMais()?.textContent?.trim()).toBe("Ver menos");

    await act(async () => botaoVerMais()?.click());
    expect(botoesVerDetalhes()).toHaveLength(1);
    expect(botaoVerMais()?.textContent?.trim()).toBe("Ver mais (2 outros)");
  });
});
