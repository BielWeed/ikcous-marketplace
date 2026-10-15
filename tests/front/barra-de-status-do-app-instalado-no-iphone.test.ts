/* eslint-disable security/detect-non-literal-fs-filename -- Lê só arquivos fixos do próprio repositório, nunca entrada de usuário. */
// O app instalado na tela inicial do iPhone usa `black-translucent`: o app
// desenha POR BAIXO da barra de status (hora, bateria), e o texto dela é
// sempre BRANCO. O cabeçalho do cliente é branco (`bg-white`) — hora e bateria
// sumiam, branco sobre branco. E o cabeçalho do painel da lojista não tinha
// folga nenhuma para a barra/notch: os botões do topo ficavam por baixo dela.
//
// O conserto: uma faixa escura com a altura exata da barra (`env(safe-area-
// inset-top)`, que vale 0 fora do iPhone instalado, então não existe lá) e a
// folga no topo do painel. Estes testes leem os arquivos de verdade; não medem
// o aparelho real.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const raiz = path.resolve(import.meta.dirname, "../..");
const ler = (arquivo: string) => readFileSync(path.join(raiz, arquivo), "utf8");

describe("barra de status do app instalado no iPhone", () => {
  it("o app continua desenhando por baixo da barra (viewport-fit=cover + black-translucent)", () => {
    const html = ler("index.html");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    );
  });

  it("existe uma faixa escura exatamente da altura da barra, só no app instalado", () => {
    const css = ler("src/index.css");
    const bloco = css.match(
      /@media \(display-mode: standalone\)\s*\{\s*html::before\s*\{([^}]*)\}\s*\}/,
    );
    expect(
      bloco,
      "faixa da barra de status ausente em index.css",
    ).not.toBeNull();
    const regras = bloco?.[1] ?? "";
    expect(regras).toMatch(/position:\s*fixed/);
    expect(regras).toMatch(/top:\s*0/);
    expect(regras).toMatch(/left:\s*0/);
    expect(regras).toMatch(/right:\s*0/);
    expect(regras).toMatch(/height:\s*env\(safe-area-inset-top,\s*0(px)?\)/);
    expect(regras).toMatch(/background:\s*#000/);
    expect(regras).toMatch(/pointer-events:\s*none/);
    expect(regras).toMatch(/z-index:\s*\d{4,}/);
  });

  it("o cabeçalho do painel da lojista abre espaço para a barra/notch no topo", () => {
    const layout = ler("src/components/layouts/AdminLayout.tsx");
    expect(layout).toMatch(/paddingTop:\s*"var\(--safe-area-top\)"/);
  });
});
