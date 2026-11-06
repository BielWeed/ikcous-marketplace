// O atalho "Favoritos" do ícone do app descrevia a tela como "lista de
// desejos". A loja inteira chama de "favoritos": uma palavra por coisa.
import { MANIFESTO_BASE } from "@/config/manifestoBase";
import { describe, expect, it } from "vitest";

describe("manifesto — atalho Favoritos", () => {
  it("descreve a tela como 'favoritos', não 'lista de desejos'", () => {
    const atalho = MANIFESTO_BASE.shortcuts.find((s) => s.url === "/favorites");
    expect(atalho?.name).toBe("Favoritos");
    expect(atalho?.description).toBe("Ver favoritos");
  });
});
