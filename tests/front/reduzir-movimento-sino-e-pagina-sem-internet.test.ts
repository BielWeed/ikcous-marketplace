// Lote 219 (caça 9), item 7: quem liga "Reduzir movimento" no aparelho não deve
// ver coisa balançando sem parar. Dois pontos achados:
//   - o sino do estado vazio das Notificações balançava para sempre
//     (`repeat: Infinity`): agora é UM balanço só;
//   - a página sem internet (public/offline.html) tinha três animações
//     infinitas (anéis e ícone) sem `prefers-reduced-motion`: agora só rodam
//     dentro de `@media (prefers-reduced-motion: no-preference)`.
//
// O `<MotionConfig reducedMotion="user">` na raiz do App NÃO foi aplicado: o
// App.tsx não pode importar framer-motion (tests/front/perf-entrada-sem-
// animacao-no-1o-paint.test.ts) — ver relatório do lote.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório, montado de import.meta.url
  readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );

/** Texto de dentro do bloco `{ ... }` que abre em `aberturaDoBloco`. */
function corpoDoBloco(css: string, aberturaDoBloco: string): string {
  const inicio = css.indexOf(aberturaDoBloco);
  if (inicio === -1) return "";
  const abre = css.indexOf("{", inicio);
  let fundo = 1;
  let i = abre + 1;
  while (i < css.length && fundo > 0) {
    if (css.charAt(i) === "{") fundo++;
    else if (css.charAt(i) === "}") fundo--;
    i++;
  }
  return css.slice(abre + 1, i - 1);
}

describe("sino do estado vazio das Notificações", () => {
  it("balança uma vez só: sem repeat infinito", () => {
    const fonte = ler("src/views/customer/NotificationsView.tsx");
    const i = fonte.indexOf("rotate: [0, -8, 8, -6, 6, 0]");
    expect(i, "animação do sino sumiu").toBeGreaterThan(-1);
    const trecho = fonte.slice(i - 80, i + 400);
    expect(trecho).not.toContain("POSITIVE_INFINITY");
    expect(trecho).not.toContain("Infinity");
    expect(trecho).not.toContain("repeat");
  });
});

describe("public/offline.html — movimento reduzido", () => {
  const html = ler("public/offline.html");
  const bloco = corpoDoBloco(
    html,
    "@media (prefers-reduced-motion: no-preference)",
  );

  it("existe o bloco que só liga a animação para quem não pediu menos movimento", () => {
    expect(bloco).not.toBe("");
    expect(bloco).toMatch(
      /\.ring\s*\{[^}]*animation:\s*ring-pulse[^}]*infinite/,
    );
    expect(bloco).toMatch(
      /\.signal-icon svg\s*\{[^}]*animation:\s*float[^}]*infinite/,
    );
  });

  it("nenhuma animação infinita fica fora desse bloco", () => {
    const fora = html.replace(bloco, "");
    expect(fora).not.toMatch(/animation:[^;]*infinite/);
  });
});
