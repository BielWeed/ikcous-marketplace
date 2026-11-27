// @vitest-environment jsdom
//
// O cartão "Sua assinatura" da lojista que entrou pagando e atrasou a
// mensalidade (26/11/2026, decisão "sem teste grátis"). A gestão manda
// `atrasada`, `teste_ate` nulo e o `pausa_em`: o cartão vira "Mensalidade em
// aberto" e diz o prazo com a mesma data do WhatsApp. Sem `pausa_em` (Savy,
// IKCOUS) o cartão continua o de hoje, com "Atrasada" e "Regularize". O
// "Teste encerrado" tem prioridade e não muda. Os textos são montados com
// `formatarMoeda` (o formatador usa espaço especial). Dados inventados; nenhuma
// chamada de rede.
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import { formatarMoeda } from "@/lib/crm";
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
  inicioEm: "2026-12-02",
  proximaCobrancaEm: "2027-01-02",
  testeAte: null,
  pausaEm: "2027-01-13",
  recursos: ["PDV", "CRM"],
  gerenciarUrl: "https://cobranca.exemplo.com/minha-loja",
  suporteWhatsapp: "34999999999",
  atualizadoEm: null,
};

const VENCEU = `A mensalidade de ${formatarMoeda(250)} venceu em 02/01.`;
const PRAZO =
  "Para continuar vendendo, pague até 12/01. Sem o pagamento, os pedidos pela loja ficam pausados a partir de 13/01.";
const GENERICA = "Para continuar vendendo, pague a mensalidade.";
const JA_PAGOU =
  "Já pagou? Assim que confirmarmos o pagamento, este aviso some sozinho.";

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(meioDia("2027-01-05"));
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

describe("CartaoDaAssinatura: mensalidade em aberto da pagante", () => {
  it("antes da pausa: os três parágrafos exatos, na ordem da leitura", () => {
    desenhar({});
    const textos = paragrafos();
    expect(textos).toContain(VENCEU);
    expect(textos).toContain(PRAZO);
    expect(textos).toContain(JA_PAGOU);
    expect(textos).not.toContain(GENERICA);
    const ordem = [VENCEU, PRAZO, JA_PAGOU].map((t) => textos.indexOf(t));
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
  });

  it("nenhuma palavra do teste grátis aparece para quem paga", () => {
    desenhar({});
    expect(tela.textContent).not.toContain("teste");
    expect(tela.textContent).not.toContain("Teste");
    expect(tela.textContent).not.toContain("primeira mensalidade");
  });

  it("o prazo sai no tom de atenção", () => {
    desenhar({});
    const prazo = Array.from(tela.querySelectorAll("p")).find(
      (p) => p.textContent === PRAZO,
    );
    expect(prazo?.className).toContain(classeDoTexto("atencao"));
  });

  it("o selo é 'Mensalidade em aberto' no tom de atenção, e nada de 'Atrasada'", () => {
    desenhar({});
    expect(selo()?.textContent).toBe("Mensalidade em aberto");
    expect(selo()?.className).toContain(classeDoTexto("atencao"));
    expect(ponto()?.className).toContain(classeDoPonto("atencao"));
    expect(ponto()?.className).not.toContain(classeDoPonto("negativo"));
    expect(tela.textContent).not.toContain("Atrasada");
  });

  it("somem 'Em aberto desde' e 'Regularize'; fica só 'Cliente desde'", () => {
    desenhar({});
    expect(rotulos()).toEqual(["Cliente desde"]);
    expect(tela.textContent).toContain("02/12/2026");
    expect(tela.textContent).not.toContain("Em aberto desde");
    expect(tela.textContent).not.toContain("Regularize");
    expect(tela.textContent).not.toContain("02/01/2027");
  });

  it("ficam o nome do plano, o valor grande, os recursos e os botões", () => {
    desenhar({});
    expect(tela.textContent).toContain("Plano Inventado");
    // 27/11/2026: o valor grande é a próxima cobrança, sem "/mês" (o app de
    // gestão pode mandar o restante de um pagamento parcial nesse campo).
    expect(tela.querySelector(".text-2xl")?.textContent).toBe(
      formatarMoeda(250),
    );
    expect(
      tela.querySelectorAll('ul[aria-label="Recursos do plano"] li'),
    ).toHaveLength(2);
    expect(tela.textContent).toContain("Gerenciar assinatura");
    expect(tela.textContent).toContain("Suporte pelo WhatsApp");
  });

  it("sem 'Cliente desde' no payload a lista de datas fica vazia", () => {
    desenhar({ inicioEm: null });
    expect(rotulos()).toEqual([]);
    expect(paragrafos()).toContain(VENCEU);
  });

  it("no dia da pausa e depois: a frase genérica, sem 'pague até' nem pausa", () => {
    for (const dia of ["2027-01-13", "2027-01-20"]) {
      vi.setSystemTime(meioDia(dia));
      desenhar({});
      const textos = paragrafos();
      expect(textos).toContain(VENCEU);
      expect(textos).toContain(GENERICA);
      expect(textos).toContain(JA_PAGOU);
      expect(tela.textContent).not.toContain("pague até");
      expect(tela.textContent).not.toContain("pausados");
      expect(selo()?.textContent).toBe("Mensalidade em aberto");
      expect(tela.textContent).not.toContain("Regularize");
    }
  });

  it("o prazo some à meia-noite de Brasília da pausa sem recarregar a tela", () => {
    vi.useFakeTimers();
    // 12/01 23:59:30 em Brasília.
    vi.setSystemTime(new Date("2027-01-13T02:59:30Z"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    desenhar({});
    expect(paragrafos()).toContain(PRAZO);
    act(() => vi.advanceTimersByTime(60_000));
    expect(paragrafos()).toContain(GENERICA);
    expect(tela.textContent).not.toContain("pague até");
  });
});

describe("CartaoDaAssinatura: sem o sinal da pagante, o cartão de hoje inteiro", () => {
  function cartaoDeHoje() {
    expect(selo()?.textContent).toBe("Atrasada");
    expect(ponto()?.className).toContain(classeDoPonto("negativo"));
    expect(rotulos()).toContain("Em aberto desde");
    expect(tela.textContent).toContain("Regularize a assinatura");
    expect(tela.textContent).not.toContain("Mensalidade em aberto");
    expect(tela.textContent).not.toContain("venceu em");
    expect(tela.textContent).not.toContain("Já pagou?");
  }

  it("sem pausa_em (Savy, IKCOUS ou gestão velha)", () => {
    desenhar({ pausaEm: null });
    cartaoDeHoje();
  });

  it("pausa_em igual ou anterior ao vencimento", () => {
    desenhar({ pausaEm: "2027-01-02" });
    cartaoDeHoje();
    desenhar({ pausaEm: "2026-12-31" });
    cartaoDeHoje();
  });

  it("pausa_em ilegível ou dia que não existe", () => {
    desenhar({ pausaEm: "amanhã" });
    cartaoDeHoje();
    desenhar({ pausaEm: "2027-02-31" });
    cartaoDeHoje();
  });

  it("valor zero", () => {
    desenhar({ valorMensal: 0 });
    cartaoDeHoje();
  });

  it("ativa ou suspensa com pausa_em: nenhum aviso da pagante", () => {
    desenhar({ status: "ativa" });
    expect(selo()?.textContent).toBe("Plano ativo");
    expect(tela.textContent).not.toContain("Mensalidade em aberto");
    expect(tela.textContent).not.toContain("Já pagou?");
    desenhar({ status: "suspensa" });
    expect(tela.textContent).not.toContain("Mensalidade em aberto");
    expect(tela.textContent).toContain("Regularize a assinatura");
  });
});

describe("CartaoDaAssinatura: o teste encerrado tem prioridade e não muda", () => {
  it("com teste_ate = próxima cobrança, o aviso é o do teste", () => {
    desenhar({ testeAte: "2027-01-02" });
    expect(selo()?.textContent).toBe("Teste encerrado");
    expect(paragrafos()).toContain(
      `Seu teste grátis acabou. A primeira mensalidade, de ${formatarMoeda(250)}, venceu em 02/01.`,
    );
    expect(paragrafos()).toContain(PRAZO);
    expect(paragrafos()).not.toContain(VENCEU);
    expect(tela.textContent).not.toContain("Mensalidade em aberto");
    // O "Já pagou?" sai UMA vez só, do aviso do teste.
    expect(paragrafos().filter((t) => t === JA_PAGOU)).toHaveLength(1);
  });
});
