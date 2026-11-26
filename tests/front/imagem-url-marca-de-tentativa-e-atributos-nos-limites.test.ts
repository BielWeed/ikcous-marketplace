// @vitest-environment jsdom
//
// Limites das funções que montam o endereço das fotos da vitrine e da galeria
// do produto (`src/lib/imageUrl.ts`), pegos pela caça por mutação de 24/11: os
// testes vizinhos só passavam pelo caminho feliz (uma foto do Supabase, uma
// nova tentativa). Aqui ficam as bordas que, se mudarem, quebram a foto da
// cliente sem nenhuma tela vermelha:
//
//  - a marca de nova tentativa (`_r=N`) só vale a partir da 1ª, só em http(s),
//    usa `&` quando o endereço já tem `?`, e preserva o descritor de largura
//    de cada candidata do `srcset`;
//  - o redimensionamento troca a query velha pela nova, arredonda a largura e
//    mantém `resize=contain` (sem ele o Supabase distorce a foto);
//  - a escada do `srcset` e o `src` padrão só existem quando há `sizes`;
//  - a "foto original" de socorro tenta UMA vez por endereço e solta o srcset.
import {
  atributosDeImagem,
  comMarcaDeTentativa,
  conjuntoComMarcaDeTentativa,
  conjuntoDeImagens,
  imagemRedimensionada,
  miniaturaDaSugestao,
  usarImagemOriginal,
} from "@/lib/imageUrl";
import { describe, expect, it } from "vitest";

const BASE =
  "https://gnjsrucsmjkajijrakzr.supabase.co/storage/v1/object/public/produtos/foto.jpg";
const REDIMENSIONADA =
  "https://gnjsrucsmjkajijrakzr.supabase.co/storage/v1/render/image/public/produtos/foto.jpg";

describe("comMarcaDeTentativa", () => {
  it("a tentativa 0 (o pedido original) e as negativas voltam intactas", () => {
    expect(comMarcaDeTentativa("https://cdn.exemplo/a.jpg", 0)).toBe(
      "https://cdn.exemplo/a.jpg",
    );
    expect(comMarcaDeTentativa("https://cdn.exemplo/a.jpg", -1)).toBe(
      "https://cdn.exemplo/a.jpg",
    );
  });

  it("a partir da 1ª marca com `?`, ou com `&` se o endereço já tem query", () => {
    expect(comMarcaDeTentativa("https://cdn.exemplo/a.jpg", 1)).toBe(
      "https://cdn.exemplo/a.jpg?_r=1",
    );
    expect(comMarcaDeTentativa("https://cdn.exemplo/a.jpg?w=2", 3)).toBe(
      "https://cdn.exemplo/a.jpg?w=2&_r=3",
    );
  });

  it("marca http simples e protocolo em maiúsculas", () => {
    expect(comMarcaDeTentativa("http://cdn.exemplo/a.jpg", 1)).toBe(
      "http://cdn.exemplo/a.jpg?_r=1",
    );
    expect(comMarcaDeTentativa("HTTPS://cdn.exemplo/a.jpg", 2)).toBe(
      "HTTPS://cdn.exemplo/a.jpg?_r=2",
    );
  });

  it("data:, blob: e caminho relativo nunca são marcados (um `?` no meio corromperia a imagem)", () => {
    for (const url of [
      "data:image/png;base64,AAAA",
      "blob:https://loja.exemplo/1234",
      "/fotos/a.jpg",
      "",
    ]) {
      expect(comMarcaDeTentativa(url, 4)).toBe(url);
    }
  });
});

describe("conjuntoComMarcaDeTentativa", () => {
  it("sem srcset (ausente ou vazio) devolve o que veio", () => {
    expect(conjuntoComMarcaDeTentativa(undefined, 2)).toBeUndefined();
    expect(conjuntoComMarcaDeTentativa("", 2)).toBe("");
  });

  it("tentativa 0 devolve o texto recebido, letra por letra (inclusive o espaçamento)", () => {
    const irregular = "https://a.exemplo/x 480w,https://a.exemplo/y   960w";
    expect(conjuntoComMarcaDeTentativa(irregular, 0)).toBe(irregular);
  });

  it("tentativa 0 não mexe no srcset", () => {
    const conjunto =
      "https://a.exemplo/x?w=1 480w, https://a.exemplo/x?w=2 960w";
    expect(conjuntoComMarcaDeTentativa(conjunto, 0)).toBe(conjunto);
  });

  it("marca cada candidata, mantém o descritor de largura e a vírgula com espaço", () => {
    expect(
      conjuntoComMarcaDeTentativa(
        "https://a.exemplo/x?w=1 480w, https://a.exemplo/x?w=2 960w",
        2,
      ),
    ).toBe(
      "https://a.exemplo/x?w=1&_r=2 480w, https://a.exemplo/x?w=2&_r=2 960w",
    );
  });

  it("candidata sem descritor e candidata de densidade (1x) também funcionam", () => {
    expect(conjuntoComMarcaDeTentativa("https://a.exemplo/x", 1)).toBe(
      "https://a.exemplo/x?_r=1",
    );
    expect(
      conjuntoComMarcaDeTentativa(
        "https://a.exemplo/x 1x, https://a.exemplo/y 2x",
        1,
      ),
    ).toBe("https://a.exemplo/x?_r=1 1x, https://a.exemplo/y?_r=1 2x");
  });
});

describe("imagemRedimensionada", () => {
  it("troca o caminho, pede `resize=contain` e usa qualidade 75 por padrão", () => {
    expect(imagemRedimensionada(BASE, { width: 480 })).toBe(
      `${REDIMENSIONADA}?width=480&resize=contain&quality=75`,
    );
  });

  it("a qualidade pedida vale", () => {
    expect(imagemRedimensionada(BASE, { width: 480, quality: 60 })).toBe(
      `${REDIMENSIONADA}?width=480&resize=contain&quality=60`,
    );
  });

  it("a query velha do endereço sai (não vai duas queries na URL)", () => {
    const resultado = imagemRedimensionada(`${BASE}?v=2&_r=1`, { width: 320 });
    expect(resultado).toBe(
      `${REDIMENSIONADA}?width=320&resize=contain&quality=75`,
    );
    expect(resultado.match(/\?/g)).toHaveLength(1);
  });

  it("a largura fracionada é arredondada", () => {
    expect(imagemRedimensionada(BASE, { width: 320.6 })).toContain(
      "width=321&",
    );
    expect(imagemRedimensionada(BASE, { width: 320.4 })).toContain(
      "width=320&",
    );
  });

  it("endereço de fora, data:, vazio, nulo e indefinido voltam como estão (ou vazios)", () => {
    expect(
      imagemRedimensionada("https://cdn.exemplo/a.jpg", { width: 200 }),
    ).toBe("https://cdn.exemplo/a.jpg");
    expect(
      imagemRedimensionada("data:image/png;base64,AA", { width: 200 }),
    ).toBe("data:image/png;base64,AA");
    expect(imagemRedimensionada("", { width: 200 })).toBe("");
    expect(imagemRedimensionada(null, { width: 200 })).toBe("");
    expect(imagemRedimensionada(undefined, { width: 200 })).toBe("");
  });

  it("a miniatura da sugestão da busca é 120 px com qualidade 70", () => {
    expect(miniaturaDaSugestao(BASE)).toBe(
      `${REDIMENSIONADA}?width=120&resize=contain&quality=70`,
    );
    expect(miniaturaDaSugestao(undefined)).toBe("");
  });
});

describe("conjuntoDeImagens", () => {
  it("uma candidata por largura, separadas por vírgula e espaço", () => {
    expect(conjuntoDeImagens(BASE, [320, 640], 80)).toBe(
      `${REDIMENSIONADA}?width=320&resize=contain&quality=80 320w, ${REDIMENSIONADA}?width=640&resize=contain&quality=80 640w`,
    );
  });

  it("endereço que não se transforma (fora do Supabase, vazio, nulo) dá texto vazio", () => {
    expect(conjuntoDeImagens("https://cdn.exemplo/a.jpg", [320, 640])).toBe("");
    expect(conjuntoDeImagens("", [320])).toBe("");
    expect(conjuntoDeImagens(null, [320])).toBe("");
    expect(conjuntoDeImagens(undefined, [320])).toBe("");
  });

  it("lista de larguras vazia dá texto vazio", () => {
    expect(conjuntoDeImagens(BASE, [])).toBe("");
  });
});

describe("atributosDeImagem", () => {
  it("sem `sizes`: o endereço puro e nada de srcset", () => {
    expect(atributosDeImagem(BASE, {})).toEqual({
      src: BASE,
      srcSet: undefined,
      sizes: undefined,
    });
  });

  it("`sizes` vazio conta como ausente", () => {
    expect(atributosDeImagem(BASE, { sizes: "" })).toEqual({
      src: BASE,
      srcSet: undefined,
      sizes: undefined,
    });
  });

  it("com `sizes`: src de 640 px, escada de 6 larguras e o sizes igual ao pedido", () => {
    const atributos = atributosDeImagem(BASE, { sizes: "100vw" });
    expect(atributos.src).toBe(
      `${REDIMENSIONADA}?width=640&resize=contain&quality=75`,
    );
    expect(atributos.sizes).toBe("100vw");
    const larguras = (atributos.srcSet ?? "")
      .split(", ")
      .map((c) => c.split(" ")[1]);
    expect(larguras).toEqual(["200w", "320w", "480w", "640w", "960w", "1280w"]);
  });

  it("a qualidade pedida chega ao src e ao srcset", () => {
    const atributos = atributosDeImagem(BASE, { sizes: "100vw", quality: 50 });
    expect(atributos.src).toContain("quality=50");
    expect(atributos.srcSet).not.toContain("quality=75");
    expect(atributos.srcSet).toContain("width=1280&resize=contain&quality=50");
  });

  it("foto de fora com `sizes`: o endereço volta e o srcset fica vazio", () => {
    expect(
      atributosDeImagem("https://cdn.exemplo/a.jpg", { sizes: "100vw" }),
    ).toEqual({
      src: "https://cdn.exemplo/a.jpg",
      srcSet: "",
      sizes: "100vw",
    });
  });
});

describe("usarImagemOriginal", () => {
  const imagem = (src: string, srcset = "") => {
    const img = document.createElement("img");
    img.src = src;
    if (srcset) img.srcset = srcset;
    return img;
  };

  it("sem endereço original não há o que tentar", () => {
    const img = imagem(REDIMENSIONADA);
    expect(usarImagemOriginal(img, null)).toBe(false);
    expect(usarImagemOriginal(img, undefined)).toBe(false);
    expect(usarImagemOriginal(img, "")).toBe(false);
    expect(img.src).toBe(REDIMENSIONADA);
  });

  it("a imagem já está no original e sem srcset: nada a trocar", () => {
    const img = imagem(BASE);
    expect(usarImagemOriginal(img, BASE)).toBe(false);
  });

  it("a imagem já está no original mas ainda tem srcset: solta o srcset e tenta", () => {
    const img = imagem(BASE, `${REDIMENSIONADA}?width=480 480w`);
    expect(usarImagemOriginal(img, BASE)).toBe(true);
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.src).toBe(BASE);
  });

  it("troca o src, tira o atributo srcset e só tenta UMA vez por endereço", () => {
    const img = imagem(REDIMENSIONADA, `${REDIMENSIONADA}?width=480 480w`);
    expect(usarImagemOriginal(img, BASE)).toBe(true);
    expect(img.src).toBe(BASE);
    expect(img.hasAttribute("srcset")).toBe(false);

    img.src = REDIMENSIONADA; // falhou de novo
    expect(usarImagemOriginal(img, BASE)).toBe(false);
    expect(img.src).toBe(REDIMENSIONADA);
  });

  it("outro endereço original (nova tentativa com marca `_r=1`) ganha a sua própria vez", () => {
    const img = imagem(REDIMENSIONADA);
    expect(usarImagemOriginal(img, BASE)).toBe(true);
    img.src = REDIMENSIONADA;
    expect(usarImagemOriginal(img, `${BASE}?_r=1`)).toBe(true);
    expect(img.src).toBe(`${BASE}?_r=1`);
  });
});
