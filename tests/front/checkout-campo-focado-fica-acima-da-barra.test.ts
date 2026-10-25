// Tela "Finalizar pedido": campo com foco não pode ficar escondido atrás da
// barra fixa do Finalizar e da navegação de baixo (caça 169, B1).
//
// O que rola é o <main id="conteudo"> (App.tsx), e a barra é `fixed` por
// cima dele. O navegador, ao focar um campo, só o leva até a borda do
// contêiner — e a borda fica atrás da barra. `scroll-padding-bottom` no
// contêiner de rolagem, igual à reserva já medida (`--customer-pb-summary`),
// faz o campo parar ACIMA da barra.
//
// O jsdom não calcula layout nem rolagem: aqui só se prova que a regra existe,
// aponta para a reserva certa e alcança o <main> que contém a tela de
// finalizar. O efeito visual só se prova em navegador real.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) =>
  readFileSync(resolve(process.cwd(), caminho), "utf8");

function regrasComScrollPadding() {
  const achadas: { seletor: string; valor: string }[] = [];
  postcss.parse(ler("src/index.css")).walkRules((regra) => {
    regra.walkDecls("scroll-padding-bottom", (decl) => {
      achadas.push({ seletor: regra.selector, valor: decl.value });
    });
  });
  return achadas;
}

describe("campo focado no checkout fica acima da barra fixa", () => {
  it("o contêiner de rolagem que guarda a tela reserva a mesma folga da barra", () => {
    const regra = regrasComScrollPadding().find(
      (r) =>
        r.seletor.includes("main") &&
        r.seletor.includes(".pb-customer-summary"),
    );
    expect(regra).toBeDefined();
    expect(regra?.valor).toBe("var(--customer-pb-summary)");
  });

  it("a tela de finalizar usa mesmo a classe que a regra procura", () => {
    expect(ler("src/views/customer/CheckoutView.tsx")).toContain(
      'className="pb-customer-summary min-h-dvh',
    );
  });

  it("a reserva já soma navegação, área segura e a barra medida", () => {
    const css = ler("src/index.css");
    expect(css).toMatch(
      /--customer-pb:\s*calc\([^;]*--customer-footer-height[^;]*\);/s,
    );
  });
});
