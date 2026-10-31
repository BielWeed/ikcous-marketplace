// Cartaz pre-impresso (lote B): a defesa em profundidade na SAIDA de
// `atributosDeImagem`. `montarCartaz` nao confia nem no que a funcao do app
// devolve: re-valida `src`, cada candidata do `srcset`, os descritores e o
// `sizes` antes de escrever HTML. Hoje a funcao real so devolve forma boa, entao
// estas guardas so aparecem com a funcao DUBLADA devolvendo o que um dia ela
// poderia devolver (um bug de `imageUrl.ts`, uma mudanca de formato).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { montarCartaz } from "@/hospedagem/cartaz";

const dublagem = vi.hoisted(() => ({
  saida: null as null | { src: string; srcSet: string; sizes: string },
}));

vi.mock("@/lib/imageUrl", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/imageUrl")>();
  return {
    ...real,
    atributosDeImagem: (...args: Parameters<typeof real.atributosDeImagem>) =>
      dublagem.saida ?? real.atributosDeImagem(...args),
  };
});

const LOJA = "https://lojaaaaaaaaaaaaaaaaa.supabase.co";
const OUTRA = "https://outraaaaaaaaaaaaaaaa.supabase.co";
const FOTO = `${LOJA}/storage/v1/object/public/banners/1791565996435-7tdkqgfb019.webp`;
const render = (origem: string, largura: number) =>
  `${origem}/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=${largura}&resize=contain&quality=70`;
const SRC_BOM = render(LOJA, 640);
const SRCSET_BOM = `${render(LOJA, 640)} 640w, ${render(LOJA, 960)} 960w`;

const linha = { id: "b1", image_url: FOTO, position: "home_top", active: true };

function com(saida: Partial<{ src: string; srcSet: string; sizes: string }>) {
  dublagem.saida = {
    src: SRC_BOM,
    srcSet: SRCSET_BOM,
    sizes: "100vw",
    ...saida,
  };
  return montarCartaz(linha, LOJA);
}

beforeEach(() => {
  dublagem.saida = null;
});

describe("montarCartaz re-valida a saida de atributosDeImagem", () => {
  it("controle: a saida boa dublada vira cartaz (as recusas abaixo sao por causa da guarda, nao do dubl)", () => {
    const cartaz = com({});
    expect(cartaz).not.toBeNull();
    expect(cartaz?.html).toContain(`src="${SRC_BOM.replaceAll("&", "&amp;")}"`);
  });

  it("src de OUTRA origem", () => {
    expect(com({ src: render(OUTRA, 640) })).toBeNull();
  });
  it("src que nao e a URL de render (ex.: a de `object`)", () => {
    expect(com({ src: FOTO })).toBeNull();
  });
  it("src com aspas e atributo pendurado", () => {
    expect(com({ src: `${SRC_BOM}" onerror="alert(1)` })).toBeNull();
    expect(com({ src: `${SRC_BOM}"><script>x</script>` })).toBeNull();
  });
  it("src com largura fora da forma", () => {
    expect(
      com({ src: render(LOJA, 640).replace("width=640", "width=abc") }),
    ).toBeNull();
  });

  it("srcset vazio (loja sem redimensionamento)", () => {
    expect(com({ srcSet: "" })).toBeNull();
  });
  it("candidata do srcset de OUTRA origem", () => {
    expect(
      com({ srcSet: `${render(LOJA, 640)} 640w, ${render(OUTRA, 960)} 960w` }),
    ).toBeNull();
  });
  it("candidata do srcset com aspas e atributo pendurado", () => {
    expect(
      com({
        srcSet: `${render(LOJA, 640)} 640w, ${render(LOJA, 960)}" onerror="x 960w`,
      }),
    ).toBeNull();
  });
  it("candidata com um terceiro token", () => {
    expect(com({ srcSet: `${render(LOJA, 640)} 640w extra` })).toBeNull();
  });
  it("descritor fora da forma `<n>w`", () => {
    expect(com({ srcSet: `${render(LOJA, 640)} 640` })).toBeNull();
    expect(com({ srcSet: `${render(LOJA, 640)} abcw` })).toBeNull();
    expect(com({ srcSet: `${render(LOJA, 640)} 2x` })).toBeNull();
    expect(com({ srcSet: render(LOJA, 640) })).toBeNull();
  });
  it("sizes diferente de 100vw: o cartaz escreve 100vw, entao o dedupe com o app quebraria", () => {
    expect(com({ sizes: "50vw" })).toBeNull();
  });
});
