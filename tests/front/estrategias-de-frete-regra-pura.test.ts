import {
  type ConfigDeFrete,
  type FormularioEstrategiaNacional,
  economiaDaOpcao,
  erroDoFormularioNacional,
  espelhoLegado,
  estrategiaTemAlcanceEditavel,
  fraseDoSeloDeFreteGratis,
  metaDeFreteGratisPorValor,
  precoComDescontoNacional,
  precoFinalDaOpcao,
  produtoTemFreteGratisPrometido,
  promessasDeFrete,
  resumoDaEstrategiaNacional,
} from "@/lib/estrategias-de-frete";
import {
  FRETE_GRATIS_POR_PRODUTO,
  FRETE_GRATIS_SEMPRE,
} from "@/lib/presets-de-frete-gratis";
import { describe, expect, it } from "vitest";

function configBase(sobre: Partial<ConfigDeFrete> = {}): ConfigDeFrete {
  return {
    freeShippingMin: 0,
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
    ...sobre,
  };
}

describe("espelhoLegado — mesma tabela da migration 20261171000000", () => {
  it("0 -> desligado", () => {
    expect(espelhoLegado(0)).toEqual({
      estrategia: "desligado",
      minimo: 0,
      alcance: "todas",
    });
  });

  it("sentinela 0,01 -> sempre", () => {
    expect(espelhoLegado(FRETE_GRATIS_SEMPRE)).toEqual({
      estrategia: "sempre",
      minimo: 0,
      alcance: "todas",
    });
  });

  it("sentinela negativa -> por_produto", () => {
    expect(espelhoLegado(FRETE_GRATIS_POR_PRODUTO)).toEqual({
      estrategia: "por_produto",
      minimo: 0,
      alcance: "todas",
    });
  });

  it("valor positivo qualquer -> acima_de_valor, com o mesmo mínimo", () => {
    expect(espelhoLegado(199)).toEqual({
      estrategia: "acima_de_valor",
      minimo: 199,
      alcance: "todas",
    });
  });
});

describe("precoFinalDaOpcao — local calcula, nacional CARIMBADA nunca recalcula (contrato §3); SEM carimbo cai na regra legada", () => {
  // CORREÇÃO (revisão Opus, pós-T3): a versão anterior deste teste gravava o
  // valor ERRADO. Opção nacional SEM `estrategiaNacional` (edge antiga, loja
  // sem migration, leitura nacional que falhou, rollback) não fica intocada
  // — a RPC (migration 20261171000000 ~linha 1195) aplica a REGRA LEGADA
  // (mesma sentinela do preset local) nesse caso, e o front tem que espelhar
  // isso para não divergir do que o pedido de verdade cobra.
  it("nacional COM carimbo: devolve o price da opção INTOCADO, mesmo com config local grátis", () => {
    const preco = precoFinalDaOpcao(
      {
        id: "melhorenvio-pac",
        price: 32.5,
        precoCheio: 45,
        estrategiaNacional: {
          estrategia: "desconto_na_mais_barata",
          minimo: 0,
          tipoDesconto: "fixo",
          valorDesconto: 12.5,
          alcance: "mais_barata",
        },
      },
      {
        config: { freeShippingMin: FRETE_GRATIS_SEMPRE },
        subtotal: 10,
        temItemMarcado: false,
      },
    );
    expect(preco).toBe(32.5);
  });

  it("nacional SEM carimbo, regra legada BATE (preset 'sempre'): zera — mesma sentinela que a RPC aplicaria", () => {
    const preco = precoFinalDaOpcao(
      { id: "melhorenvio-pac", price: 32.5, precoCheio: 45 },
      {
        config: { freeShippingMin: FRETE_GRATIS_SEMPRE },
        subtotal: 10,
        temItemMarcado: false,
      },
    );
    expect(preco).toBe(0);
  });

  it("nacional SEM carimbo, regra legada NÃO bate (preset 'acima_de_valor', subtotal abaixo): mantém o price da opção", () => {
    const preco = precoFinalDaOpcao(
      { id: "melhorenvio-pac", price: 32.5 },
      {
        config: { freeShippingMin: 100 },
        subtotal: 50,
        temItemMarcado: false,
      },
    );
    expect(preco).toBe(32.5);
  });

  it("nacional SEM carimbo, preset 'desligado': mantém o price (regra legada não zera nada)", () => {
    const preco = precoFinalDaOpcao(
      { id: "melhorenvio-pac", price: 32.5 },
      { config: { freeShippingMin: 0 }, subtotal: 999, temItemMarcado: false },
    );
    expect(preco).toBe(32.5);
  });

  it("local-delivery com preset 'sempre': zera mesmo com preço cheio vindo da edge", () => {
    const preco = precoFinalDaOpcao(
      { id: "local-delivery", price: 10, precoCheio: undefined },
      {
        config: { freeShippingMin: FRETE_GRATIS_SEMPRE },
        subtotal: 0,
        temItemMarcado: false,
      },
    );
    expect(preco).toBe(0);
  });

  it("local-delivery com preset 'acima_de_valor': só zera quando o subtotal bate", () => {
    const ctx = {
      config: { freeShippingMin: 100 },
      subtotal: 99.99,
      temItemMarcado: false,
    };
    expect(precoFinalDaOpcao({ id: "local-delivery", price: 10 }, ctx)).toBe(
      10,
    );
    expect(
      precoFinalDaOpcao(
        { id: "local-delivery", price: 10 },
        { ...ctx, subtotal: 100 },
      ),
    ).toBe(0);
  });

  it("local-delivery com preset 'por_produto': só zera com item marcado", () => {
    const ctx = {
      config: { freeShippingMin: FRETE_GRATIS_POR_PRODUTO },
      subtotal: 50,
      temItemMarcado: false,
    };
    expect(precoFinalDaOpcao({ id: "local-delivery", price: 10 }, ctx)).toBe(
      10,
    );
    expect(
      precoFinalDaOpcao(
        { id: "local-delivery", price: 10 },
        { ...ctx, temItemMarcado: true },
      ),
    ).toBe(0);
  });

  it("store-pickup 'desligado': preço passa intocado (já chega 0 da edge)", () => {
    const preco = precoFinalDaOpcao(
      { id: "store-pickup", price: 0 },
      { config: { freeShippingMin: 0 }, subtotal: 0, temItemMarcado: false },
    );
    expect(preco).toBe(0);
  });

  // BORDA: carrinho vazio (subtotal 0) com preset acima_de_valor e mínimo 0
  // -- limite exigido pelo skill de execução densa, não coberto pelas
  // funções vizinhas (elas nunca chamam com subtotal 0 e min 0 juntos).
  it("borda: acima_de_valor com mínimo 0 sempre libera (subtotal >= 0 é sempre verdade)", () => {
    const preco = precoFinalDaOpcao(
      { id: "local-delivery", price: 10 },
      { config: { freeShippingMin: 0 }, subtotal: 0, temItemMarcado: false },
    );
    // freeShippingMin=0 é a sentinela de "desligado" (presetDoConfig), não
    // "acima de zero" -- por isso o preço cheio permanece.
    expect(preco).toBe(10);
  });
});

describe("economiaDaOpcao", () => {
  // CORREÇÃO (revisão Opus, pós-T3): precisa do carimbo -- sem ele, a opção
  // cai no ramo da REGRA LEGADA (que só olha o preset local, não
  // `precoCheio`), e a economia sairia 0 mesmo com desconto real.
  it("nacional CARIMBADA beneficiada: precoCheio - price", () => {
    const eco = economiaDaOpcao(
      {
        id: "frenet-sedex",
        price: 20,
        precoCheio: 35,
        estrategiaNacional: {
          estrategia: "desconto_na_mais_barata",
          minimo: 0,
          tipoDesconto: "fixo",
          valorDesconto: 15,
          alcance: "mais_barata",
        },
      },
      { config: { freeShippingMin: 0 }, subtotal: 0, temItemMarcado: false },
    );
    expect(eco).toBe(15);
  });

  it("nacional sem carimbo E sem precoCheio (edge antiga): zero, nunca inventa economia", () => {
    const eco = economiaDaOpcao(
      { id: "frenet-sedex", price: 20 },
      { config: { freeShippingMin: 0 }, subtotal: 0, temItemMarcado: false },
    );
    expect(eco).toBe(0);
  });

  // Carimbo presente (senão o teste exerceria o ramo da regra legada em vez
  // do "cheio == price" que o título afirma).
  it("nacional CARIMBADA com precoCheio IGUAL ao price (não beneficiada): zero", () => {
    const eco = economiaDaOpcao(
      {
        id: "frenet-sedex",
        price: 20,
        precoCheio: 20,
        estrategiaNacional: {
          estrategia: "desconto_na_mais_barata",
          minimo: 0,
          tipoDesconto: "fixo",
          valorDesconto: 0,
          alcance: "mais_barata",
        },
      },
      { config: { freeShippingMin: 0 }, subtotal: 0, temItemMarcado: false },
    );
    expect(eco).toBe(0);
  });

  // NOVO (revisão Opus, pós-T3): sem carimbo, a REGRA LEGADA decide (nunca
  // o `precoCheio`, mesmo que ele exista) -- bate (preset "sempre") zera.
  it("nacional SEM carimbo, regra legada BATE: economia é o price da opção (o que deixou de ser cobrado)", () => {
    const eco = economiaDaOpcao(
      { id: "frenet-sedex", price: 20, precoCheio: 35 },
      {
        config: { freeShippingMin: FRETE_GRATIS_SEMPRE },
        subtotal: 0,
        temItemMarcado: false,
      },
    );
    expect(eco).toBe(20);
  });

  it("local grátis: economia é o preço cheio que deixou de ser cobrado", () => {
    const eco = economiaDaOpcao(
      { id: "local-delivery", price: 12.9 },
      {
        config: { freeShippingMin: FRETE_GRATIS_SEMPRE },
        subtotal: 0,
        temItemMarcado: false,
      },
    );
    expect(eco).toBe(12.9);
  });

  it("local pago (regra não bateu): zero", () => {
    const eco = economiaDaOpcao(
      { id: "local-delivery", price: 12.9 },
      { config: { freeShippingMin: 0 }, subtotal: 0, temItemMarcado: false },
    );
    expect(eco).toBe(0);
  });
});

describe("promessasDeFrete — comparação local × nacional", () => {
  it("as duas desligadas: iguais", () => {
    const p = promessasDeFrete(configBase());
    expect(p.iguais).toBe(true);
    expect(p.local.estrategia).toBe("desligado");
    expect(p.nacional.estrategia).toBe("desligado");
  });

  it("espelho recém-migrado (mesma estratégia e mínimo): iguais", () => {
    const p = promessasDeFrete(
      configBase({
        freeShippingMin: 199,
        nationalShippingStrategy: "acima_de_valor",
        nationalShippingMin: 199,
      }),
    );
    expect(p.iguais).toBe(true);
  });

  it("mesma estratégia acima_de_valor, mínimos DIFERENTES: não iguais", () => {
    const p = promessasDeFrete(
      configBase({
        freeShippingMin: 199,
        nationalShippingStrategy: "acima_de_valor",
        nationalShippingMin: 299,
      }),
    );
    expect(p.iguais).toBe(false);
  });

  it("local sempre, nacional desligado: não iguais", () => {
    const p = promessasDeFrete(
      configBase({ freeShippingMin: FRETE_GRATIS_SEMPRE }),
    );
    expect(p.iguais).toBe(false);
  });

  // BORDA (skill de execução densa): config SEM as 5 colunas nacionais —
  // objeto cru que não passou pelo espelho do StoreContext (mock de teste
  // hand-rolled, ou config anterior à migration lido direto). Sem o
  // fallback defensivo em `promessasDeFrete`, `undefined !== "sempre"`
  // faria QUALQUER config crua parecer uma loja com regras divergentes —
  // falso positivo de "na cidade" em telas que nem sabem que o campo existe.
  it("borda: config sem as colunas nacionais espelha o local (mesmo fallback do StoreContext) — nunca 'undefined' vira divergência", () => {
    const cru = { freeShippingMin: 0.01 } as ConfigDeFrete; // sentinela "sempre", sem os 4 campos nacionais
    const p = promessasDeFrete(cru);
    expect(p.local.estrategia).toBe("sempre");
    expect(p.nacional.estrategia).toBe("sempre");
    expect(p.iguais).toBe(true);
  });

  it("desconto_na_mais_barata NUNCA é igual ao local (não existe canal equivalente)", () => {
    const p = promessasDeFrete(
      configBase({
        nationalShippingStrategy: "desconto_na_mais_barata",
        nationalDiscountType: "percentual",
        nationalDiscountValue: 10,
      }),
    );
    expect(p.iguais).toBe(false);
  });
});

describe("produtoTemFreteGratisPrometido / fraseDoSeloDeFreteGratis", () => {
  it("local sempre: vale para qualquer produto, mesmo sem marcação, frase 'na cidade'", () => {
    const p = promessasDeFrete(
      configBase({ freeShippingMin: FRETE_GRATIS_SEMPRE }),
    );
    expect(produtoTemFreteGratisPrometido(p, false)).toBe(true);
    expect(fraseDoSeloDeFreteGratis(p, false)).toBe("Frete grátis na cidade");
  });

  it("nacional sempre, local desligado: vale, frase 'para todo o Brasil'", () => {
    const p = promessasDeFrete(
      configBase({ nationalShippingStrategy: "sempre" }),
    );
    expect(produtoTemFreteGratisPrometido(p, false)).toBe(true);
    expect(fraseDoSeloDeFreteGratis(p, false)).toBe(
      "Frete grátis para todo o Brasil",
    );
  });

  it("os dois sempre: frase de hoje, sem dizer onde", () => {
    const p = promessasDeFrete(
      configBase({
        freeShippingMin: FRETE_GRATIS_SEMPRE,
        nationalShippingStrategy: "sempre",
      }),
    );
    expect(fraseDoSeloDeFreteGratis(p, false)).toBe("Frete grátis");
  });

  it("por_produto local: só vale com o item MARCADO", () => {
    const p = promessasDeFrete(
      configBase({ freeShippingMin: FRETE_GRATIS_POR_PRODUTO }),
    );
    expect(produtoTemFreteGratisPrometido(p, false)).toBe(false);
    expect(produtoTemFreteGratisPrometido(p, true)).toBe(true);
  });

  it("desconto nacional NUNCA vira selo (não é grátis)", () => {
    const p = promessasDeFrete(
      configBase({
        nationalShippingStrategy: "desconto_na_mais_barata",
        nationalDiscountType: "fixo",
        nationalDiscountValue: 10,
      }),
    );
    expect(produtoTemFreteGratisPrometido(p, true)).toBe(false);
    expect(fraseDoSeloDeFreteGratis(p, true)).toBeNull();
  });

  it("nada promete: null", () => {
    const p = promessasDeFrete(configBase());
    expect(fraseDoSeloDeFreteGratis(p, true)).toBeNull();
  });
});

describe("metaDeFreteGratisPorValor", () => {
  const config = configBase({
    freeShippingMin: 100,
    nationalShippingStrategy: "acima_de_valor",
    nationalShippingMin: 250,
  });

  it("CEP local: só a meta LOCAL", () => {
    const meta = metaDeFreteGratisPorValor(promessasDeFrete(config), true);
    expect(meta).toEqual({ minimo: 100, alcance: "local" });
  });

  it("CEP fora da cidade: só a meta NACIONAL", () => {
    const meta = metaDeFreteGratisPorValor(promessasDeFrete(config), false);
    expect(meta).toEqual({ minimo: 250, alcance: "nacional" });
  });

  it("CEP desconhecido, metas DIFERENTES: não afirma nenhuma (evita prometer errado)", () => {
    const meta = metaDeFreteGratisPorValor(promessasDeFrete(config), null);
    expect(meta).toEqual({ minimo: null, alcance: null });
  });

  it("CEP desconhecido, metas IGUAIS: afirma com alcance 'ambos'", () => {
    const iguais = configBase({
      freeShippingMin: 199,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 199,
    });
    const meta = metaDeFreteGratisPorValor(promessasDeFrete(iguais), null);
    expect(meta).toEqual({ minimo: 199, alcance: "ambos" });
  });

  it("CEP local mas canal local sem meta por valor (ex.: sempre): null", () => {
    const semMetaLocal = configBase({
      freeShippingMin: FRETE_GRATIS_SEMPRE,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 250,
    });
    const meta = metaDeFreteGratisPorValor(
      promessasDeFrete(semMetaLocal),
      true,
    );
    expect(meta).toEqual({ minimo: null, alcance: null });
  });
});

// TAREFA T4 (23/09/2026, admin): funções puras que a tela
// `AdminShippingNationalView` usa — nenhuma reprecifica transportadora (isso
// segue proibido, contrato §3: "o front nunca recalcula preço nacional"),
// mas a PRÉVIA da tela precisa mostrar o que a lojista vai ver antes de
// salvar, com a MESMA conta da edge (`estrategia-nacional.ts`).
describe("precoComDescontoNacional — mesma conta em centavos da edge (aplicarEstrategiaNacional)", () => {
  it("15% de R$ 24,90 = R$ 21,16 (exemplo do plano)", () => {
    expect(precoComDescontoNacional(24.9, "percentual", 15)).toBeCloseTo(
      21.16,
      2,
    );
  });

  it("15% de R$ 19,95 = R$ 16,96 (arredondamento do centavo, Math.round(299.25)=299)", () => {
    expect(precoComDescontoNacional(19.95, "percentual", 15)).toBeCloseTo(
      16.96,
      2,
    );
  });

  it("fixo de R$ 5 em R$ 41,30 = R$ 36,30", () => {
    expect(precoComDescontoNacional(41.3, "fixo", 5)).toBeCloseTo(36.3, 2);
  });

  it("fixo maior que o preço cheio nunca fica negativo — vira R$ 0", () => {
    expect(precoComDescontoNacional(24.9, "fixo", 50)).toBe(0);
  });

  it("percentual 100% zera o preço (nunca negativo)", () => {
    expect(precoComDescontoNacional(24.9, "percentual", 100)).toBe(0);
  });
});

describe("resumoDaEstrategiaNacional — texto curto do estado SALVO (botão 'Fora da cidade')", () => {
  it("desligado", () => {
    expect(resumoDaEstrategiaNacional(configBase())).toBe("desligado");
  });

  it("acima_de_valor com alcance 'todas'", () => {
    const config = configBase({
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 199,
      nationalBenefitScope: "todas",
    });
    expect(resumoDaEstrategiaNacional(config)).toBe(
      "grátis acima de R$ 199 · todas as opções",
    );
  });

  it("acima_de_valor com alcance 'mais_barata'", () => {
    const config = configBase({
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 199,
      nationalBenefitScope: "mais_barata",
    });
    expect(resumoDaEstrategiaNacional(config)).toBe(
      "grátis acima de R$ 199 · só a mais barata",
    );
  });

  it("sempre, alcance 'todas'", () => {
    const config = configBase({
      nationalShippingStrategy: "sempre",
      nationalBenefitScope: "todas",
    });
    expect(resumoDaEstrategiaNacional(config)).toBe(
      "sempre grátis · todas as opções",
    );
  });

  it("por_produto, alcance 'mais_barata'", () => {
    const config = configBase({
      nationalShippingStrategy: "por_produto",
      nationalBenefitScope: "mais_barata",
    });
    expect(resumoDaEstrategiaNacional(config)).toBe(
      "grátis por produto marcado · só a mais barata",
    );
  });

  it("desconto percentual sem mínimo (0 = sem 'acima de')", () => {
    const config = configBase({
      nationalShippingStrategy: "desconto_na_mais_barata",
      nationalDiscountType: "percentual",
      nationalDiscountValue: 15,
      nationalShippingMin: 0,
    });
    expect(resumoDaEstrategiaNacional(config)).toBe("15% na mais barata");
  });

  it("desconto fixo com mínimo (exemplo do plano)", () => {
    const config = configBase({
      nationalShippingStrategy: "desconto_na_mais_barata",
      nationalDiscountType: "fixo",
      nationalDiscountValue: 5,
      nationalShippingMin: 150,
    });
    expect(resumoDaEstrategiaNacional(config)).toBe(
      "R$ 5 na mais barata acima de R$ 150",
    );
  });
});

describe("estrategiaTemAlcanceEditavel — o alcance só existe para as 3 estratégias de GRÁTIS", () => {
  it("desligado não tem alcance editável", () => {
    expect(estrategiaTemAlcanceEditavel("desligado")).toBe(false);
  });

  it("acima_de_valor, sempre e por_produto têm", () => {
    expect(estrategiaTemAlcanceEditavel("acima_de_valor")).toBe(true);
    expect(estrategiaTemAlcanceEditavel("sempre")).toBe(true);
    expect(estrategiaTemAlcanceEditavel("por_produto")).toBe(true);
  });

  it("desconto_na_mais_barata não tem — é sempre a mais barata por definição", () => {
    expect(estrategiaTemAlcanceEditavel("desconto_na_mais_barata")).toBe(false);
  });
});

describe("erroDoFormularioNacional — espelha os CHECKs da migration 20261171000000", () => {
  function formBase(
    sobre: Partial<FormularioEstrategiaNacional> = {},
  ): FormularioEstrategiaNacional {
    return {
      estrategia: "desligado",
      minimo: 0,
      tipoDesconto: null,
      valorDesconto: 0,
      ...sobre,
    };
  }

  it("desligado nunca dá erro", () => {
    expect(erroDoFormularioNacional(formBase())).toBeNull();
  });

  it("acima_de_valor com mínimo 0 é inválido (CHECK exige > 0)", () => {
    expect(
      erroDoFormularioNacional(
        formBase({ estrategia: "acima_de_valor", minimo: 0 }),
      ),
    ).not.toBeNull();
  });

  it("acima_de_valor com mínimo > 0 é válido", () => {
    expect(
      erroDoFormularioNacional(
        formBase({ estrategia: "acima_de_valor", minimo: 199 }),
      ),
    ).toBeNull();
  });

  it("sempre e por_produto nunca exigem mínimo", () => {
    expect(
      erroDoFormularioNacional(formBase({ estrategia: "sempre", minimo: 0 })),
    ).toBeNull();
    expect(
      erroDoFormularioNacional(
        formBase({ estrategia: "por_produto", minimo: 0 }),
      ),
    ).toBeNull();
  });

  it("desconto sem tipo escolhido é inválido", () => {
    expect(
      erroDoFormularioNacional(
        formBase({
          estrategia: "desconto_na_mais_barata",
          tipoDesconto: null,
          valorDesconto: 15,
        }),
      ),
    ).not.toBeNull();
  });

  it("desconto com valor 0 é inválido (CHECK exige > 0)", () => {
    expect(
      erroDoFormularioNacional(
        formBase({
          estrategia: "desconto_na_mais_barata",
          tipoDesconto: "percentual",
          valorDesconto: 0,
        }),
      ),
    ).not.toBeNull();
  });

  it("desconto percentual > 100 é inválido", () => {
    expect(
      erroDoFormularioNacional(
        formBase({
          estrategia: "desconto_na_mais_barata",
          tipoDesconto: "percentual",
          valorDesconto: 101,
        }),
      ),
    ).not.toBeNull();
  });

  it("desconto percentual não inteiro é inválido (CHECK exige valor = trunc(valor))", () => {
    expect(
      erroDoFormularioNacional(
        formBase({
          estrategia: "desconto_na_mais_barata",
          tipoDesconto: "percentual",
          valorDesconto: 15.5,
        }),
      ),
    ).not.toBeNull();
  });

  it("desconto percentual inteiro <= 100 é válido", () => {
    expect(
      erroDoFormularioNacional(
        formBase({
          estrategia: "desconto_na_mais_barata",
          tipoDesconto: "percentual",
          valorDesconto: 100,
        }),
      ),
    ).toBeNull();
  });

  it("desconto fixo pode passar de 100 — o CHECK só limita percentual", () => {
    expect(
      erroDoFormularioNacional(
        formBase({
          estrategia: "desconto_na_mais_barata",
          tipoDesconto: "fixo",
          valorDesconto: 250.5,
        }),
      ),
    ).toBeNull();
  });
});
