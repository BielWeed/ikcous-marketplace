// @vitest-environment jsdom
//
// O cartão "Sua assinatura" em TESTE (26/11/2026). `teste_ate` é o dia em que
// vence a 1ª mensalidade; "Teste até 03/12" fazia a lojista contar 8 dias de
// graça. O cartão passa a dizer o ÚLTIMO dia grátis (`teste_ate` − 1), conta
// os dias que faltam no calendário de São Paulo e, só quando o payload traz o
// valor, avisa em letra secundária quanto custa depois — nunca em destaque.
// Dados inventados; nenhuma chamada de rede.
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import { contagemDoTeste } from "@/lib/crm";
import type { AssinaturaDaLoja } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 26/11/2026, meio-dia em Brasília: o dia em que a lojista entrou.
const ENTRADA = new Date("2026-11-26T15:00:00Z");

describe("contagemDoTeste", () => {
  // Entrada 26/11, teste_ate 03/12 → último dia grátis 02/12.
  const TESTE_ATE = "2026-12-03";
  const meioDia = (dia: string) => new Date(`${dia}T15:00:00Z`);

  it("no dia da entrada faltam 7 dias (26/11 a 02/12, contando hoje)", () => {
    expect(contagemDoTeste(TESTE_ATE, ENTRADA)).toBe("Faltam 7 dias");
  });

  it("na véspera do último dia grátis ainda é 'Faltam 2 dias'", () => {
    expect(contagemDoTeste(TESTE_ATE, meioDia("2026-12-01"))).toBe(
      "Faltam 2 dias",
    );
  });

  it("no último dia grátis avisa que é o último", () => {
    expect(contagemDoTeste(TESTE_ATE, meioDia("2026-12-02"))).toBe(
      "Hoje é o último dia grátis",
    );
  });

  it("no dia de teste_ate a 1ª mensalidade vence hoje", () => {
    expect(contagemDoTeste(TESTE_ATE, meioDia("2026-12-03"))).toBe(
      "Sua primeira mensalidade vence hoje",
    );
  });

  it("depois de teste_ate, sem data ou com data ilegível não inventa contagem", () => {
    expect(contagemDoTeste(TESTE_ATE, meioDia("2026-12-04"))).toBeNull();
    expect(contagemDoTeste(null, ENTRADA)).toBeNull();
    expect(contagemDoTeste("amanhã", ENTRADA)).toBeNull();
  });

  it("o dia de hoje é o de Brasília, não o do UTC", () => {
    // 02/12 01:30Z = 01/12 22:30 em Brasília: ainda faltam 2 dias.
    expect(contagemDoTeste(TESTE_ATE, new Date("2026-12-02T01:30:00Z"))).toBe(
      "Faltam 2 dias",
    );
    // 02/12 03:30Z = 02/12 00:30 em Brasília: já é o último dia.
    expect(contagemDoTeste(TESTE_ATE, new Date("2026-12-02T03:30:00Z"))).toBe(
      "Hoje é o último dia grátis",
    );
  });

  it("instante ISO conta pelo dia em São Paulo", () => {
    // 04/12 02:00Z = 03/12 23:00 em Brasília: o teste_ate é 03/12.
    expect(contagemDoTeste("2026-12-04T02:00:00Z", ENTRADA)).toBe(
      "Faltam 7 dias",
    );
  });

  it("atravessa a virada do mês e do ano", () => {
    // teste_ate 02/01 → último grátis 01/01; em 30/12 faltam 3 dias.
    expect(contagemDoTeste("2027-01-02", meioDia("2026-12-30"))).toBe(
      "Faltam 3 dias",
    );
  });
});

describe("CartaoDaAssinatura em teste", () => {
  let tela: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ENTRADA);
    tela = document.createElement("div");
    document.body.appendChild(tela);
    raiz = createRoot(tela);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    tela.remove();
  });

  const base: AssinaturaDaLoja = {
    plano: "Plano Inventado",
    status: "teste",
    valorMensal: null,
    ciclo: null,
    inicioEm: "2026-11-26",
    proximaCobrancaEm: null,
    testeAte: "2026-12-03",
    pausaEm: null,
    recursos: [],
    gerenciarUrl: null,
    suporteWhatsapp: null,
    atualizadoEm: null,
  };

  function desenhar(parcial: Partial<AssinaturaDaLoja>) {
    act(() =>
      raiz.render(
        <CartaoDaAssinatura
          assinatura={{ ...base, ...parcial }}
          lida
          carregando={false}
          erro={null}
          onTentarDeNovo={() => undefined}
        />,
      ),
    );
  }

  const paragrafo = (trecho: string) =>
    Array.from(tela.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").includes(trecho),
    );

  it("mostra o último dia grátis e a contagem, sem 'Teste até'", () => {
    desenhar({});
    expect(tela.textContent).toContain("Grátis até");
    expect(tela.textContent).toContain("02/12/2026");
    expect(tela.textContent).not.toContain("Teste até");
    expect(tela.textContent).not.toContain("03/12/2026");
    expect(tela.textContent).toContain("Faltam 7 dias");
  });

  // 27/11/2026: o valor é o da PRÓXIMA cobrança, não o de todo mês (o app de
  // gestão manda o 1º mês negociado). A frase diz só a primeira mensalidade,
  // e o ciclo deixa de entrar nela ("por mês", "por ano" afirmavam demais).
  it("com valor no payload: só a linha pequena 'Depois, a primeira mensalidade...', nada em destaque", () => {
    desenhar({ valorMensal: 250, ciclo: "mensal" });
    const depois = paragrafo("Depois,");
    expect(depois?.textContent).toMatch(
      /^Depois, a primeira mensalidade é de R\$\s250,00\.$/,
    );
    expect(tela.textContent).not.toContain("por mês");
    expect(depois?.classList.contains("text-zinc-400")).toBe(true);
    expect(depois?.className).not.toMatch(/text-(xl|2xl)/);
    expect(tela.textContent).not.toContain("/mês");
    expect(tela.querySelector(".text-2xl")).toBeNull();
  });

  // 27/11/2026: antes o ciclo virava "por ano"/"por trimestre" na frase; com
  // o valor sendo a próxima cobrança, nenhum ciclo pendura período nela.
  it("nenhum ciclo (anual, trimestral, nulo, desconhecido) muda a frase", () => {
    for (const ciclo of [
      "anual",
      "trimestral",
      "Semestral",
      null,
      "quinzenal",
    ]) {
      desenhar({ valorMensal: 700, ciclo });
      expect(paragrafo("Depois,")?.textContent).toMatch(
        /^Depois, a primeira mensalidade é de R\$\s700,00\.$/,
      );
    }
  });

  it("a contagem vira à meia-noite de Brasília sem recarregar a tela", () => {
    vi.useFakeTimers();
    // 01/12 23:59:30 em Brasília.
    vi.setSystemTime(new Date("2026-12-02T02:59:30Z"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    desenhar({});
    expect(tela.textContent).toContain("Faltam 2 dias");
    act(() => vi.advanceTimersByTime(60_000));
    expect(tela.textContent).toContain("Hoje é o último dia grátis");
    expect(tela.textContent).not.toContain("Faltam");
  });

  it("plano cortesia (valor 0) em teste não promete 'Depois, R$ 0,00'", () => {
    desenhar({ valorMensal: 0, ciclo: "mensal" });
    expect(tela.textContent).not.toContain("Depois,");
    expect(tela.textContent).toContain("Faltam 7 dias");
  });

  it("sem valor no payload a linha 'Depois' não existe", () => {
    desenhar({ valorMensal: null, ciclo: "mensal" });
    expect(tela.textContent).not.toContain("Depois,");
  });

  it("outro status não ganha contagem nem 'Depois', e o valor segue em destaque", () => {
    desenhar({ status: "ativa", valorMensal: 250, ciclo: "mensal" });
    expect(tela.textContent).not.toContain("Faltam");
    expect(tela.textContent).not.toContain("Depois,");
    expect(tela.textContent).not.toContain("Grátis até");
    // 27/11/2026: em destaque como próxima cobrança, sem "/mês".
    expect(tela.querySelector(".text-2xl")?.textContent).toMatch(
      /^R\$\s250,00$/,
    );
    expect(tela.textContent).toContain("Próxima cobrança");
  });
});
