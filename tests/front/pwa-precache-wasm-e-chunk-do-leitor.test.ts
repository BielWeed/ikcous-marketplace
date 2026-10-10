import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// C2.4: afirmação por REGEX sobre o TEXTO do vite.config.ts — de propósito,
// não pelo factory de verdade. Montar a identidade de fixture para executar
// o factory é a receita pesada de tests/front/identity-build-config.test.ts;
// a prova final mesmo é o `npm run build` de C2.5, que lista o manifesto
// dentro do dist/sw.js. Aqui só prendemos que as três mudanças de texto
// continuam no lugar. Regex tolerantes a espaço, porque o Biome reformata.
// path.resolve com import.meta.dirname (em vez de fileURLToPath(new URL(...)))
// de propósito: é o caminho ESTÁTICO aos olhos do
// security/detect-non-literal-fs-filename (mesmo padrão de
// tests/front/rotas-de-entrada.test.ts) — não acorda warning novo na catraca.
const texto = readFileSync(
  path.resolve(import.meta.dirname, "../../vite.config.ts"),
  "utf8",
);

describe("precache do .wasm e chunk do leitor fora da exclusão Admin*", () => {
  it("globPatterns inclui wasm — o binário do leitor entra no precache", () => {
    expect(texto).toMatch(
      /globPatterns:\s*\[\s*"\*\*\/\*\.\{[^}]*\bwasm\b[^}]*\}"/,
    );
  });

  it("globIgnores ainda exclui assets/Admin*.js — a exclusão do admin continua de pé", () => {
    // Ancorado no array: os comentários do arquivo também citam a string
    // (ressalva da revisão de C2.4) e um toContain solto passaria só por eles.
    expect(texto).toMatch(/globIgnores:\s*\[[^\]]*"assets\/Admin\*\.js"/);
  });

  it("manualChunks tem um ramo do zxing-wasm devolvendo o chunk leitor-zxing", () => {
    expect(texto).toMatch(/zxing-wasm[\s\S]{0,400}return "leitor-zxing"/);
  });

  it("identityEntries mapeia a tela do PDV para um nome fora de Admin*, ImageAdjuster-* e PhoneSimulator-*", () => {
    const casamento = texto.match(
      /\[\s*"src\/views\/admin\/AdminPdvView\.tsx"\s*,\s*"([^"]+)"\s*\]/,
    );
    expect(casamento).not.toBeNull();
    const nome = casamento?.[1] ?? "";
    expect(nome).not.toMatch(/^Admin/);
    expect(nome.startsWith("ImageAdjuster-")).toBe(false);
    expect(nome.startsWith("PhoneSimulator-")).toBe(false);
  });
});
