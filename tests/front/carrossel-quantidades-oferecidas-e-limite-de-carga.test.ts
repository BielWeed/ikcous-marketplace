// Caça por mutação (25/11/2026) em `src/config/carrossel.ts`. O teste Deno
// `tests/limite_de_carrossel_cobre_o_seletor_test.ts` só confere que o limite de
// carga é MAIOR OU IGUAL à maior opção do painel; nada segurava os números em
// si. Um limite de 11 (um produto a mais carregado à toa), ou uma opção que some
// do seletor da lojista ("6" ou "10" em "Quantos produtos mostrar"), passava.
import { describe, expect, it } from "vitest";

import {
  LIMITE_MAX_ITENS_CARROSSEL,
  OPCOES_MAX_ITENS_CARROSSEL,
} from "@/config/carrossel";

describe("carrosséis da Home — quantidades e limite de carga", () => {
  it("o painel oferece exatamente 4, 6, 8 e 10 produtos por vitrine, nessa ordem", () => {
    expect([...OPCOES_MAX_ITENS_CARROSSEL]).toEqual([4, 6, 8, 10]);
  });

  it("a vitrine carrega no máximo 10 produtos por lista, igual à maior opção do painel", () => {
    expect(LIMITE_MAX_ITENS_CARROSSEL).toBe(10);
    expect(LIMITE_MAX_ITENS_CARROSSEL).toBe(
      Math.max(...OPCOES_MAX_ITENS_CARROSSEL),
    );
  });
});
