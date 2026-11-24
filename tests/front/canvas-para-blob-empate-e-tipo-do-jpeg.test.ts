// Caça de provas fracas (mutação) em `canvasParaBlobNoFormato`, 24/11/2026. O
// teste do arquivo irmão cobre o Safari caindo para PNG, mas dois detalhes da
// escolha entre o PNG e o JPEG sobreviviam:
//
//  - EMPATE de peso: o PNG que o navegador já entregou fica (refazer não
//    ganhou nada, e o tipo pedido continua honesto);
//  - o JPEG só vale se VOLTOU como JPEG: um segundo pedido que devolve outro
//    tipo (aqui, AVIF) e é menor não pode substituir o primeiro blob, senão o
//    arquivo seguiria com nome e Content-Type de um formato que não pedimos.
import { canvasParaBlobNoFormato } from "@/lib/canvas-para-blob";
import { describe, expect, it } from "vitest";

function canvasFalso(
  respostas: Record<string, { tipo: string; bytes: number }>,
) {
  return {
    toBlob(cb: (b: Blob | null) => void, tipo?: string) {
      const r = respostas[tipo ?? ""];
      cb(r ? new Blob([new Uint8Array(r.bytes)], { type: r.tipo }) : null);
    },
  } as unknown as HTMLCanvasElement;
}

describe("canvasParaBlobNoFormato — a escolha entre o PNG e o JPEG", () => {
  it("PNG e JPEG do MESMO peso: fica o PNG que já veio", async () => {
    const canvas = canvasFalso({
      "image/webp": { tipo: "image/png", bytes: 5_000 },
      "image/jpeg": { tipo: "image/jpeg", bytes: 5_000 },
    });

    const blob = await canvasParaBlobNoFormato(canvas, "image/webp", 0.85);

    expect(blob?.type).toBe("image/png");
    expect(blob?.size).toBe(5_000);
  });

  it("um byte a menos no JPEG já basta para ele vencer", async () => {
    const canvas = canvasFalso({
      "image/webp": { tipo: "image/png", bytes: 5_000 },
      "image/jpeg": { tipo: "image/jpeg", bytes: 4_999 },
    });

    const blob = await canvasParaBlobNoFormato(canvas, "image/webp", 0.85);

    expect(blob?.type).toBe("image/jpeg");
  });

  it("segundo pedido que volta em OUTRO tipo, mesmo menor, não substitui o primeiro blob", async () => {
    const canvas = canvasFalso({
      "image/webp": { tipo: "image/png", bytes: 5_000 },
      "image/jpeg": { tipo: "image/avif", bytes: 100 },
    });

    const blob = await canvasParaBlobNoFormato(canvas, "image/webp", 0.85);

    expect(blob?.type).toBe("image/png");
    expect(blob?.size).toBe(5_000);
  });
});
