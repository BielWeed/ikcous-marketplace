// @vitest-environment jsdom
import * as contato from "@/components/admin/minha-loja/contato";
import { mapOrderFromDB } from "@/lib/mappers";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ numero: "5511987654321" as string | null }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              tabela === "config_mototaxi"
                ? { whatsapp: estado.numero, nome: "Zé" }
                : null,
            error: null,
          }),
        }),
      }),
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const pedido: Order = {
  id: "c35ce4dd-9876-4321-8123-abcdef3884be",
  shippingOptionId: "local-delivery",
  customer: {
    name: "Cliente fictícia",
    whatsapp: "11912345678",
    address: "Rua Inventada",
    number: "12",
    complement: "apto 4",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    cep: "01000-000",
    reference: "portão azul",
  },
  items: [
    {
      productId: "p",
      name: "Caneca & café",
      quantity: 2,
      price: 25,
      image: "",
    },
  ],
  subtotal: 50,
  shipping: 8,
  discount: 0,
  total: 58,
  paymentMethod: "cash",
  status: "processing",
  createdAt: "",
  updatedAt: "",
  cancelledAfterShipping: false,
};

it.each([
  ["(11) 98765-4321", "5511987654321"],
  ["+55 11 98765-4321", "5511987654321"],
  ["5532345678", "555532345678"],
  ["1132345678", "551132345678"],
  ["", null],
  [null, null],
  ["551198765432199", null],
  ["0011987654321", null],
  ["1198765432", null],
  ["119999", null],
  ["351912345678", null],
  ["numero 11987654321", null],
  ["5511987654321?text=x", null],
])(
  "valida sem truncar ou aceitar país estrangeiro: %s",
  (entrada, esperado) => {
    expect(contato.normalizarNumeroMototaxi).toBeTypeOf("function");
    expect(contato.normalizarNumeroMototaxi(entrada)).toBe(esperado);
  },
);

it("leva apenas o necessário, com cobrança na entrega e texto pronto", () => {
  expect(contato.mensagemMototaxi).toBeTypeOf("function");
  const msg = contato.mensagemMototaxi(pedido, "Loja fictícia");
  expect(msg).toBe(
    [
      "Entrega — Pedido #3884BE",
      "Cliente: Cliente fictícia",
      "Telefone: 11912345678",
      "Endereço: Rua Inventada, 12, apto 4",
      "Centro · São Paulo/SP · CEP 01000-000",
      "Referência: portão azul",
      "Itens: 2× Caneca & café",
      "Cobrar na entrega: R$ 58,00 (Dinheiro)",
      "Loja: Loja fictícia",
    ].join("\n"),
  );
});
it("usa os seis últimos caracteres reconhecidos na ficha, nunca os primeiros", () => {
  const msg = contato.mensagemMototaxi(pedido, "Loja");
  expect(msg.split("\n")[0]).toBe("Entrega — Pedido #3884BE");
  expect(msg).not.toContain("#C35CE4");
});
it.each(["pago", "pago_apos_expirar", "recebido_na_entrega"] as const)(
  "não cobra de novo em %s",
  (paymentStatus) => {
    expect(contato.mensagemMototaxi).toBeTypeOf("function");
    const msg = contato.mensagemMototaxi({ ...pedido, paymentStatus }, "Loja");
    expect(msg).toContain("Já pago — não cobrar");
    expect(msg).not.toContain("Cobrar na entrega");
  },
);
it("sem referência não inventa; online pendente não é cobrança na entrega", () => {
  expect(contato.mensagemMototaxi).toBeTypeOf("function");
  const msg = contato.mensagemMototaxi(
    {
      ...pedido,
      paymentMethod: "online",
      customer: { ...pedido.customer, reference: "" },
    },
    "Loja",
  );
  expect(msg).not.toContain("Referência:");
  expect(msg).not.toContain("Cobrar na entrega");
  expect(msg).not.toContain("Já pago");
});
it("não manda cobrar novamente pagamento estornado, mesmo com data de recebimento", () => {
  const msg = contato.mensagemMototaxi(
    {
      ...pedido,
      paymentStatus: "estornado",
      pagamentoRecebidoEm: "2026-10-01",
    },
    "Loja",
  );
  expect(msg).toContain("Pagamento estornado — conferir antes de enviar");
  expect(msg).not.toContain("Cobrar na entrega");
  expect(msg).not.toContain("Já pago");
});
it.each([
  ["pix", "Pix"],
  ["card", "Cartão"],
] as const)(
  "identifica a forma %s para receber na entrega",
  (paymentMethod, forma) => {
    expect(
      contato.mensagemMototaxi({ ...pedido, paymentMethod }, "Loja"),
    ).toContain(`(${forma})`);
  },
);
it("mapeia o id do snapshot sem inferir por nota, preço ou retirada", () => {
  const mapped = mapOrderFromDB({
    id: "p",
    customer_data: { shipping_option_id: "local-delivery" },
    notes: "Retirada",
    total: 0,
  } as any);
  expect(mapped.shippingOptionId).toBe("local-delivery");
  expect(
    mapOrderFromDB({ id: "p", customer_data: {}, total: 0 } as any)
      .shippingOptionId,
  ).toBeNull();
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  estado.numero = "5511987654321";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function abrir(order = pedido) {
  const { OrderDetail } = await import("@/components/admin/orders/OrderDetail");
  await act(async () => {
    root.render(
      <OrderDetail
        order={{ ...order, items: [] }}
        storeName="Loja fictícia"
        onStatusChange={vi.fn()}
      />,
    );
  });
}
it("mostra o botão na ficha local com link exclusivamente wa.me e mensagem codificada", async () => {
  await abrir();
  const a = host.querySelector<HTMLAnchorElement>(
    'a[aria-label="Enviar ao mototáxi"]',
  );
  expect(a).not.toBeNull();
  const url = new URL(a!.href);
  expect(url.origin).toBe("https://wa.me");
  expect(url.pathname).toBe("/5511987654321");
  expect(url.searchParams.get("text")).toContain("Cliente: Cliente fictícia");
  expect(url.searchParams.get("text")).toContain("Loja: Loja fictícia");
  expect(host.textContent).toContain(
    "Abre o WhatsApp do Zé com a mensagem pronta",
  );
});
it.each([
  {
    caso: "cancelado em dinheiro",
    status: "cancelled",
    paymentMethod: "cash",
    paymentStatus: null,
  },
  {
    caso: "cancelado pago após expirar",
    status: "cancelled",
    paymentMethod: "online",
    paymentStatus: "pago_apos_expirar",
  },
  {
    caso: "estornado",
    status: "processing",
    paymentMethod: "online",
    paymentStatus: "estornado",
  },
  {
    caso: "entregue (inclusive pedido em devolução)",
    status: "delivered",
    paymentMethod: "cash",
    paymentStatus: null,
  },
] as const)(
  "não despacha pedido $caso",
  async ({ status, paymentMethod, paymentStatus }) => {
    await abrir({ ...pedido, status, paymentMethod, paymentStatus });
    expect(host.querySelector('a[aria-label="Enviar ao mototáxi"]')).toBeNull();
  },
);
it.each(["store-pickup", "sedex", undefined, "LOCAL-DELIVERY"])(
  "não mostra para %s",
  async (id) => {
    await abrir({ ...pedido, shippingOptionId: id });
    expect(host.textContent).not.toContain("Enviar ao mototáxi");
  },
);
it.each([null, "", "12345", "351912345678"])(
  "não mostra sem número BR válido: %s",
  async (numero) => {
    estado.numero = numero;
    await abrir();
    expect(host.textContent).not.toContain("Enviar ao mototáxi");
  },
);
