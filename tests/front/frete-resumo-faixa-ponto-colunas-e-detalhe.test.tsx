// @vitest-environment jsdom
//
// Faixa-resumo da tela de Frete (FreteResumoFaixa): três colunas — rótulo,
// valor e, só quando existe, a nota de contexto. O ponto colorido é a pista
// do tom (verde para "positivo", âmbar para "atencao"); o tom "neutro" NÃO
// acende ponto. A primeira coluna não leva a hairline de cima/da esquerda,
// as outras duas sim. Caça por mutação (25/11/2026): até aqui só havia um
// teste que lia o ARQUIVO para conferir tamanho de letra — nada renderizava
// a faixa, então trocar o tom, inverter o "tem nota?" ou perder a divisória
// passava em branco.
//
// Mutante equivalente anotado: `key={item.rotulo}` -> qualquer outra chave
// única não muda nada que o DOM mostre.
import {
  FreteResumoFaixa,
  type StatusDaFaixaFrete,
} from "@/components/admin/shipping/FreteResumoFaixa";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Trinca = readonly [
  StatusDaFaixaFrete,
  StatusDaFaixaFrete,
  StatusDaFaixaFrete,
];

const PADRAO: Trinca = [
  {
    rotulo: "Na sua cidade",
    valor: "R$ 10 por entrega",
    detalhe: "Entrega própria",
    tom: "positivo",
  },
  {
    rotulo: "Transportadora",
    valor: "Falta ligar",
    detalhe: "Nenhuma ligada",
    tom: "atencao",
  },
  { rotulo: "Frete grátis", valor: "Desligado", tom: "neutro" },
];

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(status: Trinca = PADRAO) {
  act(() => {
    raiz.render(<FreteResumoFaixa status={status} />);
  });
}

/** As três colunas, na ordem em que aparecem. */
function colunas(): HTMLElement[] {
  const grade = host.querySelector("section > div") as HTMLElement;
  return [...grade.children] as HTMLElement[];
}

function pontoDa(coluna: HTMLElement): HTMLElement | null {
  return coluna.querySelector('span[aria-hidden="true"]');
}

describe("FreteResumoFaixa: o que cada coluna mostra", () => {
  it("é uma região nomeada com exatamente três colunas", () => {
    montar();
    const regiao = host.querySelector("section") as HTMLElement;
    expect(regiao.getAttribute("aria-label")).toBe(
      "Como a entrega funciona hoje",
    );
    expect(colunas()).toHaveLength(3);
  });

  it("rótulo e valor ficam cada um no seu lugar, na ordem dos status", () => {
    montar();
    const [cidade, transp, gratis] = colunas();
    // Primeiro bloco da coluna = rótulo; segundo = valor.
    expect(cidade.children[0].textContent).toBe("Na sua cidade");
    expect(cidade.children[1].textContent).toBe("R$ 10 por entrega");
    expect(transp.children[0].textContent).toBe("Transportadora");
    expect(transp.children[1].textContent).toBe("Falta ligar");
    expect(gratis.children[0].textContent).toBe("Frete grátis");
    expect(gratis.children[1].textContent).toBe("Desligado");
  });

  it("a nota de contexto aparece só quando existe (e some no celular)", () => {
    montar();
    const [cidade, transp, gratis] = colunas();
    expect(cidade.children).toHaveLength(3);
    expect(cidade.children[2].textContent).toBe("Entrega própria");
    expect(cidade.children[2].className).toContain("hidden");
    expect(cidade.children[2].className).toContain("md:block");
    expect(transp.children[2].textContent).toBe("Nenhuma ligada");
    // "Frete grátis" veio sem detalhe: nenhuma terceira linha.
    expect(gratis.children).toHaveLength(2);
  });

  it("nota vazia ('') também não desenha a linha", () => {
    montar([PADRAO[0], PADRAO[1], { ...PADRAO[2], detalhe: "" }]);
    expect(colunas()[2].children).toHaveLength(2);
  });
});

describe("FreteResumoFaixa: o ponto do tom", () => {
  it("positivo acende o ponto verde da marca e atenção o âmbar", () => {
    montar();
    const [cidade, transp] = colunas();
    const verde = pontoDa(cidade);
    const ambar = pontoDa(transp);
    expect(verde).toBeTruthy();
    expect(verde?.className).toContain("bg-admin-accent");
    expect(verde?.className).not.toContain("bg-amber-400");
    expect(ambar).toBeTruthy();
    expect(ambar?.className).toContain("bg-amber-400");
    expect(ambar?.className).not.toContain("bg-admin-accent");
  });

  it("neutro NÃO acende ponto nenhum", () => {
    montar();
    expect(pontoDa(colunas()[2])).toBeNull();
  });

  it("o tom é por coluna, não por posição: neutro na primeira, positivo na última", () => {
    montar([
      { rotulo: "A", valor: "a", tom: "neutro" },
      { rotulo: "B", valor: "b", tom: "neutro" },
      { rotulo: "C", valor: "c", tom: "positivo" },
    ]);
    const [a, b, c] = colunas();
    expect(pontoDa(a)).toBeNull();
    expect(pontoDa(b)).toBeNull();
    expect(pontoDa(c)).toBeTruthy();
  });

  it("o ponto é decoração: aria-hidden, e o texto do rótulo continua sozinho", () => {
    montar();
    const cidade = colunas()[0];
    expect(pontoDa(cidade)?.getAttribute("aria-hidden")).toBe("true");
    expect(pontoDa(cidade)?.textContent).toBe("");
    expect(cidade.children[0].textContent).toBe("Na sua cidade");
  });
});

describe("FreteResumoFaixa: as divisórias", () => {
  it("só a primeira coluna fica sem hairline; as outras duas têm", () => {
    montar();
    const [primeira, segunda, terceira] = colunas();
    expect(primeira.className).toContain("md:pl-6");
    expect(primeira.className).not.toContain("border-t");
    expect(primeira.className).not.toContain("md:border-l");
    for (const coluna of [segunda, terceira]) {
      expect(coluna.className).toContain("border-t");
      expect(coluna.className).toContain("md:border-l");
      expect(coluna.className).not.toContain("md:pl-6");
    }
  });
});
