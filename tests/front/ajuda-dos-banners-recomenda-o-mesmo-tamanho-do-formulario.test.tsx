import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync("src/views/admin/AdminBannersView.tsx", "utf8");
const ajuda = fonte
  .split("{/* Modal de Ajuda */}")[1]
  ?.split("</AdminHelpModal>")[0];

describe("ajuda dos banners por aparelho", () => {
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
