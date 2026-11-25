// Caça por mutação (25/11/2026): trocar o nome padrão "Padrão" por "Padrao" (sem
// o til) em `variacaoDaLinha` passava em todos os testes da prévia. O nome conta
// de verdade: `precoDeVitrine` agrupa as opções por nome e só o grupo de nome
// MENOR (ordem de texto) dita o preço, então o nome padrão decide quem agrupa
// com quem. Mesma tradução de `mapVariantFromDB` no app: nome ausente ou vazio
// = "Padrão".
import { describe, expect, it } from "vitest";
import { precoDaPrevia } from "../../src/hospedagem/precoDaPrevia";

const linha = (extra: Record<string, unknown> = {}) => ({
  active: true,
  stock_increment: 5,
  price_override: null,
  ...extra,
});

describe("precoDaPrevia — o nome padrão da opção é 'Padrão', com til", () => {
  it("opção sem nome NÃO se mistura com uma opção chamada 'Padrao' (sem til): grupos diferentes", () => {
    // 'Padrao' < 'Padrão' na ordem de texto, então o grupo 'Padrao' é o
    // principal e dita o preço (90). Se o nome padrão perdesse o til, as duas
    // opções cairiam no mesmo grupo e o menor preço (40) apareceria.
    expect(
      precoDaPrevia(100, [
        linha({ name: "Padrao", price_override: 90 }),
        linha({ price_override: 40 }),
      ]),
    ).toBe(90);
  });

  it("opção sem nome e opção chamada 'Padrão' (com til) são o MESMO grupo: vale o menor preço", () => {
    expect(
      precoDaPrevia(100, [
        linha({ name: "Padrão", price_override: 90 }),
        linha({ price_override: 40 }),
      ]),
    ).toBe(40);
  });

  it("nome vazio também vira 'Padrão' (mesmo grupo da opção chamada 'Padrão')", () => {
    expect(
      precoDaPrevia(100, [
        linha({ name: "Padrão", price_override: 90 }),
        linha({ name: "", price_override: 40 }),
      ]),
    ).toBe(40);
  });
});
