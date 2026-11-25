// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), cartão "Este mês" do Início. Defeitos de UMA
// linha que os testes vizinhos deixavam passar:
//  - margem exatamente zero no começo do mês NÃO é "em formação" (só a
//    NEGATIVA é);
//  - a largura mínima da coluna acompanha o MAIOR dos dois valores em reais;
//  - o esqueleto só existe sem dado: com o painel em mãos, "carregando" é
//    atualização em segundo plano, e sem painel e sem carregar não há
//    esqueleto (nada fica "ocupado" para sempre);
//  - "Como é calculado o lucro" abre e FECHA (toque duplo);
//  - "1 venda" no singular, "0 vendas" e "N vendas" no plural;
//  - a variação do mês compara com o mês ANTERIOR, com a frase honesta da
//    janela;
//  - a cor de cada número (lucro verde/vermelho/cinza; vendas, quantidade e
//    valor médio brancos quando há valor, cinzas quando zero);
//  - as frases da explicação e o "no mês" para leitor de tela.
// Valores inventados; nenhuma chamada de rede.
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import {
  VALOR_INICIO,
  valorNaCor,
} from "@/components/admin/inicio/visualDoInicio";
import { formatarMoeda } from "@/lib/crm";
import { classeDoTexto } from "@/lib/tons-de-estado";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Mes = PainelInicio["mes"];

function painel(mes: Partial<Mes>): PainelInicio {
  return {
    hoje: {
      receita: 0,
      online: 0,
      presencial: 0,
      pedidos: 0,
      receitaSemanaPassada: 0,
    },
    mes: {
      receita: 1000,
      receitaMesAnterior: 800,
      pedidos: 4,
      ticketMedio: 250,
      lucroEstimado: 300,
      ...mes,
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
}

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

const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\u00a0/g, " ");

function montar(
  mes: Partial<Mes>,
  opcoes: { carregando?: boolean; semPainel?: boolean } = {},
) {
  act(() =>
    raiz.render(
      <NumerosDoMes
        painel={opcoes.semPainel ? null : painel(mes)}
        carregando={opcoes.carregando ?? false}
      />,
    ),
  );
}

const secao = () => tela.querySelector("section");

describe("NumerosDoMes: margem zero no começo do mês", () => {
  it("dia 2, lucro exatamente zero: mostra 'Margem estimada 0%', sem 'em formação'", () => {
    vi.setSystemTime(new Date("2026-11-02T15:00:00Z"));
    montar({ receita: 1000, lucroEstimado: 0 });
    expect(texto(tela)).toContain("Margem estimada 0%");
    expect(texto(tela)).not.toContain("em formação");
  });
});

describe("NumerosDoMes: largura mínima da coluna", () => {
  it("acompanha o MAIOR dos dois valores em reais, mais 2", () => {
    const receita = 1234567.89;
    const lucro = 5;
    montar({ receita, lucroEstimado: lucro });
    const esperado =
      Math.max(formatarMoeda(receita).length, formatarMoeda(lucro).length) + 2;
    const estilo = tela
      .querySelector<HTMLElement>(".inicio-mes-valores")
      ?.getAttribute("style");
    expect(estilo).toContain(`${esperado}ch`);
  });

  it("e o inverso: lucro maior que a receita também manda na largura", () => {
    const receita = 5;
    const lucro = 1234567.89;
    montar({ receita, lucroEstimado: lucro });
    const esperado =
      Math.max(formatarMoeda(receita).length, formatarMoeda(lucro).length) + 2;
    const estilo = tela
      .querySelector<HTMLElement>(".inicio-mes-valores")
      ?.getAttribute("style");
    expect(estilo).toContain(`${esperado}ch`);
  });
});

describe("NumerosDoMes: esqueleto e 'ocupado'", () => {
  it("sem painel e carregando: esqueleto e ocupado", () => {
    montar({}, { semPainel: true, carregando: true });
    expect(secao()?.getAttribute("aria-busy")).toBe("true");
    expect(tela.querySelector(".inicio-mes-esqueleto")).not.toBeNull();
  });

  it("com painel em mãos, recarregar em segundo plano NÃO vira esqueleto", () => {
    montar({}, { carregando: true });
    expect(secao()?.getAttribute("aria-busy")).toBe("false");
    expect(tela.querySelector(".inicio-mes-esqueleto")).toBeNull();
  });

  it("sem painel e sem carregar: nada de esqueleto nem 'ocupado'", () => {
    montar({}, { semPainel: true, carregando: false });
    expect(secao()?.getAttribute("aria-busy")).toBe("false");
    expect(tela.querySelector(".inicio-mes-esqueleto")).toBeNull();
  });
});

describe("NumerosDoMes: 'Como é calculado o lucro'", () => {
  const botao = () =>
    Array.from(tela.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Como é calculado o lucro"),
    );

  it("abre e fecha a cada toque; a frase some ao fechar", () => {
    montar({});
    expect(botao()?.getAttribute("aria-expanded")).toBe("false");
    act(() => botao()?.click());
    expect(botao()?.getAttribute("aria-expanded")).toBe("true");
    expect(texto(tela)).toContain(
      "Desconta estornos, devoluções, custos e despesas, mesmo não pagas.",
    );
    expect(texto(tela)).toContain("Sem custo cadastrado, usa R$ 0 de custo.");
    act(() => botao()?.click());
    expect(botao()?.getAttribute("aria-expanded")).toBe("false");
    expect(texto(tela)).not.toContain("Desconta estornos");
  });

  it("a frase da margem do Financeiro só vem quando o banco manda a receita líquida", () => {
    montar({ receitaLiquida: 900 });
    act(() => botao()?.click());
    expect(texto(tela)).toContain("A margem é a mesma do Financeiro");
    act(() => botao()?.click());

    montar({ receitaLiquida: null });
    act(() => botao()?.click());
    expect(texto(tela)).not.toContain("A margem é a mesma do Financeiro");
  });
});

describe("NumerosDoMes: contagem de vendas e leitor de tela", () => {
  it("1 venda no singular; 0 e 3 no plural", () => {
    montar({ pedidos: 1, ticketMedio: 100 });
    expect(texto(tela)).toMatch(/1\s*venda ·/);
    montar({ pedidos: 0, ticketMedio: 0 });
    expect(texto(tela)).toMatch(/0\s*vendas ·/);
    montar({ pedidos: 3, ticketMedio: 100 });
    expect(texto(tela)).toMatch(/3\s*vendas ·/);
  });

  it("o rótulo 'Vendas pagas' leva ' no mês' escondido para o leitor de tela", () => {
    montar({});
    const oculto = tela.querySelector(".inicio-mes-vendas .sr-only");
    expect(oculto?.textContent).toBe(" no mês");
  });
});

describe("NumerosDoMes: variação contra o mês anterior", () => {
  it("receita 120 contra 100 no mês anterior: '20% a mais', com a janela honesta", () => {
    montar({ receita: 120, receitaMesAnterior: 100 });
    expect(texto(tela)).toContain(
      "20% a mais que nos mesmos dias do mês anterior",
    );
  });

  it("mês anterior sem base (zero): 'sem base de comparação'", () => {
    montar({ receita: 120, receitaMesAnterior: 0 });
    expect(texto(tela)).toContain("sem base de comparação");
  });
});

describe("NumerosDoMes: a cor de cada número", () => {
  const lucroEl = () =>
    tela.querySelector<HTMLElement>(".inicio-mes-lucro p:nth-of-type(2)");
  const vendasEl = () =>
    tela.querySelector<HTMLElement>(".inicio-mes-vendas p:nth-of-type(2)");
  const fortes = () =>
    Array.from(tela.querySelectorAll<HTMLElement>(".inicio-mes-volume strong"));

  it("lucro positivo é verde, negativo vermelho, zero cinza", () => {
    montar({ lucroEstimado: 300 });
    expect(lucroEl()?.className).toBe(
      `mt-1 whitespace-nowrap ${valorNaCor("positivo")}`,
    );
    montar({ lucroEstimado: -300 });
    expect(lucroEl()?.className).toBe(
      `mt-1 whitespace-nowrap ${valorNaCor("negativo")}`,
    );
    montar({ lucroEstimado: 0 });
    expect(lucroEl()?.className).toBe(
      `mt-1 whitespace-nowrap ${valorNaCor("neutro")}`,
    );
  });

  it("vendas pagas: branco com valor, cinza quando zero", () => {
    montar({ receita: 1000 });
    expect(vendasEl()?.className).toContain(VALOR_INICIO);
    montar({ receita: 0 });
    expect(vendasEl()?.className).toContain(valorNaCor("neutro"));
    expect(vendasEl()?.className).not.toContain(VALOR_INICIO);
  });

  it("quantidade de vendas e valor médio: brancos com valor, cinzas quando zero", () => {
    montar({ pedidos: 3, ticketMedio: 100 });
    expect(fortes()[0].className).toContain("text-white");
    expect(fortes()[1].className).toContain("text-white");

    // Com venda e valor médio zero: só o valor médio fica cinza.
    montar({ pedidos: 3, ticketMedio: 0 });
    expect(fortes()[0].className).toContain("text-white");
    expect(fortes()[1].className).toContain(classeDoTexto("neutro"));
    expect(fortes()[1].className).not.toContain("text-white");

    // Sem venda: a quantidade fica cinza e o valor médio vira traço.
    montar({ pedidos: 0, ticketMedio: 0 });
    expect(fortes()[0].className).toContain(classeDoTexto("neutro"));
    expect(fortes()[0].className).not.toContain("text-white");
    expect(fortes()[1].className).toContain(classeDoTexto("neutro"));
  });
});
