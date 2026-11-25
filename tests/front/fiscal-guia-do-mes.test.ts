// Gestão Fiscal, tarefa 12: o pré-preenchimento do "Lançar a guia deste mês".
//
// ISTO É DINHEIRO: o que esta função monta abre o "Novo lançamento" do Financeiro e, se a
// lojista confirmar, vira lançamento de verdade (entra no Resultado, no Pagar e receber e
// no Início). Por isso a regra dura:
//
//   O VALOR DE UMA GUIA NUNCA É A ESTIMATIVA DO APP.
//
// No Simples o valor sai SEMPRE vazio: a lojista digita o da guia que recebeu. A função
// nem recebe a estimativa como parâmetro, de modo que preenchê-la é impossível, e o texto
// do módulo nem a cita (os testes abaixo provam as duas coisas). No MEI o valor é o fixo
// do DAS-MEI do ano, e só se o ano estiver conferido na lei.
//
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import {
  formularioInicialDoLancamento,
  parseValorBR,
  validarLancamento,
} from "@/lib/financeiro";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { guiaDoMes } from "@/lib/fiscal/guia-do-mes";
import { parametrosDoAno } from "@/lib/fiscal/parametros-da-lei";
import { CATEGORIA_DE_IMPOSTOS_ID } from "@/lib/fiscal/receita-do-mes";

type CadastroDaGuia = Pick<CadastroFiscal, "regime" | "atividade">;

const SIMPLES: CadastroDaGuia = { regime: "simples", atividade: "comercio" };
const MEI_COMERCIO: CadastroDaGuia = { regime: "mei", atividade: "comercio" };
const MEI_COM_SERVICO: CadastroDaGuia = {
  regime: "mei",
  atividade: "com_servico",
};

// O texto do próprio módulo, lido pelo Vite (`?raw`), sem API de Node.
const FONTE_DO_MODULO = import.meta.glob<string>(
  "/src/lib/fiscal/guia-do-mes.ts",
  { query: "?raw", import: "default", eager: true },
);

const HOJE = "2026-11-24";

/** A guia, ou erro do teste: assim o `null` não se repete em todo caso. */
function guia(
  cadastro: CadastroDaGuia | null,
  competencia: string,
  ano: number,
) {
  const resultado = guiaDoMes(cadastro, competencia, ano);
  if (resultado === null) throw new Error("devia haver guia");
  return resultado;
}

describe("guiaDoMes: o que o lançamento já vem preenchido", () => {
  it("despesa, a pagar, na categoria de impostos, com a descrição do mês", () => {
    expect(guia(SIMPLES, "2026-03", 2026)).toEqual({
      tipo: "saida",
      situacao: "previsto",
      categoriaId: "f2000000-0000-4000-8000-000000000011",
      dataCompetencia: "2026-03-01",
      dataVencimento: "2026-04-20",
      descricao: "DAS 03/2026",
      valor: "",
    });
  });

  it("a categoria é a MESMA que o caderno e a receita do mês usam", () => {
    expect(guia(SIMPLES, "2026-03", 2026).categoriaId).toBe(
      CATEGORIA_DE_IMPOSTOS_ID,
    );
  });

  it("a competência é o mês das VENDAS (dia 1) e o vencimento é no mês seguinte", () => {
    const g = guia(SIMPLES, "2026-01", 2026);
    expect(g.dataCompetencia).toBe("2026-01-01");
    expect(g.dataVencimento).toBe("2026-02-20");
  });

  it("vencimento em sábado ou domingo vai para a segunda (a regra de calendário é a da lei)", () => {
    // 20/06/2026 é sábado; 20/09/2026 é domingo.
    expect(guia(SIMPLES, "2026-05", 2026).dataVencimento).toBe("2026-06-22");
    expect(guia(SIMPLES, "2026-08", 2026).dataVencimento).toBe("2026-09-21");
  });

  it("dezembro vence em janeiro do ano seguinte, e a descrição fica no ano das vendas", () => {
    const g = guia(SIMPLES, "2026-12", 2026);
    expect(g.dataCompetencia).toBe("2026-12-01");
    expect(g.dataVencimento).toBe("2027-01-20");
    expect(g.descricao).toBe("DAS 12/2026");
  });

  it("não escolhe conta, forma de pagamento nem dia de pagamento: isso é da lojista", () => {
    const g = guia(SIMPLES, "2026-03", 2026);
    expect(g).not.toHaveProperty("contaId");
    expect(g).not.toHaveProperty("formaPagamento");
    expect(g).not.toHaveProperty("dataRealizacao");
  });

  it("cada chamada devolve um objeto novo (quem recebe pode mexer sem afetar a próxima)", () => {
    const a = guia(SIMPLES, "2026-03", 2026);
    const b = guia(SIMPLES, "2026-03", 2026);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("guiaDoMes: competência que não existe", () => {
  it.each(["2026-13", "2026-00", "2026-3", "", "2026-03-01", "março/2026"])(
    "'%s' não abre formulário nenhum (null), em vez de chutar uma data",
    (competencia) => {
      expect(guiaDoMes(SIMPLES, competencia, 2026)).toBeNull();
    },
  );
});

describe("guiaDoMes: o valor no Simples é SEMPRE vazio", () => {
  it("Simples: valor vazio", () => {
    expect(guia(SIMPLES, "2026-03", 2026).valor).toBe("");
  });

  it("mesmo que alguém passe uma estimativa, o valor continua vazio", () => {
    // A função só tem 3 parâmetros: não há onde pôr a estimativa. Se alguém forçar um
    // quarto argumento por fora do tipo (JS puro, `as`), ele é ignorado.
    const comEstimativaForcada = guiaDoMes as unknown as (
      ...argumentos: unknown[]
    ) => ReturnType<typeof guiaDoMes>;
    const g = comEstimativaForcada(SIMPLES, "2026-03", 2026, 410);
    expect(g?.valor).toBe("");
    expect(JSON.stringify(g)).not.toContain("410");
  });

  it("a assinatura tem 3 parâmetros e o TypeScript recusa um quarto", () => {
    expect(guiaDoMes.length).toBe(3);
    // @ts-expect-error a função não aceita estimativa: esta linha só compila se o quarto argumento for recusado
    guiaDoMes(SIMPLES, "2026-03", 2026, 410);
  });

  it("o módulo nem cita a estimativa: não importa o cálculo e não tem o nome dela", () => {
    const [fonte] = Object.values(FONTE_DO_MODULO);
    // Sanidade: achou mesmo o arquivo (senão o teste passaria "vazio").
    expect(fonte).toContain("guiaDoMes");
    expect(fonte).not.toMatch(/estimativa|estimar|estimad/i);
  });

  it("o módulo não importa nada que grave lançamento nem fale com o banco", () => {
    const [fonte] = Object.values(FONTE_DO_MODULO);
    expect(fonte).not.toMatch(
      /salvarLancamento|baixarLancamento|fin_lancamento_salvar|supabase/i,
    );
  });
});

describe("guiaDoMes: quem não tem conta também ganha a guia, com valor vazio", () => {
  it.each([
    ["Simples com serviço", { regime: "simples", atividade: "com_servico" }],
    ["Lucro Presumido", { regime: "presumido", atividade: "comercio" }],
    ["Lucro Real", { regime: "real", atividade: "com_servico" }],
    ["Não sei", { regime: "nao_sei", atividade: "comercio" }],
  ] as const)("%s: valor vazio", (_nome, cadastro) => {
    const g = guia(cadastro, "2026-03", 2026);
    expect(g.valor).toBe("");
    expect(g.categoriaId).toBe(CATEGORIA_DE_IMPOSTOS_ID);
  });

  it("loja sem cadastro fiscal: valor vazio (não supõe regime nenhum)", () => {
    const g = guia(null, "2026-03", 2026);
    expect(g.valor).toBe("");
    expect(g.descricao).toBe("DAS 03/2026");
  });
});

describe("guiaDoMes: o MEI com o ano conferido", () => {
  it("comércio: o DAS-MEI fixo do comércio, em texto que o campo de dinheiro lê", () => {
    const g = guia(MEI_COMERCIO, "2026-03", 2026);
    expect(g.valor).toBe("82.05");
    expect(parseValorBR(g.valor ?? "")).toBe(82.05);
  });

  it("com serviço: o DAS-MEI de comércio e serviço (a loja vende produtos E presta serviço)", () => {
    const g = guia(MEI_COM_SERVICO, "2026-03", 2026);
    expect(g.valor).toBe("87.05");
  });

  it("o valor sai do módulo da lei, não de um número solto aqui", () => {
    const lei = parametrosDoAno(2026);
    if (!lei.conferido) throw new Error("2026 devia estar conferido");
    expect(parseValorBR(guia(MEI_COMERCIO, "2026-03", 2026).valor ?? "")).toBe(
      lei.mei.dasPorAtividade.comercio,
    );
    expect(
      parseValorBR(guia(MEI_COM_SERVICO, "2026-03", 2026).valor ?? ""),
    ).toBe(lei.mei.dasPorAtividade.comercioEServico);
  });

  it("o MEI continua com o resto igual: despesa, a pagar, categoria de impostos", () => {
    const g = guia(MEI_COMERCIO, "2026-03", 2026);
    expect(g.tipo).toBe("saida");
    expect(g.situacao).toBe("previsto");
    expect(g.categoriaId).toBe(CATEGORIA_DE_IMPOSTOS_ID);
    expect(g.dataVencimento).toBe("2026-04-20");
  });
});

describe("guiaDoMes: o MEI com o ano NÃO conferido nunca usa valor velho", () => {
  it.each([2025, 2027, 2028, 1999])(
    "ano %i: valor vazio (nem o de 2026 emprestado)",
    (ano) => {
      const g = guia(MEI_COMERCIO, `${ano}-03`, ano);
      expect(g.valor).toBe("");
      // O resto do formulário continua útil: a lojista só digita o valor.
      expect(g.descricao).toBe(`DAS 03/${ano}`);
      expect(g.categoriaId).toBe(CATEGORIA_DE_IMPOSTOS_ID);
    },
  );

  it("ano que não bate com o mês das vendas: valor vazio, mesmo sendo um ano conferido", () => {
    // Competência de 2027 com "ano 2026" (ou o contrário) é erro de quem chamou. Na dúvida,
    // vazio: a lojista digita, e o app nunca grava o valor do ano errado.
    expect(guia(MEI_COMERCIO, "2027-01", 2026).valor).toBe("");
    expect(guia(MEI_COMERCIO, "2026-12", 2027).valor).toBe("");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 2026.5])(
    "ano %s que nem é um ano: valor vazio",
    (ano) => {
      expect(guia(MEI_COMERCIO, "2026-03", ano).valor).toBe("");
    },
  );
});

describe("guiaDoMes: o que passa pelo 'Novo lançamento' que já existe", () => {
  const CONTA = "conta-de-teste";

  it("com o valor digitado e uma conta escolhida, passa em validarLancamento", () => {
    const form = {
      ...formularioInicialDoLancamento(HOJE, guia(SIMPLES, "2026-03", 2026)),
      valor: "410,00",
      contaId: CONTA,
    };
    const resultado = validarLancamento(form, HOJE);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload).toMatchObject({
      tipo: "saida",
      valor: 410,
      conta_id: CONTA,
      categoria_id: CATEGORIA_DE_IMPOSTOS_ID,
      descricao: "DAS 03/2026",
      data_competencia: "2026-03-01",
      status: "previsto",
      data_vencimento: "2026-04-20",
    });
  });

  it("no Simples, sem digitar o valor NÃO passa: o app não deixa gravar guia sem valor", () => {
    const form = {
      ...formularioInicialDoLancamento(HOJE, guia(SIMPLES, "2026-03", 2026)),
      contaId: CONTA,
    };
    const resultado = validarLancamento(form, HOJE);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros.valor).toBeDefined();
    // E é só o valor que falta: o resto do pré-preenchimento já está válido.
    expect(Object.keys(resultado.erros)).toEqual(["valor"]);
  });

  it("no MEI conferido, o valor fixo já passa sem digitar (a lojista só escolhe a conta)", () => {
    const form = {
      ...formularioInicialDoLancamento(
        HOJE,
        guia(MEI_COMERCIO, "2026-03", 2026),
      ),
      contaId: CONTA,
    };
    const resultado = validarLancamento(form, HOJE);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.valor).toBe(82.05);
  });

  it("guia de um mês que já venceu continua a pagar (previsto), nunca vira pago sozinha", () => {
    const form = {
      ...formularioInicialDoLancamento(HOJE, guia(SIMPLES, "2025-01", 2025)),
      valor: "100",
      contaId: CONTA,
    };
    const resultado = validarLancamento(form, HOJE);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.status).toBe("previsto");
    expect(resultado.payload.data_realizacao).toBeUndefined();
  });
});
