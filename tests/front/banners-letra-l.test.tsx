// Prova estática de tipografia, não de aparência: jsdom não aplica o CSS.
// O redesenho removeu os celulares desenhados e os três passos. Só o desenho
// da prévia (PreviaImagemPropria/BannerPronto) continua em escala reduzida.
// O chrome do painel, inclusive as novas telas B–E, mantém o piso de 11px.
/* eslint-disable security/detect-non-literal-fs-filename --
   caminhos constantes do próprio projeto, nunca entrada do usuário */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const ARQUIVOS_DO_PAINEL = [
  "src/views/admin/AdminBannersView.tsx",
  "src/components/admin/banners/EscolherCriacaoDoBanner.tsx",
  "src/components/admin/banners/GaleriaDeBanners.tsx",
  "src/components/admin/banners/CamposDeTextoDoBanner.tsx",
  "src/components/admin/banners/CriarBannerComIa.tsx",
];
const LETRA_MIUDA = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g;

describe("Banners · letra mínima de 11px no painel", () => {
  it.each(ARQUIVOS_DO_PAINEL)("%s não usa letra abaixo do piso", (arquivo) => {
    const linhas = readFileSync(join(RAIZ, arquivo), "utf8").split("\n");
    const sobras = linhas.flatMap((texto, indice) =>
      [...texto.matchAll(LETRA_MIUDA)].map((m) => `${indice + 1}: ${m[0]}`),
    );
    expect(sobras).toEqual([]);
  });
});
