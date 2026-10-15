// O botão "Aplicar para todas" (grade de variações) só aplica um preço MAIOR QUE
// ZERO. "0.00" é texto não vazio: com `limparNumero(x) || linha.preco` ele
// passava e zerava as linhas. Esta é a guarda de profundidade — o campo já
// entrega vazio no zero digitado, mas o botão não confia nisso.
import { describe, expect, it } from "vitest";

import { precoPositivoOuVazio } from "@/utils/preco-da-grade";

describe("precoPositivoOuVazio", () => {
  it("preço maior que zero sai limpo, do jeito que a grade o guarda", () => {
    expect(precoPositivoOuVazio("49,90")).toBe("49.90");
    expect(precoPositivoOuVazio("60.00")).toBe("60.00");
    expect(precoPositivoOuVazio("0.05")).toBe("0.05");
  });

  it("zero, vazio e texto sem número viram vazio (nunca '0.00' nem NaN)", () => {
    expect(precoPositivoOuVazio("0.00")).toBe("");
    expect(precoPositivoOuVazio("0")).toBe("");
    expect(precoPositivoOuVazio("0,00")).toBe("");
    expect(precoPositivoOuVazio("")).toBe("");
    expect(precoPositivoOuVazio("abc")).toBe("");
    expect(precoPositivoOuVazio("-5")).toBe("");
  });
});
