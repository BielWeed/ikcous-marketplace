//
// B6 da a11y onda 3 (item 5 do brief 20260908-brief-a11y-onda3-invisivel.md,
// adiado porque App.tsx estava reivindicado pelo #427; agora livre — PR
// #452 juntou a onda 3 invisível, este é o follow-up): "pular para o
// conteúdo" como primeiro focável do app. Quem navega por teclado ou
// leitor de tela aperta Tab uma vez ao abrir a loja e recebe o link; Enter
// leva o foco para a área principal, sem passar pelo cabeçalho inteiro.
//
// Por que lê FONTE e não renderiza App: App.tsx arrasta supabase e
// framer-motion (mesma decisão de acess-onda2-contrato.test.tsx, cujo
// padrão este arquivo espelha). O que se prova aqui é a marcação — ordem
// no fonte decide a ordem de Tab.
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>("/src/App.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const APP = "/src/App.tsx";

function fonte(caminho: string): string {
  expect(FONTES, `falta o fonte de ${caminho}`).toHaveProperty(caminho);
  return FONTES[caminho] as string;
}

describe("o glob casou /src/App.tsx (nada de prova vazia)", () => {
  it("o fonte existe no glob", () => {
    expect(FONTES).toHaveProperty(APP);
  });
});

describe("B6 — skip link é o primeiro focável do app", () => {
  it('existe <a href="#conteudo"> com o texto "Pular para o conteúdo", invisível até focar', () => {
    const src = fonte(APP);
    const match = src.match(
      /<a\s+href="#conteudo"\s+className="([^"]+)"\s*>\s*Pular para o conteúdo\s*<\/a>/,
    );
    expect(
      match,
      'não achei o <a href="#conteudo"> com o texto exato',
    ).not.toBeNull();
    const classes = match?.[1] ?? "";
    expect(classes.startsWith("sr-only focus:not-sr-only")).toBe(true);
  });

  it("o skip link aparece ANTES de <AppBadgeSynchronizer e de <Header no fonte (primeiro focável)", () => {
    const src = fonte(APP);
    const posSkip = src.search(/<a\s+href="#conteudo"/);
    const posBadge = src.indexOf("<AppBadgeSynchronizer");
    const posHeader = src.indexOf("<Header");
    expect(posSkip, "skip link não encontrado no fonte").toBeGreaterThan(-1);
    expect(
      posBadge,
      "AppBadgeSynchronizer não encontrado no fonte",
    ).toBeGreaterThan(-1);
    expect(posHeader, "Header não encontrado no fonte").toBeGreaterThan(-1);
    expect(posSkip).toBeLessThan(posBadge);
    expect(posSkip).toBeLessThan(posHeader);
  });

  it('o <main> traz id="conteudo" e tabIndex={-1}', () => {
    const src = fonte(APP);
    // O <main> real é o único com ref={mainRef} (os outros "<main" no
    // fonte são texto de comentário). Recorta do "<main" que o precede até
    // o "> " que fecha a tag de abertura.
    const posRef = src.indexOf("ref={mainRef}");
    expect(posRef, "ref={mainRef} não encontrado no fonte").toBeGreaterThan(-1);
    const posAbertura = src.lastIndexOf("<main", posRef);
    expect(
      posAbertura,
      "abertura de <main> não encontrada antes de ref={mainRef}",
    ).toBeGreaterThan(-1);
    const posFechamento = src.indexOf(">", posRef);
    expect(
      posFechamento,
      "fechamento de <main> não encontrado",
    ).toBeGreaterThan(-1);
    const mainTag = src.slice(posAbertura, posFechamento + 1);
    expect(mainTag).toContain('id="conteudo"');
    expect(mainTag).toContain("tabIndex={-1}");
  });
});
