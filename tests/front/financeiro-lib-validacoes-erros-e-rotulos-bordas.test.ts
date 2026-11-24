// Bordas da validação dos formulários, das frases de erro e dos rótulos do
// Financeiro (`src/lib/financeiro.ts`).
//
// A caça por mutação trocou uma regra de cada vez (`<=` por `<`, tirar uma
// guarda, apagar um código de erro, apagar um rótulo) e a suíte de lib seguia
// verde. Cada caso abaixo pega uma dessas trocas. Valores fictícios.
import { describe, expect, it } from "vitest";

import {
  ErroDeFormatoFinanceiro,
  ErroDePrazoFinanceiro,
  type FormularioDaCategoria,
  type FormularioDaConta,
  type FormularioDoLancamento,
  ehCaixaJaAberto,
  ehFalhaDeRedeSemCodigo,
  ehLancamentoJaResolvido,
  formularioInicialDoLancamento,
  gruposDaNatureza,
  mensagemDeErroFinanceiro,
  origemVemDoPedido,
  percentualDaReceita,
  rotuloDaForma,
  rotuloDaOrigem,
  rotuloDoStatus,
  validarCategoria,
  validarConta,
  validarLancamento,
} from "@/lib/financeiro";

const hoje = "2026-09-26";

const lancamento = (extra: Partial<FormularioDoLancamento> = {}) =>
  formularioInicialDoLancamento(hoje, {
    valor: "10,00",
    descricao: "Fornecedor",
    categoriaId: "cat",
    contaId: "banco",
    ...extra,
  });

const erros = (resultado: ReturnType<typeof validarLancamento>) =>
  resultado.ok ? {} : resultado.erros;

describe("lançamento: bordas da validação", () => {
  it("valor zero é recusado (precisa ser MAIOR que zero)", () => {
    for (const valor of ["0", "0,00", "R$ 0,00"]) {
      expect(erros(validarLancamento(lancamento({ valor }), hoje)).valor).toBe(
        "Informe um valor maior que zero.",
      );
    }
    expect(validarLancamento(lancamento({ valor: "0,01" }), hoje).ok).toBe(
      true,
    );
  });

  it("parcelas '0' é recusado; vazio e só espaços contam como 1 parcela", () => {
    expect(
      erros(
        validarLancamento(
          lancamento({ situacao: "previsto", parcelas: "0" }),
          hoje,
        ),
      ).parcelas,
    ).toBe("De 1 a 48 parcelas.");
    for (const parcelas of ["", "   "]) {
      const resultado = validarLancamento(
        lancamento({ situacao: "previsto", parcelas }),
        hoje,
      );
      expect(resultado.ok).toBe(true);
      if (resultado.ok)
        expect(resultado.payload).not.toHaveProperty("parcelas");
    }
  });

  it("observação: 500 caracteres passam, 501 não", () => {
    expect(
      validarLancamento(lancamento({ observacao: "a".repeat(500) }), hoje).ok,
    ).toBe(true);
    expect(
      erros(
        validarLancamento(lancamento({ observacao: "a".repeat(501) }), hoje),
      ).observacao,
    ).toBe("Use no máximo 500 caracteres.");
  });

  it("transferência é sempre realizada, mesmo que o formulário diga 'previsto'", () => {
    const resultado = validarLancamento(
      lancamento({
        tipo: "transferencia",
        situacao: "previsto",
        contaDestinoId: "caixa",
        categoriaId: "",
        dataRealizacao: "2026-09-20",
      }),
      hoje,
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.payload).toMatchObject({
        status: "realizado",
        data_realizacao: "2026-09-20",
        conta_destino_id: "caixa",
      });
      expect(resultado.payload).not.toHaveProperty("data_vencimento");
    }
  });

  it("transferência sem conta de destino pede a conta que recebe", () => {
    expect(
      erros(
        validarLancamento(
          lancamento({ tipo: "transferencia", categoriaId: "" }),
          hoje,
        ),
      ).contaDestinoId,
    ).toBe("Escolha a conta que recebe.");
  });

  it("mês de referência que não é data de calendário é recusado", () => {
    for (const dataCompetencia of ["", "2026-02-31", "setembro"]) {
      expect(
        erros(validarLancamento(lancamento({ dataCompetencia }), hoje))
          .dataCompetencia,
      ).toBe("Informe o mês de referência.");
    }
  });

  it("realizado sem data de pagamento válida, e previsto sem vencimento válido, são recusados", () => {
    expect(
      erros(validarLancamento(lancamento({ dataRealizacao: "" }), hoje))
        .dataRealizacao,
    ).toBe("Informe a data do pagamento.");
    expect(
      erros(
        validarLancamento(
          lancamento({ situacao: "previsto", dataVencimento: "" }),
          hoje,
        ),
      ).dataVencimento,
    ).toBe("Informe o vencimento.");
    expect(
      erros(
        validarLancamento(
          lancamento({ situacao: "previsto", dataVencimento: "2026-13-01" }),
          hoje,
        ),
      ).dataVencimento,
    ).toBe("Informe o vencimento.");
  });

  it("o formulário novo já nasce com data de hoje no pagamento, na competência e no vencimento", () => {
    expect(formularioInicialDoLancamento(hoje)).toMatchObject({
      dataCompetencia: hoje,
      dataRealizacao: hoje,
      dataVencimento: hoje,
      parcelas: "1",
      situacao: "realizado",
      tipo: "saida",
    });
  });
});

describe("conta e categoria: bordas da validação", () => {
  const conta = (
    extra: Partial<FormularioDaConta> = {},
  ): FormularioDaConta => ({
    nome: "Cofre",
    tipo: "outro",
    saldoInicial: "10,00",
    saldoInicialEm: "2026-09-01",
    ativa: true,
    ...extra,
  });

  it("nome da conta: 60 caracteres passam, 61 não", () => {
    expect(validarConta(conta({ nome: "a".repeat(60) }), hoje).ok).toBe(true);
    expect(validarConta(conta({ nome: "a".repeat(61) }), hoje)).toEqual({
      ok: false,
      erros: { nome: "Use no máximo 60 caracteres." },
    });
  });

  it("data do saldo inicial: hoje vale, amanhã não", () => {
    expect(validarConta(conta({ saldoInicialEm: hoje }), hoje).ok).toBe(true);
    expect(validarConta(conta({ saldoInicialEm: "2026-09-27" }), hoje)).toEqual(
      {
        ok: false,
        erros: {
          saldoInicialEm: "A data do saldo inicial não pode ser no futuro.",
        },
      },
    );
  });

  const categoria = (
    extra: Partial<FormularioDaCategoria> = {},
  ): FormularioDaCategoria => ({
    nome: "Vendas",
    natureza: "receita",
    grupoDre: "receita",
    ativa: true,
    ...extra,
  });

  it("nome da categoria: 60 caracteres passam, 61 não", () => {
    expect(validarCategoria(categoria({ nome: "a".repeat(60) })).ok).toBe(true);
    expect(validarCategoria(categoria({ nome: "a".repeat(61) }))).toEqual({
      ok: false,
      erros: { nome: "Use no máximo 60 caracteres." },
    });
  });

  it("categoria do sistema (só o nome muda) ignora o grupo, e só manda `ativa` quando verdadeiro", () => {
    const incompativel = categoria({ grupoDre: "despesa_fixa" });
    expect(validarCategoria(incompativel).ok).toBe(false);
    expect(validarCategoria(incompativel, true)).toEqual({
      ok: true,
      payload: { nome: "Vendas", ativa: true },
    });
    const inativa = validarCategoria(categoria({ ativa: false }), true);
    expect(inativa.ok).toBe(true);
    if (inativa.ok) expect(inativa.payload).toEqual({ nome: "Vendas" });
  });

  it("receita pode cair em receita, financeiro e fora do resultado; despesa em cinco grupos", () => {
    expect(gruposDaNatureza("receita")).toEqual([
      "receita",
      "financeiro",
      "fora_dre",
    ]);
    expect(gruposDaNatureza("despesa")).toEqual([
      "deducao",
      "custo_variavel",
      "despesa_fixa",
      "financeiro",
      "fora_dre",
    ]);
  });
});

describe("classificação dos erros do servidor", () => {
  it("caixa já aberto é só o código 23505", () => {
    expect(ehCaixaJaAberto({ code: "23505" })).toBe(true);
    expect(ehCaixaJaAberto({ code: "23506" })).toBe(false);
    expect(ehCaixaJaAberto({ code: "22023" })).toBe(false);
    expect(ehCaixaJaAberto(null)).toBe(false);
  });

  it("lançamento já resolvido: as duas frases do banco, e só sob 22023", () => {
    const erro = (code: string, message: string) => ({ code, message });
    expect(
      ehLancamentoJaResolvido(
        erro("22023", "Este lançamento já foi baixado ou cancelado."),
      ),
    ).toBe(true);
    expect(
      ehLancamentoJaResolvido(erro("22023", "O lançamento já está cancelado.")),
    ).toBe(true);
    expect(ehLancamentoJaResolvido(erro("22023", "Data no futuro."))).toBe(
      false,
    );
    expect(
      ehLancamentoJaResolvido(erro("P0001", "O lançamento já está cancelado.")),
    ).toBe(false);
  });

  it("falha de rede sem código: sim; prazo estourado, formato errado, função ausente e erro com código: não", () => {
    expect(ehFalhaDeRedeSemCodigo({ message: "Failed to fetch" })).toBe(true);
    expect(ehFalhaDeRedeSemCodigo(new ErroDePrazoFinanceiro("demorou"))).toBe(
      false,
    );
    expect(
      ehFalhaDeRedeSemCodigo(new ErroDeFormatoFinanceiro("fin_resumo")),
    ).toBe(false);
    expect(
      ehFalhaDeRedeSemCodigo({
        message: "Could not find the function public.fin_x",
      }),
    ).toBe(false);
    expect(ehFalhaDeRedeSemCodigo({ code: "42501", message: "negado" })).toBe(
      false,
    );
  });

  it.each([
    ["PGRST202", "O Financeiro ainda não foi instalado no banco desta loja."],
    ["42883", "O Financeiro ainda não foi instalado no banco desta loja."],
    ["42P01", "O Financeiro ainda não foi instalado no banco desta loja."],
    [
      "42501",
      "Só o administrador da loja mexe no Financeiro. Entre de novo com a conta de administrador.",
    ],
    [
      "PGRST301",
      "Só o administrador da loja mexe no Financeiro. Entre de novo com a conta de administrador.",
    ],
    ["23503", "O banco recusou os dados. Confira os campos e tente de novo."],
    ["22P02", "O banco recusou os dados. Confira os campos e tente de novo."],
    ["XX000", "Algo deu errado no servidor. Tente de novo em instantes."],
  ])("código %s vira a frase fixa da casa", (code, frase) => {
    expect(
      mensagemDeErroFinanceiro({ code, message: "texto técnico em inglês" }),
    ).toBe(frase);
  });

  it("recusa de negócio (P0001 e 22023) mostra o texto em português que o banco escreveu", () => {
    for (const code of ["P0001", "22023"]) {
      expect(
        mensagemDeErroFinanceiro({
          code,
          message: "Já existe um caixa aberto.",
        }),
      ).toBe("Já existe um caixa aberto.");
    }
  });

  it("função ausente sem código (só o texto) também vira 'não foi instalado'", () => {
    expect(
      mensagemDeErroFinanceiro({
        code: "X1",
        message: "Could not find the function public.fin_x",
      }),
    ).toBe("O Financeiro ainda não foi instalado no banco desta loja.");
  });
});

describe("rótulos em português", () => {
  it("forma de pagamento: o vocabulário do pedido e o do lançamento dizem o mesmo", () => {
    expect(rotuloDaForma("cash")).toBe("Dinheiro");
    expect(rotuloDaForma("dinheiro")).toBe("Dinheiro");
    expect(rotuloDaForma("card")).toBe("Cartão");
    expect(rotuloDaForma("cartao")).toBe("Cartão");
    expect(rotuloDaForma("credito")).toBe("Cartão de crédito");
    expect(rotuloDaForma("cartao_credito")).toBe("Cartão de crédito");
    expect(rotuloDaForma("debito")).toBe("Cartão de débito");
    expect(rotuloDaForma("cartao_debito")).toBe("Cartão de débito");
    expect(rotuloDaForma(null)).toBe("Não informada");
    expect(rotuloDaForma("")).toBe("Não informada");
  });

  it("origem do lançamento e status", () => {
    expect(rotuloDaOrigem("ajuste_caixa")).toBe("Ajuste de caixa");
    expect(rotuloDaOrigem("qualquer-coisa")).toBe("Lançamento");
    expect(rotuloDoStatus("cancelado")).toBe("Cancelado");
    expect(rotuloDoStatus("previsto")).toBe("Previsto");
    expect(rotuloDoStatus("realizado")).toBe("Realizado");
  });

  it("origens que nascem de pedido (e só elas)", () => {
    for (const origem of [
      "venda_online",
      "venda_balcao",
      "venda_entrega",
      "estorno",
      "estorno_externo",
      "devolucao",
    ]) {
      expect(origemVemDoPedido(origem)).toBe(true);
    }
    for (const origem of [
      "manual",
      "sangria",
      "suprimento",
      "ajuste_caixa",
      "",
    ]) {
      expect(origemVemDoPedido(origem)).toBe(false);
    }
  });
});

describe("percentual da receita", () => {
  it("receita líquida que arredonda para zero centavos não serve de base", () => {
    expect(percentualDaReceita(1, 0.004)).toBeNull();
    expect(percentualDaReceita(1, 0)).toBeNull();
    expect(percentualDaReceita(1, -10)).toBeNull();
    expect(percentualDaReceita(25, 100)).toBe(25);
  });
});
