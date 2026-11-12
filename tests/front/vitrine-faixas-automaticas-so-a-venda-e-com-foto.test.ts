// As três faixas AUTOMÁTICAS da Home (Últimos Lançamentos, Ofertas Imperdíveis,
// Destaques em Alta) só mostram produto que a cliente consegue comprar E que tem
// foto de verdade. Esgotado e sem foto seguem no Catálogo e na busca; faixa
// montada à mão não passa por aqui. A loja e a prévia do painel chamam estas
// MESMAS funções (src/lib/vitrine-do-painel.ts).
import {
  destaquesDaVitrine,
  foraDaFaixaAutomatica,
  fraseDoQueFicouFora,
  lancamentosDaVitrine,
  ofertasDaVitrine,
  produtosAVenda,
} from "@/lib/vitrine-do-painel";
import type { Product } from "@/types";
import { describe, expect, it } from "vitest";

const FOTO = "https://cdn.exemplo/foto.jpg";
const GENERICA = "https://placehold.co/600x400?text=Sem+Imagem";

function prod(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name: id,
    price: 100,
    stock: 5,
    images: [FOTO],
    isActive: true,
    isBestseller: false,
    variants: [],
    createdTime: 1000,
    ...extra,
  } as unknown as Product;
}

const ids = (lista: readonly { id: string }[]) => lista.map((p) => p.id);

describe("faixas automáticas — só produto à venda e com foto real", () => {
  it("(1) loja com todos à venda e com foto: as três faixas são as de hoje", () => {
    const loja = [
      prod("a", { createdTime: 1, originalPrice: 150, isBestseller: true }),
      prod("b", { createdTime: 3, originalPrice: 150, isBestseller: true }),
      prod("c", { createdTime: 2, originalPrice: 150, isBestseller: true }),
    ];
    expect(ids(lancamentosDaVitrine(loja))).toEqual(["b", "c", "a"]);
    expect(ids(ofertasDaVitrine(loja))).toEqual(["b", "c", "a"]);
    expect(ids(destaquesDaVitrine(loja))).toEqual(["b", "c", "a"]);
  });

  it("(2) um esgotado entre três: Lançamentos mostra dois; o esgotado fica fora da faixa", () => {
    const loja = [
      prod("a", { createdTime: 1 }),
      prod("esgotado", { createdTime: 9, stock: 0 }),
      prod("c", { createdTime: 2 }),
    ];
    expect(ids(lancamentosDaVitrine(loja))).toEqual(["c", "a"]);
    // O Catálogo não passa por aqui: o esgotado continua na lista inteira.
    expect(ids(produtosAVenda(loja))).toContain("esgotado");
  });

  it("(3) tudo esgotado: nenhuma faixa automática tem produto", () => {
    const loja = [
      prod("a", { stock: 0, originalPrice: 150, isBestseller: true }),
      prod("b", { stock: 0, originalPrice: 150, isBestseller: true }),
      prod("c", { stock: 0, originalPrice: 150, isBestseller: true }),
    ];
    expect(lancamentosDaVitrine(loja)).toEqual([]);
    expect(ofertasDaVitrine(loja)).toEqual([]);
    expect(destaquesDaVitrine(loja)).toEqual([]);
    expect(produtosAVenda(loja)).toHaveLength(3);
  });

  it("(4) cor em estoque mas todos os tamanhos zerados: fica fora (igual ao botão Esgotado)", () => {
    const semTamanho = prod("sem-tamanho", {
      stock: 8,
      variants: [
        {
          id: "v1",
          name: "Cor",
          value: "Azul",
          active: true,
          stockIncrement: 8,
        },
        {
          id: "v2",
          name: "Tamanho",
          value: "P",
          active: true,
          stockIncrement: 0,
        },
        {
          id: "v3",
          name: "Tamanho",
          value: "M",
          active: true,
          stockIncrement: 0,
        },
      ] as unknown as Product["variants"],
    });
    const completo = prod("completo", {
      variants: [
        {
          id: "w1",
          name: "Cor",
          value: "Azul",
          active: true,
          stockIncrement: 2,
        },
        {
          id: "w2",
          name: "Tamanho",
          value: "P",
          active: true,
          stockIncrement: 2,
        },
      ] as unknown as Product["variants"],
    });
    expect(ids(lancamentosDaVitrine([semTamanho, completo]))).toEqual([
      "completo",
    ]);
  });

  it("(5) sem foto, ou só com a imagem cinza 'Sem Imagem': fora das três faixas", () => {
    const loja = [
      prod("sem-lista", {
        images: [],
        originalPrice: 150,
        isBestseller: true,
      }),
      prod("generica", {
        images: [GENERICA],
        originalPrice: 150,
        isBestseller: true,
      }),
      prod("vazia", {
        images: ["  "],
        originalPrice: 150,
        isBestseller: true,
      }),
      prod("boa", { originalPrice: 150, isBestseller: true }),
    ];
    expect(ids(lancamentosDaVitrine(loja))).toEqual(["boa"]);
    expect(ids(ofertasDaVitrine(loja))).toEqual(["boa"]);
    expect(ids(destaquesDaVitrine(loja))).toEqual(["boa"]);
    expect(ids(produtosAVenda(loja))).toHaveLength(4);
  });

  it("(5b) foto real depois da genérica na lista vale (a primeira real conta)", () => {
    const misto = prod("misto", { images: [GENERICA, FOTO] });
    expect(ids(lancamentosDaVitrine([misto]))).toEqual(["misto"]);
  });

  it("(6) o esgotado que recebe estoque volta; o destaque que esgota sai e volta ao repor", () => {
    const antes = [
      prod("x", { stock: 0, isBestseller: true }),
      prod("y", { isBestseller: true }),
    ];
    expect(ids(lancamentosDaVitrine(antes))).toEqual(["y"]);
    expect(ids(destaquesDaVitrine(antes))).toEqual(["y"]);
    const depois = [prod("x", { isBestseller: true }), antes[1]];
    expect(ids(destaquesDaVitrine(depois))).toEqual(["x", "y"]);
    const esgotou = [prod("x", { stock: 0, isBestseller: true }), antes[1]];
    expect(ids(destaquesDaVitrine(esgotou))).toEqual(["y"]);
  });

  it("(8) lançamento em oferta e destaque continua nas TRÊS faixas (repetição intacta)", () => {
    const todos = [prod("p", { originalPrice: 150, isBestseller: true })];
    expect(ids(lancamentosDaVitrine(todos))).toEqual(["p"]);
    expect(ids(ofertasDaVitrine(todos))).toEqual(["p"]);
    expect(ids(destaquesDaVitrine(todos))).toEqual(["p"]);
  });

  it("Ofertas continua exigindo o 'De' maior que o preço de vitrine; Destaques, a marca", () => {
    const loja = [
      prod("sem-oferta"),
      prod("oferta", { originalPrice: 150 }),
      prod("de-menor", { originalPrice: 80 }),
      prod("destaque", { isBestseller: true }),
    ];
    expect(ids(ofertasDaVitrine(loja))).toEqual(["oferta"]);
    expect(ids(destaquesDaVitrine(loja))).toEqual(["destaque"]);
  });

  it("lista vazia: nada em nenhuma faixa e nada de fora", () => {
    expect(lancamentosDaVitrine([])).toEqual([]);
    expect(foraDaFaixaAutomatica("ofertas", [])).toEqual({
      esgotados: 0,
      semFoto: 0,
    });
    expect(fraseDoQueFicouFora({ esgotados: 0, semFoto: 0 })).toBeNull();
  });
});

describe("a linha 'ficaram de fora desta faixa' da prévia do painel", () => {
  const loja = [
    prod("ok", { originalPrice: 150, isBestseller: true }),
    prod("esg1", { stock: 0, originalPrice: 150, isBestseller: true }),
    prod("esg2", { stock: 0, originalPrice: 150, isBestseller: true }),
    prod("foto", { images: [], originalPrice: 150, isBestseller: true }),
    // esgotado E sem foto: conta só no primeiro motivo (esgotado)
    prod("esg-sem-foto", {
      stock: 0,
      images: [GENERICA],
      originalPrice: 150,
      isBestseller: true,
    }),
    prod("fora-da-oferta", { stock: 0 }), // não é oferta: não conta em Ofertas
  ];

  it("conta por motivo, um produto no primeiro motivo aplicável", () => {
    expect(foraDaFaixaAutomatica("ofertas", loja)).toEqual({
      esgotados: 3,
      semFoto: 1,
    });
    expect(foraDaFaixaAutomatica("destaques", loja)).toEqual({
      esgotados: 3,
      semFoto: 1,
    });
    // Lançamentos: o candidato é qualquer produto à venda
    expect(foraDaFaixaAutomatica("lancamentos", loja)).toEqual({
      esgotados: 4,
      semFoto: 1,
    });
  });

  it("o que a prévia mostra + o que ficou de fora fecha com os candidatos da faixa", () => {
    const mostra = ofertasDaVitrine(loja).length;
    const fora = foraDaFaixaAutomatica("ofertas", loja);
    expect(mostra + fora.esgotados + fora.semFoto).toBe(5);
  });

  it("frase em pt-BR: singular, plural e 'sem foto' que não varia", () => {
    expect(fraseDoQueFicouFora({ esgotados: 2, semFoto: 1 })).toBe(
      "Ficaram de fora desta faixa: 2 esgotados, 1 sem foto",
    );
    expect(fraseDoQueFicouFora({ esgotados: 1, semFoto: 0 })).toBe(
      "Ficou de fora desta faixa: 1 esgotado",
    );
    expect(fraseDoQueFicouFora({ esgotados: 0, semFoto: 1 })).toBe(
      "Ficou de fora desta faixa: 1 sem foto",
    );
    expect(fraseDoQueFicouFora({ esgotados: 0, semFoto: 3 })).toBe(
      "Ficaram de fora desta faixa: 3 sem foto",
    );
    expect(fraseDoQueFicouFora({ esgotados: 1, semFoto: 1 })).toBe(
      "Ficaram de fora desta faixa: 1 esgotado, 1 sem foto",
    );
  });
});
