/* eslint-disable security/detect-non-literal-fs-filename -- lê somente fontes locais enumeradas por este teste, sem caminhos de entrada externa */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// SHA256 das classes originais de CADA atributo JSX className, na ordem da
// árvore, antes da P3. Não depende do HEAD futuro. Só desktop é descartado;
// uma mudança de celular/tablet em qualquer cartão/ramo quebra a referência.
const BASE: Record<string, string> = {
  "components/ui/custom/BannerCarousel.tsx":
    "6a43fb9428fca64b3b4d1d16e9da96b71e6d24beace9c8fdec91bc120e0ddeca",
  "components/ui/custom/CategoryFilter.tsx":
    "25a050a3a02bcd2afb8844d4884ad77e4972641827f6ef16d013c036cc127080",
  "components/ui/custom/InfoBlockCarousel.tsx":
    "dae8611c08bb6eca49261c4f70c59d91acb13fb38d2db976d9f787dae8862c7f",
  // 27/11/2026: o preço do cartão ganha 1 className novo, "whitespace-nowrap" no
  // número (só quebra entre o "R$" e o número); nenhuma classe antiga mudou.
  "components/ui/custom/OfertasCompactas.tsx":
    "e3175bf22d10f1f8df3dfee758d53471171a102b4960caaecdb9e599ffd618e1",
  "components/ui/custom/OfertasCompactasEsqueleto.tsx":
    "424bbbcd9c8224bb315140889fcb00c27f501b0c77de69d0aff924a4fb812be6",
  "components/ui/custom/OfertasLateral.tsx":
    "8a9321ee57934b9de1f7ca0fa5d71ea7465130af27a08c936cb0f5101437b242",
  "components/ui/custom/OfertasLateralDuplo.tsx":
    "3f2542d35e0c70b8f8d73d0528e248cd2f8a5881326398454ae8f2557390d4b3",
  "components/ui/custom/OfertasLateralDuploEsqueleto.tsx":
    "5f08f1fc7875a54e49755b41e151ed875c14d036ae2908b533488edc55dd1cc8",
  "components/ui/custom/OfertasLateralEsqueleto.tsx":
    "402b61e49185ba12ab5e843dad2e1583034c9911bfd552a1e75d7f17d0151907",
  "components/ui/custom/PremiumOffers.tsx":
    "2690b37164e472b758fcff2bd36cefab24b48d2a5952f4f348a5fb057a053155",
  "components/ui/custom/ProductList.tsx":
    "a548e94b10a5b942d83e6ebdf5613fccbf13e956430ce2ffcffd8b8431708940",
  // 25/11/2026 (1.5.234): o bloco "Horário de atendimento" do celular ficou compacto, a pedido do dono (ocupava ~200 px); só essa lista mudou.
  "views/customer/HomeView.tsx":
    "3fe49ed4949d9afeb77947e96b1999876486c115b10e5e87985a185c493f518d",
};

for (const [arquivo, esperado] of Object.entries(BASE)) {
  it(`celular/tablet preservados: ${arquivo}`, () => {
    const fonte = readFileSync(
      new URL(`../../src/${arquivo}`, import.meta.url),
      "utf8",
    );
    const arvore = ts.createSourceFile(
      arquivo,
      fonte,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const classes: string[] = [];
    const valor = (no: ts.Node) => {
      if (
        ts.isStringLiteral(no) ||
        ts.isNoSubstitutionTemplateLiteral(no) ||
        ts.isTemplateHead(no) ||
        ts.isTemplateMiddle(no) ||
        ts.isTemplateTail(no)
      ) {
        const celular = classesDoCelular(no.text);
        if (celular) classes.push(celular);
      }
      ts.forEachChild(no, valor);
    };
    const visitar = (no: ts.Node) => {
      if (
        ts.isJsxAttribute(no) &&
        no.name.getText(arvore) === "className" &&
        no.initializer
      )
        valor(no.initializer);
      else ts.forEachChild(no, visitar);
    };
    visitar(arvore);
    expect(classes.length).toBeGreaterThan(0);
    expect(
      createHash("sha256").update(JSON.stringify(classes)).digest("hex"),
    ).toBe(esperado);
  });
}
