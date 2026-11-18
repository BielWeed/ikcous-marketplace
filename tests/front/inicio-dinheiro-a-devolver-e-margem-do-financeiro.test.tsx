// @vitest-environment jsdom
//
// Dois números do Início que não batiam com o resto do painel:
//
// 1. "Dinheiro a devolver": pedido pago e cancelado sem reembolso ficava fora de "Vendas pagas" (R$ 0) e dentro do
//    Financeiro (R$ 100), e o Início não dizia que a lojista ainda devia o dinheiro. Agora a lista "Para fazer" ganha a
//    linha "Dinheiro a devolver: R$ X de N pedido(s) cancelado(s)" (só com N > 0), que leva para a tela de Pedidos.
//    A regra de "venda" NÃO mudou; o número vem de painel_inicio().dinheiro_a_devolver (conta provada contra a lista
//    "Devolver agora" em inicio-dinheiro-a-devolver-bate-com-devolver-agora.test.tsx e na prova de banco).
//
// 2. "Margem estimada": o Início dividia o lucro pela receita BRUTA e a "Margem líquida" do Financeiro pela receita
//    LÍQUIDA (a mesma base do lucro). Agora o Início usa `mes.receitaLiquida` (a do fin_dre do mesmo período do lucro) e a
//    mesma regra do Financeiro (base zero ou negativa não tem margem). Banco antigo (campo ausente): conta de sempre.
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import { lerPainelInicio } from "@/lib/crm";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE: PainelInicio = {
  hoje: {
    receita: 0,
    online: 0,
    presencial: 0,
    pedidos: 0,
    receitaSemanaPassada: 0,
  },
  mes: {
    receita: 100,
    receitaMesAnterior: 80,
    pedidos: 4,
    ticketMedio: 25,
    lucroEstimado: 20,
  },
  saldoTotal: 0,
  aReceber7d: 0,
  aPagar7d: 0,
  contasVencidas: 0,
  pendencias: {
    pedidosParaPreparar: 0,
    devolucoesAbertas: 0,
    caixaAberto: false,
    estoqueBaixo: 0,
  },
  serie14d: [],
};

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  // Só o relógio: os temporizadores do hook do dia seguem reais.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  vi.useRealTimers();
});

const texto = () => (tela.textContent ?? "").replace(/\u00a0/g, " ");

describe("Início: linha 'Dinheiro a devolver' em Para fazer", () => {
  const montar = (painel: PainelInicio, onNavigate = vi.fn()) => {
    act(() =>
      raiz.render(
        <ParaFazer
          painel={painel}
          carregando={false}
          onNavigate={onNavigate}
        />,
      ),
    );
    return onNavigate;
  };
  const comDevolver = (valor: number | null, pedidos: number | null) => ({
    ...BASE,
    dinheiroADevolver: { valor, pedidos },
  });
  const linha = () =>
    Array.from(tela.querySelectorAll("button")).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Dinheiro a devolver"),
    );

  it("2 pedidos cancelados com R$ 150: aparece no plural, com o valor", () => {
    montar(comDevolver(150, 2));
    expect(texto()).toContain(
      "Dinheiro a devolver: R$ 150,00 de 2 pedidos cancelados",
    );
  });

  it("1 pedido: singular, sem 's' sobrando", () => {
    montar(comDevolver(100, 1));
    expect(texto()).toContain(
      "Dinheiro a devolver: R$ 100,00 de 1 pedido cancelado",
    );
    expect(texto()).not.toContain("1 pedidos");
    expect(texto()).not.toContain("1 pedido cancelados");
  });

  it("entra na contagem de pendências do cabeçalho e some o 'Tudo em dia'", () => {
    montar(comDevolver(100, 1));
    expect(texto()).toContain("1 pendência");
    expect(texto()).not.toContain("Tudo em dia");
  });

  it("tocar na linha leva para a tela de Pedidos (sem tela nova)", () => {
    const onNavigate = montar(comDevolver(100, 1));
    const botao = linha();
    expect(botao).toBeDefined();
    act(() => botao?.click());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("admin-orders");
  });

  it("zero pedidos: a linha não aparece e o Início diz 'Tudo em dia'", () => {
    montar(comDevolver(0, 0));
    expect(linha()).toBeUndefined();
    expect(texto()).not.toContain("Dinheiro a devolver");
    expect(texto()).toContain("Tudo em dia");
  });

  it("banco antigo (campo ausente) e campo fora da forma: nada aparece e nada quebra", () => {
    montar(BASE);
    expect(linha()).toBeUndefined();
    expect(texto()).toContain("Tudo em dia");
    montar({ ...BASE, dinheiroADevolver: null });
    expect(linha()).toBeUndefined();
    expect(texto()).toContain("Tudo em dia");
  });

  it("valor ou contagem desconhecidos: não inventa 'R$ 0,00 de N pedidos'", () => {
    montar(comDevolver(null, 2));
    expect(linha()).toBeUndefined();
    montar(comDevolver(150, null));
    expect(linha()).toBeUndefined();
    expect(texto()).not.toContain("Dinheiro a devolver");
  });

  it("junto de outras pendências: cada uma conta uma vez", () => {
    montar({
      ...comDevolver(100, 1),
      contasVencidas: 2,
    });
    expect(texto()).toContain("2 pendências");
    expect(texto()).toContain("2 contas vencidas");
    expect(texto()).toContain("Dinheiro a devolver");
  });
});

describe("Início: margem estimada é a margem líquida do Financeiro", () => {
  const montar = (mes: Partial<PainelInicio["mes"]>) =>
    act(() =>
      raiz.render(
        <NumerosDoMes
          painel={{ ...BASE, mes: { ...BASE.mes, ...mes } }}
          carregando={false}
        />,
      ),
    );

  it("receita 100, lucro 20, receita líquida 40: a margem é 50% (lucro sobre a líquida), não 20%", () => {
    montar({ receitaLiquida: 40 });
    expect(texto()).toContain("Margem estimada 50%");
    expect(texto()).not.toContain("Margem estimada 20%");
  });

  it("receita líquida igual à bruta: a mesma margem de antes", () => {
    montar({ receitaLiquida: 100 });
    expect(texto()).toContain("Margem estimada 20%");
  });

  it("banco antigo (sem receita líquida): a conta de sempre, lucro sobre a receita", () => {
    montar({});
    expect(texto()).toContain("Margem estimada 20%");
    montar({ receitaLiquida: null });
    expect(texto()).toContain("Margem estimada 20%");
  });

  it("receita líquida zero ou negativa (devolveu mais do que vendeu): sem margem, como no Financeiro", () => {
    montar({ receitaLiquida: 0 });
    expect(texto()).not.toContain("Margem estimada");
    montar({ receitaLiquida: -30 });
    expect(texto()).not.toContain("Margem estimada");
  });

  it("sem lucro conhecido: sem margem, mesmo com receita líquida", () => {
    montar({ receitaLiquida: 40, lucroEstimado: null });
    expect(texto()).not.toContain("Margem estimada");
  });

  it("margem negativa na segunda metade do mês mostra o número real; no começo do mês continua 'em formação'", () => {
    montar({ receitaLiquida: 50, lucroEstimado: -25 });
    expect(texto()).toContain("Margem estimada -50%");
    act(() => raiz.unmount());
    raiz = createRoot(tela);
    vi.setSystemTime(new Date("2026-11-02T15:00:00Z"));
    montar({ receitaLiquida: 50, lucroEstimado: -25 });
    expect(texto()).toContain("Margem estimada em formação");
    expect(texto()).not.toMatch(/Margem estimada\s*[-−]?\d/);
  });

  it("a explicação diz que a margem é a do Financeiro, só quando a conta é essa", () => {
    const abrir = () => {
      const botao = Array.from(tela.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Como é calculado o lucro"),
      );
      act(() => botao?.click());
    };
    montar({ receitaLiquida: 40 });
    abrir();
    expect(texto()).toContain("mesma do Financeiro");
    expect(texto()).toContain("receita líquida");
    act(() => raiz.unmount());
    raiz = createRoot(tela);
    montar({});
    abrir();
    expect(texto()).not.toContain("mesma do Financeiro");
    // A frase que já existia continua.
    expect(texto()).toContain(
      "Desconta estornos, devoluções, custos e despesas",
    );
  });
});

describe("lerPainelInicio: as duas chaves novas", () => {
  const json = {
    hoje: { receita: 10 },
    mes: { receita: 100, lucro_estimado: 20, receita_liquida: 40 },
    dinheiro_a_devolver: { valor: 150.5, pedidos: 2 },
  };

  it("lê dinheiro_a_devolver {valor, pedidos} e mes.receita_liquida", () => {
    const painel = lerPainelInicio(json);
    expect(painel?.dinheiroADevolver).toEqual({ valor: 150.5, pedidos: 2 });
    expect(painel?.mes.receitaLiquida).toBe(40);
  });

  it("chave ausente (banco antigo) vira null, nunca zero inventado", () => {
    const painel = lerPainelInicio({
      hoje: { receita: 10 },
      mes: { receita: 5 },
    });
    expect(painel?.dinheiroADevolver).toBeNull();
    expect(painel?.mes.receitaLiquida).toBeNull();
  });

  it("fora da forma (texto, lista, número solto) vira null; campo interno ruim vira null só nele", () => {
    for (const ruim of ["abc", [], 7, true]) {
      expect(
        lerPainelInicio({ dinheiro_a_devolver: ruim })?.dinheiroADevolver,
      ).toBeNull();
    }
    expect(
      lerPainelInicio({ dinheiro_a_devolver: { valor: "x", pedidos: 3 } })
        ?.dinheiroADevolver,
    ).toEqual({ valor: null, pedidos: 3 });
    expect(
      lerPainelInicio({ mes: { receita_liquida: "x" } })?.mes.receitaLiquida,
    ).toBeNull();
  });
});
