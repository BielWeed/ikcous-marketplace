// @vitest-environment jsdom
//
// CARTÃO — as bordas de `montarCorpoDoCartao`, `classificarRespostaCartao` e
// `enviarPagamentoComCartao` que o `pagamento-com-cartao.test.tsx` deixava
// passar (achadas por mutação em `PagamentoComCartao.tsx`). Todas são decisões
// sobre DINHEIRO: que parcelas vão para a edge, o que a tela promete quando a
// resposta vem sem order, e por quanto tempo ela espera um POST de cobrança.
//
// Só dublês: token e documento são fictícios óbvios; nada sai para rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEMPO_LIMITE_ENVIO_DO_CARTAO_MS,
  classificarRespostaCartao,
  enviarPagamentoComCartao,
  montarCorpoDoCartao,
} from "@/components/checkout/PagamentoComCartao";
import type { ConfigDoCartao } from "@/lib/config-do-cartao";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento: vi.fn() }),
}));

const SO_CREDITO: ConfigDoCartao = {
  credito: true,
  debito: false,
  parcelasMax: 6,
};
const SO_DEBITO: ConfigDoCartao = {
  credito: false,
  debito: true,
  parcelasMax: 6,
};
const OS_DOIS: ConfigDoCartao = { credito: true, debito: true, parcelasMax: 6 };

/** CardData fictício do Brick. */
function dados(sobrepor: Record<string, unknown> = {}) {
  return {
    token: "TEST-ficticio-0000",
    payment_method_id: "master",
    installments: 3,
    payer: {
      email: "cliente@exemplo.com",
      identification: { type: "CPF", number: "123.456.789-09" },
    },
    ...sobrepor,
  };
}

function montar(
  sobrepor: Record<string, unknown>,
  adicionais: { paymentTypeId?: unknown } | undefined,
  config: ConfigDoCartao,
) {
  return montarCorpoDoCartao({
    orderId: "ped-1",
    dados: dados(sobrepor),
    adicionais,
    config,
    emailDeTeste: null,
  });
}

describe("montarCorpoDoCartao — parcelas", () => {
  it("o Brick que OMITE as parcelas (ou manda nulo) é compra à vista: parcelas = 1, nunca outro número", () => {
    for (const installments of [undefined, null]) {
      const r = montar(
        { installments },
        { paymentTypeId: "credit_card" },
        SO_CREDITO,
      );
      expect(r.ok && r.corpo.parcelas).toBe(1);
    }
  });

  it("parcelas em texto numérico valem como número; negativo, infinito e NaN são recusados", () => {
    const ok = montar(
      { installments: "3" },
      { paymentTypeId: "credit_card" },
      SO_CREDITO,
    );
    expect(ok.ok && ok.corpo.parcelas).toBe(3);
    for (const installments of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
      const r = montar(
        { installments },
        { paymentTypeId: "credit_card" },
        SO_CREDITO,
      );
      expect(r.ok).toBe(false);
    }
  });

  it("débito que chega com parcelas acima do teto da lojista NÃO é recusado: vai à vista (parcelas = 1)", () => {
    // O teto de parcelas é do CRÉDITO. Numa loja só de débito `parcelasMax`
    // pode ser qualquer valor, e o débito sai à vista de qualquer jeito.
    for (const config of [SO_DEBITO, OS_DOIS]) {
      const r = montar(
        { installments: 12 },
        { paymentTypeId: "debit_card" },
        config,
      );
      expect(r.ok && r.corpo.parcelas).toBe(1);
      expect(r.ok && r.corpo.paymentTypeId).toBe("debit_card");
    }
  });

  it("débito com 3 parcelas vindas do Brick sai com parcelas = 1 (nunca parcela débito)", () => {
    const r = montar(
      { installments: 3 },
      { paymentTypeId: "debit_card" },
      OS_DOIS,
    );
    expect(r.ok && r.corpo.parcelas).toBe(1);
  });
});

describe("montarCorpoDoCartao — texto vindo do Brick", () => {
  it("token, bandeira e e-mail chegam aparados", () => {
    const r = montar(
      {
        token: "  TEST-ficticio-0000  ",
        payment_method_id: " master ",
        payer: {
          email: "  cliente@exemplo.com ",
          identification: { type: " cpf ", number: " 123.456.789-09 " },
        },
      },
      { paymentTypeId: "credit_card" },
      SO_CREDITO,
    );
    expect(r).toEqual({
      ok: true,
      corpo: {
        orderId: "ped-1",
        metodo: "cartao",
        token: "TEST-ficticio-0000",
        paymentMethodId: "master",
        paymentTypeId: "credit_card",
        parcelas: 3,
        documento: { type: "CPF", number: "12345678909" },
        email: "cliente@exemplo.com",
      },
    });
  });

  it("token ou bandeira só com espaços não passam; e-mail só com espaços sai do corpo", () => {
    for (const sobrepor of [{ token: "   " }, { payment_method_id: "\t" }]) {
      expect(
        montar(sobrepor, { paymentTypeId: "credit_card" }, SO_CREDITO).ok,
      ).toBe(false);
    }
    const semEmail = montar(
      {
        payer: {
          email: "   ",
          identification: { type: "CPF", number: "12345678909" },
        },
      },
      { paymentTypeId: "credit_card" },
      SO_CREDITO,
    );
    expect(semEmail.ok && "email" in semEmail.corpo).toBe(false);
  });

  it("o tipo do AdditionalData manda: com os dois ligados, crédito no AdditionalData vence débito no CardData", () => {
    const r = montar(
      { payment_type_id: "debit_card" },
      { paymentTypeId: "credit_card" },
      OS_DOIS,
    );
    expect(r.ok && r.corpo.paymentTypeId).toBe("credit_card");
  });

  it("AdditionalData com tipo desconhecido cai no CardData quando ele é conhecido", () => {
    const r = montar(
      { payment_type_id: "credit_card" },
      { paymentTypeId: "prepaid_card" },
      OS_DOIS,
    );
    expect(r.ok && r.corpo.paymentTypeId).toBe("credit_card");
  });

  it("documento sem tipo ou sem número é recusado com a frase do CPF/CNPJ", () => {
    for (const identification of [
      { number: "12345678909" },
      { type: "CPF" },
      { type: "CPF", number: "   " },
    ]) {
      const r = montar(
        { payer: { identification } },
        { paymentTypeId: "credit_card" },
        SO_CREDITO,
      );
      expect(r).toEqual({
        ok: false,
        mensagem: "Confira o CPF ou CNPJ do titular do cartão e tente de novo.",
      });
    }
  });
});

describe("classificarRespostaCartao — resposta sem order e frases terminais", () => {
  const base = { paymentId: "pay-1", expiraEm: "2026-11-24T12:30:00Z" };

  it("sem_registro com data em branco não inventa data; com data, ela chega aparada", () => {
    expect(
      classificarRespostaCartao({
        ...base,
        paymentId: null,
        statusPagamento: "aguardando",
        verificacao: "sem_registro",
        canceladoAutomaticamenteAte: "   ",
      }),
    ).toEqual({
      tipo: "em-duvida",
      pontoDePartida: { verificacao: "sem_registro" },
    });
    expect(
      classificarRespostaCartao({
        ...base,
        paymentId: null,
        statusPagamento: "aguardando",
        verificacao: "sem_registro",
        canceladoAutomaticamenteAte: " 2026-11-25T12:30:00Z ",
      }),
    ).toEqual({
      tipo: "em-duvida",
      pontoDePartida: {
        verificacao: "sem_registro",
        canceladoAutomaticamenteAte: "2026-11-25T12:30:00Z",
      },
    });
  });

  it("sem_registro vence o status: nem 'pago' vira aprovado sem order confirmada", () => {
    expect(
      classificarRespostaCartao({
        ...base,
        paymentId: null,
        statusPagamento: "pago",
        verificacao: "sem_registro",
      }).tipo,
    ).toBe("em-duvida");
  });

  it("aguardando sem desafio e sem order (nulo ou em branco) é dúvida, nunca 'em análise'", () => {
    for (const paymentId of [null, "", "   "]) {
      expect(
        classificarRespostaCartao({
          ...base,
          paymentId,
          statusPagamento: "aguardando",
        }),
      ).toEqual({
        tipo: "em-duvida",
        pontoDePartida: { verificacao: "sem_registro" },
      });
    }
  });

  it("desafio 3DS sem URL é erro recuperável com semCobranca — nunca um iframe vazio", () => {
    for (const desafio3ds of [{}, { url: "" }, { url: "   " }]) {
      const r = classificarRespostaCartao({
        ...base,
        statusPagamento: "aguardando",
        desafio3ds: desafio3ds as { url: string },
      });
      expect(r.tipo).toBe("erro");
      expect(r.tipo === "erro" && r.sinal).toBe("semCobranca");
    }
  });

  it("desafio válido sem order na resposta segue com paymentId nulo (a cerca nasce depois)", () => {
    const url = "https://www.mercadopago.com.br/auth/x";
    expect(
      classificarRespostaCartao({
        ...base,
        paymentId: null,
        statusPagamento: "aguardando",
        desafio3ds: { url },
      }),
    ).toEqual({ tipo: "desafio", url, paymentId: null });
  });

  it("status desconhecido SEM order (nulo ou em branco) é dúvida com verificação indisponível — não 'em análise'", () => {
    for (const paymentId of [null, "", "  "]) {
      expect(
        classificarRespostaCartao({
          ...base,
          paymentId,
          statusPagamento: "in_process:xyz",
        }),
      ).toEqual({
        tipo: "em-duvida",
        pontoDePartida: { verificacao: "indisponivel" },
      });
    }
  });

  it("as frases terminais que o cliente lê, uma por estado", () => {
    expect(
      classificarRespostaCartao({ ...base, statusPagamento: "expirado" }),
    ).toMatchObject({
      mensagem:
        "O prazo para pagar este pedido acabou. Faça um pedido novo para tentar de novo.",
    });
    expect(
      classificarRespostaCartao({ ...base, statusPagamento: "estornado" }),
    ).toMatchObject({
      mensagem:
        "Este pagamento foi estornado e não pode ser confirmado neste pedido. Faça um pedido novo ou fale com a loja.",
    });
    expect(
      classificarRespostaCartao({ ...base, statusPagamento: "qualquer-coisa" }),
    ).toMatchObject({ mensagem: "Não foi possível confirmar o pagamento." });
    expect(
      classificarRespostaCartao({
        ...base,
        statusPagamento: "aguardando",
        desafio3ds: { url: "https://golpe.io/3ds" },
      }),
    ).toMatchObject({
      mensagem:
        "Não foi possível abrir a confirmação do seu banco. Tente de novo ou pague com PIX.",
    });
  });

  it("recusa sem nova tentativa e sem frase do servidor usa a frase padrão do pedido encerrado", () => {
    expect(
      classificarRespostaCartao({
        ...base,
        statusPagamento: "recusado",
        podeTentarDeNovo: false,
      }),
    ).toEqual({
      tipo: "erro",
      mensagem:
        "O pagamento foi recusado e este pedido não aceita nova tentativa. Faça um pedido novo ou fale com a loja.",
      categoria: "terminal",
    });
  });

  it("recusa com nova tentativa: motivo padrão do banco, e a categoria do servidor só entra quando conhecida", () => {
    expect(
      classificarRespostaCartao({ ...base, statusPagamento: "recusado" }),
    ).toEqual({
      tipo: "recusado",
      motivo:
        "O banco recusou este cartão. Tente outro cartão ou pague com PIX.",
    });
    expect(
      classificarRespostaCartao({
        ...base,
        statusPagamento: "recusado",
        categoriaDaRecusa: "sem_limite",
      }),
    ).toMatchObject({ tipo: "recusado", categoria: "sem-limite" });
    // Categoria desconhecida: não entra no resultado (a tela cai no mapa por frase).
    const semCategoria = classificarRespostaCartao({
      ...base,
      statusPagamento: "recusado",
      categoriaDaRecusa: "inventada",
    });
    expect(
      semCategoria.tipo === "recusado" && "categoria" in semCategoria,
    ).toBe(false);
    // "outra" + frase curada exata do servidor: orientação específica.
    expect(
      classificarRespostaCartao({
        ...base,
        statusPagamento: "recusado",
        categoriaDaRecusa: "outra",
        motivoRecusa: "Cartão desabilitado. Fale com o seu banco.",
      }),
    ).toMatchObject({ tipo: "recusado", categoria: "desabilitado" });
  });
});

describe("enviarPagamentoComCartao — o que sobra do erro e do tempo", () => {
  const entrada = {
    orderId: "ped-1",
    dados: dados(),
    adicionais: { paymentTypeId: "credit_card" },
    config: SO_CREDITO,
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("503 'verificação indisponível' MARCADO terminal vence a dúvida: erro terminal, não verificação", async () => {
    const r = await enviarPagamentoComCartao({
      ...entrada,
      criarPagamento: vi.fn().mockRejectedValue(
        Object.assign(new Error("Pedido encerrado."), {
          verificacao: "indisponivel",
          terminal: true,
        }),
      ),
    });
    expect(r).toEqual({
      tipo: "erro",
      mensagem: "Pedido encerrado.",
      categoria: "terminal",
      sinal: undefined,
    });
  });

  it("503 'verificação indisponível' comum vira dúvida, e o POST NÃO é repetido", async () => {
    const criar = vi.fn().mockRejectedValue(
      Object.assign(new Error("Não deu para conferir."), {
        verificacao: "indisponivel",
      }),
    );
    const r = await enviarPagamentoComCartao({
      ...entrada,
      criarPagamento: criar,
    });
    expect(r).toEqual({
      tipo: "em-duvida",
      pontoDePartida: { verificacao: "indisponivel" },
    });
    expect(criar).toHaveBeenCalledTimes(1);
  });

  it("rejeição sem mensagem (objeto solto, undefined) cai na frase padrão da cobrança", async () => {
    for (const rejeicao of [{}, undefined]) {
      const r = await enviarPagamentoComCartao({
        ...entrada,
        criarPagamento: vi.fn().mockRejectedValue(rejeicao),
      });
      expect(r).toMatchObject({
        tipo: "erro",
        mensagem: "Não foi possível gerar a cobrança.",
        categoria: "recuperavel",
      });
    }
  });

  describe("tempo limite do POST de cartão", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("a edge que não responde vira DÚVIDA (nunca 'nada foi cobrado') só no instante exato do limite", async () => {
      expect(TEMPO_LIMITE_ENVIO_DO_CARTAO_MS).toBe(40_000);
      let resolveuDeFato = false;
      const criar = vi.fn(
        () =>
          new Promise<never>(() => {
            /* nunca responde */
          }),
      );
      const promessa = enviarPagamentoComCartao({
        ...entrada,
        criarPagamento: criar,
      }).then((r) => {
        resolveuDeFato = true;
        return r;
      });

      await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_ENVIO_DO_CARTAO_MS - 1);
      expect(resolveuDeFato).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(resolveuDeFato).toBe(true);
      await expect(promessa).resolves.toEqual({
        tipo: "em-duvida",
        pontoDePartida: { verificacao: "indisponivel" },
      });
      // Esperar mais não dispara outro POST: o limite só deixa de ESPERAR.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(criar).toHaveBeenCalledTimes(1);
    });

    it("resposta que chega antes do limite é a resposta (sem dúvida inventada)", async () => {
      const criar = vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  paymentId: "pay-1",
                  statusPagamento: "pago",
                  expiraEm: "2026-11-24T12:30:00Z",
                }),
              TEMPO_LIMITE_ENVIO_DO_CARTAO_MS - 1,
            );
          }),
      );
      const promessa = enviarPagamentoComCartao({
        ...entrada,
        criarPagamento: criar as never,
      });
      await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_ENVIO_DO_CARTAO_MS - 1);
      await expect(promessa).resolves.toEqual({ tipo: "aprovado" });
    });
  });
});
