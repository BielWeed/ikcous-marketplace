import { textoSemControlesDeDirecao } from "@/lib/texto-sem-controles-de-direcao";
import { describe, expect, it } from "vitest";

describe("textoSemControlesDeDirecao", () => {
  it("remove os controles de direção e os três caracteres invisíveis indesejados", () => {
    const controles =
      "\u{61C}\u{200B}\u{200E}\u{200F}\u{202A}\u{202B}\u{202C}\u{202D}\u{202E}\u{2060}\u{2066}\u{2067}\u{2068}\u{2069}\u{FEFF}";

    expect(textoSemControlesDeDirecao(`Apto ${controles}120\u{202E}`)).toBe(
      "Apto 120",
    );
  });

  it("preserva espaços, acentos, escrita da direita para a esquerda e juntadores", () => {
    const texto = "  Praça 👩\u{200D}🔧 می\u{200C}روم  ";
    expect(textoSemControlesDeDirecao(texto)).toBe(texto);
  });
});
