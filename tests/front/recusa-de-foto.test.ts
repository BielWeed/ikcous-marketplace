import { recusaDeFoto } from "@/lib/recusa-de-foto";
import { describe, expect, it } from "vitest";

const MB = 1024 * 1024;

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
  // GIF pode ser animado e o canvas não o reduz sem matar a animação: não se
  // converte em silêncio, então o peso é barrado AQUI, com a frase da casa.
  it("GIF acima de 3 MB é recusado com o nome do arquivo e o limite", () => {
    const aviso = recusaDeFoto(arq("festa.gif", "image/gif", 3 * MB + 1));
    expect(aviso).toContain('"festa.gif"');
    expect(aviso).toContain("3 MB");
    expect(aviso).toMatch(/Envie uma imagem menor/);
  });
  it("GIF até 3 MB passa (fronteira no limite)", () => {
    expect(recusaDeFoto(arq("festa.gif", "image/gif", 3 * MB))).toBeNull();
    expect(recusaDeFoto(arq("festa.gif", "image/gif", 1 * MB))).toBeNull();
  });
  it("GIF sem tipo (ou genérico), reconhecido pela extensão, também tem o teto", () => {
    expect(recusaDeFoto(arq("FESTA.GIF", "", 4 * MB))).toMatch(/3 MB/);
    expect(
      recusaDeFoto(arq("festa.gif", "application/octet-stream", 4 * MB)),
    ).toMatch(/3 MB/);
  });
  it("o teto de 3 MB é só do GIF: WebP e JPEG pesados (até 12 MB) seguem passando", () => {
    expect(recusaDeFoto(arq("a.webp", "image/webp", 10 * MB))).toBeNull();
    expect(recusaDeFoto(arq("a.jpg", "image/jpeg", 10 * MB))).toBeNull();
  });
  it("recusa HEIC e arquivo acima de 12 MB", () => {
    expect(recusaDeFoto(arq("a.heic", "image/heic"))).toMatch(/JPG ou PNG/);
    expect(recusaDeFoto(arq("a.jpg", "image/jpeg", 13 * 1024 * 1024))).toMatch(
      /12 MB/,
    );
  });
});
