// Achado 1 da revisão (rodada 2, 11/09/2026): `config.matcher` em
// `middleware.ts` PRECISA ser um array-LITERAL — a Vercel/Next lê esse
// campo por ANÁLISE ESTÁTICA em tempo de build, e qualquer valor que não
// seja um literal (import, variável, chamada de função) é IGNORADO
// (Next.js `proxy.mdx`, seção "Matcher > Good to know": "The matcher
// values need to be constants so they can be statically analyzed at
// build-time. Dynamic values such as variables will be ignored" — conferido
// via context7, `/vercel/next.js`, 11/09/2026). Matcher ignorado vira
// `/(.*)`: o porteiro passaria a rodar em TODA rota, inclusive
// `/assets/*.js` (content-type errado) e `/index.html` (recursão no
// self-fetch de `atenderPorteiro`).
//
// Este teste lê `middleware.ts` DO DISCO (não importa o módulo — importar
// não prova nada sobre o que o compilador de rota vê, já que o import
// resolveria a variável em runtime da mesma forma que um binding local) e
// confere que o array ali dentro é (a) um literal de verdade — sem
// backtick, sem `${`, sem identificador — e (b) byte a byte igual à cópia
// que `src/hospedagem/porteiro.ts` exporta só para este teste.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { matcher } from "@/hospedagem/porteiro";

const CAMINHO_MIDDLEWARE = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "middleware.ts",
);

function extrairMatcherLiteral(fonte: string): string {
  const casamento = fonte.match(
    /export const config = \{\s*matcher:\s*(\[[\s\S]*?\]),?\s*\};/,
  );
  if (!casamento)
    throw new Error(
      "porteiro-middleware-matcher: não achei `export const config = { matcher: [...] }` em middleware.ts — a forma mudou, atualizar este teste.",
    );
  return casamento[1];
}

describe("middleware.ts — config.matcher tem de ser um array LITERAL, nunca importado", () => {
  const fonte = readFileSync(CAMINHO_MIDDLEWARE, "utf8");
  const literal = extrairMatcherLiteral(fonte);

  it("o array não importa `matcher` de porteiro.ts — nenhum import traz esse nome", () => {
    // Confirma a causa raiz do achado 1: a versão quebrada tinha
    // `import { atenderPorteiro, matcher, resolverConexao } from ...`.
    const importaMatcher =
      /import\s*\{[^}]*\bmatcher\b[^}]*\}\s*from\s*["']\.\/src\/hospedagem\/porteiro\.ts["']/.test(
        fonte,
      );
    expect(importaMatcher).toBe(false);
  });

  // `JSON.parse` tolera vírgula à direita (`,\n]`) do Prettier, então tira
  // ela antes — e é ISSO que prova o resto: um array com import, variável
  // ou chamada de função no meio NÃO vira JSON válido depois desse único
  // ajuste, e o teste falharia com `SyntaxError`, não passaria em silêncio.
  const literalJson = literal.replace(/,(\s*\])/, "$1");

  it("o literal extraído não contém template string nem interpolação — só strings entre aspas duplas", () => {
    // Backtick nunca aparece num array de strings estaticamente
    // analisável; `${` (início de interpolação) também não — o `$` sozinho
    // aparece de propósito dentro do PRÓPRIO padrão (`.*\.[A-Za-z0-9]+$`,
    // fim de string da regex), então o teste tem de distinguir os dois.
    expect(literal).not.toMatch(/`/);
    expect(literal).not.toMatch(/\$\{/);
    // JSON.parse só aceita aspas duplas e nenhum identificador solto — se o
    // literal não for JSON válido, ele tem algo além de string pura
    // (variável, chamada, etc.) e NÃO é estaticamente analisável.
    expect(() => JSON.parse(literalJson)).not.toThrow();
  });

  it("é byte a byte igual (por valor) à cópia que porteiro.ts exporta para este teste", () => {
    const doMiddleware: unknown = JSON.parse(literalJson);
    expect(doMiddleware).toEqual(matcher);
  });

  it("tem os três padrões do desenho (brief T3b, item 6 — lista nomeada; rodada 2, achado 1: offline.html e google*.html)", () => {
    const doMiddleware: unknown = JSON.parse(literalJson);
    expect(doMiddleware).toEqual([
      "/((?!assets/|store-identity/|icons/|images/|fonts/|sw\\.js$|workbox-[^/]*\\.js$|version\\.json$|favicon\\.ico$|favicon\\.svg$|logo\\.svg$|apple-touch-icon\\.png$|robots\\.txt$|sitemap\\.xml$|og-image\\.png$|silent-guardian\\.js$|loading\\.css$|404\\.html$|index\\.html$|registerSW\\.js$|offline\\.html$|google[A-Za-z0-9]*\\.html$).*)",
      "/identidade.json",
      "/manifest.webmanifest",
    ]);
  });
});
