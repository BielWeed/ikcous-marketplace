// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), `CartaoDaAssinatura` do Início. O teste
// vizinho prende o WhatsApp e as datas; ficavam soltos (defeitos de UMA linha):
//  - a cor do pontinho de cada status (ativa verde, em teste azul, pendente
//    âmbar, atrasada/suspensa vermelho, cancelada cinza);
//  - o aviso "Regularize" para as TRÊS situações (atrasada, suspensa,
//    pendente) e só para elas, com a cor certa;
//  - o limite de 6 recursos e o "+N recursos incluídos";
//  - valor mensal zero continua sendo valor (R$ 0,00), e plano sem nome;
//  - os dois links externos abrem em nova aba SEM dar acesso à janela de
//    origem (`noopener noreferrer`);
//  - os estados de espera (carregando, erro com e sem recarga em curso).
// Dados inventados; nenhuma chamada de rede.
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import { classeDoPonto, classeDoTexto } from "@/lib/tons-de-estado";
import type { AssinaturaDaLoja } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  // 13/11/2026, meio-dia em Brasília: só o relógio é falso.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
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
  valorMensal: null,
  ciclo: null,
  inicioEm: null,
  proximaCobrancaEm: null,
  testeAte: null,
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

const ponto = () =>
  tela.querySelector<HTMLElement>("span.rounded-full[aria-hidden='true']");
const aviso = () =>
  Array.from(tela.querySelectorAll("p")).find((p) =>
    (p.textContent ?? "").includes("Regularize a assinatura"),
  );

describe("CartaoDaAssinatura: a cor de cada status", () => {
  const casos = [
    ["ativa", "positivo", "Plano ativo"],
    ["teste", "info", "Em teste"],
    ["pendente", "atencao", "Pagamento pendente"],
    ["atrasada", "negativo", "Atrasada"],
    ["suspensa", "negativo", "Suspensa"],
    ["cancelada", "neutro", "Cancelada"],
  ] as const;

  for (const [status, tom, texto] of casos) {
    it(`${status}: pontinho ${tom} e o texto '${texto}'`, () => {
      desenhar({ status });
      expect(tela.textContent).toContain(texto);
      expect(ponto()?.className).toContain(classeDoPonto(tom));
    });
  }

  it("status que o app não conhece fica cinza (neutro), sem alarme", () => {
    desenhar({ status: null });
    expect(tela.textContent).toContain("Status desconhecido");
    expect(ponto()?.className).toContain(classeDoPonto("neutro"));
  });
});

describe("CartaoDaAssinatura: aviso de regularizar", () => {
  it("atrasada, suspensa e pendente mostram o aviso; ativa, teste e cancelada não", () => {
    for (const status of ["atrasada", "suspensa", "pendente"] as const) {
      desenhar({ status });
      expect(aviso(), status).toBeDefined();
    }
    for (const status of ["ativa", "teste", "cancelada"] as const) {
      desenhar({ status });
      expect(aviso(), status).toBeUndefined();
    }
  });

  it("a cor do aviso: vermelha para atrasada e suspensa, âmbar para pendente", () => {
    desenhar({ status: "atrasada" });
    expect(aviso()?.className).toContain(classeDoTexto("negativo"));
    desenhar({ status: "suspensa" });
    expect(aviso()?.className).toContain(classeDoTexto("negativo"));
    desenhar({ status: "pendente" });
    expect(aviso()?.className).toContain(classeDoTexto("atencao"));
    expect(aviso()?.className).not.toContain(classeDoTexto("negativo"));
  });
});

describe("CartaoDaAssinatura: recursos do plano", () => {
  const lista = (n: number) =>
    Array.from({ length: n }, (_, i) => `Recurso ${i + 1}`);

  it("exatamente 6 recursos: todos aparecem e não há '+N'", () => {
    desenhar({ recursos: lista(6) });
    const itens = tela.querySelectorAll(
      'ul[aria-label="Recursos do plano"] li',
    );
    expect(itens).toHaveLength(6);
    expect(tela.textContent).not.toContain("recursos incluídos");
  });

  it("7 recursos: mostra 6 e '+1 recursos incluídos'", () => {
    desenhar({ recursos: lista(7) });
    expect(tela.textContent).toContain("Recurso 6");
    expect(tela.textContent).not.toContain("Recurso 7");
    expect(tela.textContent).toContain("+1 recursos incluídos");
  });

  it("sem recurso nenhum a lista nem existe", () => {
    desenhar({ recursos: [] });
    expect(tela.querySelector("ul")).toBeNull();
  });
});

describe("CartaoDaAssinatura: nome e valor", () => {
  it("o cartão se chama 'Sua assinatura'", () => {
    desenhar({});
    expect(tela.querySelector("h3")?.textContent).toBe("Sua assinatura");
  });

  it("plano sem nome mostra 'Plano sem nome'", () => {
    desenhar({ plano: null });
    expect(tela.textContent).toContain("Plano sem nome");
  });

  it("valor mensal zero é valor (R$ 0,00 com o ciclo), nulo não mostra preço", () => {
    desenhar({ valorMensal: 0, ciclo: "mensal" });
    expect(tela.textContent).toMatch(/R\$\s*0,00\/mês/);
    desenhar({ valorMensal: null, ciclo: "mensal" });
    expect(tela.textContent).not.toContain("/mês");
  });
});

describe("CartaoDaAssinatura: links externos", () => {
  it("gerenciar e WhatsApp abrem em nova aba sem expor a janela de origem", () => {
    desenhar({
      gerenciarUrl: "https://exemplo.invalid/assinatura",
      suporteWhatsapp: "34999999999",
    });
    const gerenciar = tela.querySelector<HTMLAnchorElement>(
      'a[href="https://exemplo.invalid/assinatura"]',
    );
    const suporte = tela.querySelector<HTMLAnchorElement>(
      'a[href="https://wa.me/5534999999999"]',
    );
    for (const link of [gerenciar, suporte]) {
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(tela.textContent).toContain(
      "Abre a administração da assinatura fora do app.",
    );
  });

  it("sem endereço de gerenciar e sem WhatsApp, nenhum link", () => {
    desenhar({ gerenciarUrl: null, suporteWhatsapp: null });
    expect(tela.querySelector("a")).toBeNull();
  });
});

describe("CartaoDaAssinatura: estados de espera", () => {
  function esperando(props: { erro: string | null; carregando: boolean }) {
    act(() =>
      raiz.render(
        <CartaoDaAssinatura
          assinatura={null}
          lida={false}
          carregando={props.carregando}
          erro={props.erro}
          onTentarDeNovo={() => undefined}
        />,
      ),
    );
    return tela.querySelector("section");
  }

  it("carregando sem erro: ocupado e sem botão de tentar de novo", () => {
    const secao = esperando({ erro: null, carregando: true });
    expect(secao?.getAttribute("aria-busy")).toBe("true");
    expect(tela.querySelector("button")).toBeNull();
  });

  it("erro com nova tentativa em curso: continua ocupado, sem mostrar o erro", () => {
    const secao = esperando({ erro: "Falha inventada", carregando: true });
    expect(secao?.getAttribute("aria-busy")).toBe("true");
    expect(tela.textContent).not.toContain("Falha inventada");
  });

  it("erro parado: mostra o erro com botão, e não está mais ocupado", () => {
    const secao = esperando({ erro: "Falha inventada", carregando: false });
    expect(secao?.getAttribute("aria-busy")).toBe("false");
    expect(tela.textContent).toContain("Falha inventada");
    expect(tela.querySelector("button")).not.toBeNull();
  });

  it("o botão de tentar de novo chama a função recebida", () => {
    const tentar = vi.fn();
    act(() =>
      raiz.render(
        <CartaoDaAssinatura
          assinatura={null}
          lida={false}
          carregando={false}
          erro="Falha inventada"
          onTentarDeNovo={tentar}
        />,
      ),
    );
    act(() => {
      tela.querySelector("button")?.click();
    });
    expect(tentar).toHaveBeenCalledTimes(1);
  });

  it("já lida e sem linha: mostra 'Seu plano vai aparecer aqui', mesmo com erro antigo", () => {
    act(() =>
      raiz.render(
        <CartaoDaAssinatura
          assinatura={null}
          lida
          carregando={false}
          erro="Falha inventada"
          onTentarDeNovo={() => undefined}
        />,
      ),
    );
    expect(tela.textContent).toContain("Seu plano vai aparecer aqui");
    expect(tela.textContent).not.toContain("Falha inventada");
  });
});
