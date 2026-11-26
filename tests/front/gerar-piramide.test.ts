// @vitest-environment jsdom
//
// O gerador da pirâmide de cópias da foto (plano das miniaturas, 26/11/2026):
// roda no navegador da lojista, no painel, e devolve as 3 cópias (maior lado
// 240/480/960) que sobem ANTES da original marcada. Qualquer dúvida devolve
// `null` -- e `null` quer dizer "sobe a original sem marca, como hoje":
//   - GIF (pode ser animado), SVG (vetor), HEIC e tipo desconhecido;
//   - WebP/AVIF animado (o canvas guardaria só o 1º quadro);
//   - decodificação, canvas ou gravação que falha.
// Navegador que não grava WebP (Safari antigo devolve PNG no lugar) gera as
// cópias em JPEG (marca `j`), com fundo branco onde havia transparência.
// Nunca amplia: foto menor que o lado fica do tamanho dela.
//
// Roda o gerador REAL; só o que o jsdom não tem é dublado: decodificação
// (`createImageBitmap`) e canvas.
import { gerarPiramide } from "@/lib/gerar-piramide";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const texto = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

function arquivo(nome: string, tipo: string, cabecalho: number[] = []): File {
  return new File([new Uint8Array(cabecalho)], nome, { type: tipo });
}

/** RIFF....WEBP + VP8X + byte de selos; animação = 0x02. */
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

const cabecalhoAvif = (principal: string) => [
  0,
  0,
  0,
  20,
  ...texto("ftyp"),
  ...texto(principal),
  0,
  0,
  0,
  0,
  ...texto("mif1"),
];

describe("gerarPiramide", () => {
  let desenhos: { width: number; height: number; tipo: string | null }[];
  let fundosBrancos: number;
  let fechados: number;
  let decodificados: number;
  /** Tipo que o "navegador" grava; nulo = grava o que foi pedido. */
  let tipoGravado: string | null;
  let falharToBlob: boolean;

  function decodificaComo(largura: number, altura: number) {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        decodificados += 1;
        return {
          width: largura,
          height: altura,
          close() {
            fechados += 1;
          },
        };
      }),
    );
  }

  beforeEach(() => {
    desenhos = [];
    fundosBrancos = 0;
    fechados = 0;
    decodificados = 0;
    tipoGravado = null;
    falharToBlob = false;
    decodificaComo(4000, 3000);
    const contexto = {
      fillStyle: "",
      drawImage: vi.fn(),
      fillRect: vi.fn(() => {
        if (contexto.fillStyle === "#ffffff") fundosBrancos += 1;
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      contexto as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, cb, tipo) {
        desenhos.push({
          width: this.width,
          height: this.height,
          tipo: tipo ?? null,
        });
        if (falharToBlob) {
          cb(null);
          return;
        }
        const gravado =
          tipo === "image/webp" && tipoGravado ? tipoGravado : tipo;
        cb(new Blob(["c"], { type: gravado ?? "image/png" }));
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("JPEG de paisagem: 3 cópias WebP, maior lado 240/480/960, proporção mantida", async () => {
    const piramide = await gerarPiramide(arquivo("foto.jpg", "image/jpeg"));

    expect(piramide?.marca).toBe("w");
    expect(piramide?.copias.map((c) => c.lado)).toEqual([240, 480, 960]);
    expect(piramide?.copias.map((c) => c.arquivo.type)).toEqual([
      "image/webp",
      "image/webp",
      "image/webp",
    ]);
    expect(desenhos).toEqual([
      { width: 240, height: 180, tipo: "image/webp" },
      { width: 480, height: 360, tipo: "image/webp" },
      { width: 960, height: 720, tipo: "image/webp" },
    ]);
    expect(fundosBrancos).toBe(0);
    expect(decodificados).toBe(1);
    expect(fechados).toBe(1);
  });

  it("retrato: o lado que manda é o MAIOR (altura)", async () => {
    decodificaComo(3000, 4000);
    await gerarPiramide(arquivo("foto.jpg", "image/jpeg"));
    expect(desenhos.map(({ width, height }) => [width, height])).toEqual([
      [180, 240],
      [360, 480],
      [720, 960],
    ]);
  });

  it("não amplia: foto de 300 px fica com 300 px nas cópias maiores", async () => {
    decodificaComo(300, 200);
    const piramide = await gerarPiramide(arquivo("p.png", "image/png"));
    expect(piramide?.copias).toHaveLength(3);
    expect(desenhos.map(({ width, height }) => [width, height])).toEqual([
      [240, 160],
      [300, 200],
      [300, 200],
    ]);
  });

  it("PNG, WebP e AVIF estáticos também geram", async () => {
    for (const [nome, tipo, cabecalho] of [
      ["a.png", "image/png", []],
      ["b.webp", "image/webp", cabecalhoWebp(0)],
      ["c.avif", "image/avif", cabecalhoAvif("avif")],
    ] as const) {
      expect(
        (await gerarPiramide(arquivo(nome, tipo, [...cabecalho])))?.marca,
      ).toBe("w");
    }
  });

  it("navegador que não grava WebP (devolve PNG): cópias JPEG, marca j, fundo branco", async () => {
    tipoGravado = "image/png";
    const piramide = await gerarPiramide(arquivo("arte.png", "image/png"));

    expect(piramide?.marca).toBe("j");
    expect(piramide?.copias.map((c) => c.arquivo.type)).toEqual([
      "image/jpeg",
      "image/jpeg",
      "image/jpeg",
    ]);
    expect(piramide?.copias.map((c) => c.lado)).toEqual([240, 480, 960]);
    // Uma tentativa WebP (recusada) e as três em JPEG.
    expect(desenhos.map((d) => d.tipo)).toEqual([
      "image/webp",
      "image/jpeg",
      "image/jpeg",
      "image/jpeg",
    ]);
    expect(fundosBrancos).toBe(3);
  });

  it("navegador que não grava nem JPEG: null", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
      cb(new Blob(["c"], { type: "image/png" })),
    );
    expect(await gerarPiramide(arquivo("f.jpg", "image/jpeg"))).toBeNull();
  });

  it.each([
    ["animacao.gif", "image/gif"],
    ["vetor.svg", "image/svg+xml"],
    ["foto.heic", "image/heic"],
    ["sem-tipo.jpg", ""],
    ["octeto.jpg", "application/octet-stream"],
  ])("%s (%s): null, sem decodificar", async (nome, tipo) => {
    expect(await gerarPiramide(arquivo(nome, tipo))).toBeNull();
    expect(decodificados).toBe(0);
    expect(desenhos).toEqual([]);
  });

  it("WebP animado e AVIF animado: null, sem decodificar", async () => {
    expect(
      await gerarPiramide(
        arquivo("anim.webp", "image/webp", cabecalhoWebp(0x02)),
      ),
    ).toBeNull();
    expect(
      await gerarPiramide(
        arquivo("anim.avif", "image/avif", cabecalhoAvif("avis")),
      ),
    ).toBeNull();
    expect(decodificados).toBe(0);
  });

  it("decodificação que falha: null (a original sobe sem marca)", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("formato não suportado")),
    );
    expect(await gerarPiramide(arquivo("f.jpg", "image/jpeg"))).toBeNull();
  });

  it("canvas sem contexto: null, e o bitmap é fechado", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(await gerarPiramide(arquivo("f.jpg", "image/jpeg"))).toBeNull();
    expect(fechados).toBe(1);
  });

  it("gravação que devolve nada: null, e o bitmap é fechado", async () => {
    falharToBlob = true;
    expect(await gerarPiramide(arquivo("f.jpg", "image/jpeg"))).toBeNull();
    expect(fechados).toBe(1);
  });

  it("imagem sem dimensão: null", async () => {
    decodificaComo(0, 0);
    expect(await gerarPiramide(arquivo("f.jpg", "image/jpeg"))).toBeNull();
  });
});
