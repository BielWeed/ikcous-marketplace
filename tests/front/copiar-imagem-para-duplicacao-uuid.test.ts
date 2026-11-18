import { caminhoDaCopia } from "@/lib/copiar-imagem-para-duplicacao";
import { expect, it, vi } from "vitest";

it("gera caminho próprio para a cópia mesmo sem crypto.randomUUID", () => {
  const cryptoNativo = globalThis.crypto;
  let caminhos: string[];
  try {
    vi.stubGlobal("crypto", {
      getRandomValues: cryptoNativo.getRandomValues.bind(cryptoNativo),
    });
    caminhos = [
      caminhoDaCopia("pasta/minha.foto.JPG"),
      caminhoDaCopia("pasta/minha.foto.JPG"),
    ];
  } finally {
    vi.unstubAllGlobals();
  }
  for (const caminho of caminhos) {
    expect(caminho).toMatch(
      /^pasta\/minha\.foto_copia_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.JPG$/,
    );
  }
  expect(new Set(caminhos).size).toBe(2);
});
