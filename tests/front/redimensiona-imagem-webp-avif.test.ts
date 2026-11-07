// @vitest-environment jsdom
//
// Banner exportado de um editor como WebP ou AVIF (6 a 12 MB, 4000 px) subia
// INTEIRO: só JPEG e PNG eram reduzidos, e a loja principal não tem
// transformação de imagem no Storage -- o arquivo cru ia ao celular de toda
// cliente. Agora WebP e AVIF ESTÁTICOS são reduzidos como os outros (WebP
// continua WebP; AVIF vira WebP, que o navegador sabe gravar e guarda a
// transparência). Animado (WebP com o selo de animação, AVIF "avis") passa
// intacto: o canvas só guarda o primeiro quadro e a animação sumiria em
// silêncio.
//
// Roda o utilitário REAL; só o que o jsdom não tem é dublado: decodificação
// (`createImageBitmap`) e canvas.
import { redimensionarImagem } from "@/lib/redimensiona-imagem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MB = 1024 * 1024;

/** Um File com cabeçalho real (primeiros bytes) e o PESO que se quer. */
function arquivo(
  nome: string,
  tipo: string,
  bytes: number,
  cabecalho: number[] = [],
): File {
  const f = new File([new Uint8Array(cabecalho)], nome, { type: tipo });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

const texto = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** RIFF....WEBP + VP8X (tamanho 10) + byte de selos; animação = 0x02. */
const cabecalhoWebp = (selos: number) => [
  ...texto("RIFF"),
  0,
  0,
  0,
  0,
  ...texto("WEBPVP8X"),
  10,
  0,
  0,
  0,
  selos,
  0,
  0,
  0,
];

/** Caixa ftyp de 24 bytes: marca principal + uma compatível. */
const cabecalhoAvif = (principal: string, compativel: string) => [
  0,
  0,
  0,
  24,
  ...texto("ftyp"),
  ...texto(principal),
  0,
  0,
  0,
  0,
  ...texto(compativel),
  ...texto("mif1"),
];

describe("redimensionarImagem — WebP e AVIF", () => {
  let decodificados: number;
  let canvasCriado: { width: number; height: number } | null;
  let tipoPedido: string | null;
  let tipoGravado: string | null;
  let preencheuFundo: boolean;

  beforeEach(() => {
    decodificados = 0;
    canvasCriado = null;
    tipoPedido = null;
    tipoGravado = null;
    preencheuFundo = false;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        decodificados += 1;
        return { width: 4000, height: 3000, close() {} };
      }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(() => {
        preencheuFundo = true;
      }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, cb, tipo) {
        canvasCriado = { width: this.width, height: this.height };
        tipoPedido = tipo ?? null;
        // `tipoGravado` nulo = o navegador grava o que foi pedido; com valor,
        // simula o encoder que não conhece o tipo e devolve PNG no lugar.
        const blob = new Blob(["r"], {
          type: tipoGravado ?? tipo ?? "image/png",
        });
        Object.defineProperty(blob, "size", { value: 300 * 1024 });
        cb(blob);
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("WebP estático de 6 MB sai menor, em 1600 px, ainda WebP, com o mesmo nome", async () => {
    const original = arquivo(
      "banner.webp",
      "image/webp",
      6 * MB,
      cabecalhoWebp(0),
    );

    const pronto = await redimensionarImagem(original);

    expect(pronto).not.toBe(original);
    expect(pronto.size).toBeLessThan(original.size);
    expect(pronto.type).toBe("image/webp");
    expect(pronto.name).toBe("banner.webp");
    expect(tipoPedido).toBe("image/webp");
    expect(canvasCriado).toEqual({ width: 1600, height: 1200 });
  });

  it("WebP com transparência: o canvas não pinta fundo (a transparência sobrevive)", async () => {
    const original = arquivo(
      "logo.webp",
      "image/webp",
      6 * MB,
      cabecalhoWebp(0x10),
    );

    const pronto = await redimensionarImagem(original);

    expect(pronto).not.toBe(original);
    expect(preencheuFundo).toBe(false);
  });

  it("AVIF estático de 8 MB vira WebP reduzido, e o nome acompanha o tipo", async () => {
    const original = arquivo(
      "capa.avif",
      "image/avif",
      8 * MB,
      cabecalhoAvif("avif", "mif1"),
    );

    const pronto = await redimensionarImagem(original);

    expect(pronto).not.toBe(original);
    expect(pronto.type).toBe("image/webp");
    expect(pronto.name).toBe("capa.webp");
    expect(tipoPedido).toBe("image/webp");
    expect(canvasCriado).toEqual({ width: 1600, height: 1200 });
  });

  it("WebP ANIMADO passa intacto, sem nem decodificar (o canvas guardaria só o 1º quadro)", async () => {
    const original = arquivo(
      "anim.webp",
      "image/webp",
      6 * MB,
      cabecalhoWebp(0x02),
    );

    const pronto = await redimensionarImagem(original);

    expect(pronto).toBe(original);
    expect(decodificados).toBe(0);
    expect(canvasCriado).toBeNull();
  });

  it("AVIF ANIMADO (marca avis, principal ou compatível) passa intacto", async () => {
    const principal = arquivo(
      "anim1.avif",
      "image/avif",
      8 * MB,
      cabecalhoAvif("avis", "avif"),
    );
    const compativel = arquivo(
      "anim2.avif",
      "image/avif",
      8 * MB,
      cabecalhoAvif("avif", "avis"),
    );

    expect(await redimensionarImagem(principal)).toBe(principal);
    expect(await redimensionarImagem(compativel)).toBe(compativel);
    expect(decodificados).toBe(0);
    expect(canvasCriado).toBeNull();
  });

  it("WebP e AVIF leves (abaixo de 400 KB) passam intactos, sem canvas", async () => {
    const webp = arquivo(
      "leve.webp",
      "image/webp",
      100 * 1024,
      cabecalhoWebp(0),
    );
    const avif = arquivo(
      "leve.avif",
      "image/avif",
      100 * 1024,
      cabecalhoAvif("avif", "mif1"),
    );

    expect(await redimensionarImagem(webp)).toBe(webp);
    expect(await redimensionarImagem(avif)).toBe(avif);
    expect(canvasCriado).toBeNull();
  });

  it("navegador que não grava WebP (devolve PNG): mantém o original em vez de trocar o tipo", async () => {
    tipoGravado = "image/png";
    const original = arquivo(
      "banner.webp",
      "image/webp",
      6 * MB,
      cabecalhoWebp(0),
    );

    const pronto = await redimensionarImagem(original);

    expect(pronto).toBe(original);
  });

  it("GIF continua intacto (não é convertido em silêncio)", async () => {
    const original = arquivo("anim.gif", "image/gif", 5 * MB, texto("GIF89a"));

    expect(await redimensionarImagem(original)).toBe(original);
    expect(decodificados).toBe(0);
  });
});
