import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C5.1 — o ramo ADMIN do catchUp (src/lib/realtimeSyncEngine.ts) busca os
 * detalhes de produto por uma LISTA EXPLÍCITA de colunas (o comentário
 * ao lado explica por quê: `*` pediria `custo`, coluna com SELECT negado ao
 * `authenticated`). `codigo_barras` é coluna nova (migration 20261160000000)
 * e, sem entrar nessa lista, o catch-up do admin nunca traz o código de
 * barras para o IndexedDB — o PDV bipa e não encontra nada até a próxima
 * carga completa da página.
 *
 * Prova ESTÁTICA por regex sobre o texto-fonte, no molde de
 * tests/front/pwa-precache-wasm-e-chunk-do-leitor.test.ts: mais barata que
 * montar um Supabase dublê inteiro para uma checagem que é, no fundo, sobre
 * o texto de uma string de `.select(...)`. `path.resolve` com
 * `import.meta.dirname` de propósito: caminho ESTÁTICO aos olhos do
 * security/detect-non-literal-fs-filename, sem acordar warning novo.
 */
const texto = readFileSync(
  path.resolve(import.meta.dirname, "../../src/lib/realtimeSyncEngine.ts"),
  "utf8",
);

describe("catchUp admin (realtimeSyncEngine.ts) traz codigo_barras", () => {
  it("a lista explícita do ramo admin contém codigo_barras logo depois de codigo", () => {
    // Âncora em "codigo, codigo_barras" (e não só um toContain solto de
    // "codigo_barras") para não passar por acidente se a string aparecer só
    // no comentário do arquivo, e para travar a posição pedida pela tarefa
    // ("logo depois de codigo").
    expect(texto).toMatch(/\bcodigo,\s*codigo_barras\b/);
  });

  it("a mesma linha ainda pede product_variants(*) — a lista não perdeu a grade de variações", () => {
    const casamento = texto.match(
      /isAdmin\s*\?\s*"([^"]*product_variants\(\*\))"/,
    );
    expect(casamento).not.toBeNull();
    const listaDoRamoAdmin = casamento?.[1] ?? "";
    expect(listaDoRamoAdmin).toContain("codigo_barras");
    expect(listaDoRamoAdmin).toContain("product_variants(*)");
  });
});
