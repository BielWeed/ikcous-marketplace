import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ── A cura do containing block que fazia a barra da ficha rolar junto ──
//
// O BUG (medido no navegador em 20/09/2026): `.admin-tab-pane` declarava
// `will-change: transform, opacity` — will-change com transform cria
// containing block para `position: fixed` MESMO com transform: none — e,
// vindo depois da defesa `.admin-scroll-container` na folha (mesma
// especificidade), fazia a barra de ações da ficha do pedido ancorar no
// painel rolável em vez da viewport: com scrollTop ~780 a barra cruzava a
// tela por cima do cartão de pagamento.
//
// POR QUE ESTE TESTE LÊ O CSS-FONTE E NÃO O DOM: jsdom não computa cascata
// nem containing block — montar o OrderDetail não revelaria nada deste bug.
// O que dá para prender é o contrato da cura: a defesa só vence QUALQUER
// declaração comum de will-change/transform/perspective se levar
// !important (importante de autor vence comum em qualquer ordem), e as
// classes do painel não podem declarar os criadores de containing block.
// A varredura cobre TODAS as regras simples do seletor — inclusive as que
// morarem dentro de @media — para não vigiar só a primeira ocorrência.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório, montado de import.meta.url
const css = readFileSync(
  new URL("../../src/index.css", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

interface RegraCss {
  seletores: string[];
  bloco: string;
}

const regras: RegraCss[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  (m) => ({
    // separar por vírgula permite achar o seletor simples exato dentro de
    // um grupo — sem isto, "body.admin-modal-open .admin-scroll-container"
    // seria confundido com a regra da classe sozinha
    seletores: (m[1] ?? "").split(",").map((s) => s.trim()),
    bloco: (m[2] ?? "").replace(/\s+/g, " "),
  }),
);

function blocosDaRegra(seletorAlvo: string): string[] {
  const blocos = regras
    .filter((r) => r.seletores.includes(seletorAlvo))
    .map((r) => r.bloco);
  expect(
    blocos.length,
    `regra simples "${seletorAlvo}" não achada em src/index.css`,
  ).toBeGreaterThan(0);
  return blocos;
}

describe("barra de ações da ficha — ancorada na viewport, não no painel rolável", () => {
  it("a defesa .admin-scroll-container trava will-change, transform, perspective e transform-style com !important (sem isso, perdia por ordem de folha)", () => {
    const defesa = blocosDaRegra(".admin-scroll-container").join(" ");
    expect(defesa).toMatch(/will-change:\s*auto\s*!important/);
    expect(defesa).toMatch(/transform:\s*none\s*!important/);
    expect(defesa).toMatch(/perspective:\s*none\s*!important/);
    expect(defesa).toMatch(/transform-style:\s*flat\s*!important/);
  });

  it("nenhuma regra das classes do painel declara will-change, transform-style ou perspective — o réu do sequestro não volta à cena (nem por @media, nem pelas classes irmãs)", () => {
    // transform em si continua permitido: no painel do CLIENTE o slide
    // ±16px de .admin-tab-left/.admin-tab-right é vivo e necessário; no
    // admin a defesa acima já o trava. O que reabriria o bug em qualquer
    // dos lados são os três criadores de containing block listados — até
    // com !important, porque uma declaração importante posterior venceria
    // a defesa.
    const classesDoPainel = [
      ".admin-tab-pane",
      ".admin-tab-left",
      ".admin-tab-right",
      ".admin-tab-active",
    ];
    for (const classe of classesDoPainel) {
      const existentes = regras.filter((r) => r.seletores.includes(classe));
      for (const { bloco } of existentes) {
        expect(
          bloco,
          `regra de ${classe} declarando propriedade proibida`,
        ).not.toMatch(/will-change|transform-style|perspective/);
      }
    }
    // o réu original precisa continuar existindo (a transição de opacity/
    // visibility das abas mora nela) — e limpo
    blocosDaRegra(".admin-tab-pane");
  });
});
