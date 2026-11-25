// Truth Gate (`src/utils/truth_gate.ts`): as recusas e os avisos que só um valor
// NA BORDA exerce. O teste de Deno (`tests/truth_gate_test.ts`) cobre os casos
// do meio de cada regra; aqui ficam os que passavam batido numa caça por
// mutação (defeitos de uma linha que nenhum teste derrubava):
//
//   - texto só de espaços ou "Infinity" digitado no preço/estoque;
//   - nome ou valor da variação `null`/`0` (o `!nome` é quem pega, o trim não);
//   - criação com `null` não pode virar DUAS violações para o mesmo campo;
//   - preço de custo igual ao preço (margem zero) e preço de antes igual ao
//     de venda: a fronteira exata de `>=` e `<=`;
//   - patch SÓ com custo, ou SÓ com preço de antes, não compara com um preço
//     que não veio (ausente não é zero);
//   - override de preço 0 na variação é aceito;
//   - a frase de recusa do produto e da variação, que o `useProducts` lê pelo
//     prefixo "Validação de (Produto|Variante) Falhou:".
import { TruthGate } from "@/utils/truth_gate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  // O gate loga cada recibo e cada aborto; sem isto a saída vira ruído.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Alvo = "produto" | "variacao";

/** Códigos de violação (sem o prefixo "Axiom violation: "), ou [] se passou. */
function violacoes(
  payload: Record<string, unknown>,
  alvo: Alvo = "produto",
  contexto?: { mode?: "create" | "patch"; costPrice?: number | null },
): string[] {
  try {
    if (alvo === "produto") {
      TruthGate.verifyProductAxiom(payload, { mode: contexto?.mode });
    } else {
      TruthGate.verifyVariantAxiom(payload, { costPrice: contexto?.costPrice });
    }
    return [];
  } catch (e) {
    return String((e as Error).message)
      .replace(/^Validação de \w+ Falhou: /, "")
      .split(", ")
      .map((v) => v.replace("Axiom violation: ", ""));
  }
}

function avisos(
  payload: Record<string, unknown>,
  alvo: Alvo = "produto",
  contexto?: { costPrice?: number | null },
): string[] {
  const recibo =
    alvo === "produto"
      ? TruthGate.verifyProductAxiom(payload)
      : TruthGate.verifyVariantAxiom(payload, contexto);
  return recibo.warnings ?? [];
}

const temAvisoDePrejuizo = (lista: string[]) =>
  lista.some((a) => a.includes("margin_negative"));

describe("produto: número que não é número, digitado no campo", () => {
  it.each([
    ["só espaços", "   "],
    ["só um tab", "\t"],
    ["Infinity escrito", "Infinity"],
    ["-Infinity escrito", "-Infinity"],
  ])("preço %s não vira zero nem infinito: aborta", (_nome, valor) => {
    expect(violacoes({ price: valor })).toContain("price_not_numeric");
  });

  it.each([
    ["só espaços", "   "],
    ["Infinity escrito", "Infinity"],
  ])("estoque %s não vira zero nem infinito: aborta", (_nome, valor) => {
    expect(violacoes({ stock: valor })).toContain("stock_not_numeric");
  });

  it("custo e preço de antes com texto-infinito também abortam (só null passa)", () => {
    expect(violacoes({ costPrice: "Infinity" })).toContain(
      "cost_price_not_numeric",
    );
    expect(violacoes({ originalPrice: "Infinity" })).toContain(
      "original_price_not_numeric",
    );
    expect(violacoes({ originalPrice: "   " })).toContain(
      "original_price_not_numeric",
    );
  });

  it("número escrito com espaço nas pontas continua valendo", () => {
    expect(violacoes({ price: " 10 ", stock: " 3 " })).toEqual([]);
  });
});

describe("produto: criação com valor presente porém inválido não dobra a violação", () => {
  it("nome null: só 'nome vazio', não 'nome obrigatório' também", () => {
    expect(
      violacoes({ name: null, price: 10, stock: 1 }, "produto", {
        mode: "create",
      }),
    ).toEqual(["identity_null_error"]);
  });

  it("estoque null: só 'estoque não numérico', não 'estoque obrigatório' também", () => {
    expect(
      violacoes({ name: "Camiseta", price: 10, stock: null }, "produto", {
        mode: "create",
      }),
    ).toEqual(["stock_not_numeric"]);
  });

  it("preço null: só 'preço não numérico'", () => {
    expect(
      violacoes({ name: "Camiseta", price: null, stock: 1 }, "produto", {
        mode: "create",
      }),
    ).toEqual(["price_not_numeric"]);
  });
});

describe("nome falso (null, 0, false) é nome vazio, no produto e na variação", () => {
  it.each([null, 0, false, ""])("produto com nome %j aborta", (nome) => {
    expect(violacoes({ name: nome })).toEqual(["identity_null_error"]);
  });

  it.each([null, 0, false, ""])("variação com nome %j aborta", (nome) => {
    expect(violacoes({ name: nome, value: "Azul" }, "variacao")).toEqual([
      "variant_identity_null_error",
    ]);
  });

  it.each([null, 0, false, "", "   "])(
    "variação com valor %j aborta",
    (valor) => {
      expect(violacoes({ name: "Cor", value: valor }, "variacao")).toEqual([
        "variant_value_null_error",
      ]);
    },
  );

  it("nome só de espaços aborta, e um nome de verdade passa", () => {
    expect(violacoes({ name: "   " })).toEqual(["identity_null_error"]);
    expect(violacoes({ name: " Camiseta " })).toEqual([]);
    expect(violacoes({ name: "Cor", value: " Azul " }, "variacao")).toEqual([]);
  });
});

describe("produto: aviso de prejuízo nas fronteiras exatas", () => {
  it("custo IGUAL ao preço já avisa (margem zero); um centavo abaixo não", () => {
    expect(temAvisoDePrejuizo(avisos({ price: 10, costPrice: 10 }))).toBe(true);
    expect(temAvisoDePrejuizo(avisos({ price: 10, costPrice: 9.99 }))).toBe(
      false,
    );
    expect(temAvisoDePrejuizo(avisos({ price: 10, costPrice: 10.01 }))).toBe(
      true,
    );
  });

  it("patch SÓ com o custo não compara com um preço que não veio", () => {
    // `price` ausente não é zero: sem o preço não há como dizer prejuízo.
    expect(avisos({ costPrice: 20 })).toEqual([]);
    expect(violacoes({ costPrice: 20 })).toEqual([]);
  });

  it("custo zero nunca avisa, nem com preço baixo", () => {
    expect(avisos({ price: 0.01, costPrice: 0 })).toEqual([]);
  });
});

describe("produto: preço de antes ('De') nas fronteiras exatas", () => {
  it("IGUAL ao preço de venda aborta; um centavo acima passa", () => {
    expect(violacoes({ originalPrice: 20, price: 20 })).toEqual([
      "original_price_must_be_greater_than_promo_price",
    ]);
    expect(violacoes({ originalPrice: 20.01, price: 20 })).toEqual([]);
    expect(violacoes({ originalPrice: 19.99, price: 20 })).toEqual([
      "original_price_must_be_greater_than_promo_price",
    ]);
  });

  it("patch SÓ com o preço de antes não compara com um preço que não veio", () => {
    expect(violacoes({ originalPrice: 0 })).toEqual([]);
    expect(violacoes({ originalPrice: -3 })).toEqual([]);
  });
});

describe("variação: fronteiras do override de preço e da margem", () => {
  const BASE = { name: "Cor", value: "Azul", stockIncrement: 5 };

  // O servidor cobra `COALESCE(price_override, preco_venda)`: zero cobra zero
  // (brinde legítimo), então o gate não pode recusá-lo.
  it("override 0 é aceito, -0.01 aborta", () => {
    expect(violacoes({ ...BASE, priceOverride: 0 }, "variacao")).toEqual([]);
    expect(violacoes({ ...BASE, priceOverride: -0.01 }, "variacao")).toEqual([
      "variant_price_override_negative",
    ]);
  });

  it("override IGUAL ao custo do pai já avisa; um centavo acima não", () => {
    const contexto = { costPrice: 10 };
    expect(
      temAvisoDePrejuizo(
        avisos({ ...BASE, priceOverride: 10 }, "variacao", contexto),
      ),
    ).toBe(true);
    expect(
      temAvisoDePrejuizo(
        avisos({ ...BASE, priceOverride: 10.01 }, "variacao", contexto),
      ),
    ).toBe(false);
    expect(
      temAvisoDePrejuizo(
        avisos({ ...BASE, priceOverride: 9.99 }, "variacao", contexto),
      ),
    ).toBe(true);
  });

  it("sem override (null ou ausente) ou sem custo do pai, nenhum aviso", () => {
    expect(
      avisos({ ...BASE, priceOverride: null }, "variacao", { costPrice: 20 }),
    ).toEqual([]);
    expect(avisos({ ...BASE }, "variacao", { costPrice: 20 })).toEqual([]);
    expect(
      avisos({ ...BASE, priceOverride: 10 }, "variacao", { costPrice: null }),
    ).toEqual([]);
  });

  it("estoque null ou ausente na variação não é violação", () => {
    expect(violacoes({ ...BASE, stockIncrement: null }, "variacao")).toEqual(
      [],
    );
    expect(violacoes({ name: "Cor", value: "Azul" }, "variacao")).toEqual([]);
  });
});

describe("a frase de recusa que o useProducts lê pelo prefixo", () => {
  // `useProducts.ts` reconhece a recusa do gate por este prefixo e traduz cada
  // código para o português. Trocar a palavra do prefixo faz a lojista ver o
  // texto genérico em vez da regra.
  const PREFIXO_LIDO_PELO_USEPRODUCTS =
    /^Validação de (Produto|Variante) Falhou:/;

  function mensagemDe(fn: () => unknown): string {
    try {
      fn();
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("o gate devia ter abortado");
  }

  it("produto recusado diz 'Produto', com o código no formato lido pela tabela", () => {
    const msg = mensagemDe(() => TruthGate.verifyProductAxiom({ price: -1 }));
    expect(msg).toBe(
      "Validação de Produto Falhou: Axiom violation: price_non_negative",
    );
    expect(msg).toMatch(PREFIXO_LIDO_PELO_USEPRODUCTS);
  });

  it("variação recusada diz 'Variante'", () => {
    const msg = mensagemDe(() =>
      TruthGate.verifyVariantAxiom({ priceOverride: -1 }),
    );
    expect(msg).toBe(
      "Validação de Variante Falhou: Axiom violation: variant_price_override_negative",
    );
    expect(msg).toMatch(PREFIXO_LIDO_PELO_USEPRODUCTS);
  });

  it("várias violações vêm separadas por vírgula e espaço, na ordem das regras", () => {
    const msg = mensagemDe(() =>
      TruthGate.verifyProductAxiom({ price: -1, stock: 10001 }),
    );
    expect(msg).toBe(
      "Validação de Produto Falhou: Axiom violation: price_non_negative, Axiom violation: stock_limit_exceeded",
    );
  });
});
