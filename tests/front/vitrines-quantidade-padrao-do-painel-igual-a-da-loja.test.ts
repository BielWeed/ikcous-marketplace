// Caça por mutação (25/11/2026), tela de Vitrines do painel.
// Vitrine que a lojista nunca mexeu no limite mostra "6 produtos" no painel
// (QUANTIDADE_PADRAO) e a loja corta em `section.maxItems ?? 6` na Home. Os dois
// números moram em arquivos diferentes: se um mudar sem o outro, o painel diz
// "mostra 6" e a cliente vê 5 (ou 8). Mudar o 6 do painel não fazia nenhum
// teste reclamar.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { QUANTIDADE_PADRAO } from "@/components/admin/vitrines/tipos";

const home = readFileSync("src/views/customer/HomeView.tsx", "utf8");

describe("vitrines: quantidade padrão de produtos", () => {
  it("o painel anuncia 6 produtos quando a lojista nunca mexeu no limite", () => {
    expect(QUANTIDADE_PADRAO).toBe(6);
  });

  it("a Home da loja corta no MESMO padrão que o painel anuncia", () => {
    const padroes = [...home.matchAll(/section\.maxItems \?\? (\d+)/g)].map(
      (m) => Number(m[1]),
    );
    expect(padroes).toEqual([QUANTIDADE_PADRAO]);
  });
});
