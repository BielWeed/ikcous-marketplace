// O editor de foto pede `image/webp` ao canvas. O Safari do iPhone não gera
// WebP: ignora o pedido e entrega PNG sem avisar, e uma foto de câmera em PNG
// pesa alguns MB (e o envio seguinte não consegue reduzir PNG). Esta função
// confere o tipo que VOLTOU e, se o navegador caiu para PNG, refaz em JPEG.
import { describe, expect, it } from "vitest";

import { canvasParaBlobNoFormato } from "@/lib/canvas-para-blob";

type Pedido = { tipo: string; qualidade: number };

// Canvas de mentira: cada formato pedido devolve o que `respostas` manda
// (tipo + tamanho em bytes), e os pedidos ficam anotados.
function canvasFalso(
  respostas: Record<string, { tipo: string; bytes: number } | null>,
) {
  const pedidos: Pedido[] = [];
  const canvas = {
    toBlob(cb: (b: Blob | null) => void, tipo?: string, qualidade?: number) {
      pedidos.push({ tipo: tipo ?? "", qualidade: qualidade ?? -1 });
      const r = respostas[tipo ?? ""];
      cb(r ? new Blob([new Uint8Array(r.bytes)], { type: r.tipo }) : null);
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, pedidos };
}

describe("canvasParaBlobNoFormato", () => {
  it("o navegador entrega WebP (Chrome, Android): um pedido só, o blob vem como está", async () => {
    const { canvas, pedidos } = canvasFalso({
      "image/webp": { tipo: "image/webp", bytes: 100 },
    });
    const blob = await canvasParaBlobNoFormato(canvas, "image/webp", 0.85);
    expect(blob?.type).toBe("image/webp");
    expect(pedidos).toEqual([{ tipo: "image/webp", qualidade: 0.85 }]);
  });

  it("o Safari cai para PNG pesado: refaz em JPEG com a mesma qualidade e entrega o JPEG", async () => {
    const { canvas, pedidos } = canvasFalso({
      "image/webp": { tipo: "image/png", bytes: 3_000_000 },
      "image/jpeg": { tipo: "image/jpeg", bytes: 250_000 },
    });
    const blob = await canvasParaBlobNoFormato(canvas, "image/webp", 0.85);
    expect(blob?.type).toBe("image/jpeg");
    expect(blob?.size).toBe(250_000);
    expect(pedidos).toEqual([
      { tipo: "image/webp", qualidade: 0.85 },
      { tipo: "image/jpeg", qualidade: 0.85 },
    ]);
  });

  it("PNG que já é menor que o JPEG (arte chapada) fica como está: nunca entrega arquivo maior", async () => {
    const { canvas } = canvasFalso({
      "image/webp": { tipo: "image/png", bytes: 20_000 },
      "image/jpeg": { tipo: "image/jpeg", bytes: 60_000 },
    });
    const blob = await canvasParaBlobNoFormato(canvas, "image/webp", 0.85);
    expect(blob?.type).toBe("image/png");
    expect(blob?.size).toBe(20_000);
  });

  it("o JPEG também falha (devolve nada ou tipo estranho): mantém o PNG em vez de perder a foto", async () => {
    const semJpeg = canvasFalso({
      "image/webp": { tipo: "image/png", bytes: 500 },
      "image/jpeg": null,
    });
    expect(
      (await canvasParaBlobNoFormato(semJpeg.canvas, "image/webp", 0.85))?.type,
    ).toBe("image/png");

    const jpegDeOutroTipo = canvasFalso({
      "image/webp": { tipo: "image/png", bytes: 500 },
      "image/jpeg": { tipo: "image/png", bytes: 100 },
    });
    expect(
      (
        await canvasParaBlobNoFormato(
          jpegDeOutroTipo.canvas,
          "image/webp",
          0.85,
        )
      )?.type,
    ).toBe("image/png");
  });

  it("o primeiro pedido já falha (blob nulo): devolve nulo sem tentar JPEG", async () => {
    const { canvas, pedidos } = canvasFalso({ "image/webp": null });
    expect(
      await canvasParaBlobNoFormato(canvas, "image/webp", 0.85),
    ).toBeNull();
    expect(pedidos).toHaveLength(1);
  });

  it("quando o formato pedido já é JPEG (ou PNG) e vem igual, não repete o pedido", async () => {
    const { canvas, pedidos } = canvasFalso({
      "image/jpeg": { tipo: "image/jpeg", bytes: 10 },
    });
    await canvasParaBlobNoFormato(canvas, "image/jpeg", 0.9);
    expect(pedidos).toHaveLength(1);
  });
});
