import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync("src/views/admin/AdminBannersView.tsx", "utf8");
const ajuda = fonte
  .split("{/* Modal de Ajuda */}")[1]
  ?.split("</AdminHelpModal>")[0];

describe("ajuda dos banners por aparelho", () => {
  it("explica que a visibilidade depende da imagem e das datas", () => {
    const texto = ajuda?.replace(/\s+/g, " ");
    expect(texto).toContain(
      "Use o botão para ativar ou pausar o banner. Quando ativo, ele só aparece nas telas para as quais tem imagem e respeita as datas programadas, se houver.",
    );
    expect(texto).not.toMatch(/qualquer campanha instantaneamente/);
  });

  it.each([
    "Celular · recomendado 1200 × 600 px (2:1).",
    "Computador · recomendado 1920 × 480 px (4:1).",
  ])("repete a recomendação do formulário: %s", (recomendacao) => {
    expect(fonte.split("{/* Modal de Ajuda */}")[0]).toContain(
      JSON.stringify(recomendacao),
    );
    expect(ajuda?.replace(/\s+/g, " ")).toContain(recomendacao);
  });
});
