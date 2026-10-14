// O marcador "Sem Imagem" não é foto do produto: `src/lib/foto-do-produto.ts`
// o reconhece pela hospedagem (placehold.co) e o tira da lista de fotos. O
// fluxo na tela está em admin-product-form-capa-sem-imagem.
import { describe, expect, it } from "vitest";

import { ehMarcadorDeFoto, soFotosReais } from "@/lib/foto-do-produto";

const MARCADOR = "https://placehold.co/600x400?text=Sem+Imagem";
const REAL =
  "https://abc.supabase.co/storage/v1/object/public/products/foto.jpg";

describe("ehMarcadorDeFoto", () => {
  it("reconhece o marcador do mapper e variantes da mesma hospedagem", () => {
    expect(ehMarcadorDeFoto(MARCADOR)).toBe(true);
    expect(ehMarcadorDeFoto("https://placehold.co/100x100?text=AB")).toBe(true);
    expect(ehMarcadorDeFoto("http://PLACEHOLD.CO/600x600")).toBe(true);
    expect(ehMarcadorDeFoto("  https://placehold.co/600x600  ")).toBe(true);
    expect(ehMarcadorDeFoto("//placehold.co/600x600")).toBe(true);
  });

  it("foto de verdade não é marcador, mesmo com 'placehold' no meio do caminho", () => {
    expect(ehMarcadorDeFoto(REAL)).toBe(false);
    expect(ehMarcadorDeFoto("https://placehold.co.evil.com/x.jpg")).toBe(false);
    expect(ehMarcadorDeFoto("https://cdn.exemplo.com/placehold.co/x.jpg")).toBe(
      false,
    );
    expect(ehMarcadorDeFoto("")).toBe(false);
    expect(ehMarcadorDeFoto(undefined)).toBe(false);
    expect(ehMarcadorDeFoto(42)).toBe(false);
  });
});

describe("soFotosReais", () => {
  it("tira marcador e vazio, mantém as reais na ordem", () => {
    expect(soFotosReais([MARCADOR, REAL, "", "  ", `${REAL}?v=2`])).toEqual([
      REAL,
      `${REAL}?v=2`,
    ]);
  });

  it("lista só de marcador, vazia ou ausente dá lista vazia", () => {
    expect(soFotosReais([MARCADOR])).toEqual([]);
    expect(soFotosReais([])).toEqual([]);
    expect(soFotosReais(undefined)).toEqual([]);
    expect(soFotosReais(null)).toEqual([]);
  });

  it("não altera a lista recebida e ignora o que não é texto", () => {
    const entrada = [MARCADOR, REAL];
    soFotosReais(entrada);
    expect(entrada).toEqual([MARCADOR, REAL]);
    expect(soFotosReais([null, 3, REAL])).toEqual([REAL]);
  });
});
