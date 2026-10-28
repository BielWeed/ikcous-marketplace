import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Afirmação por REGEX sobre o TEXTO do vite.config.ts — de propósito, não pelo
// factory de verdade. Montar a identidade de fixture para executar o factory é
// a receita pesada de tests/front/identity-build-config.test.ts; a prova real
// é o `sw.js` do build, lido por tests/porteiro-dois-hosts/precache-sem-painel
// .test.ts, e o filtro em si é coberto por tests/front/precache-sem-painel
// .test.ts. Aqui só prendemos que a LIGAÇÃO continua no lugar. Regex tolerantes
// a espaço, porque o Biome reformata.
//
// Lote 252 (28/10/2026): antes este arquivo prendia o contrário — o .wasm e o
// chunk do leitor no precache, e o nome `PdvBalcao` fora da exclusão Admin*, "para
// o balcão ler offline". O dono decidiu que o Balcão não precisa funcionar sem
// internet: o painel inteiro sai do precache e vai pela rede.
// path.resolve com import.meta.dirname (em vez de fileURLToPath(new URL(...)))
// de propósito: é o caminho ESTÁTICO aos olhos do
// security/detect-non-literal-fs-filename (mesmo padrão de
// tests/front/rotas-de-entrada.test.ts) — não acorda warning novo na catraca.
const texto = readFileSync(
  path.resolve(import.meta.dirname, "../../vite.config.ts"),
  "utf8",
);

describe("o painel e o leitor do balcão fora do precache do service worker", () => {
  it("globPatterns NÃO inclui wasm — o binário do leitor (406 kB) não é baixado por toda cliente", () => {
    const globPatterns = texto.match(/globPatterns:\s*\[\s*"([^"]+)"/)?.[1];
    expect(globPatterns).toBeDefined();
    expect(globPatterns).not.toMatch(/\bwasm\b/);
  });

  it("globIgnores ainda exclui assets/Admin*.js — a exclusão do admin continua de pé", () => {
    // Ancorado no array: os comentários do arquivo também citam a string
    // (ressalva da revisão de C2.4) e um toContain solto passaria só por eles.
    expect(texto).toMatch(/globIgnores:\s*\[[^\]]*"assets\/Admin\*\.js"/);
  });

  it("o filtro do painel está ligado ao injectManifest (manifestTransforms)", () => {
    // Sem esta linha o painel volta ao precache e nenhum erro aparece no build.
    expect(texto).toMatch(
      /injectManifest:\s*\{[\s\S]*?manifestTransforms:\s*\[\s*semPainel\.tirarOPainel\s*\]/,
    );
  });

  it("o plugin que classifica o painel entra no build junto do portão de tamanho", () => {
    expect(texto).toMatch(
      /portaoDividido\(\{[^}]*\}\),[\s\S]{0,400}?semPainel\.plugin/,
    );
    expect(texto).toMatch(/const semPainel = precacheSemPainel\(\)/);
  });

  it("manualChunks tem um ramo do zxing-wasm devolvendo o chunk leitor-zxing", () => {
    expect(texto).toMatch(/zxing-wasm[\s\S]{0,400}return "leitor-zxing"/);
  });
});
