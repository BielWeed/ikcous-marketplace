// Lote 222 (C3): campo de valor em reais precisa de teclado com vírgula
// (inputMode="decimal"); "numeric" no iPhone só tem 0-9. Mesmo estilo de
// leitura de fonte de paineis-e-blocos-alvos-de-toque-l.test.tsx.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PASTA = "src/components/admin/shipping/";
const ler = (arq: string) => readFileSync(`${PASTA}${arq}`, "utf8");

function tagDoCampo(fonte: string, id: string): string {
  const ini = fonte.lastIndexOf("<input", fonte.indexOf(`id="${id}"`));
  return fonte.slice(ini, fonte.indexOf("/>", ini));
}

describe("lote 222 — campos de reais aceitam vírgula", () => {
  it.each([
    ["FreteGratisBloco.tsx", "frete-gratis-acima-de"],
    ["EstrategiaNacionalBloco.tsx", "frete-nacional-minimo"],
    ["EstrategiaNacionalBloco.tsx", "frete-nacional-valor-desconto"],
  ])("%s #%s usa teclado decimal", (arq, id) => {
    const tag = tagDoCampo(ler(arq), id);
    expect(tag).toContain('"decimal"');
    expect(tag).not.toMatch(/inputMode="numeric"/);
  });
});
