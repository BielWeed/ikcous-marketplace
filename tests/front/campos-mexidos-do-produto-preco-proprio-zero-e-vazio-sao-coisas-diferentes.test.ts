// `src/utils/campos-mexidos-do-produto.ts`: o preço próprio da variação é
// dinheiro, e R$ 0 NÃO é "sem preço próprio". Para os campos de texto o vazio
// vira nulo (`vazioViraNulo`), mas no preço só `null` e `undefined` são "sem
// preço próprio" — o zero é um preço de verdade. Se o zero passasse por "vazio":
//
//  - `variacaoMudou` diria que a lojista NÃO mexeu ao trocar "sem preço próprio"
//    por R$ 0 (ou o contrário), e a variação ficaria de fora do salvar;
//  - `variacoesAposConflito` trataria o R$ 0 digitado como "campo que ela não
//    tocou" e o trocaria pelo preço que o outro aparelho gravou.
import {
  type VariacaoComparavel,
  variacaoMudou,
  variacoesAposConflito,
  variacoesQueMudaram,
} from "@/utils/campos-mexidos-do-produto";
import { describe, expect, it } from "vitest";

const base: VariacaoComparavel = {
  id: "v1",
  name: "Cor",
  value: "Branca",
  sku: "BR-1",
  codigoBarras: null,
  stockIncrement: 4,
  priceOverride: null,
  active: true,
  imageUrl: null,
};

describe("variacaoMudou — preço próprio zero", () => {
  it("de 'sem preço próprio' (null) para R$ 0 é mexida", () => {
    expect(variacaoMudou({ ...base, priceOverride: 0 }, base)).toBe(true);
  });

  it("de R$ 0 para 'sem preço próprio' (ausente) também é mexida", () => {
    const { priceOverride: _p, ...semPreco } = base;
    expect(variacaoMudou(semPreco, { ...base, priceOverride: 0 })).toBe(true);
  });

  it("controle: ausente e null são a mesma coisa, e R$ 0 igual a R$ 0 não mudou", () => {
    const { priceOverride: _p, ...semPreco } = base;
    expect(variacaoMudou(semPreco, base)).toBe(false);
    expect(
      variacaoMudou(
        { ...base, priceOverride: 0 },
        { ...base, priceOverride: 0 },
      ),
    ).toBe(false);
  });

  it("a variação que ganhou R$ 0 vai no salvar", () => {
    const atuais = [{ ...base, priceOverride: 0 }];
    expect(variacoesQueMudaram(atuais, [base])).toEqual(atuais);
  });
});

describe("variacoesAposConflito — preço próprio zero digitado", () => {
  const banco = { ...base, priceOverride: 15 };

  it("R$ 0 que ela digitou (abertura sem preço próprio) fica, não vira o do banco", () => {
    const [mesclada] = variacoesAposConflito(
      [{ ...base, priceOverride: 0 }],
      [base],
      [banco],
    );
    expect(mesclada.priceOverride).toBe(0);
  });

  it("preço que ela LIMPOU (era R$ 0, agora null) fica limpo, não volta o do banco", () => {
    const [mesclada] = variacoesAposConflito(
      [{ ...base, priceOverride: null }],
      [{ ...base, priceOverride: 0 }],
      [banco],
    );
    expect(mesclada.priceOverride).toBeNull();
  });

  it("controle: campo que ela não tocou acompanha o banco", () => {
    const [mesclada] = variacoesAposConflito([base], [base], [banco]);
    expect(mesclada.priceOverride).toBe(15);
  });
});
