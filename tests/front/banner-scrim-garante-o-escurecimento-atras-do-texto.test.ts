// O escurecimento (scrim) atrás do texto do banner existe para garantir
// contraste do texto branco mesmo sobre foto clara (ver o comentário de
// `src/lib/banner-scrim.ts`). O teste que já existia só confere que a classe
// "contém `bg-gradient-to-t`" ou "contém `radial-gradient`": trocar `black/75`
// por `black/5`, tirar o `to-transparent` ou deslocar o radial para o topo
// passava verde, e o banner perdia o escurecimento sem ninguém perceber.
//
// Aqui o que se prova é o CONTRATO do escurecimento, lido da própria classe:
// mais forte onde o texto fica, sumindo para o lado oposto. Não se prova o
// desenho na tela (isso o jsdom não enxerga), só o que a função entrega.
import { classeDoScrimDoBanner } from "@/lib/banner-scrim";
import { describe, expect, it } from "vitest";

// Piso de opacidade (em %) onde o texto fica: abaixo disso, texto branco sobre
// foto clara volta a ficar ilegível — foi o motivo de o escurecimento existir.
const PISO_ONDE_O_TEXTO_FICA = 60;

describe("classeDoScrimDoBanner — modelos com o texto embaixo", () => {
  it.each([
    "default",
    "split_left",
    "split_right",
    "neon_glow",
    "modelo-que-nao-existe",
    "",
    undefined,
    null,
  ])(
    "%s: gradiente do rodapé para cima, forte embaixo e transparente em cima",
    (modelo) => {
      const classe = classeDoScrimDoBanner(modelo);

      // `-t` = o gradiente cresce de baixo (onde o texto fica) para cima.
      expect(classe).toContain("bg-gradient-to-t");
      expect(classe).not.toContain("radial");

      const embaixo = Number(/from-black\/(\d+)/.exec(classe)?.[1]);
      const meio = Number(/via-black\/(\d+)/.exec(classe)?.[1]);
      expect(embaixo).toBeGreaterThanOrEqual(PISO_ONDE_O_TEXTO_FICA);
      expect(embaixo).toBeLessThanOrEqual(100);
      // Desce de forma contínua: o meio é mais fraco que a base e ainda aparece.
      expect(meio).toBeGreaterThan(0);
      expect(meio).toBeLessThan(embaixo);
      // E some por completo no lado oposto, para não escurecer a foto toda.
      expect(classe).toMatch(/\bto-transparent\b/);
    },
  );

  it("todos eles escurecem exatamente igual (só o centralizado e o de vidro são diferentes)", () => {
    const padrao = classeDoScrimDoBanner("default");
    for (const modelo of [
      "split_left",
      "split_right",
      "neon_glow",
      undefined,
      null,
    ]) {
      expect(classeDoScrimDoBanner(modelo)).toBe(padrao);
    }
  });
});

describe("classeDoScrimDoBanner — modelo com o texto no centro", () => {
  it("escurece a partir do centro, forte no meio e sumindo até a borda", () => {
    const classe = classeDoScrimDoBanner("split_center");

    expect(classe).toContain("radial-gradient");
    expect(classe).toContain("ellipse_at_center");
    expect(classe).not.toContain("bg-gradient-to-t");

    // Paradas do gradiente: rgba(0,0,0,<alfa>)_<posição>%
    const paradas = Array.from(
      classe.matchAll(/rgba\(0,0,0,([\d.]+)\)_(\d+)%/g),
      (m) => ({ alfa: Number(m[1]), posicao: Number(m[2]) }),
    );
    expect(paradas).toHaveLength(3);
    const [centro, meio, borda] = paradas;

    expect(centro.posicao).toBe(0);
    expect(centro.alfa * 100).toBeGreaterThanOrEqual(PISO_ONDE_O_TEXTO_FICA);
    // Alfa só desce do centro para fora, e as paradas andam para fora.
    expect(meio.alfa).toBeGreaterThan(0);
    expect(meio.alfa).toBeLessThan(centro.alfa);
    expect(meio.posicao).toBeGreaterThan(centro.posicao);
    expect(borda.alfa).toBe(0);
    expect(borda.posicao).toBeGreaterThan(meio.posicao);
    expect(borda.posicao).toBeLessThanOrEqual(100);
  });
});

describe("classeDoScrimDoBanner — vidro fosco", () => {
  it("não recebe escurecimento nenhum (a caixa do texto já tem o dela)", () => {
    expect(classeDoScrimDoBanner("glassmorphic")).toBe("");
  });
});
