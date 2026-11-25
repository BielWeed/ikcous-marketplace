// Duas regras do frete que decidem dinheiro e configuração da loja:
//  1. a opção de frete marcada confere com a cotação da tela pelo preço em
//     CENTAVOS (arredondado), nunca pelo ponto flutuante cru nem cortando para
//     baixo: R$ 0,57 e R$ 0,5700000000000001 são o MESMO preço, e meio centavo
//     é um centavo a mais;
//  2. a lista gravada de métodos de envio liga/desliga só a chave da retirada e
//     devolve o resto intacto, na mesma ordem.
import { describe, expect, it } from "vitest";

import {
  chavesDeTransportadoraDaLista,
  conferirFreteEscolhidoComACotacao,
  listaComRetirada,
} from "@/lib/guarda-de-frete";

interface Opcao {
  readonly id: string;
  readonly price: number;
}

const opcao = (price: number, id = "frete-a"): Opcao => ({ id, price });

describe("conferirFreteEscolhidoComACotacao: o preço é comparado em centavos", () => {
  it("mesmo id e mesmo preço: confere", () => {
    expect(
      conferirFreteEscolhidoComACotacao(opcao(12.9), [opcao(12.9)]),
    ).toEqual({ tipo: "confere" });
  });

  it("ruído de ponto flutuante abaixo do centavo não é preço novo (0,57 contra 0,5700000000000001)", () => {
    expect(0.57 * 100).toBeLessThan(57);
    expect(0.5700000000000001 * 100).toBeGreaterThan(57);

    expect(
      conferirFreteEscolhidoComACotacao(opcao(0.57), [
        opcao(0.5700000000000001),
      ]),
    ).toEqual({ tipo: "confere" });
    expect(
      conferirFreteEscolhidoComACotacao(opcao(0.5700000000000001), [
        opcao(0.57),
      ]),
    ).toEqual({ tipo: "confere" });
  });

  it("diferença menor que meio centavo não muda o preço (0,12 contra 0,1249)", () => {
    expect(
      conferirFreteEscolhidoComACotacao(opcao(0.12), [opcao(0.1249)]),
    ).toEqual({ tipo: "confere" });
  });

  it("meio centavo já é um centavo a mais: 0,12 contra 0,125 mudou", () => {
    const fresca = opcao(0.125);

    expect(conferirFreteEscolhidoComACotacao(opcao(0.12), [fresca])).toEqual({
      tipo: "preco-mudou",
      fresca,
    });
  });

  it("um centavo de diferença mudou, e devolve a opção fresca da cotação", () => {
    const fresca = opcao(25.91);

    const conferencia = conferirFreteEscolhidoComACotacao(opcao(25.9), [
      opcao(8, "outra"),
      fresca,
    ]);

    expect(conferencia).toEqual({ tipo: "preco-mudou", fresca });
    expect(conferencia.tipo === "preco-mudou" && conferencia.fresca).toBe(
      fresca,
    );
  });

  it("id fora da cotação sumiu; preço que não é número também", () => {
    expect(
      conferirFreteEscolhidoComACotacao(opcao(10), [opcao(10, "outra")]),
    ).toEqual({ tipo: "sumiu" });
    expect(
      conferirFreteEscolhidoComACotacao(opcao(10), [
        { id: "frete-a", price: "10" },
        { id: "frete-a", price: Number.NaN },
      ]),
    ).toEqual({ tipo: "sumiu" });
  });

  it("sem lista legível não há evidência, e não bloqueia", () => {
    for (const lista of [undefined, null, [], "x", {}]) {
      expect(conferirFreteEscolhidoComACotacao(opcao(10), lista)).toEqual({
        tipo: "sem-evidencia",
      });
    }
  });
});

describe("listaComRetirada e chavesDeTransportadoraDaLista", () => {
  it("ligar a retirada acrescenta a chave no fim, sem repetir e sem mexer no resto", () => {
    expect(listaComRetirada(["pac", "frenet-x"], true)).toEqual([
      "pac",
      "frenet-x",
      "store-pickup",
    ]);
    expect(listaComRetirada(["pac", "store-pickup", "sedex"], true)).toEqual([
      "pac",
      "sedex",
      "store-pickup",
    ]);
  });

  it("desligar a retirada tira só a chave dela, na mesma ordem", () => {
    expect(listaComRetirada(["sedex", "store-pickup", "pac"], false)).toEqual([
      "sedex",
      "pac",
    ]);
  });

  it("sem lista gravada vale o padrão sedex + pac (não 'todas as transportadoras')", () => {
    expect(listaComRetirada(null, true)).toEqual([
      "sedex",
      "pac",
      "store-pickup",
    ]);
    expect(listaComRetirada(undefined, false)).toEqual(["sedex", "pac"]);
  });

  it("as chaves de transportadora são a lista sem a retirada, na mesma ordem", () => {
    expect(
      chavesDeTransportadoraDaLista(["sedex", "store-pickup", "frenet-x"]),
    ).toEqual(["sedex", "frenet-x"]);
    expect(chavesDeTransportadoraDaLista(["store-pickup"])).toEqual([]);
  });

  it("sem lista gravada não há chave de transportadora, e nada quebra", () => {
    expect(chavesDeTransportadoraDaLista(null)).toEqual([]);
    expect(chavesDeTransportadoraDaLista(undefined)).toEqual([]);
  });
});
