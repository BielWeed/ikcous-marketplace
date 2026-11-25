// Fronteiras de `src/lib/financeiro.ts` que nenhum teste citava pelo nome:
// o que conta como "divergência do caixa" (a operação repetida com valores
// diferentes), o sentido do dinheiro numa transferência, a janela de 30 dias
// e o que é uma data de calendário de verdade. Valores fictícios.
import { describe, expect, it } from "vitest";

import {
  ErroDeFormatoFinanceiro,
  ErroDePrazoFinanceiro,
  efeitoNoSaldo,
  ehDataIso,
  ehDivergenciaDoCaixa,
  ehLancamentoJaResolvido,
  fraseDeGravacaoSemConfirmacao,
  mensagemDeErroFinanceiro,
  paraCentavos,
  sentidoDoLancamento,
  ultimos30Dias,
} from "@/lib/financeiro";

const FRASE_DIVERGENTE =
  "Esta operação já foi registrada com valores diferentes. Confira o histórico antes de tentar de novo.";

describe("ehDivergenciaDoCaixa: só 22023 com os dois detalhes combinados", () => {
  it.each(["fechamento_divergente", "tentativa_divergente"])(
    "22023 com details %s é divergência",
    (details) => {
      expect(ehDivergenciaDoCaixa({ code: "22023", details })).toBe(true);
    },
  );

  it.each([
    ["outro código com o mesmo detalhe (P0001)", { code: "P0001" }],
    ["outro código com o mesmo detalhe (23505)", { code: "23505" }],
    ["sem código nenhum", {}],
    ["código vazio", { code: "" }],
  ])("%s NÃO é divergência", (_nome, base) => {
    for (const details of ["fechamento_divergente", "tentativa_divergente"]) {
      expect(ehDivergenciaDoCaixa({ ...base, details })).toBe(false);
    }
  });

  it("22023 com detalhe diferente, sem detalhe ou só na mensagem NÃO é divergência", () => {
    expect(
      ehDivergenciaDoCaixa({ code: "22023", details: "outra_coisa" }),
    ).toBe(false);
    expect(ehDivergenciaDoCaixa({ code: "22023" })).toBe(false);
    expect(ehDivergenciaDoCaixa({ code: "22023", details: null })).toBe(false);
    expect(
      ehDivergenciaDoCaixa({
        code: "22023",
        message: "fechamento_divergente",
      }),
    ).toBe(false);
  });

  it("entradas que nem são objeto não quebram e não são divergência", () => {
    for (const lixo of [null, undefined, "fechamento_divergente", 22023, []]) {
      expect(ehDivergenciaDoCaixa(lixo)).toBe(false);
    }
  });

  it("a frase da divergência vence o texto do banco, mesmo sob 22023 com mensagem", () => {
    expect(
      mensagemDeErroFinanceiro({
        code: "22023",
        details: "tentativa_divergente",
        message: "Texto que o banco escreveu.",
      }),
    ).toBe(FRASE_DIVERGENTE);
    // O mesmo código com outro detalhe mostra o texto do banco.
    expect(
      mensagemDeErroFinanceiro({
        code: "22023",
        details: "outra_coisa",
        message: "Texto que o banco escreveu.",
      }),
    ).toBe("Texto que o banco escreveu.");
  });
});

describe("mensagemDeErroFinanceiro: leitura da FORMA do erro", () => {
  it("código que não é texto conta como SEM código (rede), não como 22023", () => {
    expect(
      mensagemDeErroFinanceiro({ code: 22023, message: "Qualquer coisa." }),
    ).toBe(
      "Não consegui falar com o servidor. Confira a conexão e tente de novo.",
    );
  });

  it("22023 com mensagem em branco não mostra branco: cai na frase genérica", () => {
    expect(mensagemDeErroFinanceiro({ code: "22023", message: "   " })).toBe(
      "Algo deu errado no servidor. Tente de novo em instantes.",
    );
    expect(mensagemDeErroFinanceiro({ code: "P0001" })).toBe(
      "Algo deu errado no servidor. Tente de novo em instantes.",
    );
  });

  it("só o grupo 23xxx e o 22P02 são 'o banco recusou os dados'", () => {
    const recusou =
      "O banco recusou os dados. Confira os campos e tente de novo.";
    const generica = "Algo deu errado no servidor. Tente de novo em instantes.";
    expect(mensagemDeErroFinanceiro({ code: "23000", message: "x" })).toBe(
      recusou,
    );
    expect(mensagemDeErroFinanceiro({ code: "23514", message: "x" })).toBe(
      recusou,
    );
    expect(mensagemDeErroFinanceiro({ code: "22P02", message: "x" })).toBe(
      recusou,
    );
    expect(mensagemDeErroFinanceiro({ code: "24000", message: "x" })).toBe(
      generica,
    );
    expect(mensagemDeErroFinanceiro({ code: "22P03", message: "x" })).toBe(
      generica,
    );
  });

  it("prazo estourado mostra a própria frase; resposta fora do contrato manda atualizar o app", () => {
    expect(
      mensagemDeErroFinanceiro(new ErroDePrazoFinanceiro("A rede demorou.")),
    ).toBe("A rede demorou.");
    expect(
      mensagemDeErroFinanceiro(new ErroDeFormatoFinanceiro("fin_resumo")),
    ).toBe(
      "O servidor respondeu num formato que esta versão do app não entende. Atualize o app.",
    );
  });

  it("lançamento já resolvido exige mensagem: 22023 sem texto NÃO conta", () => {
    expect(ehLancamentoJaResolvido({ code: "22023" })).toBe(false);
    expect(ehLancamentoJaResolvido({ code: "22023", message: null })).toBe(
      false,
    );
  });

  it("a frase de 'não deu para confirmar' leva o que foi feito e onde conferir", () => {
    expect(fraseDeGravacaoSemConfirmacao("a conta foi criada", "a lista")).toBe(
      "A conexão falhou e não deu para confirmar se a conta foi criada. Feche esta tela e confira a lista antes de tentar de novo.",
    );
  });
});

describe("sentidoDoLancamento e efeitoNoSaldo", () => {
  const transferencia = {
    tipo: "transferencia" as const,
    contaId: "origem",
    contaDestinoId: "destino",
  };

  it("entrada entra e saída sai, com ou sem filtro de conta", () => {
    for (const filtro of [null, "origem", "qualquer"]) {
      expect(
        sentidoDoLancamento(
          { tipo: "entrada", contaId: "origem", contaDestinoId: null },
          filtro,
        ),
      ).toBe(1);
      expect(
        sentidoDoLancamento(
          { tipo: "saida", contaId: "origem", contaDestinoId: null },
          filtro,
        ),
      ).toBe(-1);
    }
  });

  it("transferência é neutra sem filtro; com filtro, entra no destino e sai da origem", () => {
    expect(sentidoDoLancamento(transferencia)).toBe(0);
    expect(sentidoDoLancamento(transferencia, null)).toBe(0);
    expect(sentidoDoLancamento(transferencia, "destino")).toBe(1);
    expect(sentidoDoLancamento(transferencia, "origem")).toBe(-1);
    expect(sentidoDoLancamento(transferencia, "terceira")).toBe(0);
  });

  it("sem filtro, conta vazia NUNCA casa com conta vazia: transferência sem destino não entra nem sai", () => {
    // Sem a guarda do filtro, `null === null` faria a linha parecer entrada.
    const semContas = {
      tipo: "transferencia" as const,
      contaId: null,
      contaDestinoId: null,
    };
    expect(sentidoDoLancamento(semContas)).toBe(0);
    expect(sentidoDoLancamento(semContas, null)).toBe(0);
    expect(sentidoDoLancamento(semContas, "")).toBe(0);
    expect(
      sentidoDoLancamento({ ...transferencia, contaDestinoId: null }, null),
    ).toBe(0);
  });

  it("só o que foi REALIZADO mexe no saldo; o valor entra sempre em módulo", () => {
    const base = {
      tipo: "saida" as const,
      valor: 25.5,
      contaId: "c",
      contaDestinoId: null,
    };
    expect(efeitoNoSaldo({ ...base, status: "realizado" })).toBe(-25.5);
    expect(efeitoNoSaldo({ ...base, status: "previsto" })).toBe(0);
    expect(efeitoNoSaldo({ ...base, status: "cancelado" })).toBe(0);
    expect(efeitoNoSaldo({ ...base, status: "realizado", valor: -25.5 })).toBe(
      -25.5,
    );
    expect(
      efeitoNoSaldo({
        ...base,
        tipo: "entrada",
        status: "realizado",
        valor: -10,
      }),
    ).toBe(10);
    expect(
      efeitoNoSaldo(
        { ...transferencia, status: "realizado", valor: 40 },
        "destino",
      ),
    ).toBe(40);
    expect(
      efeitoNoSaldo({ ...transferencia, status: "realizado", valor: 40 }),
    ).toBe(0);
  });
});

describe("ultimos30Dias: 30 dias contando hoje", () => {
  it("termina hoje e começa 29 dias antes", () => {
    expect(ultimos30Dias("2026-09-26")).toEqual({
      inicio: "2026-08-28",
      fim: "2026-09-26",
    });
  });

  it("atravessa fevereiro de ano comum (28 dias) e de ano bissexto (29 dias)", () => {
    expect(ultimos30Dias("2026-03-01")).toEqual({
      inicio: "2026-01-31",
      fim: "2026-03-01",
    });
    expect(ultimos30Dias("2028-03-01")).toEqual({
      inicio: "2028-02-01",
      fim: "2028-03-01",
    });
  });

  it("atravessa a virada do ano", () => {
    expect(ultimos30Dias("2026-01-10")).toEqual({
      inicio: "2025-12-12",
      fim: "2026-01-10",
    });
  });
});

describe("ehDataIso: só data de calendário de verdade", () => {
  it.each(["2026-09-26", "2028-02-29", "2026-12-31", "2026-01-01"])(
    "%s é data",
    (valor) => {
      expect(ehDataIso(valor)).toBe(true);
    },
  );

  it.each([
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-1-01",
    "26-01-01",
    " 2026-01-01",
    "2026-01-01 ",
    "2026-01-01\n",
    "2026-01-01T00:00:00Z",
    "01/01/2026",
    "",
  ])("%j NÃO é data", (valor) => {
    expect(ehDataIso(valor)).toBe(false);
  });

  it("o que nem é texto não é data", () => {
    for (const lixo of [null, undefined, 20260926, new Date(0), {}, []]) {
      expect(ehDataIso(lixo)).toBe(false);
    }
  });
});

describe("paraCentavos: arredonda, não corta", () => {
  it.each([
    [0.29, 29],
    [0.57, 57],
    [1.15, 115],
    [8.85, 885],
    [0.07, 7],
    [19.9, 1990],
    [0, 0],
    [1234.56, 123456],
  ])("R$ %s são %s centavos", (reais, centavos) => {
    expect(paraCentavos(reais)).toBe(centavos);
  });
});
