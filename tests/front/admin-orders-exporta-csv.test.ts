import {
  PaymentStatusBadge,
  rotuloDoPagamento,
} from "@/components/admin/orders/OrderStatusBadge";
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { PaymentStatus, Order as Pedido } from "@/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const CABECALHO =
  "Número do pedido;Data;Cliente;Telefone;Status;Forma de pagamento;Status do pagamento;Total;Cidade;UF;Itens;Subtotal;Frete;Desconto;Canal;Entrega";

const CABECALHO_COM_ESTORNO = `${CABECALHO};Estorno pelo Mercado Pago;Total menos estorno do Mercado Pago`;
const CRLF = "\r\n";

function pedido(alteracoes: Partial<Pedido> = {}): Pedido {
  return {
    id: "pedido-abc123",
    customer: {
      name: "João Silva",
      whatsapp: "11987654321",
      city: "São Paulo",
      state: "SP",
    },
    items: [],
    subtotal: 1234.5,
    shipping: 0,
    discount: 0,
    total: 1234.5,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus: "aguardando",
    createdAt: "2026-09-08T12:07:00Z",
    updatedAt: "2026-09-08T12:07:00Z",
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

describe("pedidosParaCsv", () => {
  it.each([
    ["parcial", 100, 30, "100,00", "30,00", "70,00"],
    ["nenhum confirmado", 100, 0, "100,00", "0,00", "100,00"],
    ["integral", 100, 100, "100,00", "100,00", "0,00"],
    ["maior que o pedido", 100, 130, "100,00", "100,00", "0,00"],
    ["com centavos", 100.23, 30.09, "100,23", "30,09", "70,14"],
    [
      "arredondado antes da subtração",
      100.006,
      30.004,
      "100,01",
      "30,00",
      "70,01",
    ],
    ["desconhecido", 100, undefined, "100,00", "", ""],
    ["ilegível", 100, Number.NaN, "100,00", "", ""],
    ["negativo", 100, -5, "100,00", "", ""],
  ])(
    "exporta o estorno %s sem mudar o Total original",
    (_, total, valorEstornado, totalOriginal, estorno, restante) => {
      const colunas = pedidosParaCsv([
        pedido({ total, valorEstornado, paymentStatus: "pago" }),
      ])
        .split(CRLF)[1]
        .split(";");

      expect(colunas[7]).toBe(totalOriginal);
      expect(colunas.slice(16)).toEqual([estorno, restante]);
    },
  );

  it.each([0, undefined])(
    "não informa valores de estorno para pagamento estornado com acumulado %s",
    (valorEstornado) => {
      const colunas = pedidosParaCsv([
        pedido({
          total: 37.27,
          paymentMethod: "online",
          paymentStatus: "estornado",
          status: "delivered",
          valorEstornado,
        }),
      ])
        .split(CRLF)[1]
        .split(";");

      expect(colunas[7]).toBe("37,27");
      expect(colunas.slice(16)).toEqual(["", ""]);
    },
  );

  it("exporta o valor confirmado mesmo quando o pagamento está estornado", () => {
    const colunas = pedidosParaCsv([
      pedido({ total: 100, valorEstornado: 100, paymentStatus: "estornado" }),
    ])
      .split(CRLF)[1]
      .split(";");

    expect(colunas.slice(16)).toEqual(["100,00", "0,00"]);
  });

  it("não usa o relógio local de um aparelho em UTC", () => {
    vi.spyOn(Date.prototype, "getDate").mockImplementation(function (
      this: Date,
    ) {
      return this.getUTCDate();
    });
    vi.spyOn(Date.prototype, "getMonth").mockImplementation(function (
      this: Date,
    ) {
      return this.getUTCMonth();
    });
    vi.spyOn(Date.prototype, "getFullYear").mockImplementation(function (
      this: Date,
    ) {
      return this.getUTCFullYear();
    });
    vi.spyOn(Date.prototype, "getHours").mockImplementation(function (
      this: Date,
    ) {
      return this.getUTCHours();
    });
    vi.spyOn(Date.prototype, "getMinutes").mockImplementation(function (
      this: Date,
    ) {
      return this.getUTCMinutes();
    });
    try {
      expect(
        pedidosParaCsv([pedido({ createdAt: "2026-11-02T02:50:00Z" })])
          .split(CRLF)[1]
          .split(";")[1],
      ).toBe("01/11/2026 23:50");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each([
    ["2026-11-02T02:50:00Z", "01/11/2026 23:50"],
    ["2026-11-01T03:30:00Z", "01/11/2026 00:30"],
    ["2026-11-01T03:00:00Z", "01/11/2026 00:00"],
  ])(
    "exporta %s no calendário de Brasília, não no do aparelho",
    (createdAt, esperado) => {
      expect(
        pedidosParaCsv([pedido({ createdAt })])
          .split(CRLF)[1]
          .split(";")[1],
      ).toBe(esperado);
    },
  );

  it("data ilegível deixa só a coluna vazia e a planilha sai inteira", () => {
    const linhas = pedidosParaCsv([
      pedido({ createdAt: "não é data" }),
      pedido({ createdAt: "2026-11-02T02:50:00Z" }),
    ]).split(CRLF);
    expect(linhas[1].split(";")[1]).toBe("");
    expect(linhas[2].split(";")[1]).toBe("01/11/2026 23:50");
  });

  it("exporta itens e valores históricos distintos sem recalcular o pedido", () => {
    const original = pedido({
      items: [
        {
          productId: "produto-1",
          name: 'Café; "Seleção"\n250 g',
          quantity: 2,
          price: 12.34,
          image: "",
        },
        {
          productId: "produto-1",
          name: "Chá de maçã",
          quantity: 1,
          price: 5.6,
          image: "",
        },
      ],
      subtotal: 123.45,
      shipping: 16.7,
      discount: 8.9,
      total: 131.25,
    });
    const antes = structuredClone(original);
    const csv = pedidosParaCsv([original]);
    expect(csv.split(CRLF)[0]).toBe(`\uFEFF${CABECALHO_COM_ESTORNO}`);
    expect(csv).toContain(
      ';131,25;São Paulo;SP;"Café; ""Seleção""\n250 g (2 x 12,34) | Chá de maçã (1 x 5,60)";123,45;16,70;8,90',
    );
    expect(original).toEqual(antes);
    expect(pedidosParaCsv([original])).toBe(csv);
  });

  it("exporta itens vazios e valores zero registrados sem inventar itens", () => {
    expect(
      pedidosParaCsv([
        pedido({ items: [], subtotal: 0, shipping: 0, discount: 0, total: 0 }),
      ]),
    ).toContain(";0,00;São Paulo;SP;;0,00;0,00;0,00");
  });

  it.each([
    ["=1+1", "'=1+1 (1 x 2,50)"],
    ["+1+1", "'+1+1 (1 x 2,50)"],
    ["-1+1", "'-1+1 (1 x 2,50)"],
    ["@SUM(1)", "'@SUM(1) (1 x 2,50)"],
    ["  =1+1", "'  =1+1 (1 x 2,50)"],
    ["\t=1+1", "'\t=1+1 (1 x 2,50)"],
    ["\r=1+1", '"\'\r=1+1 (1 x 2,50)"'],
    ["\n=1+1", '"\'\n=1+1 (1 x 2,50)"'],
  ])("neutraliza fórmula na coluna de itens: %j", (name, esperado) => {
    expect(
      pedidosParaCsv([
        pedido({
          items: [
            {
              productId: "produto-1",
              name,
              quantity: 1,
              price: 2.5,
              image: "",
            },
          ],
        }),
      ]),
    ).toContain(`;SP;${esperado};1234,50;0,00;0,00`);
  });

  it("gera BOM UTF-8, colunas na ordem contratada, ponto e vírgula e CRLF", () => {
    const csv = pedidosParaCsv([pedido()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // O fixture `pedido()` não declara `canal`, e pedido
    // sem canal é tratado como online (lote C4 — C4.1/C4.3); sem retirada nem
    // entrega local declaradas, a coluna Entrega é "Envio".
    expect(csv).toBe(
      `\uFEFF${CABECALHO_COM_ESTORNO}\r\n#ABC123;08/09/2026 09:07;João Silva;11987654321;Novo Pedido;PIX Instantâneo;Aguardando pagamento;1234,50;São Paulo;SP;;1234,50;0,00;0,00;Site;Envio;;`,
    );
  });

  it("lista vazia devolve somente BOM e cabeçalho", () => {
    expect(pedidosParaCsv([])).toBe(`\uFEFF${CABECALHO_COM_ESTORNO}`);
  });

  it.each([
    ["Ana; Maria", '"Ana; Maria"'],
    ['Ana "Maria"', '"Ana ""Maria"""'],
    ["Ana\nMaria", '"Ana\nMaria"'],
    ["Ana\rMaria", '"Ana\rMaria"'],
    ["Ana\r\nMaria", '"Ana\r\nMaria"'],
  ])("escapa o campo %j sem mudar seu conteúdo", (name, escapado) => {
    const original = pedido();
    const csv = pedidosParaCsv([
      pedido({ customer: { ...original.customer, name } }),
    ]);
    expect(csv).toContain(`;${escapado};11987654321;`);
  });

  it.each([0, 1.2, 9999.99])(
    "total %s tem duas casas, sem símbolo ou milhar",
    (total) => {
      expect(pedidosParaCsv([pedido({ total })])).toContain(
        `;${total.toFixed(2).replace(".", ",")};São Paulo;SP`,
      );
    },
  );

  it("preserva ordem, duplicados e os objetos recebidos ao exportar novamente", () => {
    const pedidos = [
      pedido({ id: "pedido-000002" }),
      pedido({ id: "pedido-000001" }),
      pedido({ id: "pedido-000002" }),
    ];
    const antes = structuredClone(pedidos);
    const csv = pedidosParaCsv(pedidos);
    expect(
      csv
        .split("\r\n")
        .slice(1)
        .map((linha) => linha.split(";")[0]),
    ).toEqual(["#000002", "#000001", "#000002"]);
    expect(pedidos).toEqual(antes);
    expect(pedidosParaCsv(pedidos)).toBe(csv);
  });

  it("campos opcionais ausentes ficam vazios e pagamento nulo usa o rótulo da tela", () => {
    expect(
      pedidosParaCsv([
        pedido({
          customer: { name: "Ana", whatsapp: "" },
          paymentStatus: null,
          paymentMethod: "online",
        }),
      ]),
    ).toContain(
      ";Ana;;Novo Pedido;Pagamento pelo site;Sem cobrança online;1234,50;;",
    );
  });

  // D4: a coluna "Forma de pagamento" usa a fonte única
  // (`src/lib/forma-de-pagamento.ts`) — a mesma da lista de pedidos. Só o
  // TEXTO muda; as demais colunas, o filtro e o valor gravado não.
  describe("coluna Forma de pagamento (D4)", () => {
    const formaDe = (alteracoes: Partial<Pedido>) =>
      pedidosParaCsv([pedido(alteracoes)])
        .split(CRLF)[1]
        .split(";")[5];

    it("cartão deixa de ser 'Crédito Seguro': no site é 'na entrega', no balcão é 'na maquininha'", () => {
      expect(formaDe({ paymentMethod: "card" })).toBe("Cartão na entrega");
      expect(formaDe({ paymentMethod: "card", canal: "online" })).toBe(
        "Cartão na entrega",
      );
      expect(formaDe({ paymentMethod: "card", canal: "presencial" })).toBe(
        "Cartão na maquininha",
      );
    });

    it("pago pelo app deixa de ser 'Outro': diz que foi pelo site", () => {
      expect(formaDe({ paymentMethod: "online" })).toBe("Pagamento pelo site");
    });

    it("PIX e dinheiro seguem com o texto de antes (não-regressão)", () => {
      expect(formaDe({ paymentMethod: "pix" })).toBe("PIX Instantâneo");
      expect(formaDe({ paymentMethod: "cash" })).toBe("Dinheiro");
      expect(formaDe({ paymentMethod: "cash", canal: "presencial" })).toBe(
        "Dinheiro",
      );
    });

    it("forma que o app não conhece continua 'Outro'", () => {
      expect(
        formaDe({
          paymentMethod: "boleto" as unknown as Pedido["paymentMethod"],
        }),
      ).toBe("Outro");
    });

    it("a forma de pagamento não desloca a coluna Canal", () => {
      const colunas = pedidosParaCsv([
        pedido({ paymentMethod: "card", canal: "presencial" }),
      ])
        .split(CRLF)[1]
        .split(";");
      expect(colunas).toHaveLength(18);
      expect(colunas[14]).toBe("Balcão");
    });
  });

  it.each([
    "=1+1",
    "+1+1",
    "-1+1",
    "@SUM(1)",
    "  =1+1",
    "\t=1+1",
    "\r=1+1",
    "\n=1+1",
  ])("neutraliza fórmula em Cidade e UF: %j", (valor) => {
    const csv = pedidosParaCsv([
      pedido({
        customer: {
          name: "Cliente de teste",
          whatsapp: "11999999999",
          city: valor,
          state: valor,
        },
      }),
    ]);
    const protegido = `'${valor}`;
    const esperado = /[\r\n]/.test(protegido) ? `"${protegido}"` : protegido;
    expect(csv).toContain(`;1234,50;${esperado};${esperado};;`);
  });

  it.each([
    "=1+1",
    "+1+1",
    "-1+1",
    "@SUM(1)",
    "  =1+1",
    "\t=1+1",
    "\r=1+1",
    "\n=1+1",
  ])("neutraliza fórmula em texto de cliente: %j", (name) => {
    const csv = pedidosParaCsv([
      pedido({ customer: { name, whatsapp: "+5511987654321" } }),
    ]);
    const protegido = `'${name}`;
    const esperado = /[\r\n]/.test(protegido) ? `"${protegido}"` : protegido;
    expect(csv).toContain(`;${esperado};'+5511987654321;`);
  });
});

describe("rótulo do badge permanece igual ao extrair a regra para o CSV", () => {
  it.each([
    ["pago", "Pago e cancelado — precisa de atenção"],
    ["recebido_na_entrega", "Pago e cancelado — precisa de atenção"],
    ["aguardando", "Cancelado — sem pagamento"],
  ] as const)("%s com pedido cancelado", (paymentStatus, label) => {
    const html = renderToStaticMarkup(
      createElement(PaymentStatusBadge, {
        paymentStatus: paymentStatus as PaymentStatus,
        orderStatus: "cancelled",
      }),
    );
    expect(html).toContain(`>${label}</span>`);
    expect(rotuloDoPagamento(paymentStatus, "cancelled")).toBe(label);
    expect(
      pedidosParaCsv([pedido({ paymentStatus, status: "cancelled" })]),
    ).toContain(`;${label};1234,50;`);
  });

  it.each(["pago", "recebido_na_entrega"] as const)(
    "%s mantém rótulo curto, título completo e alerta no badge compacto",
    (paymentStatus) => {
      const html = renderToStaticMarkup(
        createElement(PaymentStatusBadge, {
          paymentStatus,
          orderStatus: "cancelled",
          compact: true,
        }),
      );
      expect(html).toContain('title="Pago e cancelado — precisa de atenção"');
      expect(html).toContain(">Pago e cancelado</span>");
      expect(html).toContain("animate-pulse ring-1 ring-red-500/60");
    },
  );
});
