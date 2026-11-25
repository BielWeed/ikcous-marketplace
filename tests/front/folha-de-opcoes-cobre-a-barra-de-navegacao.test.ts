import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Pedido do dono (24/11/2026): a folha "Escolher opções" abre do fundo da tela
// e COBRE a barra de navegação — antes ela parava acima da barra.
// Fontes lidas pelo Vite (`?raw`), sem API de Node.
const FONTES = import.meta.glob<string>(
  ["/src/components/ui/custom/ProductCard.tsx", "/src/components/ui/sheet.tsx"],
  { query: "?raw", import: "default", eager: true },
);

function fonte(caminho: string): string {
  const texto = new Map(Object.entries(FONTES)).get(caminho);
  expect(texto, `falta o fonte de ${caminho}`).toBeDefined();
  return (texto as string).replace(/\r\n/g, "\n");
}

describe("folha de opções do card cobre a barra de navegação", () => {
  const card = fonte("/src/components/ui/custom/ProductCard.tsx");
  const inicio = card.indexOf('data-testid="product-card-options-sheet"');
  const trecho = card.slice(inicio, inicio + 1400);

  it("a folha e o véu não reservam mais o espaço da barra", () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(trecho).not.toContain("--folha-acima-da-barra");
    expect(trecho).toContain("max-h-[calc(100dvh-72px)]");
  });

  it("a folha segue acima da barra na régua de camadas (z-130 > 120)", () => {
    const sheet = fonte("/src/components/ui/sheet.tsx");
    expect(sheet.match(/z-\[130\]/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sheet).toContain("inset-x-0 bottom-0");
  });

  it("o rodapé da folha sempre respeita a área segura do aparelho", () => {
    // O CSS não passa pelo `?raw` no vitest (volta vazio): leitura direta, com caminho literal.
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toContain(
      "--folha-folga-segura: var(--safe-area-bottom, 0px);",
    );
    expect(css).not.toContain("--folha-folga-segura: 0px;");
  });
});
