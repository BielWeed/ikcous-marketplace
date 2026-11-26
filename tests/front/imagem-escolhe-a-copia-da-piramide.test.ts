// @vitest-environment jsdom
//
// A foto MARCADA (subiu com as 3 cópias 240/480/960) é servida pela cópia do
// tamanho certo na loja em projeto gratuito (sem `/render/`), 26/11/2026.
//
// Ordem de precedência (plano das miniaturas):
//   1. projeto que TRANSFORMA (Savy, Pro): continua no `/render/`, marcada ou não;
//   2. foto marcada: a menor cópia que cobre a largura pedida;
//   3. o resto: o original, exatamente como hoje.
// E o cartaz do porteiro NÃO muda para a loja grátis: ele só imprime endereço
// do `/render/`, então foto marcada de loja grátis continua sem cartaz.
import { lojaRedimensionaFoto, montarCartaz } from "@/hospedagem/cartaz";
import {
  atributosDeImagem,
  conjuntoDeImagens,
  imagemRedimensionada,
  miniaturaDaSugestao,
} from "@/lib/imageUrl";
import { IMAGEM_DO_BANNER } from "@/lib/imagem-do-banner";
import { describe, expect, it } from "vitest";

const LOJA_GRATIS = "https://novalojagratisaaaaaa.supabase.co";
const LOJA_MEDIDA = "https://gnjsrucsmjkajijrakzr.supabase.co";
const UUID = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";
const PASTA = `${LOJA_GRATIS}/storage/v1/object/public/products/`;
const MARCADA = `${PASTA}${UUID}-vw.jpg`;
const C240 = `${PASTA}${UUID}-240.webp`;
const C480 = `${PASTA}${UUID}-480.webp`;
const C960 = `${PASTA}${UUID}-960.webp`;
const BANNER_MARCADO =
  "/storage/v1/object/public/banners/1791565996435-7tdkqgfb019-vw.png";

describe("loja grátis, foto marcada: a cópia do tamanho certo", () => {
  it.each([
    [1, C240],
    [120, C240],
    [240, C240],
    [241, C480],
    [340, C480],
    [480, C480],
    [481, C960],
    [640, C960],
    [960, C960],
  ])("largura %i pede %s", (largura, esperada) => {
    expect(imagemRedimensionada(MARCADA, { width: largura })).toBe(esperada);
  });

  it("largura acima da maior cópia: o original (nunca menos do que foi pedido)", () => {
    expect(imagemRedimensionada(MARCADA, { width: 961 })).toBe(MARCADA);
    expect(imagemRedimensionada(MARCADA, { width: 1280 })).toBe(MARCADA);
  });

  it("a miniatura da busca é a cópia de 240", () => {
    expect(miniaturaDaSugestao(MARCADA)).toBe(C240);
  });

  it("srcSet oferece as 3 cópias com o lado de cada uma", () => {
    expect(conjuntoDeImagens(MARCADA, [480, 640, 960, 1280])).toBe(
      `${C240} 240w, ${C480} 480w, ${C960} 960w`,
    );
  });

  it("atributosDeImagem com sizes: src na cópia de 960 e srcSet das cópias", () => {
    expect(atributosDeImagem(MARCADA, { sizes: "100vw" })).toEqual({
      src: C960,
      srcSet: `${C240} 240w, ${C480} 480w, ${C960} 960w`,
      sizes: "100vw",
    });
  });

  it("atributosDeImagem SEM sizes continua no original (como hoje)", () => {
    expect(atributosDeImagem(MARCADA, {})).toEqual({
      src: MARCADA,
      srcSet: undefined,
      sizes: undefined,
    });
  });

  it("cópias JPEG (marca j) para o navegador que não grava WebP", () => {
    const marcadaJ = `${PASTA}${UUID}-vj.png`;
    expect(imagemRedimensionada(marcadaJ, { width: 300 })).toBe(
      `${PASTA}${UUID}-480.jpg`,
    );
  });
});

describe("na dúvida, o original (comportamento de hoje)", () => {
  it.each([
    ["foto sem marca", `${PASTA}${UUID}.jpg`],
    ["marcada com consulta", `${MARCADA}?v=2`],
    ["marcada com fragmento", `${MARCADA}#x`],
    ["backup", `${PASTA}backup/${UUID}-vw.jpg`],
    ["cópia antiga", `${PASTA}${UUID}_copia_${UUID}.jpg`],
    [
      "outro host",
      `https://cdn.exemplo.com/storage/v1/object/public/products/${UUID}-vw.jpg`,
    ],
  ])("%s: volta intacta, sem srcSet", (_caso, url) => {
    expect(imagemRedimensionada(url, { width: 340 })).toBe(url);
    expect(conjuntoDeImagens(url, [320, 640])).toBe("");
    expect(atributosDeImagem(url, { sizes: "100vw" })).toEqual({
      src: url,
      srcSet: "",
      sizes: "100vw",
    });
  });
});

describe("projeto que transforma: a transformação vence a marca", () => {
  const marcadaSavy = `${LOJA_MEDIDA}/storage/v1/object/public/products/${UUID}-vw.jpg`;

  it("continua no /render/ com a largura pedida", () => {
    expect(imagemRedimensionada(marcadaSavy, { width: 340 })).toBe(
      `${LOJA_MEDIDA}/storage/v1/render/image/public/products/${UUID}-vw.jpg?width=340&resize=contain&quality=75`,
    );
    expect(conjuntoDeImagens(marcadaSavy, [320])).toContain("/render/image/");
    expect(conjuntoDeImagens(marcadaSavy, [320])).not.toContain("-240.webp");
  });

  it("o cartaz da loja medida continua saindo com o banner marcado", () => {
    const cartaz = montarCartaz(
      {
        id: "b1",
        image_url: `${LOJA_MEDIDA}${BANNER_MARCADO}`,
        position: "home_top",
        active: true,
        order: 1,
      },
      LOJA_MEDIDA,
    );
    expect(cartaz?.html).toContain(
      `${LOJA_MEDIDA}/storage/v1/render/image/public/banners/`,
    );
  });
});

describe("o cartaz do porteiro não muda para a loja grátis", () => {
  it("a loja grátis continua sem cartaz (a sonda x.webp não tem marca)", () => {
    expect(lojaRedimensionaFoto(LOJA_GRATIS)).toBe(false);
  });

  it("nem com o banner do topo marcado: o cartaz só aceita endereço do /render/", () => {
    expect(
      atributosDeImagem(`${LOJA_GRATIS}${BANNER_MARCADO}`, IMAGEM_DO_BANNER)
        .srcSet,
    ).not.toBe("");
    expect(
      montarCartaz(
        {
          id: "b1",
          image_url: `${LOJA_GRATIS}${BANNER_MARCADO}`,
          position: "home_top",
          active: true,
          order: 1,
        },
        LOJA_GRATIS,
      ),
    ).toBeNull();
  });
});
