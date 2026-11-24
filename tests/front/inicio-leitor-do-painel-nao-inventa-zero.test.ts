// O leitor do `painel_inicio()` (regra da casa: "não sei" nunca é zero) tinha
// cinco ramos que nenhum teste segurava (achados por mutação em 24/11/2026):
//  - texto vazio ou só espaço NÃO é o número zero (`Number("")` dá 0): a tela
//    mostraria "R$ 0,00" onde o banco não mandou nada;
//  - número infinito (um `1e999` no jsonb) não é medida;
//  - o caixa FECHADO (`false`) tem de chegar como fechado;
//  - `contas_vencidas` em forma de objeto aceita `quantidade` e, na falta dela,
//    `total`;
//  - `dinheiro_a_devolver` ausente ou fora da forma fica `null` (o cartão some),
//    nunca "R$ 0,00 de 0 pedidos".
// E a data ilegível mostra "—", não "Invalid Date".
import { formatarData, lerPainelInicio } from "@/lib/crm";
import { describe, expect, it } from "vitest";

describe("lerPainelInicio: ausência não vira zero", () => {
  it("texto vazio ou em branco vira null; texto numérico continua valendo", () => {
    const painel = lerPainelInicio({
      hoje: { receita: "", online: "   ", presencial: "12.5", pedidos: 3 },
    });
    expect(painel?.hoje.receita).toBeNull();
    expect(painel?.hoje.online).toBeNull();
    expect(painel?.hoje.presencial).toBe(12.5);
    expect(painel?.hoje.pedidos).toBe(3);
  });

  it("zero medido é zero, e infinito ou NaN não é medida", () => {
    const painel = lerPainelInicio({
      mes: {
        receita: 0,
        pedidos: Number.POSITIVE_INFINITY,
        ticket_medio: Number.NaN,
        lucro_estimado: "abc",
      },
    });
    expect(painel?.mes.receita).toBe(0);
    expect(painel?.mes.pedidos).toBeNull();
    expect(painel?.mes.ticketMedio).toBeNull();
    expect(painel?.mes.lucroEstimado).toBeNull();
  });

  it("caixa: false chega fechado, true chega aberto, sessão (objeto) é aberto, ausente é fechado", () => {
    const caixa = (valor: unknown) =>
      lerPainelInicio({ pendencias: { caixa_aberto: valor } })?.pendencias
        .caixaAberto;
    expect(caixa(false)).toBe(false);
    expect(caixa(true)).toBe(true);
    expect(caixa({ id: "sessao-1" })).toBe(true);
    expect(caixa(null)).toBe(false);
    expect(caixa(undefined)).toBe(false);
  });

  it("contas vencidas em objeto: lê `quantidade`; sem ela, lê `total`", () => {
    const vencidas = (valor: unknown) =>
      lerPainelInicio({ contas_vencidas: valor })?.contasVencidas;
    expect(vencidas(4)).toBe(4);
    expect(vencidas({ quantidade: 2 })).toBe(2);
    expect(vencidas({ total: 5 })).toBe(5);
    expect(vencidas({ quantidade: 2, total: 5 })).toBe(2);
    expect(vencidas({ outra: 1 })).toBeNull();
  });

  it("dinheiro a devolver: ausente ou fora da forma é null; presente mantém valor e pedidos", () => {
    expect(lerPainelInicio({})?.dinheiroADevolver).toBeNull();
    expect(
      lerPainelInicio({ dinheiro_a_devolver: "nada" })?.dinheiroADevolver,
    ).toBeNull();
    expect(
      lerPainelInicio({ dinheiro_a_devolver: [1, 2] })?.dinheiroADevolver,
    ).toBeNull();
    expect(
      lerPainelInicio({ dinheiro_a_devolver: { valor: 80, pedidos: 2 } })
        ?.dinheiroADevolver,
    ).toEqual({ valor: 80, pedidos: 2 });
    // Zero medido continua zero (o cartão some pela conta, não pelo parser).
    expect(
      lerPainelInicio({ dinheiro_a_devolver: { valor: 0, pedidos: 0 } })
        ?.dinheiroADevolver,
    ).toEqual({ valor: 0, pedidos: 0 });
  });
});

describe("formatarData: data ilegível", () => {
  it("texto que não é data nem instante mostra '—'", () => {
    expect(formatarData("amanhã cedo")).toBe("—");
    expect(formatarData("2026-13-45T99:99")).toBe("—");
    expect(formatarData(null)).toBe("—");
    expect(formatarData("2026-11-24")).toBe("24/11/2026");
  });
});
