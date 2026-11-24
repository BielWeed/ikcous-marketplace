// A recusa de HEIC (foto de iPhone) e a aceitação de AVIF têm DUAS portas cada:
// o tipo que o navegador informa e a extensão do nome. O teste antigo só usa o
// par "a.heic" + "image/heic", em que as duas portas dizem a mesma coisa; se
// uma delas sumisse, ele continuaria passando.
import { ehImagem, recusaDeFoto } from "@/lib/recusa-de-foto";
import { describe, expect, it } from "vitest";

const arq = (nome: string, tipo: string) =>
  new File(["x"], nome, { type: tipo });

const FRASE_HEIC = /Salve como JPG ou PNG/;

describe("recusaDeFoto — HEIC/HEIF", () => {
  it("só pela EXTENSÃO (o navegador não informa o tipo): recusa com a frase do HEIC, não a de 'não é foto'", () => {
    expect(recusaDeFoto(arq("IMG_0001.HEIC", ""))).toMatch(FRASE_HEIC);
    expect(recusaDeFoto(arq("IMG_0001.heif", ""))).toMatch(FRASE_HEIC);
    expect(
      recusaDeFoto(arq("IMG_0001.heic", "application/octet-stream")),
    ).toMatch(FRASE_HEIC);
  });

  it("só pelo TIPO (nome sem extensão ou com outra): recusa, em vez de deixar passar como imagem", () => {
    expect(recusaDeFoto(arq("foto", "image/heic"))).toMatch(FRASE_HEIC);
    expect(recusaDeFoto(arq("foto.jpg", "image/heif"))).toMatch(FRASE_HEIC);
    expect(recusaDeFoto(arq("foto", "image/HEIC"))).toMatch(FRASE_HEIC);
  });

  it("a frase cita o nome do arquivo", () => {
    expect(recusaDeFoto(arq("IMG_0001.heic", "image/heic"))).toContain(
      '"IMG_0001.heic"',
    );
  });
});

describe("recusaDeFoto — AVIF", () => {
  it("aceita AVIF pelo tipo e, sem tipo, pela extensão", () => {
    expect(recusaDeFoto(arq("a.avif", "image/avif"))).toBeNull();
    expect(recusaDeFoto(arq("a.avif", ""))).toBeNull();
    expect(recusaDeFoto(arq("a.AVIF", "application/octet-stream"))).toBeNull();
    expect(ehImagem(arq("a.avif", ""))).toBe(true);
  });

  it("extensão que parece foto mas termina em outra coisa não passa", () => {
    expect(recusaDeFoto(arq("a.avif.exe", ""))).toMatch(/não é uma foto/);
    expect(recusaDeFoto(arq("avif", ""))).toMatch(/não é uma foto/);
  });
});
