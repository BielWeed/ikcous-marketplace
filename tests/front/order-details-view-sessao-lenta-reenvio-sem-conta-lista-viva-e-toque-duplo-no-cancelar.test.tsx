// @vitest-environment jsdom
//
// Caça por mutação na ficha do pedido (OrderDetailsView). Cinco estados que a
// cliente lê como verdade e que nenhum teste prendia:
//   1. Reenviar comprovante exige CONTA: quem acompanha pelo código (sem conta)
//      não vê um botão que a edge recusaria sempre.
//   2. Sessão ainda sendo verificada, com o pedido do retrato já na tela: a
//      ficha aparece (não "Sincronizando pedido…" no lugar dela) e NÃO manda a
//      pessoa "falar com a loja para cancelar" antes de saber se ela tem conta.
//   3. Falha de carregamento sem conta: oferece "Tentar de novo" e NÃO oferece
//      "Entrar" ao lado (a falha é de rede, não de login).
//   4. Lista viva traz o pedido DEPOIS da abertura vazia: a tela o adota em vez
//      de quebrar ou ficar em "não encontrado".
//   5. Toque duplo em "Cancelar pedido" dentro da caixa: o servidor recebe UM
//      pedido de cancelamento só.
//
// RENDER DE VERDADE da tela; só os hooks de dados, a sessão e o banco são dublês
// (mesmo molde de order-details-convidado-nao-ve-cancelar-pedido).
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

import type { Order } from "@/types";

const { fetchUserOrders, updateOrderStatus, estado } = vi.hoisted(() => ({
  fetchUserOrders: vi.fn(),
  updateOrderStatus: vi.fn(),
  estado: {
    user: null as { id: string } | null,
    loading: false,
    orders: [] as unknown[],
    erro: null as string | null,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useOrders", () => ({
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    orders: estado.orders,
    ordersLoadError: estado.erro,
    fetchUserOrders,
    updateOrderStatus,
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, loading: estado.loading }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, storeAddress: "Rua A, 10" },
  }),
}));

const ID = "pedido-da-ficha-lenta";
const pedido = (parcial: Partial<Order> = {}): Order => ({
  id: ID,
  customer: { name: "Cliente", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  paymentStatus: null,
  status: "processing",
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T11:00:00Z",
  cancelledAfterShipping: false,
  ...parcial,
});

function armazem() {
  const dados = new Map<string, string>();
  return {
    getItem: (c: string) => dados.get(c) ?? null,
    setItem: (c: string, v: string) => {
      dados.set(c, String(v));
    },
    removeItem: (c: string) => {
      dados.delete(c);
    },
    clear: () => dados.clear(),
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

function guardarRetratoDoConvidado(p: Order) {
  sessionStorage.setItem(
    "guest_tracked_orders",
    JSON.stringify({ consultadoEm: Date.now(), pedidos: [p] }),
  );
}

async function montar() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView orderId={ID} onBack={vi.fn()} onNavigate={vi.fn()} />,
    );
  });
}
async function assentar() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
async function abrir() {
  await montar();
  await assentar();
}

const texto = () => hospedeiro.textContent ?? "";
const botao = (nome: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === nome,
  );

beforeAll(async () => {
  await import("@/views/customer/OrderDetailsView");
}, 60_000);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("sessionStorage", armazem());
  vi.stubGlobal("localStorage", armazem());
  vi.clearAllMocks();
  estado.user = null;
  estado.loading = false;
  estado.orders = [];
  estado.erro = null;
  fetchUserOrders.mockResolvedValue([]);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("ficha do pedido — reenviar comprovante só com conta", () => {
  it("convidado (retrato, sem conta): a ficha abre e NÃO há 'Reenviar comprovante'", async () => {
    guardarRetratoDoConvidado(pedido());

    await abrir();

    expect(texto()).toContain("Meu pedido");
    expect(botao("Reenviar comprovante")).toBeUndefined();
  });

  it("controle: com conta aberta, o MESMO pedido oferece 'Reenviar comprovante'", async () => {
    estado.user = { id: "u-1" };
    guardarRetratoDoConvidado(pedido());

    await abrir();

    expect(botao("Reenviar comprovante")).toBeDefined();
  });
});

describe("ficha do pedido — sessão ainda sendo verificada", () => {
  it("com o pedido do retrato já carregado, mostra a ficha e não manda 'falar com a loja para cancelar'", async () => {
    estado.loading = true;
    guardarRetratoDoConvidado(pedido());

    await abrir();

    expect(texto()).not.toContain("Sincronizando pedido");
    expect(texto()).toContain("Meu pedido");
    expect(texto()).not.toContain("Para cancelar, fale com a loja");
  });

  it("controle: sessão já verificada e sem conta, a orientação de cancelar aparece", async () => {
    estado.loading = false;
    guardarRetratoDoConvidado(pedido());

    await abrir();

    expect(texto()).toContain("Para cancelar, fale com a loja");
  });
});

describe("ficha do pedido — falha de carregamento sem conta", () => {
  it("oferece 'Tentar de novo' e não 'Entrar': o problema é a rede, não o login", async () => {
    estado.erro = "Falha na consulta";

    await abrir();

    expect(texto()).toContain("Não conseguimos carregar agora");
    expect(botao("Tentar de novo")).toBeDefined();
    expect(botao("Entrar")).toBeUndefined();
  });

  it("controle: sem falha e sem conta, é o 'Entrar' que aparece, sem 'Tentar de novo'", async () => {
    await abrir();

    expect(texto()).toContain("Entre na conta para ver este pedido");
    expect(botao("Entrar")).toBeDefined();
    expect(botao("Tentar de novo")).toBeUndefined();
  });
});

describe("ficha do pedido — a lista viva traz o pedido depois", () => {
  it("abre sem achar o pedido e, quando a lista passa a trazê-lo, a ficha o mostra", async () => {
    estado.user = { id: "u-1" };

    await abrir();
    expect(texto()).toContain("Pedido não encontrado");

    estado.orders = [pedido()];
    await montar();
    await assentar();

    expect(texto()).not.toContain("Pedido não encontrado");
    expect(texto()).toContain("Meu pedido");
    expect(texto()).toContain("Blusa Teste");
  });
});

describe("ficha do pedido — toque duplo em 'Cancelar pedido' na caixa", () => {
  it("dois toques no mesmo instante mandam UM cancelamento ao servidor", async () => {
    estado.user = { id: "u-1" };
    estado.orders = [pedido()];
    updateOrderStatus.mockReturnValue(new Promise(() => {}));

    await abrir();
    await act(async () => {
      botao("Cancelar Pedido")?.click();
    });
    const confirmar = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[role=alertdialog] button"),
    ).find((b) => b.textContent?.trim() === "Cancelar pedido");
    expect(confirmar).toBeDefined();

    await act(async () => {
      confirmar?.click();
      confirmar?.click();
    });

    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(updateOrderStatus).toHaveBeenCalledWith(
      ID,
      "cancelled",
      undefined,
      false,
      "processing",
    );
  });
});
