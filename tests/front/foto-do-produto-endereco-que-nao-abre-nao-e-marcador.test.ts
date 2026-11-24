// O marcador "Sem Imagem" (placehold.co) sai da galeria da cliente; qualquer
// outra coisa que a lojista guardou como foto FICA, mesmo que o endereço esteja
// quebrado -- aí quem decide é a imagem que não carrega (nova tentativa, aviso
// "Toque para tentar de novo"). Caça por mutação, 24/11: se o endereço que o
// navegador não consegue ler fosse tratado como marcador, a foto sumiria da
// galeria sem aviso nenhum, e nenhum teste olhava esse lado do `catch`.
import { ehMarcadorDeFoto, soFotosReais } from "@/lib/foto-do-produto";
import { describe, expect, it } from "vitest";

const REAL = "https://abc.supabase.co/storage/v1/object/public/p/foto.jpg";

describe("ehMarcadorDeFoto — endereço ilegível", () => {
  it.each(["https://", "http://[", "https://exemplo..com:abc/x.jpg"])(
    "%s não é marcador",
    (url) => {
      expect(ehMarcadorDeFoto(url)).toBe(false);
    },
  );

  it("caminho sem protocolo cai na base interna e não casa com a hospedagem do marcador", () => {
    expect(ehMarcadorDeFoto("placehold.co/600x400")).toBe(false);
    expect(ehMarcadorDeFoto("/placehold.co/600x400")).toBe(false);
  });
});

describe("soFotosReais — endereço ilegível", () => {
  it("fica na lista, na ordem em que a lojista guardou", () => {
    expect(soFotosReais([REAL, "https://", "http://["])).toEqual([
      REAL,
      "https://",
      "http://[",
    ]);
  });
});
