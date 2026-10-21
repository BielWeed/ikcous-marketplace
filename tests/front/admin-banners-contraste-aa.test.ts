import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const base = readFileSync(
  new URL("../../src/index.css", import.meta.url),
  "utf8",
);
const temas = readFileSync(
  new URL("../../src/components/layouts/temas-do-painel.css", import.meta.url),
  "utf8",
);

function token(css: string, nome: string): number[] {
  const valor = css.match(
    new RegExp(`--admin-${nome}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`),
  );
  if (!valor) throw new Error(`Token ${nome} ausente`);
  const [h, s, l] = valor.slice(1).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  return [0, 8, 4].map((n) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  });
}

function rgb(hex: string): number[] {
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
}

function luminancia(cor: number[]): number {
  return cor
    .map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
    .reduce((soma, c, i) => soma + c * [0.2126, 0.7152, 0.0722][i], 0);
}

function contraste(a: number[], b: number[]): number {
  const x = luminancia(a);
  const y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("paleta dos banners tem contraste AA sem opacidade no cartão", () => {
  it("controle: branco/preto = 21 e zinc-500 não servia no elevado escuro", () => {
    expect(contraste(rgb("ffffff"), rgb("000000"))).toBe(21);
    expect(contraste(rgb("71717a"), token(base, "raised"))).toBeLessThan(4.5);
  });
  for (const tema of ["escuro", "claro", "confortavel"]) {
    const css =
      tema === "escuro"
        ? base
        : temas
            .split(`html.admin-mode[data-admin-tema="${tema}"] {`)[1]
            .split("}")[0];
    const suave = tema === "escuro" ? rgb("a1a1aa") : token(css, "text-soft");
    const texto = tema === "escuro" ? rgb("e4e4e7") : token(css, "text");
    it(`${tema}: metadados e título pausado nos fundos do cartão`, () => {
      for (const fundo of ["bg", "surface", "raised"]) {
        expect(
          contraste(suave, token(css, fundo)),
          fundo,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${tema}: Cancelar no fundo elevado e hover`, () => {
      for (const fundo of ["raised", "hover"]) {
        expect(
          contraste(texto, token(css, fundo)),
          fundo,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("confirmar exclusão: texto branco sobre vermelho sólido e hover", () => {
    for (const cor of ["dc2626", "b91c1c"]) {
      expect(contraste(rgb("ffffff"), rgb(cor))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
