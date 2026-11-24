// @vitest-environment jsdom
//
// Caça de provas fracas (mutação) em `imageUrl`, 24/11/2026. Só duas telas
// exercitavam este módulo (o preload do banner e a imagem sem transformação) e
// onze trocas sobreviviam. As que doíam:
//
//  - a URL que já traz `?v=...` é limpa antes de pedir a transformação (sem
//    isso o endereço sai com DOIS `?` e o Storage devolve erro);
//  - `resize=contain` está SEMPRE no pedido (sem ele o Supabase mantém a
//    altura original e distorce a foto: width=200 devolvia 200x768);
//  - a largura é arredondada para inteiro, e a qualidade padrão é 75;
//  - a miniatura da busca é 120 px / 70, a mesma string que o aquecedor de
//    cache pede (se uma das duas mudar, o aquecimento deixa de servir a busca);
//  - a marca de "nova tentativa" só vale para http(s), em qualquer caixa, e não
//    mexe no srcSet na tentativa 0;
//  - `sizes` vazio não vira atributo; e o plano B da imagem original NÃO tenta
//    de novo uma original que já falhou (senão a tela entra em laço).
import {
  atributosDeImagem,
  comMarcaDeTentativa,
  conjuntoComMarcaDeTentativa,
  imagemRedimensionada,
  miniaturaDaSugestao,
  usarImagemOriginal,
} from "@/lib/imageUrl";
import { describe, expect, it } from "vitest";

// Projeto QUALQUER (não é o da IKCOUS, que não oferece transformação).
const ORIGINAL =
  "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/produtos/foto.jpg";
const TRANSFORMADA =
  "https://abcdefghijklmnopqrst.supabase.co/storage/v1/render/image/public/produtos/foto.jpg";

describe("imagemRedimensionada — o pedido de transformação", () => {
  it("monta largura, resize=contain e qualidade 75 por padrão", () => {
    expect(imagemRedimensionada(ORIGINAL, { width: 640 })).toBe(
      `${TRANSFORMADA}?width=640&resize=contain&quality=75`,
    );
  });

  it("respeita a qualidade pedida", () => {
    expect(imagemRedimensionada(ORIGINAL, { width: 640, quality: 40 })).toBe(
      `${TRANSFORMADA}?width=640&resize=contain&quality=40`,
    );
  });

  it("arredonda a largura para inteiro (340,5 vira 341; 340,4 vira 340)", () => {
    expect(imagemRedimensionada(ORIGINAL, { width: 340.5 })).toContain(
      "?width=341&",
    );
    expect(imagemRedimensionada(ORIGINAL, { width: 340.4 })).toContain(
      "?width=340&",
    );
  });

  it("descarta a query que a URL já trazia (versão, cache) em vez de empilhar dois '?'", () => {
    const pedido = imagemRedimensionada(`${ORIGINAL}?v=3`, { width: 640 });

    expect(pedido).toBe(`${TRANSFORMADA}?width=640&resize=contain&quality=75`);
    expect(pedido.match(/\?/g)).toHaveLength(1);
  });

  it("a miniatura da sugestão da busca é 120 px com qualidade 70", () => {
    expect(miniaturaDaSugestao(ORIGINAL)).toBe(
      `${TRANSFORMADA}?width=120&resize=contain&quality=70`,
    );
  });
});

describe("marca de nova tentativa (_r=N)", () => {
  it("só marca http(s), em qualquer caixa do esquema", () => {
    expect(comMarcaDeTentativa("HTTPS://loja.com/a.png", 2)).toBe(
      "HTTPS://loja.com/a.png?_r=2",
    );
    expect(comMarcaDeTentativa("http://loja.com/a.png?x=1", 1)).toBe(
      "http://loja.com/a.png?x=1&_r=1",
    );
  });

  it("data: e blob: voltam intactos, e a tentativa 0 (ou negativa) nunca marca", () => {
    expect(comMarcaDeTentativa("data:image/png;base64,AAAA", 3)).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(comMarcaDeTentativa("blob:https://loja.com/abc", 3)).toBe(
      "blob:https://loja.com/abc",
    );
    expect(comMarcaDeTentativa("https://loja.com/a.png", 0)).toBe(
      "https://loja.com/a.png",
    );
    expect(comMarcaDeTentativa("https://loja.com/a.png", -1)).toBe(
      "https://loja.com/a.png",
    );
  });

  it("no srcSet, marca cada candidata mantendo o descritor", () => {
    expect(
      conjuntoComMarcaDeTentativa(
        "https://a.com/1.png 320w, https://a.com/2.png 640w",
        2,
      ),
    ).toBe("https://a.com/1.png?_r=2 320w, https://a.com/2.png?_r=2 640w");
  });

  it("na tentativa 0 o srcSet volta EXATAMENTE como veio (sem reformatar)", () => {
    const original = "https://a.com/1.png 320w,https://a.com/2.png 640w";

    expect(conjuntoComMarcaDeTentativa(original, 0)).toBe(original);
    expect(conjuntoComMarcaDeTentativa(undefined, 2)).toBeUndefined();
    expect(conjuntoComMarcaDeTentativa("", 2)).toBe("");
  });
});

describe("atributosDeImagem", () => {
  it("sizes vazio não vira atributo: src é a URL pura e não há srcSet", () => {
    expect(atributosDeImagem(ORIGINAL, { sizes: "" })).toEqual({
      src: ORIGINAL,
      srcSet: undefined,
      sizes: undefined,
    });
  });

  it("com sizes, o src é a versão de 640 px e o srcSet traz a escada de larguras", () => {
    const atributos = atributosDeImagem(ORIGINAL, {
      sizes: "100vw",
      quality: 70,
    });

    expect(atributos.sizes).toBe("100vw");
    expect(atributos.src).toBe(
      `${TRANSFORMADA}?width=640&resize=contain&quality=70`,
    );
    expect(atributos.srcSet).toBe(
      [200, 320, 480, 640, 960, 1280]
        .map(
          (w) => `${TRANSFORMADA}?width=${w}&resize=contain&quality=70 ${w}w`,
        )
        .join(", "),
    );
  });
});

describe("usarImagemOriginal — plano B que não entra em laço", () => {
  it("imagem que JÁ está na original e sem srcset: não há o que trocar", () => {
    const img = document.createElement("img");
    img.src = ORIGINAL;

    expect(usarImagemOriginal(img, ORIGINAL)).toBe(false);
    expect(img.dataset.imagemOriginalTentada).toBeUndefined();
  });

  it("sem endereço original, não faz nada", () => {
    const img = document.createElement("img");
    img.src = `${TRANSFORMADA}?width=640`;

    expect(usarImagemOriginal(img, undefined)).toBe(false);
    expect(usarImagemOriginal(img, null)).toBe(false);
    expect(usarImagemOriginal(img, "")).toBe(false);
  });

  it("original que JÁ foi tentada e falhou não é tentada de novo, mesmo se a tela voltar à transformada", () => {
    const img = document.createElement("img");
    img.src = `${TRANSFORMADA}?width=640`;
    img.srcset = `${TRANSFORMADA}?width=320 320w`;

    expect(usarImagemOriginal(img, ORIGINAL)).toBe(true);
    expect(img.src).toBe(ORIGINAL);

    // A tela repõe a transformada e ela falha outra vez: a original já falhou.
    img.src = `${TRANSFORMADA}?width=640`;
    expect(usarImagemOriginal(img, ORIGINAL)).toBe(false);
    expect(img.src).toBe(`${TRANSFORMADA}?width=640`);
  });
});
