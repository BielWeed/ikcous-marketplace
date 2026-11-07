// r46-e: a regra comum das duas prévias de link (Vercel e Cloudflare). O preço
// anunciado é o de vitrine; qualquer coisa que não dê para ler cai no preço-base.
import { describe, expect, it } from "vitest";
import {
  montarConsultaDeVariacoes,
  precoDaPrevia,
} from "../../src/hospedagem/precoDaPrevia";

const linha = (extra: Record<string, unknown> = {}) => ({
  name: "Tamanho",
  active: true,
  stock_increment: 5,
  price_override: null,
  ...extra,
});

describe("montarConsultaDeVariacoes", () => {
  it("lê só as quatro colunas da regra de preço, do produto pedido, com o id codificado", () => {
    expect(montarConsultaDeVariacoes("https://x.supabase.co", "abc")).toBe(
      "https://x.supabase.co/rest/v1/product_variants?product_id=eq.abc&select=name,active,stock_increment,price_override",
    );
    // Sem a codificação, "1&select=*" injetaria parâmetros na consulta.
    expect(
      montarConsultaDeVariacoes("https://x.supabase.co", "1&select=*"),
    ).toBe(
      "https://x.supabase.co/rest/v1/product_variants?product_id=eq.1%26select%3D*&select=name,active,stock_increment,price_override",
    );
  });
});

describe("precoDaPrevia", () => {
  it("base 50, P a 40 e G a 90 com estoque -> 40 (o menor à venda)", () => {
    expect(
      precoDaPrevia(50, [
        linha({ price_override: 40 }),
        linha({ price_override: 90 }),
      ]),
    ).toBe(40);
  });

  it("opção esgotada ou desativada não puxa o preço", () => {
    expect(
      precoDaPrevia(50, [
        linha({ price_override: 40, stock_increment: 0 }),
        linha({ price_override: 30, active: false }),
        linha({ price_override: 90 }),
      ]),
    ).toBe(90);
  });

  it("opção sem preço próprio vale o preço-base; preço próprio ZERO é preço válido (brinde)", () => {
    expect(precoDaPrevia(50, [linha(), linha({ price_override: 70 })])).toBe(
      50,
    );
    expect(precoDaPrevia(50, [linha({ price_override: 0 })])).toBe(0);
  });

  it("tudo esgotado: ainda anuncia o menor preço entre as opções ativas (o card mostra 'Esgotado' por cima)", () => {
    expect(
      precoDaPrevia(50, [
        linha({ price_override: 40, stock_increment: 0 }),
        linha({ price_override: 90, stock_increment: 0 }),
      ]),
    ).toBe(40);
  });

  it("traduz a linha como o app: active ausente = ativa, estoque como texto numérico, nome ausente = Padrão", () => {
    expect(
      precoDaPrevia(50, [
        { price_override: "35.5", stock_increment: "3" },
        { name: "", price_override: 20, stock_increment: 0 },
      ]),
    ).toBe(35.5);
  });

  it.each([
    ["null (consulta falhou)", null],
    ["undefined", undefined],
    ["objeto no lugar da lista", { code: "42501" }],
    ["texto", "[]"],
    ["lista vazia", []],
    ["lista só de lixo", [null, 3, "x"]],
  ])("%s -> o próprio preço-base", (_, entrada) => {
    expect(precoDaPrevia(50, entrada)).toBe(50);
  });

  it("linhas boas misturadas com lixo: o lixo é ignorado", () => {
    expect(precoDaPrevia(50, [null, linha({ price_override: 40 }), "x"])).toBe(
      40,
    );
  });

  it("preço-base inválido sem preço próprio nas opções devolve não-número (o chamador não exibe preço)", () => {
    expect(Number.isFinite(precoDaPrevia(Number.NaN, [linha()]))).toBe(false);
  });
});
