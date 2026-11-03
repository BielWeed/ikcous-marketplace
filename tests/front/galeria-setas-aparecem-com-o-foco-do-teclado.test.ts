// Contrato de classe da galeria de fotos do produto. Em tela com mouse e menor
// que 1024 px as setas ficam com opacidade 0 e só aparecem no hover do mouse.
// Quem chega nelas pelo teclado (Tab) recebia foco num botão invisível, sem ver
// onde estava. O contêiner das setas tem de aparecer também quando algo dentro
// da galeria recebe foco, como já faz o card de produto da vitrine.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fonte = (arquivo: string) =>
  readFileSync(resolve(process.cwd(), arquivo), "utf8");

function classesDoContainerDasSetas(codigo: string): string {
  const inicio = codigo.indexOf("Navigation Arrows");
  expect(inicio).toBeGreaterThan(-1);
  const trecho = codigo.slice(inicio);
  const fim = trecho.indexOf("</div>");
  return trecho.slice(0, fim);
}

describe("GaleriaDoProduto — setas visíveis para quem navega por teclado", () => {
  const galeria = fonte("src/components/ui/custom/GaleriaDoProduto.tsx");

  it("o contêiner das setas aparece com o foco de dentro dele", () => {
    const classes = classesDoContainerDasSetas(galeria);
    expect(classes).toContain("hover-hover:group-focus-within:opacity-100");
  });

  it("controle: o hover do mouse continua revelando as setas", () => {
    const classes = classesDoContainerDasSetas(galeria);
    expect(classes).toContain("hover-hover:group-hover:opacity-100");
    expect(classes).toContain("lg:!opacity-100");
  });

  it("controle: o contêiner externo da galeria continua sendo o `group`", () => {
    expect(galeria).toContain('"group relative aspect-[4/3]');
  });
});
