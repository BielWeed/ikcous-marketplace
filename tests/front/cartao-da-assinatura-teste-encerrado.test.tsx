// @vitest-environment jsdom
//
// O cartão "Sua assinatura" quando o teste grátis acabou sem pagamento
// (26/11/2026). A gestão manda `atrasada`; a lojista que só testou não deve
// nada e via "Atrasada" em vermelho, "Em aberto desde" e "Regularize". Com o
// sinal completo (`teste_ate` = próxima cobrança, valor > 0, `pausa_em` depois
// do vencimento ou ausente), o cartão vira "Teste encerrado" e diz o prazo com
// a mesma data do WhatsApp. Sinal torto: o cartão de hoje, inteiro. Os textos
// são montados com `formatarMoeda` (o formatador usa espaço especial).
// Dados inventados; nenhuma chamada de rede.
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import { formatarDiaEMes, formatarMoeda } from "@/lib/crm";
import { classeDoPonto, classeDoTexto } from "@/lib/tons-de-estado";
import type { AssinaturaDaLoja } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Meio-dia em Brasília (15h UTC) do dia pedido. */
const meioDia = (dia: string) => new Date(`${dia}T15:00:00Z`);

const base: AssinaturaDaLoja = {
  plano: "Plano Inventado",
  status: "atrasada",
  valorMensal: 250,
  ciclo: "mensal",
  inicioEm: "2026-11-26",
  proximaCobrancaEm: "2026-12-03",
  testeAte: "2026-12-03",
  pausaEm: "2026-12-07",
  recursos: ["PDV", "CRM"],
  gerenciarUrl: "https://cobranca.exemplo.com/minha-loja",
  suporteWhatsapp: "34999999999",
  atualizadoEm: null,
};

const ACABOU = `Seu teste grátis acabou. A primeira mensalidade, de ${formatarMoeda(250)}, venceu em 03/12.`;
const PRAZO =
  "Para continuar vendendo, pague até 06/12. Sem o pagamento, os pedidos pela loja ficam pausados a partir de 07/12.";
const GENERICA = "Para continuar vendendo, pague a mensalidade.";
const JA_PAGOU =
  "Já pagou? Assim que confirmarmos o pagamento, este aviso some sozinho.";

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(meioDia("2026-12-05"));
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

const paragrafos = () =>
  Array.from(tela.querySelectorAll("p")).map((p) => p.textContent ?? "");
const selo = () =>
  tela.querySelector<HTMLElement>("h3 + p > span.inline-flex") ?? null;
const ponto = () =>
  tela.querySelector<HTMLElement>("span.rounded-full[aria-hidden='true']");
const rotulos = () =>
  Array.from(tela.querySelectorAll("dl dt")).map((dt) => dt.textContent);

describe("formatarDiaEMes", () => {
  it("YYYY-MM-DD vira DD/MM sem passar por fuso", () => {
    expect(formatarDiaEMes("2026-12-03")).toBe("03/12");
    expect(formatarDiaEMes("2027-01-04")).toBe("04/01");
  });
});

describe("CartaoDaAssinatura: teste encerrado com o sinal completo", () => {
  it("antes da pausa: os três parágrafos exatos, com o prazo da pausa", () => {
    desenhar({});
    const textos = paragrafos();
    expect(textos).toContain(ACABOU);
    expect(textos).toContain(PRAZO);
    expect(textos).toContain(JA_PAGOU);
    expect(textos).not.toContain(GENERICA);
    // A ordem da leitura: o que aconteceu, o que fazer, e o "já pagou?".
    const ordem = [ACABOU, PRAZO, JA_PAGOU].map((t) => textos.indexOf(t));
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
  });

  it("o selo é 'Teste encerrado' no tom de atenção, e nada de 'Atrasada'", () => {
    desenhar({});
    expect(selo()?.textContent).toBe("Teste encerrado");
    expect(selo()?.className).toContain(classeDoTexto("atencao"));
    expect(ponto()?.className).toContain(classeDoPonto("atencao"));
    expect(ponto()?.className).not.toContain(classeDoPonto("negativo"));
    expect(tela.textContent).not.toContain("Atrasada");
  });

  it("somem 'Em aberto desde', 'Teste até' e 'Regularize'; fica só 'Cliente desde'", () => {
    desenhar({});
    expect(rotulos()).toEqual(["Cliente desde"]);
    expect(tela.textContent).toContain("26/11/2026");
    expect(tela.textContent).not.toContain("Em aberto desde");
    expect(tela.textContent).not.toContain("Teste até");
    expect(tela.textContent).not.toContain("Regularize");
    expect(tela.textContent).not.toContain("03/12/2026");
  });

  it("ficam o nome do plano, o valor grande, os recursos e os botões", () => {
    desenhar({});
    expect(tela.textContent).toContain("Plano Inventado");
    expect(tela.querySelector(".text-2xl")?.textContent).toBe(
      `${formatarMoeda(250)}/mês`,
    );
    expect(
      tela.querySelectorAll('ul[aria-label="Recursos do plano"] li'),
    ).toHaveLength(2);
    expect(tela.textContent).toContain("Gerenciar assinatura");
    expect(tela.textContent).toContain("Suporte pelo WhatsApp");
  });

  it("sem 'Cliente desde' no payload a lista de datas fica vazia, sem inventar data", () => {
    desenhar({ inicioEm: null });
    expect(rotulos()).toEqual([]);
    expect(paragrafos()).toContain(ACABOU);
  });

  it("no dia da pausa e depois: a frase genérica, sem 'pague até' nem pausa", () => {
    for (const dia of ["2026-12-07", "2026-12-10"]) {
      vi.setSystemTime(meioDia(dia));
      desenhar({});
      const textos = paragrafos();
      expect(textos).toContain(ACABOU);
      expect(textos).toContain(GENERICA);
      expect(textos).toContain(JA_PAGOU);
      expect(tela.textContent).not.toContain("pague até");
      expect(tela.textContent).not.toContain("pausados");
      expect(selo()?.textContent).toBe("Teste encerrado");
    }
  });

  it("sem pausa_em (gestão velha ou recuo): a frase genérica", () => {
    desenhar({ pausaEm: null });
    expect(paragrafos()).toContain(GENERICA);
    expect(tela.textContent).not.toContain("pague até");
    expect(selo()?.textContent).toBe("Teste encerrado");
  });

  it("na virada do ano as datas saem em DD/MM do ano novo", () => {
    vi.setSystemTime(meioDia("2026-12-30"));
    desenhar({
      proximaCobrancaEm: "2026-12-28",
      testeAte: "2026-12-28",
      pausaEm: "2027-01-04",
    });
    expect(paragrafos()).toContain(
      `Seu teste grátis acabou. A primeira mensalidade, de ${formatarMoeda(250)}, venceu em 28/12.`,
    );
    expect(paragrafos()).toContain(
      "Para continuar vendendo, pague até 03/01. Sem o pagamento, os pedidos pela loja ficam pausados a partir de 04/01.",
    );
  });

  it("o prazo some à meia-noite de Brasília da pausa sem recarregar a tela", () => {
    vi.useFakeTimers();
    // 06/12 23:59:30 em Brasília.
    vi.setSystemTime(new Date("2026-12-07T02:59:30Z"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    desenhar({});
    expect(paragrafos()).toContain(PRAZO);
    act(() => vi.advanceTimersByTime(60_000));
    expect(paragrafos()).toContain(GENERICA);
    expect(tela.textContent).not.toContain("pague até");
  });
});

describe("CartaoDaAssinatura: sinal torto mostra o cartão de hoje inteiro", () => {
  function cartaoDeHoje() {
    expect(selo()?.textContent).toBe("Atrasada");
    expect(ponto()?.className).toContain(classeDoPonto("negativo"));
    expect(rotulos()).toContain("Em aberto desde");
    expect(tela.textContent).toContain("Regularize a assinatura");
    expect(tela.textContent).not.toContain("Teste encerrado");
    expect(tela.textContent).not.toContain("Seu teste grátis acabou");
    expect(tela.textContent).not.toContain("Já pagou?");
  }

  it("pausa_em igual ou anterior ao vencimento", () => {
    desenhar({ pausaEm: "2026-12-03" });
    cartaoDeHoje();
    desenhar({ pausaEm: "2026-12-01" });
    cartaoDeHoje();
  });

  it("pausa_em ilegível", () => {
    desenhar({ pausaEm: "amanhã" });
    cartaoDeHoje();
  });

  it("atrasada com teste_ate nulo (devedora de verdade)", () => {
    desenhar({ testeAte: null, pausaEm: null });
    cartaoDeHoje();
    expect(rotulos()).not.toContain("Teste até");
  });

  it("teste_ate diferente da próxima cobrança", () => {
    desenhar({ testeAte: "2026-11-03", proximaCobrancaEm: "2026-12-03" });
    cartaoDeHoje();
    expect(rotulos()).toContain("Teste até");
  });

  it("valor zero", () => {
    desenhar({ valorMensal: 0 });
    cartaoDeHoje();
  });
});
