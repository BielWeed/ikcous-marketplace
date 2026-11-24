// Caça de provas fracas (mutação) em `recusa-de-foto`, 24/11/2026. O teste
// existente cobre os limites de peso muito bem, mas HEIC e as extensões só
// eram provados por UM caminho cada, e sobreviviam: HEIF pelo TIPO (nome
// .jpg), HEIC em maiúsculas, `.heif` sem tipo, `.avif` e `.jpeg` sem tipo, e
// tipo que só CONTÉM "image" no meio. Cada uma deixaria passar (ou recusar
// com a frase errada) a foto do iPhone — a recusa que mais aparece no balcão.
import { recusaDeFoto } from "@/lib/recusa-de-foto";
import { describe, expect, it } from "vitest";

const arq = (nome: string, tipo: string) =>
  new File(["x"], nome, { type: tipo });

const FRASE_HEIC = /Salve como JPG ou PNG/;
const FRASE_NAO_FOTO = "Esse arquivo não é uma foto. Envie JPG, PNG ou WebP.";

describe("HEIC/HEIF — reconhecido pelo tipo OU pelo nome (o nome, em qualquer caixa)", () => {
  it.each([
    ["foto.jpg", "image/heif"],
    ["foto.jpg", "image/heic"],
  ])(
    "tipo %s/%s é recusado pela frase do HEIC, mesmo com nome de JPG",
    (nome, tipo) => {
      expect(recusaDeFoto(arq(nome, tipo))).toMatch(FRASE_HEIC);
    },
  );

  it.each([
    ["IMG_1.HEIC", ""],
    ["IMG_1.heif", ""],
    ["IMG_1.HEIF", "image/jpeg"],
    ["IMG_1.heic", "image/jpeg"],
    ["IMG_1.heic", "application/octet-stream"],
  ])("nome %s com tipo '%s' é recusado pela frase do HEIC", (nome, tipo) => {
    expect(recusaDeFoto(arq(nome, tipo))).toMatch(FRASE_HEIC);
  });

  it("a frase do HEIC cita o nome do arquivo", () => {
    expect(recusaDeFoto(arq("Férias 1.HEIC", ""))).toContain('"Férias 1.HEIC"');
  });
});

describe("sem tipo (ou tipo genérico): vale a extensão", () => {
  it.each([
    "a.jpg",
    "a.jpeg",
    "a.JPEG",
    "a.png",
    "a.webp",
    "a.gif",
    "a.avif",
    "A.AVIF",
  ])("%s é aceito", (nome) => {
    expect(recusaDeFoto(arq(nome, ""))).toBeNull();
    expect(recusaDeFoto(arq(nome, "application/octet-stream"))).toBeNull();
  });

  it.each(["a.tiff", "a.bmp", "a.svg", "a", "a.jpg.exe"])(
    "%s não é foto",
    (nome) => {
      expect(recusaDeFoto(arq(nome, ""))).toBe(FRASE_NAO_FOTO);
    },
  );
});

describe("com tipo: o tipo tem de COMEÇAR por image/", () => {
  it.each(["application/x-image", "text/image", "model/vnd.image"])(
    "tipo '%s' (só contém 'image') não é foto, mesmo com nome de JPG",
    (tipo) => {
      expect(recusaDeFoto(arq("a.jpg", tipo))).toBe(FRASE_NAO_FOTO);
    },
  );
});
