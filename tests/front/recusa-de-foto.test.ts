import { recusaDeFoto } from "@/lib/recusa-de-foto";
import { describe, expect, it } from "vitest";

const arq = (nome: string, tipo: string, tamanho?: number) => {
  const f = new File(["x"], nome, { type: tipo });
  if (tamanho !== undefined)
    Object.defineProperty(f, "size", { value: tamanho });
  return f;
};

describe("recusaDeFoto", () => {
  it("aceita foto comum e foto sem tipo com extensão de imagem", () => {
    expect(recusaDeFoto(arq("a.jpg", "image/jpeg"))).toBeNull();
    expect(recusaDeFoto(arq("a.webp", ""))).toBeNull();
  });
  it("decide pela extensão quando o tipo vem vazio ou genérico", () => {
    expect(recusaDeFoto(arq("A.JPG", ""))).toBeNull();
    expect(recusaDeFoto(arq("a.jpg", "image/jpg"))).toBeNull();
    expect(
      recusaDeFoto(arq("foto.jpg", "application/octet-stream")),
    ).toBeNull();
    expect(recusaDeFoto(arq("a.pdf", "application/octet-stream"))).toMatch(
      /não é uma foto/,
    );
  });
  it.each([
    ["a.pdf", "application/pdf"],
    ["a.xlsx", "application/vnd.ms-excel"],
    ["a.mp4", "video/mp4"],
    ["a.txt", ""],
  ])("recusa %s com a frase de não-foto", (nome, tipo) => {
    expect(recusaDeFoto(arq(nome, tipo))).toBe(
      "Esse arquivo não é uma foto. Envie JPG, PNG ou WebP.",
    );
  });
  it("recusa HEIC e arquivo acima de 12 MB", () => {
    expect(recusaDeFoto(arq("a.heic", "image/heic"))).toMatch(/JPG ou PNG/);
    expect(recusaDeFoto(arq("a.jpg", "image/jpeg", 13 * 1024 * 1024))).toMatch(
      /12 MB/,
    );
  });
});
