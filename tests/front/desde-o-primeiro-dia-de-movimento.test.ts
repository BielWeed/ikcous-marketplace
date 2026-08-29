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
