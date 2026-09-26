// @vitest-environment jsdom
//
// achado AdminProductFormView-499: o ImageAdjuster SEMPRE exporta
// `image/webp` (ver ImageAdjuster.tsx: `const exportFormat = "image/webp"`
// passado a `canvas.toBlob`), mas `handleAdjustConfirm` embrulhava esse
// blob com nome fixo `product-image-<ts>.jpg` e `type: "image/jpeg"` —
// mentindo nome E Content-Type sobre um conteúdo que é WEBP de verdade.
// O mesmo defeito existia na tela de banners
// (AdminBannersView.handleAdjustConfirm) — follow-up 17/09.
//
// A consequência não é só estética: o upload deriva a extensão do bucket a
// partir do NOME do arquivo (`pronto.name.split(".").pop()`, useProducts)
// e o Storage serve o objeto com o Content-Type do `File.type`. O
// transformador de imagem do Storage decodifica pelo Content-Type
// DECLARADO, não pelos bytes — um ".jpg" que é webp por dentro falha na
// transformação, e o LazyImage cai no fallback da imagem ORIGINAL (sem
// redimensionar) em toda a vitrine.
//
// O helper virou função pura em src/lib/arquivo-da-imagem-recortada.ts,
// compartilhada pelas duas telas (cada uma passa o seu prefixo de nome) —
// mesmo mecanismo de geometria-do-recorte.ts e de `compressProductImage`
// (admin-product-form-compressimage-fundo-preto.test.ts). O fluxo REAL da
// tela de banners com o ImageAdjuster montado fica na regressão
// admin-banners-recorte-salva-o-tipo-real-da-imagem.test.tsx.
import { describe, expect, it } from "vitest";

import { arquivoDaImagemRecortada } from "@/lib/arquivo-da-imagem-recortada";

describe("arquivoDaImagemRecortada (upload do recorte da tesoura) usa o tipo REAL do blob", () => {
  it("blob WEBP (o que o ImageAdjuster realmente exporta) vira arquivo .webp com Content-Type image/webp — não .jpg/image/jpeg", () => {
    const blobWebp = new Blob(["conteudo-fake-webp"], { type: "image/webp" });
    const arquivo = arquivoDaImagemRecortada(blobWebp, "product-image-");

    // Esta é a asserção que o defeito original quebrava: nome e tipo
    // MENTIAM jpeg para um conteúdo webp.
    expect(arquivo.type).toBe("image/webp");
    expect(arquivo.name.endsWith(".webp")).toBe(true);
    expect(arquivo.name.endsWith(".jpg")).toBe(false);
    expect(arquivo.type).not.toBe("image/jpeg");
  });

  it("blob PNG sai coerente — extensão .png com Content-Type image/png", () => {
    const blobPng = new Blob(["conteudo-fake-png"], { type: "image/png" });
    const arquivo = arquivoDaImagemRecortada(blobPng, "product-image-");

    expect(arquivo.type).toBe("image/png");
    expect(arquivo.name.endsWith(".png")).toBe(true);
    expect(arquivo.name.endsWith(".jpg")).toBe(false);
  });

  it("controle: um blob jpeg (se o ImageAdjuster algum dia mudar) ainda sai coerente — extensão .jpg com Content-Type image/jpeg", () => {
    const blobJpeg = new Blob(["conteudo-fake-jpeg"], { type: "image/jpeg" });
    const arquivo = arquivoDaImagemRecortada(blobJpeg, "product-image-");

    expect(arquivo.type).toBe("image/jpeg");
    expect(arquivo.name.endsWith(".jpg")).toBe(true);
  });

  it("controle: blob sem `type` (ambiente que não preenche Blob.type) cai no formato que o ImageAdjuster de fato produz, webp — nunca no jpeg mentiroso antigo", () => {
    const blobSemTipo = new Blob(["sem-tipo"]);
    const arquivo = arquivoDaImagemRecortada(blobSemTipo, "product-image-");

    expect(arquivo.type).toBe("image/webp");
    expect(arquivo.name.endsWith(".webp")).toBe(true);
  });

  it("nome continua com o prefixo passado por cada tela — produto e banner", () => {
    const blobWebp = new Blob(["x"], { type: "image/webp" });

    const arquivoDoProduto = arquivoDaImagemRecortada(
      blobWebp,
      "product-image-",
    );
    const arquivoDoBanner = arquivoDaImagemRecortada(blobWebp, "banner-image-");

    expect(arquivoDoProduto.name.startsWith("product-image-")).toBe(true);
    expect(arquivoDoBanner.name.startsWith("banner-image-")).toBe(true);
  });
});
