// Tabela de decisão de `elegibilidadeDaEtiqueta` — a MESMA régua que morava
// espalhada no EtiquetasEnvioCard (rotuloEtiquetaPedido e os `disabled` do
// botão "Gerar etiqueta") virou função pura, testável sem montar componente
// nenhum. Cobre cada ramo e a ORDEM entre eles (achado ANOTADO: a ordem é a
// própria regra de negócio — já etiquetado vence cancelado, pagamento vence
// serviço, etc.).
import {
  type PedidoParaEtiqueta,
  elegibilidadeDaEtiqueta,
  freteEfetivoDoPedido,
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
    ...over,
  };
}

describe("elegibilidadeDaEtiqueta", () => {
  it("já etiquetado vence QUALQUER outro motivo — inclusive cancelado depois", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ shipping_label_id: "abc123", status: "cancelled" }),
    );
    expect(r).toEqual({ estado: "emitida" });
  });

  it("cancelado sem etiqueta: indisponível, motivo específico de cancelamento", () => {
    const r = elegibilidadeDaEtiqueta(pedido({ status: "cancelled" }));
    expect(r.estado).toBe("indisponivel");
    expect(r).toMatchObject({ motivo: expect.stringContaining("cancelado") });
  });

  it("entregue sem etiqueta: indisponível, motivo específico de entrega", () => {
    const r = elegibilidadeDaEtiqueta(pedido({ status: "delivered" }));
    expect(r.estado).toBe("indisponivel");
    expect(r).toMatchObject({ motivo: expect.stringContaining("entregue") });
  });

  it("devolvido sem etiqueta: indisponível, motivo específico de devolução", () => {
    const r = elegibilidadeDaEtiqueta(pedido({ status: "returned" }));
    expect(r.estado).toBe("indisponivel");
    expect(r).toMatchObject({ motivo: expect.stringContaining("devolvido") });
  });

  it("não pago + superfrete: o motivo é de PAGAMENTO, não de superfrete (pagamento vence serviço)", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({
        payment_status: "aguardando",
        shipping_option_id: "superfrete-1",
      }),
    );
    expect(r.estado).toBe("indisponivel");
    expect(r).toMatchObject({
      motivo: expect.stringMatching(/pagamento confirmado|saldo real/i),
    });
  });

  it.each(["aguardando", "recusado", "expirado", "estornado", null])(
    "payment_status %s recusa (falha fechado)",
    (paymentStatus) => {
      const r = elegibilidadeDaEtiqueta(
        pedido({ payment_status: paymentStatus as string | null }),
      );
      expect(r.estado).toBe("indisponivel");
    },
  );

  it.each(["pago", "pago_apos_expirar", "recebido_na_entrega"])(
    "payment_status %s libera a etiqueta",
    (paymentStatus) => {
      const r = elegibilidadeDaEtiqueta(
        pedido({ payment_status: paymentStatus }),
      );
      expect(r.estado).toBe("disponivel");
    },
  );

  it("retirada na loja: indisponível, nunca 'sem serviço do ME'", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ shipping_option_id: "store-pickup" }),
    );
    expect(r.estado).toBe("indisponivel");
    expect(r).toMatchObject({ motivo: expect.stringContaining("retirada") });
  });

  it("entrega local: indisponível, quem despacha é a loja", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ shipping_option_id: "local-delivery" }),
    );
    expect(r.estado).toBe("indisponivel");
    expect(r).toMatchObject({ motivo: expect.stringContaining("loja") });
  });

  it("SuperFrete com id conhecido (superfrete-17 = Mini Envios): motivo nomeia o serviço", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ shipping_option_id: "superfrete-17" }),
    );
    expect(r.estado).toBe("indisponivel");
    expect(r).toMatchObject({
      motivo: expect.stringContaining("Mini Envios"),
    });
    expect((r as { motivo: string }).motivo).toContain("SuperFrete");
  });

  it.each([
    ["superfrete-1", "PAC"],
    ["superfrete-2", "SEDEX"],
    ["superfrete-3", "Jadlog"],
    ["superfrete-17", "Mini Envios"],
  ])(
    "SERVICO_DA_SUPERFRETE: %s nomeia %s (tabela inteira — herdado de etiquetas-superfrete-diz-o-servico.test.tsx)",
    (opcao, servicoEsperado) => {
      const r = elegibilidadeDaEtiqueta(pedido({ shipping_option_id: opcao }));
      expect(r).toMatchObject({
        motivo: expect.stringContaining(servicoEsperado),
      });
    },
  );

  it("SuperFrete: o id validado vence texto livre da nota (achado 4 herdado)", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({
        shipping_option_id: "superfrete-1",
        notes:
          "Frete Escolhido: Correios — SEDEX (Prazo: 1 dias); Frete Escolhido: Entrega econômica (Prazo: 6 dias)",
      }),
    );
    expect(r).toMatchObject({ motivo: expect.stringContaining("PAC") });
    expect((r as { motivo: string }).motivo).not.toMatch(/SEDEX/);
  });

  it("SuperFrete com id desconhecido e sem nota: motivo sem nome de serviço", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ shipping_option_id: "superfrete-31" }),
    );
    expect(r).toMatchObject({
      motivo:
        "Frete cotado e cobrado pela SuperFrete — gere a etiqueta no site da SuperFrete.",
    });
  });

  it("Frenet sem nota: usa o código cru", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ shipping_option_id: "frenet-EXP01" }),
    );
    expect(r).toMatchObject({ motivo: expect.stringContaining("EXP01") });
    expect((r as { motivo: string }).motivo).toContain("Frenet");
  });

  it("Frenet com nota do checkout: usa o nome 'Transportadora — Serviço'", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({
        shipping_option_id: "frenet-EXP01",
        notes: "Frete Escolhido: Jamef — Rodoviário (Prazo: 5 dias)",
      }),
    );
    expect(r).toMatchObject({
      motivo: expect.stringContaining("Jamef — Rodoviário"),
    });
  });

  it("nota com duas 'Frete Escolhido' usa a ÚLTIMA ocorrência (checkout sempre acrescenta no fim)", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({
        shipping_option_id: "frenet-31",
        notes:
          "Frete Escolhido: nota antiga de outro pedido (Prazo: 9 dias); Frete Escolhido: Loggi Ponto (Prazo: 3 dias)",
      }),
    );
    expect(r).toMatchObject({
      motivo: expect.stringContaining("Loggi Ponto"),
    });
    expect((r as { motivo: string }).motivo).not.toContain("nota antiga");
  });

  it.each([null, "flat-fee-nacional", "algo-desconhecido"])(
    "sem serviço do Melhor Envio (%s): indisponível, sem inventar transportadora",
    (opcao) => {
      const r = elegibilidadeDaEtiqueta(
        pedido({ shipping_option_id: opcao as string | null }),
      );
      expect(r.estado).toBe("indisponivel");
      expect(r).toMatchObject({
        motivo: expect.stringContaining("Melhor Envio"),
      });
    },
  );

  it.each(["12", "15", "16", "22"])(
    "melhor-envio-%s exige agência de coleta — indisponível",
    (id) => {
      const r = elegibilidadeDaEtiqueta(
        pedido({ shipping_option_id: `melhor-envio-${id}` }),
      );
      expect(r.estado).toBe("indisponivel");
      expect(r).toMatchObject({
        motivo: expect.stringContaining("agência de coleta"),
      });
    },
  );

  it("melhor-envio-31-ss (sufixo sem seguro) ainda é reconhecido como opção do ME — disponível", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ shipping_option_id: "melhor-envio-31-ss" }),
    );
    expect(r.estado).toBe("disponivel");
  });

  it("id do ME sem agência e pago: disponível, com o nome do serviço da nota", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({
        shipping_option_id: "melhor-envio-3",
        notes: "Frete Escolhido: Correios — SEDEX (Prazo: 2 dias)",
      }),
    );
    expect(r).toEqual({ estado: "disponivel", servico: "Correios — SEDEX" });
  });

  it("id do ME sem nota: disponível, com rótulo de fallback 'Melhor Envio (serviço N)'", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ shipping_option_id: "melhor-envio-3", notes: null }),
    );
    expect(r).toEqual({
      estado: "disponivel",
      servico: "Melhor Envio (serviço 3)",
    });
  });
});

describe("freteEfetivoDoPedido", () => {
  it("usa shipping quando positivo", () => {
    expect(freteEfetivoDoPedido({ shipping: 24.9, shipping_cost: 10 })).toBe(
      24.9,
    );
  });

  it("cai para shipping_cost quando shipping é 0 (pedido antigo, RPC anterior à v23)", () => {
    expect(freteEfetivoDoPedido({ shipping: 0, shipping_cost: 18.5 })).toBe(
      18.5,
    );
  });

  it("shipping_cost ausente e shipping 0: devolve 0, não NaN", () => {
    expect(freteEfetivoDoPedido({ shipping: 0, shipping_cost: null })).toBe(0);
  });
});
