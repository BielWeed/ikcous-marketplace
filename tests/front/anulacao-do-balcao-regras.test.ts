// Anular venda do balcão (migration 20261204000000) — as três decisões PURAS
// da tela: quando o botão aparece, o que dizer quando o banco recusa, e como
// o lojista devolve o dinheiro. O banco é a autoridade; aqui só se prova que
// a tela não convida ao clique errado e não mostra código nem jargão.
import {
  MOTIVO_MAXIMO_DA_ANULACAO,
  mensagemDaFalhaDaAnulacao,
  motivoTemTexto,
  orientacaoDeDevolucao,
  podeAnularVendaDoBalcao,
} from "@/lib/anulacao-do-balcao";
import { describe, expect, it } from "vitest";

// 08/10/2026, 15:00 em São Paulo (UTC-3) = 18:00Z.
const AGORA = new Date("2026-10-08T18:00:00.000Z");

function venda(parcial: Record<string, unknown> = {}) {
  return {
    canal: "presencial" as const,
    status: "delivered" as const,
    paymentStatus: "recebido_na_entrega" as const,
    paymentMethod: "cash" as const,
    pagamentoRecebidoEm: "2026-10-08T14:00:00.000Z",
    ...parcial,
  };
}

describe("podeAnularVendaDoBalcao — o botão só aparece onde o banco aceitaria", () => {
  it("venda do balcão entregue, recebida na hora, recebida HOJE: aparece (as 3 formas)", () => {
    for (const forma of ["cash", "pix", "card"] as const) {
      expect(
        podeAnularVendaDoBalcao(venda({ paymentMethod: forma }), AGORA),
      ).toBe(true);
    }
  });

  it("pedido do site (canal online ou ausente) nunca aparece", () => {
    expect(podeAnularVendaDoBalcao(venda({ canal: "online" }), AGORA)).toBe(
      false,
    );
    expect(podeAnularVendaDoBalcao(venda({ canal: undefined }), AGORA)).toBe(
      false,
    );
  });

  it("venda já cancelada, ou que não está entregue, não aparece", () => {
    for (const status of ["cancelled", "pending", "processing", "shipped"]) {
      expect(podeAnularVendaDoBalcao(venda({ status }), AGORA)).toBe(false);
    }
  });

  it("só 'recebido_na_entrega': estornada, paga pelo site ou sem estado não aparece", () => {
    for (const paymentStatus of ["estornado", "pago", "aguardando", null]) {
      expect(podeAnularVendaDoBalcao(venda({ paymentStatus }), AGORA)).toBe(
        false,
      );
    }
    expect(
      podeAnularVendaDoBalcao(venda({ paymentStatus: undefined }), AGORA),
    ).toBe(false);
  });

  it("forma que o balcão não usa (online, vazia) não aparece", () => {
    expect(
      podeAnularVendaDoBalcao(venda({ paymentMethod: "online" }), AGORA),
    ).toBe(false);
    expect(
      podeAnularVendaDoBalcao(venda({ paymentMethod: undefined }), AGORA),
    ).toBe(false);
  });

  it("sem carimbo de recebimento (pagamento desfeito) ou com data torta: não aparece", () => {
    expect(
      podeAnularVendaDoBalcao(venda({ pagamentoRecebidoEm: null }), AGORA),
    ).toBe(false);
    expect(
      podeAnularVendaDoBalcao(venda({ pagamentoRecebidoEm: undefined }), AGORA),
    ).toBe(false);
    expect(
      podeAnularVendaDoBalcao(venda({ pagamentoRecebidoEm: "ontem" }), AGORA),
    ).toBe(false);
  });

  it("a BORDA do dia é o calendário de São Paulo: 23:59 de ontem não vale, 00:00 de hoje vale", () => {
    // 07/10 23:59:59 em SP = 08/10 02:59:59Z → ontem
    expect(
      podeAnularVendaDoBalcao(
        venda({ pagamentoRecebidoEm: "2026-10-08T02:59:59.000Z" }),
        AGORA,
      ),
    ).toBe(false);
    // 08/10 00:00:00 em SP = 08/10 03:00:00Z → hoje
    expect(
      podeAnularVendaDoBalcao(
        venda({ pagamentoRecebidoEm: "2026-10-08T03:00:00.000Z" }),
        AGORA,
      ),
    ).toBe(true);
  });

  it("NÃO usa o dia UTC: 22:00 em SP já é o dia seguinte em UTC, e a venda do mesmo dia da loja continua valendo", () => {
    // venda 08/10 21:00 SP (= 09/10 00:00Z); agora 08/10 23:30 SP (= 09/10 02:30Z)
    expect(
      podeAnularVendaDoBalcao(
        venda({ pagamentoRecebidoEm: "2026-10-09T00:00:00.000Z" }),
        new Date("2026-10-09T02:30:00.000Z"),
      ),
    ).toBe(true);
    // e depois da meia-noite de SP (09/10 00:10 SP = 09/10 03:10Z) já não vale
    expect(
      podeAnularVendaDoBalcao(
        venda({ pagamentoRecebidoEm: "2026-10-09T00:00:00.000Z" }),
        new Date("2026-10-09T03:10:00.000Z"),
      ),
    ).toBe(false);
  });

  it("venda de dias atrás nunca aparece", () => {
    expect(
      podeAnularVendaDoBalcao(
        venda({ pagamentoRecebidoEm: "2026-10-01T14:00:00.000Z" }),
        AGORA,
      ),
    ).toBe(false);
  });
});

describe("mensagemDaFalhaDaAnulacao — português do lojista, sem código nem jargão", () => {
  it("função inexistente no servidor (PGRST202, ou só o texto) diz que ainda não está liberada", () => {
    const frase =
      "A anulação ainda não está liberada neste servidor. Avise quem cuida do app.";
    expect(
      mensagemDaFalhaDaAnulacao({ code: "PGRST202", message: "schema cache" }),
    ).toBe(frase);
    expect(
      mensagemDaFalhaDaAnulacao({
        code: "42883",
        message:
          "Could not find the function public.anular_venda_presencial(p_motivo, p_order_id) in the schema cache",
      }),
    ).toBe(frase);
  });

  it("o dia que passou: repassa a frase do banco, que já manda registrar uma devolução", () => {
    const frase =
      "Só dá para anular no mesmo dia da venda. Para outro dia, registre uma devolução.";
    expect(mensagemDaFalhaDaAnulacao({ code: "22023", message: frase })).toBe(
      frase,
    );
  });

  it("as demais recusas do banco (22023 e 42501) são repassadas como estão", () => {
    for (const [code, message] of [
      ["22023", "Esta venda não pode ser anulada aqui."],
      ["22023", "Esta venda tem devolução registrada; resolva pela devolução."],
      ["22023", "Informe o motivo para anular a venda."],
      [
        "22023",
        "O recebimento desta venda foi desfeito e refeito hoje; por segurança ela não pode ser anulada aqui. Registre uma devolução.",
      ],
      ["42501", "Acesso negado: só a loja anula venda do balcão."],
    ]) {
      expect(mensagemDaFalhaDaAnulacao({ code, message })).toBe(message);
    }
  });

  it("sem frase do banco, 22023 e 42501 caem numa frase própria", () => {
    expect(mensagemDaFalhaDaAnulacao({ code: "22023" })).toBe(
      "Esta venda não pode ser anulada aqui.",
    );
    expect(mensagemDaFalhaDaAnulacao({ code: "42501" })).toBe(
      "Só quem é da loja pode anular uma venda.",
    );
  });

  it("rede caindo (sem code) manda conferir antes de repetir, sem afirmar que não anulou", () => {
    for (const erro of [
      new TypeError("Failed to fetch"),
      new DOMException("The operation was aborted.", "AbortError"),
    ]) {
      const frase = mensagemDaFalhaDaAnulacao(erro);
      expect(frase).toContain("Não consegui confirmar com o servidor");
      expect(frase).not.toContain("AbortError");
      expect(frase).not.toContain("Failed to fetch");
    }
  });

  it("código desconhecido sem frase vira a frase genérica; nunca mostra o código", () => {
    const frase = mensagemDaFalhaDaAnulacao({ code: "XX000" });
    expect(frase).toBe("Não consegui anular agora. Tente de novo.");
    expect(frase).not.toContain("XX000");
  });
});

describe("orientacaoDeDevolucao — o app não devolve o dinheiro, e a tela diz como", () => {
  it("cada forma tem a sua instrução, com o valor", () => {
    expect(orientacaoDeDevolucao("cash", 79.8)).toMatch(
      /^Devolva R\$\s79,80 em dinheiro ao cliente\.$/,
    );
    expect(orientacaoDeDevolucao("pix", 79.8)).toMatch(
      /^Devolva R\$\s79,80 ao cliente por PIX\.$/,
    );
    expect(orientacaoDeDevolucao("card", 79.8)).toMatch(
      /^Faça o estorno de R\$\s79,80 na maquininha\.$/,
    );
  });

  it("venda que talvez já tenha sido devolvida por outro aparelho: a instrução é CONDICIONAL, com valor e forma", () => {
    const antes = "Se o dinheiro ainda não voltou ao cliente,";
    expect(orientacaoDeDevolucao("cash", 79.8, true)).toMatch(
      new RegExp(`^${antes} devolva R\\$\\s79,80 em dinheiro\\.$`),
    );
    expect(orientacaoDeDevolucao("pix", 79.8, true)).toMatch(
      new RegExp(`^${antes} devolva R\\$\\s79,80 por PIX\\.$`),
    );
    expect(orientacaoDeDevolucao("card", 79.8, true)).toMatch(
      new RegExp(`^${antes} faça o estorno de R\\$\\s79,80 na maquininha\\.$`),
    );
    expect(orientacaoDeDevolucao("outra", 10, true)).toMatch(
      new RegExp(`^${antes} devolva R\\$\\s10,00\\.$`),
    );
    expect(orientacaoDeDevolucao("cash", 0, true)).toBe(
      "A venda não tinha valor: não há dinheiro a devolver.",
    );
  });

  it("forma desconhecida cai na instrução geral; venda de valor zero não manda devolver nada", () => {
    expect(orientacaoDeDevolucao("outra", 10)).toMatch(/^Devolva R\$\s10,00/);
    expect(orientacaoDeDevolucao("cash", 0)).toBe(
      "A venda não tinha valor: não há dinheiro a devolver.",
    );
    expect(orientacaoDeDevolucao("cash", Number.NaN)).toBe(
      "A venda não tinha valor: não há dinheiro a devolver.",
    );
  });
});

describe("motivoTemTexto — espelha o banco: ao menos uma letra ou número", () => {
  it("aceita letras (inclusive só acentuadas), números e texto com emoji", () => {
    for (const m of ["engano", "çãé", "ÇÃO", "123", "a😀", "erro no caixa"]) {
      expect(motivoTemTexto(m)).toBe(true);
    }
  });

  it("recusa vazio, pontuação, emoji e caracteres invisíveis", () => {
    for (const m of [
      "",
      "?!... --",
      "😀😀",
      String.fromCharCode(0x200b).repeat(3),
      String.fromCharCode(0xfeff),
      String.fromCharCode(0x2800),
      ` ${String.fromCharCode(0x200b)} `,
    ]) {
      expect(motivoTemTexto(m)).toBe(false);
    }
  });
});

describe("limites", () => {
  it("o teto do motivo é o da RPC (500)", () => {
    expect(MOTIVO_MAXIMO_DA_ANULACAO).toBe(500);
  });
});
