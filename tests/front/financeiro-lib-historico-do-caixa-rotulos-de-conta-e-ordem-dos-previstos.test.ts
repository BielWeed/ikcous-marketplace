// Pontas soltas de `src/lib/financeiro.ts` que a caça por mutação achou sem
// nenhum teste direto (as telas só passavam por elas de raspão):
//  - `parseCaixaHistorico`: o histórico de fechamentos do caixa. Troquei o
//    padrão de `status` ("fechado" virou "aberto") e a suíte seguiu verde.
//  - `rotuloDoTipoDeConta` / `TIPOS_DE_CONTA`: o texto que a lojista lê ao
//    escolher e ao ver o tipo da conta ("Caixa físico" virou "Caixa", verde).
//  - `ajudaDoGrupoDre`: a ajuda de cada grupo na folha de categoria.
//  - `ordenarPorVencimento`: trocar o lado de quem não tem data seguia verde
//    porque o teste antigo só testava UMA ordem de entrada.
// Valores e nomes fictícios.
import { describe, expect, it } from "vitest";

import {
  ErroDeFormatoFinanceiro,
  TIPOS_DE_CONTA,
  ajudaDoGrupoDre,
  gruposDaNatureza,
  ordenarPorVencimento,
  parseCaixaHistorico,
  parseContas,
  rotuloDoTipoDeConta,
  sentidoDoLancamento,
} from "@/lib/financeiro";

describe("parseCaixaHistorico: histórico de fechamentos do caixa", () => {
  it("lista ausente ou vazia vira lista vazia (jsonb_agg de zero linhas é NULL)", () => {
    expect(parseCaixaHistorico(null)).toEqual([]);
    expect(parseCaixaHistorico(undefined)).toEqual([]);
    expect(parseCaixaHistorico([])).toEqual([]);
  });

  it("resposta que não é lista é erro de formato, nunca uma lista inventada", () => {
    expect(() => parseCaixaHistorico({ id: "x" })).toThrow(
      ErroDeFormatoFinanceiro,
    );
    expect(() => parseCaixaHistorico("texto")).toThrow(ErroDeFormatoFinanceiro);
  });

  it("sessão completa: cada campo vai para o seu lugar, com centavos exatos", () => {
    expect(
      parseCaixaHistorico([
        {
          id: "sessao-1",
          conta_nome: "Caixa da frente",
          aberto_em: "2026-09-26T12:00:00Z",
          fechado_em: "2026-09-26T21:30:00Z",
          valor_abertura: "100.5",
          esperado: 150.25,
          contado: 148,
          diferenca: -2.25,
          status: "fechado",
        },
      ]),
    ).toEqual([
      {
        id: "sessao-1",
        contaNome: "Caixa da frente",
        abertoEm: "2026-09-26T12:00:00Z",
        fechadoEm: "2026-09-26T21:30:00Z",
        valorAbertura: 100.5,
        esperado: 150.25,
        contado: 148,
        diferenca: -2.25,
        status: "fechado",
      },
    ]);
  });

  it("só com o id: nome 'Caixa', abertura zero, números nulos e status 'fechado'", () => {
    expect(parseCaixaHistorico([{ id: "sessao-2" }])).toEqual([
      {
        id: "sessao-2",
        contaNome: "Caixa",
        abertoEm: "",
        fechadoEm: null,
        valorAbertura: 0,
        esperado: null,
        contado: null,
        diferenca: null,
        status: "fechado",
      },
    ]);
  });

  it("sessão ainda aberta mantém o status e o fechamento nulo (vazio e só espaço também)", () => {
    const [aberta, vazia] = parseCaixaHistorico([
      { id: "a", status: "aberto", fechado_em: null },
      { id: "b", status: "aberto", fechado_em: "   " },
    ]);
    expect(aberta?.status).toBe("aberto");
    expect(aberta?.fechadoEm).toBeNull();
    expect(vazia?.fechadoEm).toBeNull();
  });

  it("zero é número de verdade (caixa que bateu), texto vazio é 'sem número'", () => {
    const [bateu, semNumero] = parseCaixaHistorico([
      { id: "a", esperado: 0, contado: "0", diferenca: 0 },
      { id: "b", esperado: "", contado: null, diferenca: undefined },
    ]);
    expect(bateu).toMatchObject({ esperado: 0, contado: 0, diferenca: 0 });
    expect(semNumero).toMatchObject({
      esperado: null,
      contado: null,
      diferenca: null,
    });
  });

  it("a diferença do caixa mantém o sinal: a quebra continua negativa", () => {
    const [quebra, sobra] = parseCaixaHistorico([
      { id: "a", diferenca: -10 },
      { id: "b", diferenca: "7.5" },
    ]);
    expect(quebra?.diferenca).toBe(-10);
    expect(sobra?.diferenca).toBe(7.5);
  });

  it("valor com mais de 2 casas fecha em centavos (19,999 vira 20)", () => {
    const [sessao] = parseCaixaHistorico([
      { id: "a", valor_abertura: 19.999, esperado: "19.999" },
    ]);
    expect(sessao?.valorAbertura).toBe(20);
    expect(sessao?.esperado).toBe(20);
  });

  it("item sem id (ausente, vazio, só espaço) ou que não é objeto é descartado; os bons ficam na ordem", () => {
    const lista = parseCaixaHistorico([
      { id: "a" },
      { conta_nome: "sem id" },
      { id: "" },
      { id: "   " },
      null,
      "texto",
      [],
      { id: "b" },
    ]);
    expect(lista.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("tipo de conta: rótulo e lista oferecida na folha", () => {
  it("cada tipo tem o seu texto", () => {
    expect(rotuloDoTipoDeConta("caixa")).toBe("Caixa físico");
    expect(rotuloDoTipoDeConta("banco")).toBe("Conta bancária");
    expect(rotuloDoTipoDeConta("mercado_pago")).toBe("Mercado Pago");
    expect(rotuloDoTipoDeConta("outro")).toBe("Outra");
  });

  it("tipo desconhecido ou vazio cai em 'Outra', sem mostrar o código do banco", () => {
    expect(rotuloDoTipoDeConta("cripto")).toBe("Outra");
    expect(rotuloDoTipoDeConta("")).toBe("Outra");
  });

  it("a folha oferece os quatro tipos, na ordem, e o banco os lê de volta sem trocar por 'outro'", () => {
    expect(TIPOS_DE_CONTA).toEqual(["caixa", "banco", "mercado_pago", "outro"]);
    const lidas = parseContas(
      TIPOS_DE_CONTA.map((tipo, i) => ({ id: `c${i}`, tipo, ordem: i })),
    );
    expect(lidas.map((c) => c.tipo)).toEqual([...TIPOS_DE_CONTA]);
    // Cada tipo oferecido tem texto próprio (nenhum repete o outro).
    expect(new Set(TIPOS_DE_CONTA.map(rotuloDoTipoDeConta)).size).toBe(4);
  });
});

describe("ajudaDoGrupoDre: a frase de ajuda de cada grupo", () => {
  const trechos: Record<string, string> = {
    receita: "vendas, serviços, outras receitas",
    deducao: "devoluções, estornos, impostos sobre a venda",
    custo_variavel: "taxa do cartão e do Mercado Pago",
    despesa_fixa: "aluguel, salários, internet",
    financeiro: "Juros, tarifas do banco e rendimento",
    fora_dre: "aporte ou retirada do dono",
  };

  it("cada grupo explica o que entra nele, e nenhuma ajuda repete a outra", () => {
    for (const [grupo, trecho] of Object.entries(trechos)) {
      expect(ajudaDoGrupoDre(grupo)).toContain(trecho);
    }
    const todas = Object.keys(trechos).map(ajudaDoGrupoDre);
    expect(new Set(todas).size).toBe(6);
  });

  it("grupo desconhecido não escreve nada (o lugar da ajuda fica vazio)", () => {
    expect(ajudaDoGrupoDre("inventado")).toBe("");
    expect(ajudaDoGrupoDre("")).toBe("");
  });

  it("todo grupo que a folha oferece (para receita e para despesa) tem ajuda", () => {
    for (const natureza of ["receita", "despesa"] as const) {
      for (const grupo of gruposDaNatureza(natureza)) {
        expect(ajudaDoGrupoDre(grupo)).not.toBe("");
      }
    }
  });
});

describe("ordenarPorVencimento: quem não tem data fica no fim, em qualquer ordem de entrada", () => {
  type Item = { readonly id: string; readonly vencimento: string | null };
  const itens: readonly Item[] = [
    { id: "sem-1", vencimento: null },
    { id: "outubro", vencimento: "2026-10-01" },
    { id: "setembro", vencimento: "2026-09-01" },
    { id: "sem-2", vencimento: null },
  ];

  function permutacoes<T>(lista: readonly T[]): T[][] {
    if (lista.length <= 1) return [[...lista]];
    return lista.flatMap((escolhido, i) =>
      permutacoes([...lista.slice(0, i), ...lista.slice(i + 1)]).map(
        (resto) => [escolhido, ...resto],
      ),
    );
  }

  it("nas 24 ordens de entrada: mais antigo primeiro, depois os sem data, estes na ordem em que vieram", () => {
    for (const entrada of permutacoes(itens)) {
      const ids = ordenarPorVencimento(entrada).map((i) => i.id);
      expect(ids.slice(0, 2)).toEqual(["setembro", "outubro"]);
      const semData = entrada.filter((i) => i.vencimento === null);
      expect(ids.slice(2)).toEqual(semData.map((i) => i.id));
    }
  });

  it("não mexe na lista recebida", () => {
    const entrada = [...itens];
    ordenarPorVencimento(entrada);
    expect(entrada.map((i) => i.id)).toEqual(itens.map((i) => i.id));
  });

  it("lista vazia e item único passam sem erro", () => {
    expect(ordenarPorVencimento([])).toEqual([]);
    expect(ordenarPorVencimento([itens[0] as Item])).toEqual([itens[0]]);
  });
});

describe("sentidoDoLancamento: para onde o dinheiro vai, visto da conta", () => {
  it("entrada é 1 e saída é -1, com ou sem conta filtrada", () => {
    expect(
      sentidoDoLancamento({
        tipo: "entrada",
        contaId: "a",
        contaDestinoId: null,
      }),
    ).toBe(1);
    expect(
      sentidoDoLancamento(
        { tipo: "saida", contaId: "a", contaDestinoId: null },
        "b",
      ),
    ).toBe(-1);
  });

  it("transferência: neutra sem filtro; com filtro, entra no destino, sai da origem e é neutra para a terceira conta", () => {
    const transferencia = {
      tipo: "transferencia",
      contaId: "origem",
      contaDestinoId: "destino",
    } as const;
    expect(sentidoDoLancamento(transferencia)).toBe(0);
    expect(sentidoDoLancamento(transferencia, null)).toBe(0);
    expect(sentidoDoLancamento(transferencia, "destino")).toBe(1);
    expect(sentidoDoLancamento(transferencia, "origem")).toBe(-1);
    expect(sentidoDoLancamento(transferencia, "outra")).toBe(0);
  });

  it("transferência de uma conta para ela mesma (dado estranho) conta como entrada: o destino é olhado primeiro", () => {
    expect(
      sentidoDoLancamento(
        { tipo: "transferencia", contaId: "a", contaDestinoId: "a" },
        "a",
      ),
    ).toBe(1);
  });
});
