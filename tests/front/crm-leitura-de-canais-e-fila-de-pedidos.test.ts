// O que a leitura de `crm_visao` faz com canais e fila de pedidos e nenhum
// teste segurava (achado por mutação em 24/11/2026):
//  - canal sem nenhum pedido: o valor médio é ZERO, nunca NaN (a tela
//    escreveria "R$ NaN" no cartão "App × loja física");
//  - valor médio que a RPC manda vale, mesmo zero, e não ganha "valor de
//    exibição" por cima; sem o da RPC, o front calcula e já traz o centavo
//    arredondado para exibir;
//  - a fila de pedidos em aberto guarda desde quando o mais antigo espera
//    (é dela que sai o selo "parado há N dias").
import { lerVisaoDoCrm } from "@/lib/crm";
import { describe, expect, it } from "vitest";

const lerCanais = (canais: unknown[]) =>
  lerVisaoDoCrm({ canais })?.canais ?? [];

describe("canais do CRM: valor médio quando a RPC não manda o dela", () => {
  it("canal sem pedido nenhum: valor médio zero (nunca NaN) e sem valor de exibição", () => {
    const [online] = lerCanais([{ canal: "online", receita: 0, pedidos: 0 }]);

    expect(online.ticketMedio).toBe(0);
    expect(Number.isNaN(online.ticketMedio)).toBe(false);
    expect(online).not.toHaveProperty("ticketMedioExibido");
  });

  it("canal com pedidos: receita ÷ pedidos, e o valor de exibição vem arredondado ao centavo", () => {
    const [loja] = lerCanais([
      { canal: "presencial", receita: 100, pedidos: 3 },
    ]);

    expect(loja.ticketMedio).toBeCloseTo(33.3333333, 5);
    expect(loja.ticketMedioExibido).toBe(33.33);
  });

  it("canal com pedidos fechados em R$ 0,00 (brinde): valor médio zero medido, exibido zero", () => {
    const [app] = lerCanais([{ canal: "online", receita: 0, pedidos: 2 }]);

    expect(app.ticketMedio).toBe(0);
    expect(app.ticketMedioExibido).toBe(0);
  });

  it("o valor médio da RPC manda: vale mesmo zero e não ganha valor de exibição", () => {
    const [comValor, comZero] = lerCanais([
      { canal: "online", receita: 100, pedidos: 2, ticket_medio: 40 },
      { canal: "presencial", receita: 100, pedidos: 2, ticket_medio: 0 },
    ]);

    expect(comValor.ticketMedio).toBe(40);
    expect(comValor).not.toHaveProperty("ticketMedioExibido");
    expect(comZero.ticketMedio).toBe(0);
    expect(comZero).not.toHaveProperty("ticketMedioExibido");
  });
});

describe("fila de pedidos do CRM", () => {
  it("guarda desde quando o pedido mais antigo de cada etapa espera; sem a data, null", () => {
    const visao = lerVisaoDoCrm({
      pipeline: [
        {
          status: "processing",
          quantidade: 4,
          mais_antigo_em: "2026-11-10T12:00:00Z",
        },
        { status: "pending", quantidade: 1 },
      ],
    });

    expect(visao?.pipeline).toEqual([
      {
        status: "processing",
        quantidade: 4,
        maisAntigoEm: "2026-11-10T12:00:00Z",
      },
      { status: "pending", quantidade: 1, maisAntigoEm: null },
    ]);
  });
});
