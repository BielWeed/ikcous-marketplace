import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// O MapLibre REESCREVE o `transform` inline do elemento do Marker a cada
// projeção (translate/rotateZ). Um `transform` na própria caixa do pino é
// descartado em navegador real — a gota saía sem rotação e a ponta fora do
// ponto do endereço (achado visual de 29/09/2026, Chromium; o mock do
// MapLibre no teste do cartão não enxerga isso). A rotação mora nos
// pseudo-elementos, que o MapLibre não toca.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do CSS do próprio repositório, sem entrada externa.
const css = readFileSync(
  new URL(
    "../../src/components/ui/custom/address-card-map.css",
    import.meta.url,
  ),
  "utf8",
);

function bloco(seletor: string): string {
  const inicio = css.indexOf(`${seletor} {`);
  expect(inicio, `seletor ${seletor} existe`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

describe("pino do mapa do cartão — CSS convive com o Marker do MapLibre", () => {
  it("a caixa do marcador não declara transform (o MapLibre a sobrescreve)", () => {
    expect(bloco(".address-map__pin")).not.toMatch(/transform\s*:/);
  });

  it("a gota rotacionada vive no pseudo-elemento ::before", () => {
    expect(bloco(".address-map__pin::before")).toMatch(
      /transform:\s*rotate\(-45deg\)/,
    );
  });

  it("a caixa mede 32×42 (a ponta na base = anchor bottom do Marker)", () => {
    const b = bloco(".address-map__pin");
    expect(b).toMatch(/width:\s*32px/);
    expect(b).toMatch(/height:\s*42px/);
  });
});
