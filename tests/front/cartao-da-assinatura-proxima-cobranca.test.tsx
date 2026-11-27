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

/**
 * O rótulo (`dt`) que encima o valor grande, ligado a ele no mesmo `dl` — não
 * a linha de data, cujo `dd` é texto pequeno.
 */
const rotuloDoValor = (texto = "Próxima cobrança") =>
  Array.from(tela.querySelectorAll("dt")).find(
    (dt) =>
      dt.textContent === texto &&
      dt.nextElementSibling?.tagName === "DD" &&
      dt.nextElementSibling.classList.contains("text-2xl"),
  );
const vezes = (trecho: string) =>
  (tela.textContent ?? "").split(trecho).length - 1;

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

  // Revisão 27/11/2026: o rótulo saía duas vezes ("Próxima cobrança R$ 175,00"
  // e a linha "Próxima cobrança 27/12/2026"). A data vai para junto do valor.
  it("'Próxima cobrança' aparece uma vez só, com a data junto do valor", () => {
    desenhar({});
    expect(vezes("Próxima cobrança")).toBe(1);
    const dl = rotuloDoValor()?.parentElement;
    expect(dl?.tagName).toBe("DL");
    expect(dl?.textContent).toMatch(
      /^Próxima cobrançaR\$\s175,00em 27\/12\/2026$/,
    );
    expect(vezes("27/12/2026")).toBe(1);
    // As outras datas continuam na lista.
    expect(tela.textContent).toContain("Cliente desde");
  });

  it("sem data da próxima cobrança, o valor fica sem 'em'", () => {
    desenhar({ proximaCobrancaEm: null });
    expect(rotuloDoValor()?.parentElement?.textContent).toMatch(
      /^Próxima cobrançaR\$\s175,00$/,
    );
  });

  // Revisão 27/11/2026: com conta vencida o valor é o que está EM ABERTO.
  it("atrasada: 'Valor em aberto' acima do valor, nunca 'Próxima cobrança'", () => {
    desenhar({ status: "atrasada", proximaCobrancaEm: "2026-11-10" });
    expect(
      rotuloDoValor("Valor em aberto")?.nextElementSibling?.textContent,
    ).toMatch(/^R\$\s175,00$/);
    expect(tela.textContent).not.toContain("Próxima cobrança");
    expect(tela.textContent).toContain("Em aberto desde");
  });

  it("pendente e suspensa sem sinal também dizem 'Valor em aberto'", () => {
    for (const status of ["pendente", "suspensa"] as const) {
      // A linha de data dessas situações é de `linhasDeDatasDaAssinatura` e
      // não muda aqui; o que se prende é só o rótulo do valor.
      desenhar({ status, proximaCobrancaEm: null });
      expect(rotuloDoValor("Valor em aberto")).toBeDefined();
      expect(rotuloDoValor("Próxima cobrança")).toBeUndefined();
      expect(tela.textContent).not.toContain("Próxima cobrança");
    }
  });

  // Revisão 27/11/2026: assinatura cancelada não tem próxima cobrança.
  it("cancelada: nenhum valor nem 'Próxima cobrança'", () => {
    desenhar({ status: "cancelada", proximaCobrancaEm: null });
    expect(rotuloDoValor()).toBeUndefined();
    expect(tela.textContent).not.toContain("Próxima cobrança");
    expect(tela.textContent).not.toMatch(/R\$\s175,00/);
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
