// @vitest-environment jsdom
import * as contato from "@/components/admin/minha-loja/contato";
import { mapOrderFromDB } from "@/lib/mappers";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  numero: "5511987654321" as string | null,
  erroLeitura: false,
  leituraPendurada: false,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          abortSignal() {
            return this;
          },
          maybeSingle: async () => {
            if (estado.leituraPendurada) return new Promise<never>(() => {});
            return {
              data:
                tabela === "config_mototaxi"
                  ? { whatsapp: estado.numero, nome: "Zé" }
                  : null,
              error:
                tabela === "config_mototaxi" && estado.erroLeitura
                  ? { message: "falha de leitura" }
                  : null,
            };
          },
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
it("o endereço na mensagem sai sem controles invisíveis", () => {
  const controle = String.fromCodePoint(0x202e);
  const msg = contato.mensagemMototaxi(
    {
      ...pedido,
      customer: {
        ...pedido.customer,
        address: `Rua ${controle}Inventada`,
        number: `${controle}12`,
        complement: `Apto ${controle}120`,
        neighborhood: `Cen${controle}tro`,
        city: `São ${String.fromCodePoint(0x200f)}Paulo`,
        state: `S${controle}P`,
        cep: `01000-${controle}000`,
        reference: `portão ${controle}azul`,
      },
    },
    "Loja fictícia",
  );
  expect(msg.split("\n").slice(3, 6)).toEqual([
    "Endereço: Rua Inventada, 12, Apto 120",
    "Centro · São Paulo/SP · CEP 01000-000",
    "Referência: portão azul",
  ]);
});
it("compra para outra pessoa leva o nome de quem recebe, logo depois do cliente", () => {
  const msg = contato.mensagemMototaxi(
    {
      ...pedido,
      customer: { ...pedido.customer, recipientName: "  Maria   da Silva " },
    },
    "Loja",
  );
  const linhas = msg.split("\n");
  expect(linhas[1]).toBe("Cliente: Cliente fictícia");
  expect(linhas[2]).toBe("Quem recebe: Maria da Silva");
  expect(linhas[3]).toBe("Telefone: 11912345678");
});
it.each([undefined, "", "   ", "cliente FICTÍCIA", "Cliente Ficticia"])(
  "não repete o comprador nem inventa quem recebe: %j",
  (recipientName) => {
    const msg = contato.mensagemMototaxi(
      { ...pedido, customer: { ...pedido.customer, recipientName } },
      "Loja",
    );
    expect(msg).not.toContain("Quem recebe");
  },
);
it("leva as observações do pedido em uma linha só, depois da referência", () => {
  const msg = contato.mensagemMototaxi(
    { ...pedido, notes: "Campainha estragada\n  deixar   na portaria.\n" },
    "Loja",
  );
  const linhas = msg.split("\n");
  expect(linhas[5]).toBe("Referência: portão azul");
  expect(linhas[6]).toBe(
    "Observações do pedido: Campainha estragada · deixar na portaria.",
  );
  expect(linhas[7]).toMatch(/^Itens: /);
});
it("no formato que o checkout grava, a linha automática de frete não vira observação", () => {
  // CheckoutView junta observação + escolhas de variação + nota do frete com "\n\n".
  const notes = [
    "Deixar na portaria",
    "Camiseta: P",
    "Frete Escolhido: Entrega local (Prazo: no mesmo dia)",
  ].join("\n\n");
  const msg = contato.mensagemMototaxi({ ...pedido, notes }, "Loja");
  expect(msg).toContain(
    "Observações do pedido: Deixar na portaria · Camiseta: P",
  );
  expect(msg).not.toContain("Frete Escolhido");
  expect(msg.split("\n")).toHaveLength(10);
});
it("a linha antiga de retirada não muda a mensagem de uma entrega", () => {
  const notes = "Deixar na portaria";
  const mensagem = contato.mensagemMototaxi({ ...pedido, notes }, "Loja");
  expect(
    contato.mensagemMototaxi(
      { ...pedido, notes: `${notes}\n\nRetirada na loja: Rua X, 10` },
      "Loja",
    ),
  ).toBe(mensagem);
});

it("pedido de entrega local sem observação só tem a nota automática de frete: sem a linha", () => {
  const notes = "Frete Escolhido: Entrega local (Prazo: no mesmo dia)";
  const msg = contato.mensagemMototaxi({ ...pedido, notes }, "Loja");
  expect(msg).not.toContain("Observações");
  expect(msg).not.toContain("Frete Escolhido");
});
it.each([undefined, "", "  \n "])(
  "sem observação não inventa a linha: %j",
  (notes) => {
    expect(
      contato.mensagemMototaxi({ ...pedido, notes }, "Loja"),
    ).not.toContain("Observações");
  },
);
it("observação longa é cortada em 300 caracteres com reticências", () => {
  const msg = contato.mensagemMototaxi(
    { ...pedido, notes: "a".repeat(500) },
    "Loja",
  );
  const linha = msg.split("\n").find((l) => l.startsWith("Observações"));
  expect(linha).toBe(`Observações do pedido: ${"a".repeat(299)}…`);
});
it("o corte nunca parte um emoji ao meio: o link do WhatsApp continua válido", () => {
  // 298 letras + emoji (2 unidades UTF-16) + texto: cortar por unidade deixaria
  // meio emoji solto e o encodeURIComponent do link lançaria "URI malformed".
  const msg = contato.mensagemMototaxi(
    { ...pedido, notes: `${"a".repeat(298)}😀 fim de texto` },
    "Loja",
  );
  const linha = msg.split("\n").find((l) => l.startsWith("Observações"));
  expect(linha).toBe(`Observações do pedido: ${"a".repeat(298)}😀…`);
  expect(() => encodeURIComponent(msg)).not.toThrow();
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
  estado.erroLeitura = false;
  estado.leituraPendurada = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
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
  const { navegar, aba, link } = await clicarParaEnviar();
  expect(aba.opener).toBeNull();
  expect(link.rel).toBe("noreferrer");
  expect(navegar).toHaveBeenCalledOnce();
  const url = new URL(navegar.mock.calls[0][0]);
  expect(url.origin).toBe("https://wa.me");
  expect(url.pathname).toBe("/5511987654321");
  expect(url.searchParams.get("text")).toContain("Cliente: Cliente fictícia");
  expect(url.searchParams.get("text")).toContain("Loja: Loja fictícia");
  expect(host.textContent).toContain(
    "Abre o WhatsApp do mototáxi com a mensagem pronta",
  );
});
it.each(["pending", "processing", "shipping"] as const)(
  "oferece envio ao mototáxi para entrega local em dinheiro: %s",
  async (status) => {
    await abrir({ ...pedido, status, paymentMethod: "cash" });
    expect(
      host.querySelector('[aria-label="Enviar ao mototáxi"]'),
    ).not.toBeNull();
  },
);
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
    expect(host.querySelector('[aria-label="Enviar ao mototáxi"]')).toBeNull();
  },
);
it.each(["aguardando", "recusado", "expirado", null, undefined] as const)(
  "não despacha online com pagamento %s",
  async (paymentStatus) => {
    for (const status of ["pending", "processing"] as const) {
      await abrir({
        ...pedido,
        status,
        paymentMethod: "online",
        paymentStatus,
      });
      expect(
        host.querySelector('[aria-label="Enviar ao mototáxi"]'),
        `pedido: ${status}`,
      ).toBeNull();
    }
  },
);
it.each(["pago", "pago_apos_expirar"] as const)(
  "despacha online confirmado em %s sem cobrar novamente",
  async (paymentStatus) => {
    await abrir({ ...pedido, paymentMethod: "online", paymentStatus });
    const { navegar } = await clicarParaEnviar();
    const mensagem = new URL(navegar.mock.calls[0][0]).searchParams.get("text");
    expect(mensagem).toContain("Já pago — não cobrar");
    expect(mensagem).not.toContain("Cobrar na entrega");
  },
);
it.each(["cash", "pix", "card"] as const)(
  "mantém despacho com cobrança na entrega em %s",
  async (paymentMethod) => {
    await abrir({ ...pedido, paymentMethod, paymentStatus: null });
    const { navegar } = await clicarParaEnviar();
    expect(
      new URL(navegar.mock.calls[0][0]).searchParams.get("text"),
    ).toContain("Cobrar na entrega");
  },
);
it.each(["store-pickup", "sedex", undefined, "LOCAL-DELIVERY"])(
  "não mostra para %s",
  async (id) => {
    await abrir({ ...pedido, shippingOptionId: id });
    expect(host.textContent).not.toContain("Enviar ao mototáxi");
    expect(host.textContent).not.toContain(
      "Não consegui ler o número do mototáxi agora.",
    );
    expect(host.textContent).not.toContain("Tentar de novo");
  },
);
async function abrirMototaxi(order = pedido) {
  const { EnviarAoMototaxi } = await import(
    "@/components/admin/orders/EnviarAoMototaxi"
  );
  await act(async () => {
    root.render(<EnviarAoMototaxi order={order} loja="Loja fictícia" />);
  });
}
// Intercepta a navegação nativa do link antigo e a da aba reservada pelo botão.
async function clicarParaEnviar() {
  const comando = host.querySelector<HTMLElement>(
    '[aria-label="Enviar ao mototáxi"]',
  );
  expect(comando).not.toBeNull();
  const navegar = vi.fn();
  const fechar = vi.fn();
  const link = document.createElement("a");
  vi.spyOn(link, "click").mockImplementation(() => navegar(link.href));
  const aba = {
    opener: window,
    closed: false,
    close: fechar,
    document: { createElement: () => link, body: { append: vi.fn() } },
  };
  const abrirAba = vi
    .spyOn(window, "open")
    .mockReturnValue(aba as unknown as Window);
  const interceptar = (evento: MouseEvent) => {
    if (
      evento.target === comando &&
      comando instanceof HTMLAnchorElement &&
      !evento.defaultPrevented
    ) {
      evento.preventDefault();
      navegar(comando.href);
    }
  };
  document.addEventListener("click", interceptar);
  try {
    await act(async () => comando!.click());
    return { navegar, fechar, aba, link };
  } finally {
    document.removeEventListener("click", interceptar);
    abrirAba.mockRestore();
  }
}

it("consulta o número novo no clique, sem usar o que a ficha mostrou ao abrir", async () => {
  await abrirMototaxi();
  estado.numero = "5534987654321";
  const { navegar } = await clicarParaEnviar();
  expect(navegar).toHaveBeenCalledTimes(1);
  expect(new URL(navegar.mock.calls[0][0]).pathname).toBe("/5534987654321");
});

it.each([
  {
    caso: "contato apagado",
    numero: null,
    erroLeitura: false,
    aviso: "O mototáxi está sem um número cadastrado.",
  },
  {
    caso: "falha da rede",
    numero: "5511987654321",
    erroLeitura: true,
    aviso: "Não consegui consultar o número do mototáxi. Tente de novo.",
  },
])(
  "não envia a mensagem em caso de $caso",
  async ({ numero, erroLeitura, aviso }) => {
    await abrirMototaxi();
    estado.numero = numero;
    estado.erroLeitura = erroLeitura;
    const { navegar, fechar } = await clicarParaEnviar();
    expect(navegar).not.toHaveBeenCalled();
    expect(fechar).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(aviso);
  },
);

it("leitura pendurada avisa depois do prazo e permite reler o contato", async () => {
  vi.useFakeTimers();
  estado.leituraPendurada = true;
  await abrirMototaxi();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Não consegui ler o número do mototáxi agora.",
  );
  const tentar = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Tentar de novo",
  );
  expect(tentar).toBeDefined();
  estado.leituraPendurada = false;
  await act(async () => tentar!.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="Enviar ao mototáxi"]'),
  ).not.toBeNull();
});

it("avisa quando a leitura falha e relê o contato ao tentar de novo", async () => {
  estado.erroLeitura = true;
  await abrirMototaxi();
  expect(host.textContent).toContain(
    "Não consegui ler o número do mototáxi agora.",
  );
  expect(host.querySelector('[aria-label="Enviar ao mototáxi"]')).toBeNull();
  const tentar = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Tentar de novo",
  );
  expect(tentar).toBeDefined();
  expect(tentar!.classList.contains("min-h-11")).toBe(true);
  estado.erroLeitura = false;
  await act(async () => tentar!.click());
  expect(host.textContent).not.toContain(
    "Não consegui ler o número do mototáxi agora.",
  );
  expect(host.textContent).not.toContain("Tentar de novo");
  expect(
    host.querySelector('[aria-label="Enviar ao mototáxi"]'),
  ).not.toBeNull();
});
it.each(["store-pickup", "sedex", undefined])(
  "não oferece nova tentativa fora de entrega local: %s",
  async (shippingOptionId) => {
    estado.erroLeitura = true;
    await abrirMototaxi({ ...pedido, shippingOptionId });
    expect(host.textContent).not.toContain(
      "Não consegui ler o número do mototáxi agora.",
    );
    expect(host.textContent).not.toContain("Tentar de novo");
    expect(host.querySelector('[aria-label="Enviar ao mototáxi"]')).toBeNull();
  },
);
it("nova leitura sem número cadastrado esconde o aviso e o despacho", async () => {
  estado.erroLeitura = true;
  await abrirMototaxi();
  const tentar = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Tentar de novo",
  );
  expect(tentar).toBeDefined();
  estado.erroLeitura = false;
  estado.numero = null;
  await act(async () => tentar!.click());
  expect(host.textContent).not.toContain(
    "Não consegui ler o número do mototáxi agora.",
  );
  expect(host.textContent).not.toContain("Tentar de novo");
  expect(host.querySelector('[aria-label="Enviar ao mototáxi"]')).toBeNull();
});
it.each([null, "", "12345", "351912345678"])(
  "não mostra sem número BR válido: %s",
  async (numero) => {
    estado.numero = numero;
    await abrir();
    expect(host.textContent).not.toContain("Enviar ao mototáxi");
    expect(host.textContent).not.toContain(
      "Não consegui ler o número do mototáxi agora.",
    );
    expect(host.textContent).not.toContain("Tentar de novo");
  },
);
