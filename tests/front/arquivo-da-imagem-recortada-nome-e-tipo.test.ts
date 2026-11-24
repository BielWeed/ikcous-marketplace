// Caça de provas fracas (mutação) em `arquivoDaImagemRecortada`, 24/11/2026.
// O arquivo do recorte só era provado pelas telas de produto e de banner. Uma
// troca sobrevivia: o "tipo desconhecido" cair em `.jpg`. É exatamente a
// mentira que este módulo existe para evitar: o upload deriva a extensão do
// bucket do NOME, o Storage serve com o Content-Type do `File.type`, e um
// ".jpg" com conteúdo WebP falha na transformação de imagem.
import { arquivoDaImagemRecortada } from "@/lib/arquivo-da-imagem-recortada";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("arquivoDaImagemRecortada — nome e tipo dizem a verdade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["image/webp", "webp"],
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
  ])("blob %s vira .%s com o MESMO tipo no arquivo", (tipo, extensao) => {
    const arquivo = arquivoDaImagemRecortada(
      new Blob(["x"], { type: tipo }),
      "banner-image-",
    );

    expect(arquivo.name).toBe(`banner-image-1700000000000.${extensao}`);
    expect(arquivo.type).toBe(tipo);
  });

  it("blob sem tipo vira WebP (o que o editor exporta), nunca .jpg", () => {
    const arquivo = arquivoDaImagemRecortada(new Blob(["x"]), "product-image-");

    expect(arquivo.name).toBe("product-image-1700000000000.webp");
    expect(arquivo.type).toBe("image/webp");
  });

  it("tipo que não é nenhum dos três: a extensão cai em .webp, nunca em .jpg", () => {
    const arquivo = arquivoDaImagemRecortada(
      new Blob(["x"], { type: "image/avif" }),
      "product-image-",
    );

    expect(arquivo.name).toMatch(/\.webp$/);
    expect(arquivo.name).not.toMatch(/\.jpe?g$/);
  });
});
