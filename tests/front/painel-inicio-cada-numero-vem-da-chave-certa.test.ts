// Início: cada número do painel sai da chave CERTA da RPC `painel_inicio()`.
//
// Nasceu de mutação (24/11/2026): trocar "a pagar em 7 dias" pela chave de "a
// receber", ou o "valor médio do mês" pela receita, não derrubava nenhum
// teste — o teste de contrato só conferia `hoje`, o lucro e o saldo. Todos os
// valores abaixo são DIFERENTES entre si de propósito: dois campos trocados
// nunca dão o mesmo número.
import { lerPainelInicio } from "@/lib/crm";
import { describe, expect, it } from "vitest";

describe("lerPainelInicio: cada campo vem da sua chave", () => {
  const JSON_DISTINTO = {
    hoje: {
      receita: 351.5,
      online: 201.25,
      presencial: 150.25,
      pedidos: 4,
      receita_semana_passada: 303,
    },
    mes: {
      receita: 9101,
      receita_mes_anterior: 7307,
      pedidos: 61,
      ticket_medio: 149.18,
      lucro_estimado: 3109,
      receita_liquida: 8803,
    },
    dinheiro_a_devolver: { valor: 230.5, pedidos: 3 },
    saldo_total: 12503.9,
    a_receber_7d: 811,
    a_pagar_7d: 457,
  };

  it("o mês, o que entra e o que sai em 7 dias, e o dinheiro a devolver não se misturam", () => {
    const painel = lerPainelInicio(JSON_DISTINTO);

    expect(painel?.mes).toEqual({
      receita: 9101,
      receitaMesAnterior: 7307,
      pedidos: 61,
      ticketMedio: 149.18,
      lucroEstimado: 3109,
      receitaLiquida: 8803,
    });
    expect(painel?.aReceber7d).toBe(811);
    expect(painel?.aPagar7d).toBe(457);
    expect(painel?.saldoTotal).toBe(12503.9);
    expect(painel?.dinheiroADevolver).toEqual({ valor: 230.5, pedidos: 3 });
  });

  it("dia da série sem receita é ZERO medido (não um valor inventado) e não some", () => {
    const painel = lerPainelInicio({
      ...JSON_DISTINTO,
      serie_14d: [{ dia: "2026-11-23" }, { dia: "2026-11-24", receita: 12.5 }],
    });

    expect(painel?.serie14d).toEqual([
      { dia: "2026-11-23", receita: 0 },
      { dia: "2026-11-24", receita: 12.5 },
    ]);
  });
});
