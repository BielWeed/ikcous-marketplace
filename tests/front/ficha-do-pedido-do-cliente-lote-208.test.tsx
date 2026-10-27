// @vitest-environment jsdom
//
// Lote 208 (caça 8) — ficha do pedido da CLIENTE (OrderDetailsView):
//  (1)  mostra qual cor/tamanho cada linha é, lendo `product_variants`; falha
//       na leitura não quebra a ficha;
//  (3)  nome do produto em até 2 linhas (nada de `truncate`);
//  (4)  código de rastreio nunca cortado em 1 linha;
//  (5)  etapas com os nomes da tabela única (Recebido/Separado/A caminho/
//       Entregue);
//  (7)  retirada na loja: "Sem frete (retirada)", "Retirado" e nada de
//       "Chegou!"/"entregue", e "Seu endereço" só com endereço;
//  (8)  "Reenviar comprovante" só para quem tem conta;
//  (9)  textos pequenos sobem de 9-10 px;
//  (10) pedido sem itens não mostra "0 de 0 avaliados".
//
// Molde: ficha-do-pedido-reenvia-comprovante.test.tsx (createRoot + act,
// hooks dublês com identidades estáveis).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";
import { OrderDetailsView } from "@/views/customer/OrderDetailsView";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const { duble } = vi.hoisted(() => ({
  duble: {
    // Linhas que `product_variants` devolve; "erro" simula falha de rede.
    variacoes: [] as Array<{ id: string; name: string; value: string }>,
    leituraFalha: false,
    pedido: null as unknown,
    usuario: { id: "cliente-1" } as null | { id: string },
    config: { whatsappNumber: "", enableReviews: true } as Record<
      string,
      unknown
    >,
  },
}));

vi.mock("@/lib/supabase", () => {
  const consulta = {
    select: () => consulta,
    in: () =>
      duble.leituraFalha
        ? Promise.reject(new Error("rede caiu"))
        : Promise.resolve({ data: duble.variacoes, error: null }),
    eq: () => consulta,
    order: () => consulta,
    limit: () => consulta,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return {
    supabase: {
      rpc: vi.fn(),
      from: () => consulta,
      functions: { invoke: vi.fn() },
      channel: vi.fn(),
      removeChannel: vi.fn(),
    },
  };
});

const reenviarComprovante = vi.fn();
const fetchUserOrders = vi.fn();
const updateOrderStatus = vi.fn();
const hookDeUsuario = {
  get user() {
    return duble.usuario;
  },
};
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => hookDeUsuario }));

const listaVazia: Order[] = [];
const valorDoHookDePedidos = {
  orders: listaVazia,
  fetchUserOrders,
  updateOrderStatus,
  reenviarComprovante,
};
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => valorDoHookDePedidos,
}));

const valorDaLoja = {
  get config() {
    return duble.config;
  },
};
vi.mock("@/contexts/StoreContext", () => ({ useStore: () => valorDaLoja }));

function pedidoBase(extra: Record<string, unknown> = {}): Order {
  return {
    id: "pedido-1",
    status: "processing",
    paymentStatus: null,
    paymentMethod: "cash",
    createdAt: new Date("2026-09-01T12:00:00Z").toISOString(),
    customer: {
      name: "Cliente",
      phone: "",
      address: "Rua A",
      number: "10",
      city: "Uberlândia",
      state: "MG",
    },
    deliveryAddress: null,
    subtotal: 100,
    shipping: 10,
    discount: 0,
    total: 110,
    items: [
      {
        productId: "produto-1",
        variantId: "var-m",
        name: "Camiseta",
        image: "",
        quantity: 1,
        price: 50,
      },
      {
        productId: "produto-1",
        variantId: "var-g",
        name: "Camiseta",
        image: "",
        quantity: 1,
        price: 50,
      },
    ],
    ...extra,
  } as unknown as Order;
}

let container: HTMLElement | null = null;
let root: Root | null = null;

async function montar(pedido: Order) {
  duble.pedido = pedido;
  fetchUserOrders.mockResolvedValue([pedido]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <OrderDetailsView
        orderId="pedido-1"
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
  });
  await act(async () => {});
  await act(async () => {});
}

const texto = () => container?.textContent ?? "";

beforeEach(() => {
  duble.variacoes = [];
  duble.leituraFalha = false;
  duble.usuario = { id: "cliente-1" };
  duble.config = { whatsappNumber: "", enableReviews: true };
  reenviarComprovante.mockReset();
  fetchUserOrders.mockReset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe("item 1 — qual cor/tamanho a cliente comprou", () => {
  it("a mesma camiseta M e G mostra o rótulo de cada linha", async () => {
    duble.variacoes = [
      { id: "var-m", name: "Cor / Tamanho", value: "Azul / M" },
      { id: "var-g", name: "Cor / Tamanho", value: "Azul / G" },
    ];
    await montar(pedidoBase());

    const rotulos = [
      ...(container?.querySelectorAll('[data-testid="variacao-do-item"]') ??
        []),
    ].map((el) => el.textContent);
    expect(rotulos).toEqual(["Cor Azul · Tamanho M", "Cor Azul · Tamanho G"]);
  });

  it("no cartão de avaliação (pedido entregue) o produto lista as variações compradas", async () => {
    duble.variacoes = [
      { id: "var-m", name: "Tamanho", value: "M" },
      { id: "var-g", name: "Tamanho", value: "G" },
    ];
    await montar(pedidoBase({ status: "delivered" }));

    const cartao = container?.querySelector('[data-testid="cartao-avaliacao"]');
    expect(cartao).not.toBeNull();
    expect(cartao?.textContent).toContain("Tamanho M");
    expect(cartao?.textContent).toContain("Tamanho G");
  });

  it("a leitura das variações falha: a ficha aparece como sempre, sem rótulo", async () => {
    duble.leituraFalha = true;
    await montar(pedidoBase());

    expect(texto()).toContain("Itens do pedido");
    expect(texto()).toContain("Camiseta");
    expect(
      container?.querySelectorAll('[data-testid="variacao-do-item"]').length,
    ).toBe(0);
  });
});

describe("itens 3 e 4 — nome do produto e rastreio sem corte", () => {
  it("nome do produto em até 2 linhas, nunca truncate", async () => {
    await montar(pedidoBase({ status: "delivered" }));

    const nomes = [...(container?.querySelectorAll("h5, p") ?? [])].filter(
      (el) => el.textContent === "Camiseta",
    );
    expect(nomes.length).toBeGreaterThan(0);
    for (const el of nomes) {
      expect(el.className).toContain("line-clamp-2");
      expect(el.className).toContain("break-words");
      expect(el.className).not.toContain("truncate");
    }
  });

  it("código de rastreio quebra em até 2 linhas, sem truncate", async () => {
    await montar(
      pedidoBase({
        status: "shipping",
        trackingCode: "AB123456789BRCODIGOMUITOLONGO0000000000000000",
      }),
    );

    const codigo = container?.querySelector("code");
    expect(codigo?.textContent).toContain("AB123456789BR");
    expect(codigo?.className).toContain("break-all");
    expect(codigo?.className).toContain("line-clamp-2");
    expect(codigo?.className).not.toContain("truncate");
  });
});

describe("item 5 — nomes das etapas", () => {
  it("linha do tempo da ficha usa Recebido / Separado / A caminho / Entregue", async () => {
    await montar(pedidoBase());
    const cartao = container?.querySelector('[data-testid="cartao-status"]');
    for (const etapa of ["Recebido", "Separado", "A caminho", "Entregue"]) {
      expect(cartao?.textContent).toContain(etapa);
    }
  });
});

describe("item 7 — retirada na loja não usa texto de entrega", () => {
  const retirada = (extra: Record<string, unknown> = {}) =>
    pedidoBase({
      retiradaNaLoja: true,
      enderecoDeRetirada: "Rua da Loja, 1",
      shipping: 0,
      total: 100,
      ...extra,
    });

  it("frete zero da retirada diz 'Sem frete (retirada)', não 'Grátis'", async () => {
    await montar(retirada());
    expect(texto()).toContain("Sem frete (retirada)");
    expect(texto()).not.toContain("Grátis");
  });

  it("controle: entrega com frete zero continua 'Grátis'", async () => {
    await montar(pedidoBase({ shipping: 0, total: 100 }));
    expect(texto()).toContain("Grátis");
  });

  it("retirada já retirada diz 'Retirado', sem 'Chegou!' nem 'entregue com sucesso'", async () => {
    await montar(retirada({ status: "delivered" }));
    expect(texto()).toContain("Retirado");
    expect(texto()).not.toContain("Chegou!");
    expect(texto()).not.toContain("entregue com sucesso");
  });

  it("controle: entrega entregue continua 'Chegou!'", async () => {
    await montar(pedidoBase({ status: "delivered" }));
    expect(texto()).toContain("Chegou!");
  });

  it("retirada sem endereço de quem comprou não mostra 'Seu endereço'", async () => {
    await montar(
      retirada({
        customer: { name: "Cliente", phone: "" },
      }),
    );
    expect(texto()).toContain("Retire em: Rua da Loja, 1");
    expect(texto()).not.toContain("Seu endereço");
  });

  it("controle: retirada com endereço mantém 'Seu endereço'", async () => {
    await montar(retirada());
    expect(texto()).toContain("Seu endereço");
  });
});

describe("item 8 — reenviar comprovante só com conta", () => {
  it("sem usuário logado (rastreio por código) o botão não aparece", async () => {
    duble.usuario = null;
    await montar(pedidoBase());
    expect(texto()).not.toContain("Reenviar comprovante");
  });

  it("controle: com usuário o botão aparece", async () => {
    await montar(pedidoBase());
    expect(texto()).toContain("Reenviar comprovante");
  });
});

describe("item 9 — texto pequeno sobe", () => {
  it("etapas ainda não alcançadas: 11 px e branco mais forte que 40%", async () => {
    await montar(pedidoBase());
    const cartao = container?.querySelector('[data-testid="cartao-status"]');
    const alcancada = [...(cartao?.querySelectorAll("span") ?? [])].find(
      (el) => el.textContent === "Entregue",
    );
    expect(alcancada?.className).toContain("text-[11px]");
    expect(alcancada?.className).not.toContain("text-white/40");
    expect(alcancada?.className).not.toContain("text-[10px]");
  });

  it("selo 'Cancelado — não pague' na ficha tem 11 px, não 9 px", async () => {
    await montar(
      pedidoBase({ status: "cancelled", paymentStatus: "aguardando" }),
    );
    const selo = container?.querySelector(
      '[data-testid="customer-payment-badge"]',
    );
    expect(selo?.textContent).toContain("Cancelado — não pague");
    expect(selo?.innerHTML).not.toContain("text-[9px]");
    expect(selo?.innerHTML).toContain("text-[11px]");
  });
});

describe("item 10 — pedido sem itens", () => {
  it("entregue e sem itens: nenhum cartão '0 de 0 avaliados'", async () => {
    await montar(pedidoBase({ status: "delivered", items: [] }));
    expect(texto()).not.toContain("0 de 0");
    expect(
      container?.querySelector('[data-testid="cartao-avaliacao"]'),
    ).toBeNull();
  });
});
