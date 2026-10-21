/* eslint-disable security/detect-non-literal-fs-filename -- Lê só arquivos fixos do próprio repositório, nunca entrada de usuário. */
// O manifesto do app instalado dizia `orientation: "portrait"`. No Android, o
// app instalado obedece: a lojista com o tablet (ou o celular) deitado no
// balcão, na hora de fazer a venda no PDV, não conseguia usar a tela deitada.
// (No iPhone o valor é ignorado; no navegador comum a tela já gira.)
//
// "any" deixa o aparelho decidir: gira se a pessoa deixou a rotação
// automática ligada. Este teste guarda a estrutura e as regras de rolagem:
// título e resumo também pertencem ao corpo do fechamento, não à parte fixa.
// Não mede a altura disponível nem o alcance físico; isso exige navegador.
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
    // A altura externa é travada, então o próprio viewport rola quando o
    // mínimo das regiões não cabe (`hidden` cortava a lista em tela deitada).
    expect(css).toMatch(/\.pdv-viewport\s*\{[^}]*overflow-y:\s*auto/);
    for (const classe of ["pdv-checkout-body", "pdv-variation-options"]) {
      const bloco = css.match(new RegExp(`\\.${classe}\\s*\\{([^}]+)\\}`))?.[1];
      expect(bloco, classe).toMatch(/min-height:\s*0/);
      expect(bloco, classe).toMatch(/overflow-y:\s*(auto|scroll)/);
      expect(bloco, classe).toMatch(/overscroll-behavior:\s*contain/);
    }
  });

  it("título e resumo do fechamento ficam dentro do corpo que rola", () => {
    const codigo = ler("src/components/admin/pdv/FechamentoDaVenda.tsx");
    const inicio = codigo.indexOf('className="pdv-checkout-body"');
    const barra = codigo.indexOf('<AcaoDaBarra aria-label="Registrar a venda"');
    const corpo = codigo.slice(inicio, barra);
    expect(inicio).toBeGreaterThan(-1);
    expect(corpo).toContain('className="pdv-layer-heading"');
    expect(corpo).toContain('className="pdv-cupom pdv-stack"');
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
