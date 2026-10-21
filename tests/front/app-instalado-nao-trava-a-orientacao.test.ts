/* eslint-disable security/detect-non-literal-fs-filename -- Lê só arquivos fixos do próprio repositório, nunca entrada de usuário. */
// O manifesto do app instalado dizia `orientation: "portrait"`. No Android, o
// app instalado obedece: a lojista com o tablet (ou o celular) deitado no
// balcão, na hora de fazer a venda no PDV, não conseguia usar a tela deitada.
// (No iPhone o valor é ignorado; no navegador comum a tela já gira.)
//
// "any" deixa o aparelho decidir: gira se a pessoa deixou a rotação
// automática ligada. A página do PDV pode ter altura limitada, desde que
// fechamento e escolha de variação preservem rolagem interna alcançável.
// Não mede a tela num aparelho real.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { MANIFESTO_BASE } from "@/config/manifestoBase";
import { describe, expect, it } from "vitest";

const raiz = path.resolve(import.meta.dirname, "../..");
const ler = (arquivo: string) => readFileSync(path.join(raiz, arquivo), "utf8");

describe("o app instalado não trava a orientação", () => {
  it("o manifesto-base diz 'any' (nem portrait, nem landscape, nem natural)", () => {
    expect(MANIFESTO_BASE.orientation).toBe("any");
  });

  it("nenhum dos dois montadores de manifesto sobrescreve a orientação", () => {
    for (const arquivo of [
      "vite.config.ts",
      "src/hospedagem/porteiro.ts",
      "scripts/identityBuildConfig.ts",
    ]) {
      expect(ler(arquivo), arquivo).not.toMatch(/\borientation\s*:/);
    }
  });
});

describe("a tela do PDV funciona deitada sem cortar conteúdo", () => {
  const pasta = "src/components/admin/pdv";
  const arquivos = [
    "src/views/admin/AdminPdvView.tsx",
    ...readdirSync(path.join(raiz, pasta))
      .filter((nome) => nome.endsWith(".tsx"))
      .map((nome) => `${pasta}/${nome}`),
  ];

  it("altura externa travada só é aceita com rolagem dos dois corpos", () => {
    const css = ler("src/components/admin/pdv/pdv.css");
    expect(css).toMatch(/\.pdv-viewport\s*\{[^}]*overflow:\s*hidden/);
    for (const classe of ["pdv-checkout-body", "pdv-variation-options"]) {
      const bloco = css.match(new RegExp(`\\.${classe}\\s*\\{([^}]+)\\}`))?.[1];
      expect(bloco, classe).toMatch(/min-height:\s*0/);
      expect(bloco, classe).toMatch(/overflow-y:\s*(auto|scroll)/);
      expect(bloco, classe).toMatch(/overscroll-behavior:\s*contain/);
    }
  });

  it("encontrou os arquivos do PDV", () => {
    expect(arquivos.length).toBeGreaterThan(5);
  });

  it.each(arquivos)(
    "%s não trava altura/largura de tela nem fixa elemento",
    (arquivo) => {
      const codigo = ler(arquivo);
      const travas =
        /\b(h-screen|min-h-screen|max-h-screen|w-screen|h-dvh|h-svh|h-lvh)\b|\b(h|min-h|max-h)-\[[^\]]*\d(vh|dvh|svh|lvh)\]|\b(fixed|sticky)\b/;
      expect(codigo).not.toMatch(travas);
    },
  );
});
