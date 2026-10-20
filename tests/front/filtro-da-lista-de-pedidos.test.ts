// O filtro de datas da lista de pedidos pegava o dia errado, e a busca pelo
// número COM "#" mostrava o pedido de outra pessoa.
//
// O banco compara `created_at >= p_start_date::TIMESTAMPTZ` e roda em UTC: a
// data crua "2026-10-14" virava 00:00 UTC = 21:00 de 13/10 em Brasília. "14/10
// a 14/10" devolvia lista vazia, e "01/08 a 31/08" deixava de fora o dia 31
// inteiro e trazia a noite de 31/07. A tela passa a mandar o INSTANTE de
// início e de fim do dia da loja (Brasília, -03:00).
import {
  fimDoDiaDaLoja,
  inicioDoDiaDaLoja,
  instanteDentroDoPeriodo,
  termoDeBuscaDoPedido,
} from "@/lib/filtro-da-lista-de-pedidos";
import { describe, expect, it } from "vitest";

describe("início e fim do dia da loja (Brasília)", () => {
  it("o início é a meia-noite de Brasília e o fim é o último milissegundo do dia", () => {
    expect(inicioDoDiaDaLoja("2026-10-14")).toBe("2026-10-14T00:00:00-03:00");
    expect(fimDoDiaDaLoja("2026-10-14")).toBe("2026-10-14T23:59:59.999-03:00");
  });

  it("vazio, ausente ou lixo guardado no navegador viram 'sem limite' (nunca erro no banco)", () => {
    for (const entrada of [
      undefined,
      "",
      "14/10/2026",
      "2026-10-14T00:00",
      "2026-13-01",
      "2026-02-30",
      "abc",
    ]) {
      expect(inicioDoDiaDaLoja(entrada)).toBeUndefined();
      expect(fimDoDiaDaLoja(entrada)).toBeUndefined();
    }
  });

  it("dia bissexto existe e o 29/02 de ano comum não", () => {
    expect(inicioDoDiaDaLoja("2028-02-29")).toBe("2028-02-29T00:00:00-03:00");
    expect(inicioDoDiaDaLoja("2027-02-29")).toBeUndefined();
  });
});

describe("pedido dentro do período escolhido (conferência ao vivo e filtro)", () => {
  const dia14 = {
    inicio: inicioDoDiaDaLoja("2026-10-14"),
    fim: fimDoDiaDaLoja("2026-10-14"),
  };

  it("escolher UM dia só devolve o pedido das 23h30 de Brasília (que em UTC já é dia 15)", () => {
    // 23:30 em Brasília de 14/10 = 02:30 UTC de 15/10.
    expect(
      instanteDentroDoPeriodo(
        "2026-10-15T02:30:00.000Z",
        dia14.inicio,
        dia14.fim,
      ),
    ).toBe(true);
    // Pedido do meio da manhã do mesmo dia.
    expect(
      instanteDentroDoPeriodo(
        "2026-10-14T13:00:00.000+00:00",
        dia14.inicio,
        dia14.fim,
      ),
    ).toBe(true);
  });

  it("escolher UM dia só NÃO traz a noite de 13/10 nem a madrugada de 15/10", () => {
    // 23:59 de 13/10 em Brasília = 02:59 UTC de 14/10: texto "2026-10-14T02…"
    // parece estar dentro por comparação de texto, mas é do dia anterior.
    expect(
      instanteDentroDoPeriodo(
        "2026-10-14T02:59:59.000Z",
        dia14.inicio,
        dia14.fim,
      ),
    ).toBe(false);
    // 00:00 de 15/10 em Brasília = 03:00 UTC de 15/10.
    expect(
      instanteDentroDoPeriodo(
        "2026-10-15T03:00:00.000Z",
        dia14.inicio,
        dia14.fim,
      ),
    ).toBe(false);
    // Os extremos exatos do dia entram.
    expect(
      instanteDentroDoPeriodo(
        "2026-10-14T03:00:00.000Z",
        dia14.inicio,
        dia14.fim,
      ),
    ).toBe(true);
    expect(
      instanteDentroDoPeriodo(
        "2026-10-15T02:59:59.999Z",
        dia14.inicio,
        dia14.fim,
      ),
    ).toBe(true);
  });

  it("o mês inteiro (01/08 a 31/08) inclui o dia 31 e exclui a noite de 31/07", () => {
    const inicio = inicioDoDiaDaLoja("2026-08-01");
    const fim = fimDoDiaDaLoja("2026-08-31");
    // 23:30 de 31/08 em Brasília = 02:30 UTC de 01/09: era o dia que sumia.
    expect(instanteDentroDoPeriodo("2026-09-01T02:30:00Z", inicio, fim)).toBe(
      true,
    );
    // 22:00 de 31/07 em Brasília = 01:00 UTC de 01/08: era a venda que entrava
    // no mês errado.
    expect(instanteDentroDoPeriodo("2026-08-01T01:00:00Z", inicio, fim)).toBe(
      false,
    );
    // Primeiro minuto de agosto e primeiro minuto de setembro.
    expect(instanteDentroDoPeriodo("2026-08-01T03:00:00Z", inicio, fim)).toBe(
      true,
    );
    expect(instanteDentroDoPeriodo("2026-09-01T03:00:00Z", inicio, fim)).toBe(
      false,
    );
  });

  it("só o início, só o fim, ou nenhum dos dois", () => {
    expect(
      instanteDentroDoPeriodo("2026-01-01T00:00:00Z", dia14.inicio, undefined),
    ).toBe(false);
    expect(
      instanteDentroDoPeriodo("2030-01-01T00:00:00Z", dia14.inicio, undefined),
    ).toBe(true);
    expect(
      instanteDentroDoPeriodo("2030-01-01T00:00:00Z", undefined, dia14.fim),
    ).toBe(false);
    expect(
      instanteDentroDoPeriodo("2026-01-01T00:00:00Z", undefined, dia14.fim),
    ).toBe(true);
    expect(
      instanteDentroDoPeriodo("2026-01-01T00:00:00Z", undefined, undefined),
    ).toBe(true);
  });

  it("limite que não é data é ignorado (não esconde todo pedido novo); pedido sem data legível não passa por um limite real", () => {
    expect(
      instanteDentroDoPeriodo("2026-10-14T12:00:00Z", "lixo", "lixo"),
    ).toBe(true);
    expect(instanteDentroDoPeriodo("sem-data", dia14.inicio, dia14.fim)).toBe(
      false,
    );
    expect(instanteDentroDoPeriodo("sem-data", undefined, undefined)).toBe(
      true,
    );
  });
});

describe("termo de busca do pedido", () => {
  it("tira o '#' do começo: o número aparece com '#' em toda parte do app", () => {
    expect(termoDeBuscaDoPedido("#3884BE")).toBe("3884BE");
    expect(termoDeBuscaDoPedido("  #3884BE  ")).toBe("3884BE");
    expect(termoDeBuscaDoPedido("# 3884BE")).toBe("3884BE");
  });

  it("não mexe no que não começa com '#', nem no '#' do meio", () => {
    expect(termoDeBuscaDoPedido("3884BE")).toBe("3884BE");
    expect(termoDeBuscaDoPedido("  Maria da Silva ")).toBe("Maria da Silva");
    expect(termoDeBuscaDoPedido("cupom#10")).toBe("cupom#10");
  });

  it("só o '#', vazio ou ausente viram busca vazia (lista completa)", () => {
    expect(termoDeBuscaDoPedido("#")).toBe("");
    expect(termoDeBuscaDoPedido("   ")).toBe("");
    expect(termoDeBuscaDoPedido("")).toBe("");
    expect(termoDeBuscaDoPedido(undefined)).toBe("");
  });

  it("tira só UM '#' (o segundo faz parte do que ela digitou)", () => {
    expect(termoDeBuscaDoPedido("##3884BE")).toBe("#3884BE");
  });
});
