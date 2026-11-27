// @vitest-environment jsdom
//
// O cartão "Sua assinatura" no dia em que as vendas pela loja PARAM (26/11/2026,
// decisão da pausa, texto 3). Para pausar, a gestão grava `suspensa` com os
// mesmos dados do aviso da mensalidade em aberto (ou do teste encerrado). Antes
// desta correção o cartão voltava ao genérico "Suspensa / Regularize a
// assinatura" e a lojista não ficava sabendo que os clientes não conseguem
// comprar. Sem `pausa_em` (Savy, IKCOUS) o cartão continua o de hoje.
//
// Desde 27/11/2026 quem decide "pausadas" é o BANCO
// (`situacao_das_vendas_da_loja()`): a pausa só vale com a chave
// `pausa_de_vendas.vale_pela_assinatura`, que o front não enxerga. Sem a
// resposta dele o cartão não afirma pausa. Dados inventados; nenhuma chamada
// de rede.
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import { formatarMoeda } from "@/lib/crm";
import { classeDoPonto } from "@/lib/tons-de-estado";
import type { AssinaturaDaLoja, SituacaoDasVendas } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Meio-dia em Brasília (15h UTC) do dia pedido. */
const meioDia = (dia: string) => new Date(`${dia}T15:00:00Z`);

const base: AssinaturaDaLoja = {
  plano: "Plano Inventado",
  status: "suspensa",
  valorMensal: 250,
  ciclo: "mensal",
  inicioEm: "2026-12-02",
  proximaCobrancaEm: "2027-01-02",
  testeAte: null,
  pausaEm: "2027-01-13",
  recursos: ["PDV", "CRM"],
  gerenciarUrl: "https://cobranca.exemplo.com/minha-loja",
  suporteWhatsapp: "34999999999",
  atualizadoEm: null,
};

// O que `situacao_das_vendas_da_loja()` devolve, já lido.
const PAUSADAS: SituacaoDasVendas = {
  aceita: false,
  motivo: "vendas_pausadas",
  pausadaDesde: "2027-01-13",
};
const ACEITA: SituacaoDasVendas = {
  aceita: true,
  motivo: null,
  pausadaDesde: null,
};

// As frases aprovadas (DECISAO-FIM-DO-TESTE-E-PAUSA-26-11, texto 3).
const TITULO = "Vendas pela loja pausadas desde 13/01";
const TEXTO_3 =
  "Seus clientes não conseguem fazer pedidos novos pela loja. Pedidos já feitos, entregas, devoluções, estornos e vendas no balcão continuam funcionando. Assim que confirmarmos o pagamento da mensalidade, as vendas voltam sozinhas.";
const VENCEU = `A mensalidade de ${formatarMoeda(250)} venceu em 02/01.`;

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(meioDia("2027-01-13"));
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

function desenhar(
  parcial: Partial<AssinaturaDaLoja>,
  situacao: SituacaoDasVendas | null = PAUSADAS,
) {
  act(() =>
    raiz.render(
      <CartaoDaAssinatura
        assinatura={{ ...base, ...parcial }}
        situacaoDasVendas={situacao}
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

describe("CartaoDaAssinatura: vendas pela loja pausadas", () => {
  it("no dia da pausa: o selo diz desde quando, e o texto 3 diz o que para e como voltar", () => {
    desenhar({});
    expect(selo()?.textContent).toBe(TITULO);
    expect(ponto()?.className).toContain(classeDoPonto("negativo"));
    const textos = paragrafos();
    expect(textos).toContain(VENCEU);
    expect(textos).toContain(TEXTO_3);
    expect(textos.indexOf(VENCEU)).toBeLessThan(textos.indexOf(TEXTO_3));
  });

  it("some o genérico: nada de 'Suspensa', 'Regularize' ou prazo que já passou", () => {
    desenhar({});
    expect(tela.textContent).not.toContain("Suspensa");
    expect(tela.textContent).not.toContain("Regularize");
    expect(tela.textContent).not.toContain("pague até");
    expect(tela.textContent).not.toContain("Mensalidade em aberto");
    // O texto 3 já diz como voltar; o "Já pagou?" seria uma segunda promessa.
    expect(tela.textContent).not.toContain("Já pagou?");
  });

  it("as datas ficam só com 'Cliente desde'", () => {
    desenhar({});
    expect(rotulos()).toEqual(["Cliente desde"]);
  });

  it("dias depois a data continua a da pausa", () => {
    vi.setSystemTime(meioDia("2027-02-20"));
    desenhar({});
    expect(selo()?.textContent).toBe(TITULO);
  });

  it("do teste encerrado: a frase do teste e o mesmo texto 3", () => {
    desenhar({ testeAte: "2027-01-02" });
    expect(selo()?.textContent).toBe(TITULO);
    expect(paragrafos()).toContain(
      `Seu teste grátis acabou. A primeira mensalidade, de ${formatarMoeda(250)}, venceu em 02/01.`,
    );
    expect(paragrafos()).toContain(TEXTO_3);
    expect(paragrafos()).not.toContain(VENCEU);
  });
});

describe("CartaoDaAssinatura: suspensa sem o sinal, o cartão de hoje", () => {
  function cartaoDeHoje() {
    expect(selo()?.textContent).toBe("Suspensa");
    expect(tela.textContent).toContain("Regularize a assinatura");
    expect(tela.textContent).not.toContain("pausadas desde");
    expect(tela.textContent).not.toContain("Seus clientes não conseguem");
  }

  it("sem pausa_em (Savy, IKCOUS ou gestão velha)", () => {
    desenhar({ pausaEm: null }, ACEITA);
    cartaoDeHoje();
  });

  it("antes do dia da pausa o banco ainda vende: nada de 'pausadas'", () => {
    vi.setSystemTime(meioDia("2027-01-12"));
    desenhar({}, ACEITA);
    cartaoDeHoje();
  });

  it("sinal torto (valor zero ou pausa antes do vencimento)", () => {
    desenhar({ valorMensal: 0 }, ACEITA);
    cartaoDeHoje();
    desenhar({ pausaEm: "2027-01-01" }, ACEITA);
    cartaoDeHoje();
  });

  it("atrasada no dia da pausa continua a mensalidade em aberto (nada de 'pausadas')", () => {
    desenhar({ status: "atrasada" }, ACEITA);
    expect(selo()?.textContent).toBe("Mensalidade em aberto");
    expect(tela.textContent).not.toContain("pausadas desde");
  });
});

describe("CartaoDaAssinatura: quem diz 'pausadas' é o banco", () => {
  it("o defeito: suspensa + pausa vencida, mas o banco ACEITA pedido → mensalidade em aberto, sem afirmar pausa", () => {
    desenhar({}, ACEITA);
    expect(selo()?.textContent).toBe("Mensalidade em aberto");
    expect(ponto()?.className).toContain(classeDoPonto("atencao"));
    const textos = paragrafos();
    expect(textos).toContain(VENCEU);
    expect(textos).toContain("Para continuar vendendo, pague a mensalidade.");
    expect(tela.textContent).toContain("Já pagou?");
    expect(tela.textContent).not.toContain("pausad");
    expect(tela.textContent).not.toContain("Seus clientes não conseguem");
    expect(tela.textContent).not.toContain("Suspensa");
    expect(rotulos()).toEqual(["Cliente desde"]);
  });

  it("o mesmo do teste encerrado: 'Teste encerrado', sem afirmar pausa", () => {
    desenhar({ testeAte: "2027-01-02" }, ACEITA);
    expect(selo()?.textContent).toBe("Teste encerrado");
    expect(paragrafos()).toContain(
      `Seu teste grátis acabou. A primeira mensalidade, de ${formatarMoeda(250)}, venceu em 02/01.`,
    );
    expect(tela.textContent).not.toContain("pausad");
    expect(tela.textContent).not.toContain("Seus clientes não conseguem");
  });

  it("a resposta do banco falhou ou não existe (loja antiga): cartão de hoje, sem inventar pausa", () => {
    desenhar({}, null);
    expect(selo()?.textContent).toBe("Suspensa");
    expect(tela.textContent).toContain("Regularize a assinatura");
    expect(tela.textContent).not.toContain("pausad");
    expect(tela.textContent).not.toContain("Seus clientes não conseguem");
  });

  it("sem a prop (quem desenha não leu o banco): cartão de hoje", () => {
    act(() =>
      raiz.render(
        <CartaoDaAssinatura
          assinatura={base}
          lida
          carregando={false}
          erro={null}
          onTentarDeNovo={() => undefined}
        />,
      ),
    );
    expect(selo()?.textContent).toBe("Suspensa");
    expect(tela.textContent).not.toContain("pausad");
  });

  it("manutenção não é pausa por assinatura: nada de 'pausadas' nem 'pague para voltar'", () => {
    desenhar({}, { aceita: false, motivo: "manutencao", pausadaDesde: null });
    expect(selo()?.textContent).toBe("Suspensa");
    expect(tela.textContent).not.toContain("pausad");
    expect(tela.textContent).not.toContain("Seus clientes não conseguem");
  });

  it("o inverso: chave ligada sem pausa_em (gestão antiga), o banco pausa → o cartão diz pausadas", () => {
    desenhar({ pausaEm: null }, { ...PAUSADAS, pausadaDesde: "2027-01-15" });
    expect(selo()?.textContent).toBe("Vendas pela loja pausadas desde 15/01");
    expect(ponto()?.className).toContain(classeDoPonto("negativo"));
    expect(paragrafos()).toContain(VENCEU);
    expect(paragrafos()).toContain(TEXTO_3);
    expect(tela.textContent).not.toContain("Regularize");
    expect(tela.textContent).not.toContain("Suspensa");
  });

  it("o dia é o que o banco diz, não o pausa_em (fim de semana passa para a segunda)", () => {
    desenhar({}, { ...PAUSADAS, pausadaDesde: "2027-01-18" });
    expect(selo()?.textContent).toBe("Vendas pela loja pausadas desde 18/01");
  });

  it("pausadas sem dia válido: afirma a pausa sem inventar data", () => {
    desenhar({}, { ...PAUSADAS, pausadaDesde: null });
    expect(selo()?.textContent).toBe("Vendas pela loja pausadas");
    expect(paragrafos()).toContain(TEXTO_3);
  });

  it("pausadas com valor zero: o texto 3 fica, sem frase de vencimento inventada", () => {
    desenhar({ valorMensal: 0 }, PAUSADAS);
    expect(selo()?.textContent).toBe(TITULO);
    expect(paragrafos()).toContain(TEXTO_3);
    expect(tela.textContent).not.toContain("venceu em");
  });

  it("o banco pausa mas a assinatura lida diz atrasada (leituras de instantes diferentes): a pausa vence o prazo", () => {
    desenhar({ status: "atrasada" }, PAUSADAS);
    expect(selo()?.textContent).toBe(TITULO);
    expect(tela.textContent).not.toContain("pague até");
    expect(tela.textContent).not.toContain("Mensalidade em aberto");
    expect(tela.textContent).not.toContain("Já pagou?");
  });
});
