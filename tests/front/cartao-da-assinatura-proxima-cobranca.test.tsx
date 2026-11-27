// @vitest-environment jsdom
//
// O valor do cartão "Sua assinatura" é a PRÓXIMA COBRANÇA (27/11/2026). O app
// de gestão passa a mandar em `valorMensal` o valor da próxima cobrança: o 1º
// mês negociado (R$ 250), o RESTANTE de um pagamento parcial (ex.: R$ 175) ou
// R$ 275 no mês que vence depois do fim do contrato. Com o sufixo do ciclo a
// lojista lia "R$ 175,00/mês", o que é falso. Fora do teste o valor ganha o
// rótulo "Próxima cobrança" e perde o "/mês"; em teste a frase diz só a
// primeira mensalidade, sem prometer que todo mês será igual.
// Dados inventados; nenhuma chamada de rede.
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import type { AssinaturaDaLoja } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  // 27/11/2026, meio-dia em Brasília: só o relógio é falso.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  vi.useRealTimers();
  act(() => raiz.unmount());
  tela.remove();
});

const base: AssinaturaDaLoja = {
  plano: "Plano Inventado",
  status: "ativa",
  valorMensal: 175,
  ciclo: "mensal",
  inicioEm: "2026-10-27",
  proximaCobrancaEm: "2026-12-27",
  testeAte: null,
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

/** O rótulo pequeno que encima o valor grande (não a linha de data). */
const rotuloDoValor = () =>
  Array.from(tela.querySelectorAll("p")).find(
    (p) => p.textContent === "Próxima cobrança",
  );

describe("CartaoDaAssinatura: o valor é a próxima cobrança", () => {
  it("valor parcial (175) aparece como 'Próxima cobrança R$ 175,00', sem '/mês'", () => {
    desenhar({});
    const rotulo = rotuloDoValor();
    expect(rotulo).toBeDefined();
    const valor = rotulo?.nextElementSibling;
    expect(valor?.textContent).toMatch(/^R\$\s175,00$/);
    expect(valor?.className).toContain("text-2xl");
    expect(tela.textContent).not.toContain("/mês");
    expect(tela.textContent).not.toContain("por mês");
  });

  it("nenhum ciclo volta a pendurar sufixo no valor", () => {
    for (const ciclo of ["anual", "trimestral", "Semestral", "quinzenal"]) {
      desenhar({ valorMensal: 275, ciclo });
      expect(rotuloDoValor()?.nextElementSibling?.textContent).toMatch(
        /^R\$\s275,00$/,
      );
    }
  });

  it("a data da próxima cobrança continua na sua linha, uma vez só", () => {
    desenhar({});
    const datas = Array.from(tela.querySelectorAll("dt")).map(
      (dt) => dt.textContent,
    );
    expect(datas.filter((d) => d === "Próxima cobrança")).toHaveLength(1);
    expect(tela.textContent).toContain("27/12/2026");
  });

  it("sem valor no payload não há rótulo de próxima cobrança acima do valor", () => {
    desenhar({ valorMensal: null });
    expect(rotuloDoValor()).toBeUndefined();
  });
});

describe("CartaoDaAssinatura em teste: só a primeira mensalidade", () => {
  it("diz 'Depois, a primeira mensalidade é de R$ X.' sem afirmar todo mês", () => {
    desenhar({
      status: "teste",
      valorMensal: 250,
      proximaCobrancaEm: null,
      testeAte: "2026-12-03",
    });
    const depois = Array.from(tela.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").startsWith("Depois,"),
    );
    expect(depois?.textContent).toMatch(
      /^Depois, a primeira mensalidade é de R\$\s250,00\.$/,
    );
    expect(tela.textContent).not.toContain("por mês");
    expect(tela.textContent).not.toContain("/mês");
    expect(rotuloDoValor()).toBeUndefined();
  });
});
