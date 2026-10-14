// O rascunho do formulário de produto: estoque nunca vem dele, e ele vence.
// As funções puras de `src/lib/rascunho-do-produto.ts`, provadas sem montar a
// tela (o fluxo na tela está em admin-product-form-rascunho-nao-devolve-estoque).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRAZO_DO_RASCUNHO_DO_PRODUTO_MS,
  chaveDoRascunhoDoProduto,
  descartarRascunhoDoProduto,
  estoqueDoRascunhoDifereDoBanco,
  lerRascunhoVigenteDoProduto,
  rascunhoVenceu,
  serializarRascunhoDoProduto,
  variacoesDoRascunhoComEstoqueDoBanco,
} from "@/lib/rascunho-do-produto";
import type { ProductVariant } from "@/types";

const UM_DIA = 24 * 60 * 60 * 1000;
const AGORA = 1_800_000_000_000;

const variacao = (
  id: string,
  estoque: number,
  extra: Partial<ProductVariant> = {},
): ProductVariant => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: id,
  stockIncrement: estoque,
  active: true,
  ...extra,
});

describe("chaveDoRascunhoDoProduto", () => {
  it("é por usuário e por produto; sem usuário não há chave", () => {
    expect(chaveDoRascunhoDoProduto("u1")).toBe("ikcous_product_form_draft:u1");
    expect(chaveDoRascunhoDoProduto("u1", "p-9")).toBe(
      "ikcous_product_form_draft_edit_p-9:u1",
    );
    expect(chaveDoRascunhoDoProduto(undefined, "p-9")).toBeNull();
    expect(chaveDoRascunhoDoProduto("", "p-9")).toBeNull();
  });
});

describe("variacoesDoRascunhoComEstoqueDoBanco", () => {
  it("variação que existe no banco: leva o estoque do BANCO e o resto do rascunho", () => {
    const doRascunho = [
      variacao("v1", 3, { value: "Rosa choque", active: false, stock: 3 }),
    ];
    const doBanco = [variacao("v1", 1, { value: "Rosa" })];

    const [resultado] = variacoesDoRascunhoComEstoqueDoBanco(
      doRascunho,
      doBanco,
    );

    expect(resultado.stockIncrement).toBe(1);
    expect(resultado.value).toBe("Rosa choque");
    expect(resultado.active).toBe(false);
    // O `stock` velho do rascunho não sobra (o banco não tinha).
    expect(resultado).not.toHaveProperty("stock");
  });

  it("variação NOVA (temp-) mantém o estoque digitado", () => {
    const nova = variacao("temp-1", 4);
    expect(variacoesDoRascunhoComEstoqueDoBanco([nova], [])).toEqual([nova]);
  });

  it("variação com id de verdade que já saiu do banco não volta", () => {
    expect(
      variacoesDoRascunhoComEstoqueDoBanco(
        [variacao("v-apagada", 9)],
        [variacao("v1", 1)],
      ),
    ).toEqual([]);
  });

  it("lista vazia no rascunho: nada volta (e o banco não é tocado)", () => {
    expect(
      variacoesDoRascunhoComEstoqueDoBanco([], [variacao("v1", 1)]),
    ).toEqual([]);
  });

  it("não altera as listas recebidas", () => {
    const doRascunho = [variacao("v1", 3)];
    const doBanco = [variacao("v1", 1)];
    variacoesDoRascunhoComEstoqueDoBanco(doRascunho, doBanco);
    expect(doRascunho[0].stockIncrement).toBe(3);
    expect(doBanco[0].stockIncrement).toBe(1);
  });
});

describe("estoqueDoRascunhoDifereDoBanco", () => {
  it("sem variação: compara o estoque do produto", () => {
    const banco = { stock: "3", variants: [] };
    expect(estoqueDoRascunhoDifereDoBanco({ stock: "5" }, banco)).toBe(true);
    expect(estoqueDoRascunhoDifereDoBanco({ stock: "3" }, banco)).toBe(false);
    expect(estoqueDoRascunhoDifereDoBanco({ stock: 3 }, banco)).toBe(false);
    expect(estoqueDoRascunhoDifereDoBanco({}, banco)).toBe(false);
  });

  it("com variação ligada: só o número de cada variação conta (o do produto é a soma)", () => {
    const banco = {
      stock: "7", // o banco guarda 7, mas as variações somam 3
      variants: [variacao("v1", 1), variacao("v2", 2)],
    };
    expect(
      estoqueDoRascunhoDifereDoBanco(
        { stock: "5", variants: [variacao("v1", 1), variacao("v2", 2)] },
        banco,
      ),
    ).toBe(false);
    expect(
      estoqueDoRascunhoDifereDoBanco(
        { stock: "5", variants: [variacao("v1", 3), variacao("v2", 2)] },
        banco,
      ),
    ).toBe(true);
  });

  it("variação nova no rascunho não conta como estoque diferente", () => {
    expect(
      estoqueDoRascunhoDifereDoBanco(
        { variants: [variacao("v1", 1), variacao("temp-1", 4)] },
        { stock: "1", variants: [variacao("v1", 1)] },
      ),
    ).toBe(false);
  });
});

describe("prazo do rascunho", () => {
  it("o prazo é de 7 dias", () => {
    expect(PRAZO_DO_RASCUNHO_DO_PRODUTO_MS).toBe(7 * UM_DIA);
  });

  it("vence só depois de 7 dias; no limite exato ainda vale", () => {
    expect(rascunhoVenceu({ salvoEm: AGORA - 8 * UM_DIA }, AGORA)).toBe(true);
    expect(rascunhoVenceu({ salvoEm: AGORA - 7 * UM_DIA - 1 }, AGORA)).toBe(
      true,
    );
    expect(rascunhoVenceu({ salvoEm: AGORA - 7 * UM_DIA }, AGORA)).toBe(false);
    expect(rascunhoVenceu({ salvoEm: AGORA - 6 * UM_DIA }, AGORA)).toBe(false);
    expect(rascunhoVenceu({ salvoEm: AGORA }, AGORA)).toBe(false);
  });

  it("sem carimbo, carimbo ilegível ou do futuro: vale (nunca apaga trabalho por dúvida)", () => {
    expect(rascunhoVenceu({}, AGORA)).toBe(false);
    expect(rascunhoVenceu(null, AGORA)).toBe(false);
    expect(rascunhoVenceu({ salvoEm: "ontem" }, AGORA)).toBe(false);
    expect(rascunhoVenceu({ salvoEm: Number.NaN }, AGORA)).toBe(false);
    expect(rascunhoVenceu({ salvoEm: AGORA + UM_DIA }, AGORA)).toBe(false);
  });

  it("serializar guarda os campos e o carimbo", () => {
    const texto = serializarRascunhoDoProduto({ name: "X" }, AGORA);
    expect(JSON.parse(texto)).toEqual({ name: "X", salvoEm: AGORA });
  });
});

describe("lerRascunhoVigenteDoProduto e descartarRascunhoDoProduto", () => {
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("vigente volta como texto; vencido sai do armazém e volta null", () => {
    armazem.set("novo", serializarRascunhoDoProduto({ name: "A" }, AGORA));
    armazem.set(
      "velho",
      serializarRascunhoDoProduto({ name: "B" }, AGORA - 8 * UM_DIA),
    );

    expect(lerRascunhoVigenteDoProduto("novo", AGORA)).toBe(
      armazem.get("novo"),
    );
    expect(lerRascunhoVigenteDoProduto("velho", AGORA)).toBeNull();
    expect(armazem.has("velho")).toBe(false);
    expect(armazem.has("novo")).toBe(true);
  });

  it("chave ausente: null; texto que não é JSON volta como está (o erro é de quem lê)", () => {
    expect(lerRascunhoVigenteDoProduto("nada", AGORA)).toBeNull();
    armazem.set("quebrado", "{não é json");
    expect(lerRascunhoVigenteDoProduto("quebrado", AGORA)).toBe("{não é json");
    expect(armazem.has("quebrado")).toBe(true);
  });

  it("descartar apaga só a chave do produto (e a do produto novo, sem id)", () => {
    armazem.set("ikcous_product_form_draft_edit_p-1:u1", "{}");
    armazem.set("ikcous_product_form_draft_edit_p-2:u1", "{}");
    armazem.set("ikcous_product_form_draft:u1", "{}");

    descartarRascunhoDoProduto("u1", "p-1");
    expect([...armazem.keys()].sort()).toEqual([
      "ikcous_product_form_draft:u1",
      "ikcous_product_form_draft_edit_p-2:u1",
    ]);

    descartarRascunhoDoProduto("u1");
    expect([...armazem.keys()]).toEqual([
      "ikcous_product_form_draft_edit_p-2:u1",
    ]);
  });

  it("descartar sem usuário não faz nada (nunca apaga chave de outro)", () => {
    armazem.set("ikcous_product_form_draft_edit_p-1:u1", "{}");
    descartarRascunhoDoProduto(undefined, "p-1");
    expect(armazem.size).toBe(1);
  });
});
