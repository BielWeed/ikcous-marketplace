// `src/utils/campos-mexidos-do-produto.ts`: bordas que
// `campos-mexidos-do-produto.test.ts` e `variacoes-apos-conflito.test.ts`
// deixavam passar.
//
//  - `camposQueMudaram`: `undefined` do lado de cá é "não mexi" e a CHAVE some
//    do remendo (não vira chave com valor undefined); a comparação é estrita
//    (0 não é "", false não é 0);
//  - `variacaoMudou`: preço próprio ZERO (cobra zero, brinde) é diferente de
//    "sem preço próprio" (segue o preço do produto);
//  - `estoqueFoiHerdado`: só o marcador `true` vale;
//  - `variacoesAposConflito`: a variação nova com estoque herdado só troca o
//    estoque quando há saldo para herdar; a nova digitada à mão nunca troca; e a
//    variação que a tela já mostra e o banco também tem, mas que a abertura não
//    tinha, entra UMA vez e não derruba o salvar.
import {
  type ComEstoqueHerdado,
  ESTOQUE_HERDADO,
  type VariacaoComparavel,
  camposQueMudaram,
  estoqueFoiHerdado,
  variacaoMudou,
  variacoesAposConflito,
} from "@/utils/campos-mexidos-do-produto";
import { describe, expect, it } from "vitest";

type Campos = Record<string, unknown>;

type VariacaoDeTela = VariacaoComparavel & ComEstoqueHerdado;

const variacao = (
  id: string,
  extra: Partial<VariacaoDeTela> = {},
): VariacaoDeTela => ({
  id,
  name: "Cor",
  value: "Azul",
  stockIncrement: 3,
  active: true,
  ...extra,
});

describe("camposQueMudaram — undefined e tipos", () => {
  it("campo undefined do lado de cá some do remendo: a chave nem existe", () => {
    const remendo = camposQueMudaram<Campos>(
      { medidas: undefined, preco: 2 },
      { medidas: 7, preco: 2 },
    );
    expect(Object.keys(remendo)).toEqual([]);
  });

  it("campo limpo de verdade (null) continua indo como null", () => {
    const remendo = camposQueMudaram<Campos>({ preco: null }, { preco: 5 });
    expect(remendo).toStrictEqual({ preco: null });
  });

  it("comparação estrita: 0 não é texto vazio e false não é 0", () => {
    expect(camposQueMudaram<Campos>({ preco: 0 }, { preco: "" })).toStrictEqual(
      {
        preco: 0,
      },
    );
    expect(
      camposQueMudaram<Campos>({ ativo: false }, { ativo: 0 }),
    ).toStrictEqual({
      ativo: false,
    });
  });
});

describe("variacaoMudou — preço próprio zero", () => {
  it("zero (cobra zero) é diferente de sem preço próprio (null ou ausente)", () => {
    expect(
      variacaoMudou(
        variacao("v1", { priceOverride: 0 }),
        variacao("v1", { priceOverride: null }),
      ),
    ).toBe(true);
    expect(
      variacaoMudou(variacao("v1", { priceOverride: 0 }), variacao("v1")),
    ).toBe(true);
  });

  it("null e ausente são o mesmo 'sem preço próprio'", () => {
    expect(
      variacaoMudou(variacao("v1", { priceOverride: null }), variacao("v1")),
    ).toBe(false);
  });
});

describe("estoqueFoiHerdado — só o marcador true", () => {
  it("true herdou; false e ausente não", () => {
    expect(estoqueFoiHerdado({ [ESTOQUE_HERDADO]: true })).toBe(true);
    expect(estoqueFoiHerdado({ [ESTOQUE_HERDADO]: false })).toBe(false);
    expect(estoqueFoiHerdado({})).toBe(false);
  });
});

describe("variacoesAposConflito — variação nova (temp-)", () => {
  it("herdada, mas sem saldo para herdar: mantém o estoque que está na tela", () => {
    const nova = variacao("temp-1", {
      stockIncrement: 3,
      [ESTOQUE_HERDADO]: true,
    });
    const [resultado] = variacoesAposConflito([nova], [], [], undefined);
    expect(resultado?.stockIncrement).toBe(3);
  });

  it("herdada, com saldo: passa a valer o saldo do banco", () => {
    const nova = variacao("temp-1", {
      stockIncrement: 3,
      [ESTOQUE_HERDADO]: true,
    });
    const [resultado] = variacoesAposConflito([nova], [], [], 9);
    expect(resultado?.stockIncrement).toBe(9);
  });

  it("digitada à mão (não herdada): o estoque que ela digitou fica, haja saldo ou não", () => {
    const nova = variacao("temp-1", { stockIncrement: 3 });
    const [resultado] = variacoesAposConflito([nova], [], [], 9);
    expect(resultado?.stockIncrement).toBe(3);
  });
});

describe("variacoesAposConflito — id que a abertura não conhecia", () => {
  it("na tela e no banco, fora da abertura: entra uma vez, com o estoque do banco, sem erro", () => {
    const naTela = variacao("v9", { name: "Estampa", stockIncrement: 2 });
    const noBanco = variacao("v9", { name: "Estampa", stockIncrement: 5 });
    const resultado = variacoesAposConflito([naTela], [], [noBanco]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({
      id: "v9",
      name: "Estampa",
      stockIncrement: 5,
    });
  });

  it("foto da variação que ela não mexeu acompanha o banco; a que ela mexeu fica", () => {
    const antes = variacao("v1", { imageUrl: "a.jpg" });
    const tela = variacao("v1", { imageUrl: "a.jpg" });
    const banco = variacao("v1", { imageUrl: "b.jpg" });
    expect(variacoesAposConflito([tela], [antes], [banco])[0]?.imageUrl).toBe(
      "b.jpg",
    );

    const telaMexida = variacao("v1", { imageUrl: "minha.jpg" });
    expect(
      variacoesAposConflito([telaMexida], [antes], [banco])[0]?.imageUrl,
    ).toBe("minha.jpg");
  });
});
