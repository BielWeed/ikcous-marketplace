// @vitest-environment jsdom
//
// Caça de provas fracas (mutação) no `redimensionarImagem`, 24/11/2026. Os
// testes de WebP/AVIF e do `planoDaImagem` deixavam sobreviver 14 trocas no
// código de envio da foto. Este arquivo fecha o que doía de verdade:
//
//  - o JPEG reduzido sai com o MESMO nome, o mesmo tipo e a mesma data (nome
//    com ".webp" sobre conteúdo JPEG é a mentira que quebra a transformação de
//    imagem do Storage, que decodifica pelo Content-Type declarado);
//  - o bitmap é pedido com a orientação do EXIF (sem isso a foto de celular em
//    retrato sai deitada) e liberado em TODA saída, inclusive na que devolve o
//    original;
//  - o tamanho do canvas é ARREDONDADO, não cortado (1199,6 px viram 1200);
//  - resize que não encolhe (mesmo peso) mantém o original;
//  - o corte de 400 KB vale em número literal, não só pela constante;
//  - o detector de WebP/AVIF animado olha o cabeçalho de verdade: WebP sem
//    RIFF/WEBP/VP8X, WebP sem perda (VP8L, cujo 0x2f cai justo no byte dos
//    selos) e AVIF sem `ftyp` NÃO são animados e continuam sendo reduzidos;
//    uma marca `avis` fora da caixa `ftyp` não conta, e uma no último lugar
//    dela conta.
//
// Roda o utilitário REAL; só o que o jsdom não tem é dublado (bitmap e canvas).
import { planoDaImagem, redimensionarImagem } from "@/lib/redimensiona-imagem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MB = 1024 * 1024;

/** File com os primeiros bytes que se quer e o PESO declarado. */
function arquivo(
  nome: string,
  tipo: string,
  bytes: number,
  cabecalho: number[] = [],
  lastModified?: number,
): File {
  const f = new File([new Uint8Array(cabecalho)], nome, {
    type: tipo,
    lastModified,
  });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

const texto = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

describe("redimensionarImagem — JPEG, canvas e liberação do bitmap", () => {
  let fechou: ReturnType<typeof vi.fn>;
  let criarBitmap: ReturnType<typeof vi.fn>;
  let dimensoes: { width: number; height: number };
  let pesoDoResultado: number;
  let canvasCriado: { width: number; height: number } | null;
  let pedidoAoCanvas: { tipo: string | undefined; qualidade: unknown } | null;

  beforeEach(() => {
    fechou = vi.fn();
    dimensoes = { width: 4000, height: 3000 };
    pesoDoResultado = 300 * 1024;
    canvasCriado = null;
    pedidoAoCanvas = null;
    criarBitmap = vi.fn(async () => ({ ...dimensoes, close: fechou }));
    vi.stubGlobal("createImageBitmap", criarBitmap);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, cb, tipo, qualidade) {
        canvasCriado = { width: this.width, height: this.height };
        pedidoAoCanvas = { tipo, qualidade };
        const blob = new Blob(["r"], { type: tipo ?? "image/png" });
        Object.defineProperty(blob, "size", { value: pesoDoResultado });
        cb(blob);
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("JPEG grande sai reduzido com o mesmo nome, o mesmo tipo e a mesma data de modificação", async () => {
    const original = arquivo(
      "IMG_0001.JPG",
      "image/jpeg",
      5 * MB,
      [],
      1_700_000_000_000,
    );

    const pronto = await redimensionarImagem(original);

    expect(pronto).not.toBe(original);
    expect(pronto.name).toBe("IMG_0001.JPG");
    expect(pronto.type).toBe("image/jpeg");
    expect(pronto.lastModified).toBe(1_700_000_000_000);
    expect(canvasCriado).toEqual({ width: 1600, height: 1200 });
  });

  it("pede o bitmap com a orientação do EXIF e grava com qualidade 0,82 no tipo de origem", async () => {
    const original = arquivo("a.jpg", "image/jpeg", 5 * MB);

    await redimensionarImagem(original);

    expect(criarBitmap).toHaveBeenCalledWith(original, {
      imageOrientation: "from-image",
    });
    expect(pedidoAoCanvas).toEqual({ tipo: "image/jpeg", qualidade: 0.82 });
  });

  it("arredonda o tamanho do canvas em vez de cortar a fração (paisagem e retrato)", async () => {
    // escala = 1600 / 4000 = 0,4; 2999 * 0,4 = 1199,6 -> 1200 (não 1199)
    dimensoes = { width: 4000, height: 2999 };
    await redimensionarImagem(arquivo("p.jpg", "image/jpeg", 5 * MB));
    expect(canvasCriado).toEqual({ width: 1600, height: 1200 });

    dimensoes = { width: 2999, height: 4000 };
    await redimensionarImagem(arquivo("r.jpg", "image/jpeg", 5 * MB));
    expect(canvasCriado).toEqual({ width: 1200, height: 1600 });
  });

  it("libera o bitmap em toda saída: reduzida, leve demais ou resultado que não encolheu", async () => {
    // 1) reduzida
    await redimensionarImagem(arquivo("a.jpg", "image/jpeg", 5 * MB));
    expect(fechou).toHaveBeenCalledTimes(1);

    // 2) leve demais: devolve o original, mas o bitmap já foi aberto
    fechou.mockClear();
    const leve = arquivo("b.jpg", "image/jpeg", 100 * 1024);
    expect(await redimensionarImagem(leve)).toBe(leve);
    expect(fechou).toHaveBeenCalledTimes(1);

    // 3) o canvas devolveu mais pesado que o original
    fechou.mockClear();
    pesoDoResultado = 6 * MB;
    const grande = arquivo("c.jpg", "image/jpeg", 5 * MB);
    expect(await redimensionarImagem(grande)).toBe(grande);
    expect(fechou).toHaveBeenCalledTimes(1);
  });

  it("resultado do MESMO peso do original: mantém o original (resize que não encolhe é errado)", async () => {
    pesoDoResultado = 5 * MB;
    const original = arquivo("igual.jpg", "image/jpeg", 5 * MB);

    expect(await redimensionarImagem(original)).toBe(original);

    pesoDoResultado = 5 * MB - 1;
    const pronto = await redimensionarImagem(original);
    expect(pronto).not.toBe(original);
    expect(pronto.type).toBe("image/jpeg");
  });
});

describe("planoDaImagem — o corte de peso em número literal", () => {
  it("um byte abaixo de 400 KB passa intacto; 400 KB cravados já são reduzidos", () => {
    expect(planoDaImagem("image/jpeg", 400 * 1024 - 1, 2000, 1000)).toEqual({
      redimensionar: false,
      lado: 2000,
      mime: "image/jpeg",
    });
    expect(planoDaImagem("image/jpeg", 400 * 1024, 2000, 1000)).toEqual({
      redimensionar: true,
      lado: 1600,
      mime: "image/jpeg",
    });
  });
});

describe("redimensionarImagem — quem NÃO é animado continua sendo reduzido", () => {
  let decodificados: number;
  let canvasCriado: boolean;

  beforeEach(() => {
    decodificados = 0;
    canvasCriado = false;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        decodificados += 1;
        return { width: 4000, height: 3000, close() {} };
      }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (cb, tipo) => {
        canvasCriado = true;
        const blob = new Blob(["r"], { type: tipo ?? "image/png" });
        Object.defineProperty(blob, "size", { value: 300 * 1024 });
        cb(blob);
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Cabeçalho de WebP: [0..4) tag, [4..8) tamanho, [8..12) formato, [12..16) bloco. */
  const webp = (tag: string, formato: string, bloco: string, selos: number) => [
    ...texto(tag),
    0,
    0,
    0,
    0,
    ...texto(formato),
    ...texto(bloco),
    10,
    0,
    0,
    0,
    selos,
    0,
    0,
    0,
  ];

  it("WebP com o bit de animação mas SEM a tag RIFF não é animado", async () => {
    const f = arquivo(
      "a.webp",
      "image/webp",
      6 * MB,
      webp("XXXX", "WEBP", "VP8X", 0x02),
    );
    expect(await redimensionarImagem(f)).not.toBe(f);
    expect(decodificados).toBe(1);
  });

  it("WebP com o bit de animação mas SEM a marca WEBP não é animado", async () => {
    const f = arquivo(
      "a.webp",
      "image/webp",
      6 * MB,
      webp("RIFF", "XXXX", "VP8X", 0x02),
    );
    expect(await redimensionarImagem(f)).not.toBe(f);
    expect(decodificados).toBe(1);
  });

  it("WebP SEM PERDA (bloco VP8L, assinatura 0x2f no byte dos selos) é reduzido, não tratado como animado", async () => {
    // No VP8L o byte 20 é a assinatura 0x2f (0b101111): o bit 0x02 está
    // ligado, mas o bloco não é VP8X e não há selo de animação nenhum.
    const f = arquivo(
      "logo.webp",
      "image/webp",
      6 * MB,
      webp("RIFF", "WEBP", "VP8L", 0x2f),
    );
    expect(await redimensionarImagem(f)).not.toBe(f);
    expect(decodificados).toBe(1);
    expect(canvasCriado).toBe(true);
  });

  it("AVIF sem a caixa ftyp, mesmo com 'avis' no lugar da marca, não é animado", async () => {
    const f = arquivo("a.avif", "image/avif", 8 * MB, [
      0,
      0,
      0,
      24,
      ...texto("free"),
      ...texto("avis"),
      0,
      0,
      0,
      0,
      ...texto("avif"),
      ...texto("mif1"),
    ]);
    expect(await redimensionarImagem(f)).not.toBe(f);
    expect(decodificados).toBe(1);
  });

  it("AVIF com 'avis' FORA da caixa ftyp (depois do tamanho declarado) não é animado", async () => {
    // ftyp de 16 bytes: marca "avif" + versão. O "avis" que vem depois já é
    // de outra caixa e não diz nada sobre animação.
    const f = arquivo("a.avif", "image/avif", 8 * MB, [
      0,
      0,
      0,
      16,
      ...texto("ftyp"),
      ...texto("avif"),
      0,
      0,
      0,
      0,
      ...texto("avis"),
      0,
      0,
      0,
      0,
    ]);
    expect(await redimensionarImagem(f)).not.toBe(f);
    expect(decodificados).toBe(1);
  });

  it("AVIF animado cuja marca 'avis' é a ÚLTIMA da caixa ftyp (caixa de 12 bytes) passa intacto", async () => {
    const f = arquivo("anim.avif", "image/avif", 8 * MB, [
      0,
      0,
      0,
      12,
      ...texto("ftyp"),
      ...texto("avis"),
    ]);
    expect(await redimensionarImagem(f)).toBe(f);
    expect(decodificados).toBe(0);
  });
});
