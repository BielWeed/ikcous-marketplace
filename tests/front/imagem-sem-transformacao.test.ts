// @vitest-environment jsdom
import {
  conjuntoDeImagens,
  imagemRedimensionada,
  usarImagemOriginal,
} from "@/lib/imageUrl";
import { describe, expect, it } from "vitest";

const fotoIkcous =
  "https://cafkrminfnokvgjqtkle.supabase.co/storage/v1/object/public/produtos/foto.jpg";
const fotoOutraLoja =
  "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/produtos/foto.jpg";

describe("imagem quando o projeto não oferece transformações", () => {
  it("serve o arquivo original da IKCOUS sem pedir uma transformação que responde 403", () => {
    expect(imagemRedimensionada(fotoIkcous, { width: 960 })).toBe(fotoIkcous);
    expect(conjuntoDeImagens(fotoIkcous, [480, 960])).toBe("");
  });

  it("preserva o redimensionamento nos outros projetos", () => {
    expect(imagemRedimensionada(fotoOutraLoja, { width: 960 })).toContain(
      "/storage/v1/render/image/public/produtos/foto.jpg?width=960",
    );
    expect(conjuntoDeImagens(fotoOutraLoja, [480, 960])).toContain("480w");
  });

  it("se outra transformação falhar, retira srcset e tenta o original uma vez", () => {
    const img = document.createElement("img");
    img.src = imagemRedimensionada(fotoOutraLoja, { width: 960 });
    img.srcset = conjuntoDeImagens(fotoOutraLoja, [480, 960]);

    expect(usarImagemOriginal(img, fotoOutraLoja)).toBe(true);
    expect(img.src).toBe(fotoOutraLoja);
    expect(img.srcset).toBe("");
    expect(usarImagemOriginal(img, fotoOutraLoja)).toBe(false);
  });
});
