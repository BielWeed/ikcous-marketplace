import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync("src/views/customer/CheckoutView.tsx", "utf8");

describe("CheckoutView — altura só no computador", () => {
  it("retira o mínimo de viewport de todas as telas só no desktop", () => {
    const paineis = Array.from(fonte.matchAll(/className="([^"]*)"/g))
      .map((ocorrencia) => ocorrencia[1].split(/\s+/))
      .filter((classes) => classes.includes("min-h-dvh"));

    expect(paineis).toHaveLength(7);
    const semAjuste = paineis.filter(
      (classes) => !classes.includes("lg:min-h-0"),
    );
    expect(
      semAjuste,
      `${semAjuste.length} telas sem lg:min-h-0; min-h-dvh deve continuar no celular`,
    ).toEqual([]);
  });
});
