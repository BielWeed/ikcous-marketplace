import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pedido do dono (24/11/2026): a folha "Escolher opções" abre do fundo da tela
// e COBRE a barra de navegação — antes ela parava acima da barra.
function fonte(caminho: string): string {
  return readFileSync(resolve(process.cwd(), "src", caminho), "utf8");
}

describe("folha de opções do card cobre a barra de navegação", () => {
  const card = fonte("components/ui/custom/ProductCard.tsx");
  const inicio = card.indexOf('data-testid="product-card-options-sheet"');
  const trecho = card.slice(inicio, inicio + 1400);

  it("a folha e o véu não reservam mais o espaço da barra", () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(trecho).not.toContain("--folha-acima-da-barra");
    expect(trecho).toContain("max-h-[calc(100dvh-72px)]");
  });

  it("a folha segue acima da barra na régua de camadas (z-130 > 120)", () => {
    const sheet = fonte("components/ui/sheet.tsx");
    expect(sheet.match(/z-\[130\]/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sheet).toContain("inset-x-0 bottom-0");
  });

  it("o rodapé da folha sempre respeita a área segura do aparelho", () => {
    const css = fonte("index.css");
    expect(css).toContain(
      "--folha-folga-segura: var(--safe-area-bottom, 0px);",
    );
    expect(css).not.toContain("--folha-folga-segura: 0px;");
  });
});
