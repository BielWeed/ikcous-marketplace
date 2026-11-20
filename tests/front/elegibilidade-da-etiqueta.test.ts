// Tabela de decisão de `elegibilidadeDaEtiqueta` — a MESMA régua que morava
// espalhada no EtiquetasEnvioCard (rotuloEtiquetaPedido e os `disabled` do
// botão "Gerar etiqueta") virou função pura, testável sem montar componente
// nenhum. Cobre cada ramo e a ORDEM entre eles (achado ANOTADO: a ordem é a
// própria regra de negócio — já etiquetado vence cancelado, pagamento vence
// serviço, etc.).
import {
  type PedidoParaEtiqueta,
  deveAvisarCancelamentoComEtiquetaPaga,
  elegibilidadeDaEtiqueta,
  freteEfetivoDoPedido,
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
    // CPF válido de teste (exigido pelo Melhor Envio em `to.document`) — os
    // testes que querem "disponivel" de verdade herdam este valor; quem
    // quer testar o portão de CPF sobrescreve com `null`/inválido.
    cpf: "52998224725",
    ...over,
  };
}

describe("elegibilidadeDaEtiqueta", () => {
  it("já etiquetado vence QUALQUER outro motivo — inclusive cancelado depois", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({
        shipping_label_id: "abc123",
        status: "cancelled",
        situacao_da_compra: "confirmada",
      }),
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
        payment_status: "sem_prova",
        shipping_option_id: "superfrete-1",
      }),
    );
    expect(r.estado).toBe("indisponivel");
    expect(r).toMatchObject({
      motivo: expect.stringMatching(/pagamento confirmado|saldo real/i),
    });
  });

  it.each(["sem_prova", "recusado", "expirado", "estornado", null])(
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

  it("Frenet sem nota: orienta emitir no site sem exibir o código interno", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ shipping_option_id: "frenet-EXP01" }),
    );
    expect(r).toEqual({
      estado: "indisponivel",
      motivo:
        "Frete cotado e cobrado pela Frenet — gere a etiqueta no site da Frenet.",
    });
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

describe("elegibilidadeDaEtiqueta — CPF do destinatário (ordem: emitida e indisponível vencem CPF; CPF só entra quando seria disponível)", () => {
  it("CPF ausente (null): precisa_cpf, cpfInvalido false, com o nome do serviço", () => {
    const r = elegibilidadeDaEtiqueta(pedido({ cpf: null }));
    expect(r).toEqual({
      estado: "precisa_cpf",
      servico: "Melhor Envio (serviço 3)",
      cpfInvalido: false,
    });
  });

  it("CPF ausente (string vazia): precisa_cpf, cpfInvalido false — trata como ausente, não como inválido", () => {
    const r = elegibilidadeDaEtiqueta(pedido({ cpf: "" }));
    expect(r).toMatchObject({ estado: "precisa_cpf", cpfInvalido: false });
  });

  it("CPF inválido (checksum errado): precisa_cpf, cpfInvalido TRUE", () => {
    const r = elegibilidadeDaEtiqueta(pedido({ cpf: "52998224700" }));
    expect(r).toEqual({
      estado: "precisa_cpf",
      servico: "Melhor Envio (serviço 3)",
      cpfInvalido: true,
    });
  });

  it("CPF inválido (dígitos repetidos): precisa_cpf, cpfInvalido true", () => {
    const r = elegibilidadeDaEtiqueta(pedido({ cpf: "11111111111" }));
    expect(r).toMatchObject({ estado: "precisa_cpf", cpfInvalido: true });
  });

  it("CPF válido COM máscara: disponível (a validação limpa antes de checar)", () => {
    const r = elegibilidadeDaEtiqueta(pedido({ cpf: "529.982.247-25" }));
    expect(r.estado).toBe("disponivel");
  });

  it("CPF válido: disponível, com o mesmo nome de serviço que o estado disponivel usaria", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({
        cpf: "52998224725",
        notes: "Frete Escolhido: Correios — SEDEX (Prazo: 2 dias)",
      }),
    );
    expect(r).toEqual({ estado: "disponivel", servico: "Correios — SEDEX" });
  });

  it("já etiquetado vence CPF ausente — emitida, não precisa_cpf", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({
        cpf: null,
        shipping_label_id: "abc123",
        situacao_da_compra: "confirmada",
      }),
    );
    expect(r).toEqual({ estado: "emitida" });
  });

  it("indisponível (SuperFrete) vence CPF ausente — nunca pede CPF para um pedido que já é indisponível por outro motivo", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ cpf: null, shipping_option_id: "superfrete-1" }),
    );
    expect(r.estado).toBe("indisponivel");
  });

  it("indisponível (pagamento não confirmado) vence CPF ausente", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ cpf: null, payment_status: "sem_prova" }),
    );
    expect(r.estado).toBe("indisponivel");
  });

  it("indisponível (cancelado) vence CPF ausente", () => {
    const r = elegibilidadeDaEtiqueta(
      pedido({ cpf: null, status: "cancelled" }),
    );
    expect(r.estado).toBe("indisponivel");
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

describe("elegibilidadeDaEtiqueta — compra da etiqueta", () => {
  const vinculo = { shipping_label_id: "lbl-1" } as const;
  const indeterminada = {
    ...vinculo,
    situacao_da_compra: "indeterminada",
  } as const;

  it("vínculo com resposta indeterminada continua conferindo, inclusive se o pedido foi cancelado", () => {
    expect(elegibilidadeDaEtiqueta(pedido(indeterminada))).toEqual({
      estado: "conferindo",
    });
    expect(
      elegibilidadeDaEtiqueta(
        pedido({ ...indeterminada, status: "cancelled" }),
      ),
    ).toEqual({
      estado: "conferindo",
    });
  });

  it("o link de impressão é evidência de compra, mesmo sem histórico", () => {
    expect(
      elegibilidadeDaEtiqueta(
        pedido({ ...vinculo, shipping_label_url: "https://x/y" }),
      ),
    ).toEqual({
      estado: "emitida",
    });
  });

  it("id isolado mantém o rótulo da base; código manual não comprova a compra", () => {
    expect(elegibilidadeDaEtiqueta(pedido(vinculo))).toEqual({
      estado: "emitida",
    });
    const cancelado = pedido({
      ...vinculo,
      status: "cancelled",
      tracking_code: "AA123456789BR",
    });
    expect(deveAvisarCancelamentoComEtiquetaPaga(cancelado)).toBe(false);
    expect(
      deveAvisarCancelamentoComEtiquetaPaga({
        ...cancelado,
        shipping_label_url: "https://imprimir.teste/etiqueta",
      }),
    ).toBe(true);
  });

  it("confirmação da compra basta mesmo sem link de impressão e sem rastreio", () => {
    expect(
      elegibilidadeDaEtiqueta(
        pedido({ ...vinculo, situacao_da_compra: "confirmada" }),
      ),
    ).toEqual({
      estado: "emitida",
    });
  });

  it("sem vínculo o histórico não muda a elegibilidade", () => {
    expect(
      elegibilidadeDaEtiqueta(pedido({ situacao_da_compra: "indeterminada" })),
    ).toEqual({
      estado: "disponivel",
      servico: "Melhor Envio (serviço 3)",
    });
  });
});

describe("situacaoDaCompraPeloHistorico", () => {
  const indet = (
    extra: Record<string, unknown> = {},
    quando = "2026-10-27T10:00:00Z",
  ) => ({
    event_type: "erro",
    created_at: quando,
    error_message: "Falha indeterminada no checkout/geração da etiqueta: x",
    payload: { etapa: "checkout_indeterminado", label_id: "lbl-1", ...extra },
  });

  it("evento indeterminado sem confirmação explícita deixa a compra indeterminada", () => {
    expect(
      situacaoDaCompraPeloHistorico(
        [indet({ pago_confirmado: false })],
        "lbl-1",
      ),
    ).toBe("indeterminada");
    expect(situacaoDaCompraPeloHistorico([indet()], "lbl-1")).toBe(
      "indeterminada",
    );
  });

  it("compra confirmada com falha na impressão ou gravação continua confirmada", () => {
    for (const evento of [
      indet({ pago_confirmado: true }),
      {
        ...indet(),
        error_message:
          "Compra CONFIRMADA no Melhor Envio, falha na finalização: x",
      },
      indet({ etapa: "gravacao" }),
    ]) {
      expect(situacaoDaCompraPeloHistorico([evento], "lbl-1")).toBe(
        "confirmada",
      );
    }
  });

  it("leva em conta o evento mais recente daquela etiqueta, não a ordem da lista", () => {
    const gerada = (quando: string) => ({
      event_type: "etiqueta_gerada",
      created_at: quando,
      payload: { label_id: "lbl-1" },
    });
    expect(
      situacaoDaCompraPeloHistorico(
        [gerada("2026-10-27T11:00:00Z"), indet()],
        "lbl-1",
      ),
    ).toBe("confirmada");
    expect(
      situacaoDaCompraPeloHistorico(
        [indet(), gerada("2026-10-27T09:00:00Z")],
        "lbl-1",
      ),
    ).toBe("indeterminada");
  });

  it("confirmação de outra etiqueta não prova a compra da que está vinculada agora", () => {
    expect(
      situacaoDaCompraPeloHistorico(
        [indet({ label_id: "lbl-antiga", pago_confirmado: true })],
        "lbl-1",
      ),
    ).toBe("sem_prova");
  });

  it("rastreio retornado pelo provedor para o id atual confirma a etiqueta; vazio não", () => {
    const consultado = {
      event_type: "rastreio_consultado",
      payload: { label_id: "lbl-1" },
    };
    expect(
      situacaoDaCompraPeloHistorico(
        [{ ...consultado, tracking_code: "ME123" }],
        "lbl-1",
      ),
    ).toBe("confirmada");
    expect(
      situacaoDaCompraPeloHistorico(
        [{ ...consultado, tracking_code: "  " }],
        "lbl-1",
      ),
    ).toBe("sem_prova");
    expect(
      situacaoDaCompraPeloHistorico(
        [{ ...consultado, tracking_code: "..." }],
        "lbl-1",
      ),
    ).toBe("sem_prova");
  });

  it("falha em generate para a etiqueta vinculada só acontece depois do pagamento", () => {
    expect(
      situacaoDaCompraPeloHistorico([indet({ etapa: "generate" })], "lbl-1"),
    ).toBe("confirmada");
  });

  it("histórico da consulta confirma status de etiqueta já paga mesmo sem rastreio", () => {
    const consultar = (status: string) => ({
      event_type: "rastreio_consultado",
      payload: { label_id: "lbl-1", status_etiqueta: status },
      tracking_code: null,
    });
    expect(
      situacaoDaCompraPeloHistorico([consultar("released")], "lbl-1"),
    ).toBe("confirmada");
    expect(situacaoDaCompraPeloHistorico([consultar("pending")], "lbl-1")).toBe(
      "sem_prova",
    );
  });

  it("outros erros, dados ilegíveis ou vazios não confirmam a compra", () => {
    for (const v of [
      null,
      undefined,
      [],
      "x",
      5,
      {},
      [null],
      [{}],
      [{ payload: "texto" }],
      [indet({ etapa: "tracking" })],
    ]) {
      expect(situacaoDaCompraPeloHistorico(v, "lbl-1")).toBe("sem_prova");
    }
  });
});
