// O botão "Tudo" do gráfico do painel promete o histórico inteiro, mas a RPC
// `get_admin_analytics_v2` tem `p_limit_days DEFAULT 90` e o hook chamava SEM
// argumento — "Tudo" e "90D" mostravam o mesmo gráfico. A correção passa uma
// janela de anos na chamada (provada em
// dashboard-tudo-cobre-o-historico-inteiro.test.tsx) e apara, NA EXIBIÇÃO,
// os dias vazios antes da primeira venda — é isto que esta função faz, e é
// ela que impede a parede de barras zeradas à esquerda do "Tudo".
import { describe, expect, it } from "vitest";

import { desdeOPrimeiroDiaDeMovimento } from "@/utils/desde-o-primeiro-dia-de-movimento";

const dia = (revenue: number, orders = 0) => ({ revenue, orders });

describe("desdeOPrimeiroDiaDeMovimento — só a cabeça vazia é aparada", () => {
  it("dias zerados antes da primeira venda somem; o resto fica inteiro", () => {
    const historico = [
      dia(0),
      dia(0),
      dia(0),
      dia(120.5, 2),
      dia(0), // dia parado DEPOIS da primeira venda: é informação, fica
      dia(80, 1),
    ];
    const aparado = desdeOPrimeiroDiaDeMovimento(historico);
    expect(aparado).toHaveLength(3);
    expect(aparado[0]?.revenue).toBe(120.5);
    expect(aparado[2]?.revenue).toBe(80);
  });

  it("histórico que já começa com movimento volta intacto", () => {
    const historico = [dia(10, 1), dia(0), dia(5, 1)];
    expect(desdeOPrimeiroDiaDeMovimento(historico)).toBe(historico);
  });

  it("histórico sem movimento nenhum volta como veio — gráfico não some", () => {
    const historico = [dia(0), dia(0), dia(0)];
    expect(desdeOPrimeiroDiaDeMovimento(historico)).toBe(historico);
  });

  it("loja que só teve pedido (sem faturamento reconhecido) também conta como movimento", () => {
    const historico = [dia(0), dia(0, 1), dia(0)];
    const aparado = desdeOPrimeiroDiaDeMovimento(historico);
    expect(aparado).toHaveLength(2);
    expect(aparado[0]?.orders).toBe(1);
  });

  it("campo null não quebra a leitura", () => {
    const historico = [
      { revenue: null, orders: null },
      { revenue: 10, orders: null },
    ];
    expect(desdeOPrimeiroDiaDeMovimento(historico)).toHaveLength(1);
  });
});

// O dia de venda 100% estornada sem recuperar a peça tem receita 0, pedidos 0
// e LUCRO NEGATIVO (a RPC admite esse dia). Aparar a cabeça só por receita e
// pedidos descartava esse dia: "30 dias" somava lucro 20 e "Tudo" somava 60
// para a mesma loja. O lucro também é movimento.
describe("desdeOPrimeiroDiaDeMovimento — o lucro também é movimento", () => {
  const diaComLucro = (revenue: number, orders: number, profit: number) => ({
    revenue,
    orders,
    profit,
  });
  const somaDoLucro = (dias: { profit?: number | null }[]) =>
    dias.reduce((soma, d) => soma + (d.profit ?? 0), 0);

  it("dia anterior com receita 0, pedidos 0 e lucro negativo NÃO é descartado", () => {
    const historico = [
      diaComLucro(0, 0, 0),
      diaComLucro(0, 0, -40), // venda estornada sem recuperar a peça
      diaComLucro(100, 1, 60),
    ];
    const aparado = desdeOPrimeiroDiaDeMovimento(historico);
    expect(aparado).toHaveLength(2);
    expect(aparado[0]?.profit).toBe(-40);
    // "Tudo" tem de bater com "30 dias": mesma soma de lucro.
    expect(somaDoLucro(aparado)).toBe(somaDoLucro(historico.slice(-2)));
    expect(somaDoLucro(aparado)).toBe(20);
  });

  it("lucro positivo sem receita nem pedido também abre a série", () => {
    const historico = [diaComLucro(0, 0, 0), diaComLucro(0, 0, 15)];
    const aparado = desdeOPrimeiroDiaDeMovimento(historico);
    expect(aparado).toHaveLength(1);
    expect(aparado[0]?.profit).toBe(15);
  });

  it("dia zerado no MEIO continua no gráfico", () => {
    const historico = [
      diaComLucro(0, 0, 0),
      diaComLucro(0, 0, -40),
      diaComLucro(0, 0, 0), // parado no meio: informação, fica
      diaComLucro(100, 1, 60),
    ];
    const aparado = desdeOPrimeiroDiaDeMovimento(historico);
    expect(aparado).toHaveLength(3);
    expect(aparado[1]).toEqual(diaComLucro(0, 0, 0));
  });

  it("tudo zerado (inclusive o lucro) volta como veio", () => {
    const historico = [diaComLucro(0, 0, 0), diaComLucro(0, 0, 0)];
    expect(desdeOPrimeiroDiaDeMovimento(historico)).toBe(historico);
  });

  it("lucro null ou ausente não conta como movimento", () => {
    const historico = [
      { revenue: 0, orders: 0, profit: null },
      { revenue: 0, orders: 0 },
      { revenue: 10, orders: 1, profit: null },
    ];
    expect(desdeOPrimeiroDiaDeMovimento(historico)).toHaveLength(1);
  });

  it("histórico que já começa com lucro (sem receita) volta intacto", () => {
    const historico = [diaComLucro(0, 0, -5), diaComLucro(10, 1, 4)];
    expect(desdeOPrimeiroDiaDeMovimento(historico)).toBe(historico);
  });
});
