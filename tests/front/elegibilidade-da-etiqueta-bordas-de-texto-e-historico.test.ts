// Bordas da decisão "este pedido gera etiqueta de envio?" que o teste da tabela
// de decisão (elegibilidade-da-etiqueta.test.ts) não prendia — achadas trocando
// o código por versões erradas e vendo a suíte seguir verde:
//   - status de pagamento em maiúscula ainda é pagamento confirmado;
//   - o id do serviço do Melhor Envio tem de ser o texto INTEIRO
//     ("melhor-envio-1x" não é o serviço 1);
//   - CPF só com espaços é "sem CPF" (não "CPF inválido");
//   - os três textos de "status morto" são exatos (a ficha traduz a recusa da
//     edge com eles);
//   - etiqueta "conferindo" ignora link só com espaços;
//   - o aviso de cancelamento com etiqueta paga não vale para compra já cancelada;
//   - etiqueta cancelada no provedor NÃO volta a valer por evento que chega depois,
//     e as duas grafias (canceled/cancelled) contam.
import {
  type PedidoParaEtiqueta,
  deveAvisarCancelamentoComEtiquetaPaga,
  elegibilidadeDaEtiqueta,
  motivoDoStatusSemEtiqueta,
  situacaoDaCompraPeloHistorico,
} from "@/lib/elegibilidade-da-etiqueta";
import { describe, expect, it } from "vitest";

function pedido(over: Partial<PedidoParaEtiqueta> = {}): PedidoParaEtiqueta {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    status: "processing",
    payment_status: "pago",
    shipping: 24.9,
    shipping_cost: null,
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    notes: null,
    shipping_option_id: "melhor-envio-3",
    // CPF de teste válido (o mesmo do teste da tabela de decisão).
    cpf: "52998224725",
    ...over,
  };
}

describe("elegibilidadeDaEtiqueta — bordas de texto", () => {
  it.each(["PAGO", "Recebido_Na_Entrega", "Pago_Apos_Expirar"])(
    "payment_status '%s' em outra caixa ainda é pagamento confirmado",
    (payment_status) => {
      expect(elegibilidadeDaEtiqueta(pedido({ payment_status })).estado).toBe(
        "disponivel",
      );
    },
  );

  it.each(["melhor-envio-1x", "melhor-envio-3-extra", "x-melhor-envio-3"])(
    "id de serviço '%s' não é um serviço do Melhor Envio (o texto tem de casar inteiro)",
    (shipping_option_id) => {
      const r = elegibilidadeDaEtiqueta(pedido({ shipping_option_id }));
      expect(r.estado).toBe("indisponivel");
      expect(r).toMatchObject({
        motivo: expect.stringContaining("não registrou um serviço"),
      });
    },
  );

  it("o sufixo -ss do serviço continua valendo", () => {
    expect(
      elegibilidadeDaEtiqueta(
        pedido({ shipping_option_id: "melhor-envio-3-ss" }),
      ).estado,
    ).toBe("disponivel");
  });

  it("CPF só com espaços é 'sem CPF' (cpfInvalido false), não 'CPF inválido'", () => {
    expect(elegibilidadeDaEtiqueta(pedido({ cpf: "   " }))).toMatchObject({
      estado: "precisa_cpf",
      cpfInvalido: false,
    });
    expect(
      elegibilidadeDaEtiqueta(pedido({ cpf: "123.456.789-00" })),
    ).toMatchObject({ estado: "precisa_cpf", cpfInvalido: true });
  });

  it("os três textos de status morto são exatos", () => {
    expect(motivoDoStatusSemEtiqueta("cancelled")).toBe(
      "Pedido cancelado — não gera etiqueta.",
    );
    expect(motivoDoStatusSemEtiqueta("delivered")).toBe(
      "Pedido já entregue — não gera etiqueta.",
    );
    expect(motivoDoStatusSemEtiqueta("returned")).toBe(
      "Pedido devolvido — não gera etiqueta.",
    );
    expect(motivoDoStatusSemEtiqueta("DELIVERED")).toBe(
      "Pedido já entregue — não gera etiqueta.",
    );
    expect(motivoDoStatusSemEtiqueta("processing")).toBeNull();
    expect(motivoDoStatusSemEtiqueta(null)).toBeNull();
  });

  it("compra indeterminada com link só de espaços e sem rastreio segue 'conferindo'", () => {
    expect(
      elegibilidadeDaEtiqueta(
        pedido({
          shipping_label_id: "abc123",
          situacao_da_compra: "indeterminada",
          shipping_label_url: "   ",
          tracking_code: "",
        }),
      ),
    ).toEqual({ estado: "conferindo" });
    // Controle: com link de verdade, é emitida.
    expect(
      elegibilidadeDaEtiqueta(
        pedido({
          shipping_label_id: "abc123",
          situacao_da_compra: "indeterminada",
          shipping_label_url: "https://exemplo.test/etiqueta.pdf",
        }),
      ),
    ).toEqual({ estado: "emitida" });
  });
});

describe("deveAvisarCancelamentoComEtiquetaPaga — compra já cancelada não assusta", () => {
  const base = {
    status: "cancelled",
    shipping_label_id: "abc123",
    shipping_label_url: "https://exemplo.test/etiqueta.pdf",
  } satisfies Partial<PedidoParaEtiqueta>;

  it("com link da etiqueta e compra viva, avisa", () => {
    expect(deveAvisarCancelamentoComEtiquetaPaga(pedido(base))).toBe(true);
  });

  it("se a compra da etiqueta já foi cancelada no provedor, não avisa", () => {
    expect(
      deveAvisarCancelamentoComEtiquetaPaga(
        pedido({ ...base, situacao_da_compra: "cancelada" }),
      ),
    ).toBe(false);
  });
});

describe("situacaoDaCompraPeloHistorico — cancelada é definitiva", () => {
  const ID = "etq-1";
  const cancelamento = (status_etiqueta: string, created_at: string) => ({
    event_type: "rastreio_consultado",
    created_at,
    payload: { label_id: ID, status_etiqueta },
  });
  const geracao = (created_at: string) => ({
    event_type: "etiqueta_gerada",
    created_at,
    payload: { label_id: ID },
  });

  it.each(["canceled", "cancelled", " CANCELED "])(
    "status '%s' no provedor cancela a compra, nas duas grafias",
    (status) => {
      expect(
        situacaoDaCompraPeloHistorico(
          [
            geracao("2026-08-01T10:00:00Z"),
            cancelamento(status, "2026-08-01T11:00:00Z"),
          ],
          ID,
        ),
      ).toBe("cancelada");
    },
  );

  it("um evento de geração que chega DEPOIS não ressuscita a etiqueta cancelada", () => {
    expect(
      situacaoDaCompraPeloHistorico(
        [
          geracao("2026-08-01T10:00:00Z"),
          cancelamento("canceled", "2026-08-01T11:00:00Z"),
          geracao("2026-08-01T12:00:00Z"),
        ],
        ID,
      ),
    ).toBe("cancelada");
  });

  it("evento de outra etiqueta não interfere", () => {
    expect(
      situacaoDaCompraPeloHistorico(
        [
          geracao("2026-08-01T10:00:00Z"),
          {
            event_type: "rastreio_consultado",
            created_at: "2026-08-01T11:00:00Z",
            payload: { label_id: "outra", status_etiqueta: "canceled" },
          },
        ],
        ID,
      ),
    ).toBe("confirmada");
  });

  it("histórico que não é lista, ou vazio, não prova nada", () => {
    expect(situacaoDaCompraPeloHistorico(null, ID)).toBe("sem_prova");
    expect(situacaoDaCompraPeloHistorico([], ID)).toBe("sem_prova");
  });
});
