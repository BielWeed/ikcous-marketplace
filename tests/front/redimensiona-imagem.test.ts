// Laudo novos ângulos 01/09 (C2): o upload gravava o arquivo CRU do celular
// — foto de 12 MP são vários MB guardados no bucket e servidos a quem escapar
// do pipeline de render. A decisão de redimensionar (`planoDaImagem`) é pura
// e testada aqui; o canvas em si (`redimensionarImagem`) é fail-open e não
// é testável em jsdom sem mocks de bitmap.
//
// O assassino de mutantes: trocar `<=` por `<` no peso mínimo, inverter o
// corte do JPEG/PNG ou usar a MENOR dimensão em vez da maior — cada mutação
// faz um caso abaixo falhar.

import {
  LADO_MAXIMO_UPLOAD,
  PESO_MINIMO_PARA_REDIMENSIONAR,
  planoDaImagem,
} from "@/lib/redimensiona-imagem";
import { describe, expect, it } from "vitest";

describe("planoDaImagem — o que o upload redimensiona", () => {
  it("foto de celular grande (JPEG, 12 MP): redimensiona para o lado máximo", () => {
    const plano = planoDaImagem("image/jpeg", 4 * 1024 * 1024, 4000, 3000);
    expect(plano.redimensionar).toBe(true);
    expect(plano.lado).toBe(LADO_MAXIMO_UPLOAD);
    expect(plano.mime).toBe("image/jpeg");
  });

  it("retrato: o lado que corta é o MAIOR (altura), não a largura", () => {
    const plano = planoDaImagem("image/jpeg", 3 * 1024 * 1024, 3000, 4000);
    expect(plano.redimensionar).toBe(true);
    expect(plano.lado).toBe(LADO_MAXIMO_UPLOAD);
  });

  it("imagem já pequena em peso: passa intacta, mesmo larga", () => {
    const plano = planoDaImagem("image/jpeg", 120 * 1024, 4000, 3000);
    expect(plano.redimensionar).toBe(false);
  });

  it("fronteira do peso mínimo: no limite passa a redimensionar", () => {
    const abaixo = planoDaImagem(
      "image/jpeg",
      PESO_MINIMO_PARA_REDIMENSIONAR - 1,
      2000,
      1000,
    );
    expect(abaixo.redimensionar).toBe(false);
    const noLimite = planoDaImagem(
      "image/jpeg",
      PESO_MINIMO_PARA_REDIMENSIONAR,
      2000,
      1000,
    );
    expect(noLimite.redimensionar).toBe(true);
    expect(noLimite.lado).toBe(1600);
  });

  it("PNG grande redimensiona e continua PNG (transparência sobrevive)", () => {
    const plano = planoDaImagem("image/png", 2 * 1024 * 1024, 2200, 1200);
    expect(plano.redimensionar).toBe(true);
    expect(plano.mime).toBe("image/png");
  });

  it("GIF, SVG, webp e HEIC passam intactos (rasterizar os mata)", () => {
    for (const mime of [
      "image/gif",
      "image/svg+xml",
      "image/webp",
      "image/heic",
    ]) {
      expect(
        planoDaImagem(mime, 5 * 1024 * 1024, 4000, 3000).redimensionar,
      ).toBe(false);
    }
  });

  it("imagem menor que o lado máximo mas acima do peso: lado fica o dela", () => {
    const plano = planoDaImagem("image/jpeg", 900 * 1024, 1200, 900);
    expect(plano.redimensionar).toBe(true);
    expect(plano.lado).toBe(1200);
  });
});
