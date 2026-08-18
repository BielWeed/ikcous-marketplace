// @ts-nocheck
/**
 * Axiomas do Truth Gate (protocolo SROS) — src/utils/truth_gate.ts
 *
 * Cobre o que a auditoria de 05/08/2026 encontrou e o PR #145 corrigiu:
 * seis buracos de axioma, um recibo cujo hash colidia entre produtos
 * diferentes, e as variantes que nunca passavam pelo gate.
 *
 * Mora em tests/ e não ao lado do fonte porque tsconfig.app.json tem
 * include ["src"]: um _test.ts lá dentro entraria no `tsc -b` e quebraria o
 * typecheck com os globais do Deno.
 */
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { TruthGate } from "../src/utils/truth_gate.ts";

const INSTANTE = "2026-08-05T00:00:00.000Z";

/** O gate loga cada recibo; sem isto a saída do teste vira ruído. */
function semRuido(fn) {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}

/**
 * Congela o relógio para isolar o payload como única variável do hash.
 * Sem isto o timestamp sozinho geraria a entropia e os testes de conteúdo
 * passariam mesmo se o payload voltasse a ficar de fora do digest.
 */
function comRelogioCongelado(fn) {
  const Real = globalThis.Date;
  class Congelado extends Real {
    constructor() {
      super(INSTANTE);
    }
    toISOString() {
      return INSTANTE;
    }
  }
  globalThis.Date = Congelado;
  try {
    return fn();
  } finally {
    globalThis.Date = Real;
  }
}

function recibo(payload, context, subject = "product") {
  return semRuido(() =>
    subject === "product"
      ? TruthGate.verifyProductAxiom(payload, context)
      : TruthGate.verifyVariantAxiom(payload, context),
  );
}

/** Devolve os códigos de violação, ou [] se o payload passou. */
function violacoes(payload, context, subject = "product") {
  try {
    recibo(payload, context, subject);
    return [];
  } catch (e) {
    return String(e.message)
      .replace(/^Validação de \w+ Falhou: /, "")
      .split(", ")
      .map((v) => v.replace("Axiom violation: ", ""));
  }
}

function temWarningDePrejuizo(payload, context, subject = "product") {
  const r = recibo(payload, context, subject);
  return (r.warnings ?? []).some((w) => w.includes("price_margin_negative"));
}

// --------------------------------------------------------------------------
// Produto
// --------------------------------------------------------------------------

Deno.test("produto: axiomas de valor abortam", async (t) => {
  const casos = [
    ["preço negativo", { price: -1 }, "price_non_negative"],
    ["estoque acima do teto", { stock: 10001 }, "stock_limit_exceeded"],
    ["estoque negativo", { stock: -50 }, "stock_negative"],
    ["nome vazio", { name: "   " }, "identity_null_error"],
    ["custo negativo", { costPrice: -5 }, "cost_price_negative"],
    [
      "preço original menor que o de venda",
      { originalPrice: 10, price: 20 },
      "original_price_must_be_greater_than_promo_price",
    ],
  ];
  for (const [nome, payload, codigo] of casos) {
    await t.step(nome, () => {
      assert(
        violacoes(payload).includes(codigo),
        `esperava ${codigo}, veio [${violacoes(payload)}]`,
      );
    });
  }
});

Deno.test("produto: valor presente tem que ser numérico", async (t) => {
  const invalidos = [
    ["null", null],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["texto", "abc"],
    ["string vazia", ""],
  ];
  for (const [nome, valor] of invalidos) {
    await t.step(`preço ${nome} aborta`, () => {
      assert(violacoes({ price: valor }).includes("price_not_numeric"));
    });
  }

  await t.step("string numérica continua sendo aceita", () => {
    assertEquals(violacoes({ price: "10.50" }), []);
  });

  await t.step("string numérica negativa ainda coage e aborta", () => {
    assert(violacoes({ price: "-5" }).includes("price_non_negative"));
  });
});

Deno.test("produto: modo create exige o produto inteiro", async (t) => {
  await t.step("objeto vazio reporta as três ausências", () => {
    assertEquals(violacoes({}, { mode: "create" }).sort(), [
      "identity_required",
      "price_required",
      "stock_required",
    ]);
  });

  await t.step("criação válida passa", () => {
    assertEquals(
      violacoes(
        { name: "Camiseta", price: 50, stock: 10, costPrice: 20 },
        { mode: "create" },
      ),
      [],
    );
  });

  await t.step("valor inválido não vira duas violações", () => {
    const v = violacoes({ price: null }, { mode: "create" });
    assert(v.includes("price_not_numeric"));
    assert(
      !v.includes("price_required"),
      "price null gerou presença e validade ao mesmo tempo",
    );
  });
});

Deno.test("produto: semântica de patch preservada", async (t) => {
  // Num patch, campo ausente quer dizer "não mexe nesse". Se isto quebrar,
  // qualquer edição parcial de produto passa a ser rejeitada.
  const patches = [
    ["patch vazio", {}],
    ["só isActive", { isActive: false }],
    ["só o nome", { name: "Novo nome" }],
  ];
  for (const [nome, payload] of patches) {
    await t.step(`${nome} continua válido`, () => {
      assertEquals(violacoes(payload), []);
    });
  }
});

Deno.test("produto: margem financeira é aviso, não violação", async (t) => {
  await t.step("custo acima do preço avisa sem abortar", () => {
    assertEquals(violacoes({ price: 10, costPrice: 20 }), []);
    assert(temWarningDePrejuizo({ price: 10, costPrice: 20 }));
  });

  await t.step("preço zero com custo positivo também avisa", () => {
    assert(temWarningDePrejuizo({ price: 0, costPrice: 50 }));
  });

  await t.step("brinde com custo zero não avisa contra si mesmo", () => {
    assert(!temWarningDePrejuizo({ price: 0, costPrice: 0 }));
  });

  await t.step("entidade mesclada enxerga o custo já gravado", () => {
    // O caminho de update valida {...produtoAtual, ...updates}. Validando só
    // o patch, baixar o preço abaixo do custo não gerava nem aviso.
    const gravado = { name: "X", price: 100, stock: 5, costPrice: 50 };
    assert(temWarningDePrejuizo({ ...gravado, price: 10 }));
  });
});

// --------------------------------------------------------------------------
// Variante
// --------------------------------------------------------------------------

const VARIANTE_OK = {
  productId: "p1",
  name: "Cor",
  value: "Azul",
  stockIncrement: 10,
  priceOverride: 50,
  active: true,
};

Deno.test("variante: axiomas próprios", async (t) => {
  const casos = [
    [
      "override negativo",
      { ...VARIANTE_OK, priceOverride: -1 },
      "variant_price_override_negative",
    ],
    [
      "estoque acima do teto",
      { ...VARIANTE_OK, stockIncrement: 10001 },
      "variant_stock_limit_exceeded",
    ],
    [
      "estoque negativo",
      { ...VARIANTE_OK, stockIncrement: -5 },
      "variant_stock_negative",
    ],
    [
      "nome vazio",
      { ...VARIANTE_OK, name: "   " },
      "variant_identity_null_error",
    ],
    ["valor vazio", { ...VARIANTE_OK, value: "" }, "variant_value_null_error"],
  ];
  for (const [nome, payload, codigo] of casos) {
    await t.step(nome, () => {
      assert(
        violacoes(payload, undefined, "variant").includes(codigo),
        `esperava ${codigo}, veio [${violacoes(payload, undefined, "variant")}]`,
      );
    });
  }

  await t.step("variante válida passa", () => {
    assertEquals(violacoes(VARIANTE_OK, { costPrice: 20 }, "variant"), []);
  });

  await t.step("patch parcial passa", () => {
    assertEquals(violacoes({ active: false }, undefined, "variant"), []);
  });
});

Deno.test("variante: não empresta os códigos do produto", () => {
  // Um recibo dizendo "price_non_negative" para um priceOverride mentiria
  // sobre o que foi validado.
  const v = violacoes(
    { ...VARIANTE_OK, priceOverride: -1, stockIncrement: -5, value: "" },
    undefined,
    "variant",
  );
  assertEquals(v.length, 3, `acumulou ${v.length} violações: [${v}]`);
  assert(v.every((codigo) => codigo.startsWith("variant_")));
});

Deno.test("variante: mensagem de erro identifica o sujeito", () => {
  try {
    recibo({ ...VARIANTE_OK, priceOverride: -1 }, undefined, "variant");
    throw new Error("deveria ter abortado");
  } catch (e) {
    assert(
      String(e.message).startsWith("Validação de Variante"),
      `mensagem foi: ${e.message}`,
    );
  }
});

Deno.test("variante: margem depende do custo do pai", async (t) => {
  const barata = { ...VARIANTE_OK, priceOverride: 10 };

  await t.step("com o custo informado, avisa", () => {
    assert(temWarningDePrejuizo(barata, { costPrice: 20 }, "variant"));
  });

  await t.step("sem o custo, omite o aviso mas não inventa violação", () => {
    assert(!temWarningDePrejuizo(barata, undefined, "variant"));
    assertEquals(violacoes(barata, undefined, "variant"), []);
  });
});

// --------------------------------------------------------------------------
// Recibo
// --------------------------------------------------------------------------

Deno.test("recibo: o hash cobre o conteúdo validado", async (t) => {
  const hash = (payload, subject = "product") =>
    comRelogioCongelado(() => recibo(payload, undefined, subject).hash);

  const A = { id: "MESMO-ID", price: 10, stock: 5 };

  await t.step("payloads diferentes geram hashes diferentes", () => {
    // Regressão do bug original: btoa(id-timestamp-status).slice(0, 16)
    // truncava em 12 bytes e estes dois produtos colidiam.
    assertNotEquals(
      hash(A),
      hash({ id: "MESMO-ID", price: 999999, stock: 9999 }),
    );
  });

  await t.step("payload idêntico gera hash idêntico", () => {
    assertEquals(hash(A), hash({ id: "MESMO-ID", price: 10, stock: 5 }));
  });

  await t.step("ordem das chaves não altera o hash", () => {
    assertEquals(hash(A), hash({ stock: 5, price: 10, id: "MESMO-ID" }));
  });

  await t.step("um centavo de diferença muda o hash", () => {
    assertNotEquals(hash(A), hash({ ...A, price: 10.01 }));
  });

  await t.step("o veredito entra no hash", () => {
    assertNotEquals(hash(A), hash({ ...A, costPrice: 20 }));
  });

  await t.step("ordem dentro de array é preservada", () => {
    assertNotEquals(
      hash({ id: "X", tags: ["a", "b"] }),
      hash({ id: "X", tags: ["b", "a"] }),
    );
  });

  await t.step("produto e variante de campos iguais não colidem", () => {
    const campos = { name: "X", value: "Y" };
    assertNotEquals(hash(campos, "product"), hash(campos, "variant"));
  });
});

Deno.test("recibo: serialização aguenta os casos difíceis", async (t) => {
  const hash = (payload) =>
    comRelogioCongelado(() => recibo(payload, undefined).hash);

  await t.step("objeto vazio não estoura", () => {
    assertEquals(hash({}).length, 16);
  });

  await t.step("undefined explícito difere de chave ausente", () => {
    assertNotEquals(hash({ id: "z", stock: undefined }), hash({ id: "z" }));
  });

  await t.step("referência circular não estoura a pilha", () => {
    const circular = { id: "z", price: 1 };
    circular.self = circular;
    assertEquals(hash(circular).length, 16);
  });

  await t.step("acentuação não quebra o digest", () => {
    assertEquals(hash({ id: "z", name: "Camisetão Ação" }).length, 16);
  });

  await t.step("o recibo carrega status e timestamp", () => {
    const r = comRelogioCongelado(() => recibo({ price: 10 }, undefined));
    assertEquals(r.status, "VERIFIED");
    assertEquals(r.timestamp, INSTANTE);
    assertEquals(r.violations, []);
  });
});

// --------------------------------------------------------------------------
// ADMIN-050 (#96): limpar campo opcional é intenção legítima, não violação
// --------------------------------------------------------------------------
//
// O gate tratava QUALQUER valor não-numérico como violação, inclusive `null`.
// Isso estava certo para `price` e `stock` (colunas obrigatórias, onde null
// deixaria produto sem preço no catálogo) e errado para `costPrice` e
// `originalPrice`: as duas colunas são anuláveis, o tipo do front já é
// `number | null`, e `null` é a única forma de a lojista DESFAZER uma
// promoção ou apagar o preço de custo.
//
// Enquanto o gate recusava `null`, o formulário mandava `undefined` — que
// some no caminho e faz o painel dizer "salvo" sem salvar (#96). Consertar só
// o formulário trocaria a mentira por um erro de validação na cara dela.

Deno.test("produto: null é aceito nos campos que a lojista pode zerar (#96)", async (t) => {
  await t.step("originalPrice null desfaz a promoção", () => {
    assertEquals(violacoes({ originalPrice: null, price: 20 }), []);
  });

  await t.step("costPrice null apaga o preço de custo", () => {
    assertEquals(violacoes({ costPrice: null, price: 20 }), []);
  });

  await t.step("os dois de uma vez", () => {
    assertEquals(violacoes({ originalPrice: null, costPrice: null }), []);
  });

  await t.step("null NÃO é aceito em preço, que é obrigatório", () => {
    assert(violacoes({ price: null }).includes("price_not_numeric"));
  });

  await t.step("null NÃO é aceito em estoque, que é obrigatório", () => {
    assert(violacoes({ stock: null }).includes("stock_not_numeric"));
  });

  await t.step("lixo continua sendo lixo nos campos opcionais", () => {
    // Aceitar `null` é aceitar a INTENÇÃO de limpar — não é abrir a porta
    // para texto e NaN, que chegariam ao banco como null sem ninguém pedir.
    for (const valor of [Number.NaN, "abc", ""]) {
      assert(
        violacoes({ costPrice: valor }).includes("cost_price_not_numeric"),
        `costPrice=${String(valor)} deveria abortar`,
      );
      assert(
        violacoes({ originalPrice: valor }).includes(
          "original_price_not_numeric",
        ),
        `originalPrice=${String(valor)} deveria abortar`,
      );
    }
  });

  await t.step(
    "originalPrice null não dispara a regra de 'maior que o preço'",
    () => {
      // A comparação promo x original só faz sentido com os dois números
      // presentes; com null ela não pode inventar violação.
      assertEquals(violacoes({ originalPrice: null, price: 999 }), []);
    },
  );
});
