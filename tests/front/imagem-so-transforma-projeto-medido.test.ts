// @vitest-environment jsdom
//
// A foto da loja nova (projeto Supabase GRATUITO) não pode quebrar, 26/11/2026.
//
// O redimensionamento do Supabase (`/render/image/public/`) só existe nos planos
// pagos; no gratuito ele responde 403 FeatureNotEnabled. As lojas novas nascem
// em projeto gratuito na conta da lojista. Antes, o código só sabia que UM
// projeto (o da IKCOUS) não transformava e mandava TODO outro projeto para o
// endereço transformado: na loja gratuita cada foto fazia um pedido que dava
// erro antes de cair na original, e o cartaz do porteiro (banner impresso no
// HTML) apontava para o endereço do 403, sem plano B.
//
// A regra agora: o padrão é servir o ORIGINAL; só transforma o projeto que foi
// MEDIDO respondendo 200 na transformação.
import { lojaRedimensionaFoto, montarCartaz } from "@/hospedagem/cartaz";
import {
  atributosDeImagem,
  conjuntoDeImagens,
  imagemRedimensionada,
  miniaturaDaSugestao,
} from "@/lib/imageUrl";
import { IMAGEM_DO_BANNER } from "@/lib/imagem-do-banner";
import { describe, expect, it } from "vitest";

// Projeto qualquer que o código nunca mediu: o caso da loja nova gratuita.
const LOJA_NOVA = "https://novalojagratisaaaaaa.supabase.co";
// O único projeto medido com a transformação ligada (200 image/webp, 26/11/2026).
const LOJA_MEDIDA = "https://gnjsrucsmjkajijrakzr.supabase.co";
const CAMINHO = "/storage/v1/object/public/produtos/foto.jpg";
const CAMINHO_DO_BANNER =
  "/storage/v1/object/public/banners/1791565996435-7tdkqgfb019.webp";

describe("projeto que o código não mediu: serve o original", () => {
  const foto = `${LOJA_NOVA}${CAMINHO}`;

  it("o ref de teste tem o formato de um ref de verdade (20 letras)", () => {
    expect(new URL(LOJA_NOVA).hostname.split(".")[0]).toMatch(/^[a-z]{20}$/);
  });

  it("imagemRedimensionada devolve a URL original, sem pedir transformação", () => {
    expect(imagemRedimensionada(foto, { width: 640 })).toBe(foto);
    expect(imagemRedimensionada(`${foto}?v=3`, { width: 640 })).toBe(
      `${foto}?v=3`,
    );
  });

  it("conjuntoDeImagens fica vazio (o navegador usa só o src)", () => {
    expect(conjuntoDeImagens(foto, [320, 640])).toBe("");
  });

  it("atributosDeImagem com sizes: src original e nenhum srcSet", () => {
    const { src, srcSet } = atributosDeImagem(foto, { sizes: "100vw" });
    expect(src).toBe(foto);
    expect(srcSet).toBe("");
    expect(src).not.toContain("/render/image/");
  });

  it("a miniatura da busca também é o original", () => {
    expect(miniaturaDaSugestao(foto)).toBe(foto);
  });

  it("o porteiro não imprime cartaz para essa loja (o cartaz exige foto reduzida)", () => {
    expect(lojaRedimensionaFoto(LOJA_NOVA)).toBe(false);
    expect(
      montarCartaz(
        {
          id: "b1",
          image_url: `${LOJA_NOVA}${CAMINHO_DO_BANNER}`,
          position: "home_top",
          active: true,
          order: 1,
        },
        LOJA_NOVA,
      ),
    ).toBeNull();
  });
});

describe("projeto medido: continua reduzido", () => {
  it("transforma a foto do projeto medido", () => {
    expect(
      imagemRedimensionada(`${LOJA_MEDIDA}${CAMINHO}`, { width: 640 }),
    ).toBe(
      `${LOJA_MEDIDA}/storage/v1/render/image/public/produtos/foto.jpg?width=640&resize=contain&quality=75`,
    );
    expect(conjuntoDeImagens(`${LOJA_MEDIDA}${CAMINHO}`, [320])).toContain(
      "320w",
    );
  });

  it("o porteiro imprime o cartaz do projeto medido", () => {
    expect(lojaRedimensionaFoto(LOJA_MEDIDA)).toBe(true);
    const cartaz = montarCartaz(
      {
        id: "b1",
        image_url: `${LOJA_MEDIDA}${CAMINHO_DO_BANNER}`,
        position: "home_top",
        active: true,
        order: 1,
      },
      LOJA_MEDIDA,
    );
    expect(cartaz?.html).toContain(
      `${LOJA_MEDIDA}/storage/v1/render/image/public/banners/`,
    );
    expect(
      atributosDeImagem(`${LOJA_MEDIDA}${CAMINHO_DO_BANNER}`, IMAGEM_DO_BANNER)
        .srcSet,
    ).not.toBe("");
  });
});

describe("bordas: parecer o projeto medido não basta", () => {
  it.each([
    [
      "host que só COMEÇA igual",
      `https://gnjsrucsmjkajijrakzr.supabase.co.exemplo.com${CAMINHO}`,
    ],
    [
      "host com letra a mais na frente",
      `https://xgnjsrucsmjkajijrakzr.supabase.co${CAMINHO}`,
    ],
    [
      "http em vez de https",
      `http://gnjsrucsmjkajijrakzr.supabase.co${CAMINHO}`,
    ],
    [
      "URL de outro site que CITA o caminho",
      `https://cdn.exemplo.com/x?u=${LOJA_MEDIDA}${CAMINHO}`,
    ],
    [
      "caminho que não é o do arquivo público",
      `${LOJA_MEDIDA}/storage/v1/object/sign/produtos/foto.jpg`,
    ],
  ])("%s: volta intacta", (_nome, url) => {
    expect(imagemRedimensionada(url, { width: 640 })).toBe(url);
    expect(conjuntoDeImagens(url, [320])).toBe("");
  });

  it("vazio, nulo e indefinido continuam virando string vazia", () => {
    expect(imagemRedimensionada("", { width: 640 })).toBe("");
    expect(imagemRedimensionada(null, { width: 640 })).toBe("");
    expect(imagemRedimensionada(undefined, { width: 640 })).toBe("");
  });
});
