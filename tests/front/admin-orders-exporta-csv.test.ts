import {
  PaymentStatusBadge,
  rotuloDoPagamento,
} from "@/components/admin/orders/OrderStatusBadge";
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { PaymentStatus, Order as Pedido } from "@/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const CABECALHO =
  "Número do pedido;Data;Cliente;Telefone;Status;Forma de pagamento;Status do pagamento;Total;Cidade;UF";

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
    createdAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    updatedAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

describe("pedidosParaCsv", () => {
  it("gera BOM UTF-8, colunas na ordem contratada, ponto e vírgula e CRLF", () => {
    const csv = pedidosParaCsv([pedido()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(
      `\uFEFF${CABECALHO}\r\n#ABC123;08/09/2026 09:07;João Silva;11987654321;Novo Pedido;PIX Instantâneo;Aguardando pagamento;1234,50;São Paulo;SP`,
    );
  });

  it("lista vazia devolve somente BOM e cabeçalho", () => {
    expect(pedidosParaCsv([])).toBe(`\uFEFF${CABECALHO}`);
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
    ).toContain(";Ana;;Novo Pedido;Outro;Sem cobrança online;1234,50;;");
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
    ["aguardando", "Aguardando pagamento"],
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
