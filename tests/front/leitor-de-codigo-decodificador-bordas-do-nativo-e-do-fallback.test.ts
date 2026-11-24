// Protege as bordas do decodificador de código de barras que os "casos" de
// leitor-de-codigo-decodificador deixam passar, todas com efeito que a
// lojista sente no balcão:
//  · o código que o motor NATIVO devolve com espaço nas pontas é aparado, e o
//    vazio é descartado (senão a RPC receberia " 789 " ou "");
//  · formato que o navegador não conhece vira "desconhecido", nunca é repassado
//    cru para o resto do app;
//  · o nativo só vale com ean_13 E code_128 (só um dos dois cai no zxing);
//  · o construtor do nativo recebe só os formatos que a plataforma sabe ler;
//  · `escopo: {}` explícito desliga o nativo mesmo com `BarcodeDetector` global;
//  · só InvalidStateError é silêncio: qualquer outra falha do nativo avisa UMA
//    vez no console, e não um aviso por quadro;
//  · o carregamento do zxing que falhou é tentado de novo no próximo quadro;
//  · o quadro precisa de data, width e height (um objeto qualquer com `data`
//    não é imagem);
//  · o nome do formato do zxing é normalizado (espaço, hífen, caixa) e
//    UPC-A não vira UPC-E.
import {
  ErroDoDecodificador,
  type ModuloZxingReader,
  criarDecodificador,
} from "@/lib/leitor/decodificador";
import { afterEach, describe, expect, it, vi } from "vitest";

const TODOS_OS_FORMATOS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "qr_code",
];

function construtorNativo(
  suportados: readonly string[],
  detectar: ReturnType<typeof vi.fn> = vi.fn(async () => []),
) {
  const construidoCom: unknown[] = [];
  class BarcodeDetectorFalso {
    static getSupportedFormats = vi.fn().mockResolvedValue(suportados);
    constructor(opcoes?: unknown) {
      construidoCom.push(opcoes);
    }
    detect = detectar;
  }
  return { Ctor: BarcodeDetectorFalso, construidoCom, detectar };
}

const VIDEO = { readyState: 4 } as unknown as HTMLVideoElement;
const IMAGEM = {
  data: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
} as unknown as ImageData;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("decodificador nativo: o que ele devolve", () => {
  it("apara o código, descarta o vazio e o só-espaços, e formato desconhecido vira 'desconhecido'", async () => {
    const { Ctor, detectar } = construtorNativo(TODOS_OS_FORMATOS);
    detectar.mockResolvedValue([
      { rawValue: "  7891000315507 \n", format: "ean_13" },
      { rawValue: "", format: "ean_13" },
      { rawValue: "   ", format: "code_128" },
      { rawValue: "ABC-123", format: "pdf417" },
    ]);

    const decodificador = await criarDecodificador({
      escopo: { BarcodeDetector: Ctor as never },
    });
    const leituras = await decodificador.detectar(VIDEO);

    expect(leituras).toEqual([
      { codigo: "7891000315507", formato: "ean_13" },
      { codigo: "ABC-123", formato: "desconhecido" },
    ]);
  });

  it("o construtor nativo recebe só os formatos que a plataforma suporta, e o decodificador anuncia os mesmos", async () => {
    const { Ctor, construidoCom } = construtorNativo([
      "ean_13",
      "code_128",
      "aztec",
      "qr_code",
    ]);

    const decodificador = await criarDecodificador({
      escopo: { BarcodeDetector: Ctor as never },
    });

    expect(decodificador.motor).toBe("nativo");
    expect(construidoCom).toEqual([
      { formats: ["ean_13", "code_128", "qr_code"] },
    ]);
    expect(decodificador.formatos).toEqual(["ean_13", "code_128", "qr_code"]);
  });
});

describe("decodificador: quando o nativo vale", () => {
  it.each([
    ["só ean_13", ["ean_13", "qr_code"]],
    ["só code_128", ["code_128", "qr_code"]],
  ])("%s NÃO basta: cai no zxing", async (_nome, suportados) => {
    const { Ctor } = construtorNativo(suportados);
    const carregar = vi.fn(
      async (): Promise<ModuloZxingReader> => ({
        readBarcodes: vi.fn(async () => []),
      }),
    );

    const decodificador = await criarDecodificador({
      escopo: { BarcodeDetector: Ctor as never },
      carregarFallback: carregar,
    });

    expect(decodificador.motor).toBe("zxing");
  });

  it("`escopo: {}` explícito desliga o nativo mesmo com BarcodeDetector no global; sem escopo, o global vale", async () => {
    const { Ctor } = construtorNativo(TODOS_OS_FORMATOS);
    vi.stubGlobal("BarcodeDetector", Ctor);
    const carregar = vi.fn(
      async (): Promise<ModuloZxingReader> => ({
        readBarcodes: vi.fn(async () => []),
      }),
    );

    const semNativo = await criarDecodificador({
      escopo: {},
      carregarFallback: carregar,
    });
    expect(semNativo.motor).toBe("zxing");

    const comGlobal = await criarDecodificador({ carregarFallback: carregar });
    expect(comGlobal.motor).toBe("nativo");
  });
});

describe("decodificador nativo: avisos de quadro ruim", () => {
  it("só InvalidStateError é silêncio; as outras falhas avisam UMA vez só", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { Ctor, detectar } = construtorNativo(TODOS_OS_FORMATOS);
    const decodificador = await criarDecodificador({
      escopo: { BarcodeDetector: Ctor as never },
    });

    detectar.mockRejectedValue(
      new DOMException("câmera abrindo", "InvalidStateError"),
    );
    expect(await decodificador.detectar(VIDEO)).toEqual([]);
    expect(aviso).not.toHaveBeenCalled();

    // Um erro comum que só TEM o nome de InvalidStateError não é o da spec.
    const parecido = new Error("outra coisa");
    parecido.name = "InvalidStateError";
    detectar.mockRejectedValue(parecido);
    expect(await decodificador.detectar(VIDEO)).toEqual([]);
    expect(aviso).toHaveBeenCalledTimes(1);

    // Um DOMException de outro nome também avisa, mas o aviso já foi dado.
    detectar.mockRejectedValue(
      new DOMException("não sei ler", "NotSupportedError"),
    );
    expect(await decodificador.detectar(VIDEO)).toEqual([]);
    expect(await decodificador.detectar(VIDEO)).toEqual([]);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("um DOMException que não é InvalidStateError avisa (não é o silêncio da spec)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { Ctor, detectar } = construtorNativo(TODOS_OS_FORMATOS);
    detectar.mockRejectedValue(
      new DOMException("não sei ler", "NotSupportedError"),
    );
    const decodificador = await criarDecodificador({
      escopo: { BarcodeDetector: Ctor as never },
    });

    expect(await decodificador.detectar(VIDEO)).toEqual([]);
    expect(aviso).toHaveBeenCalledTimes(1);
  });
});

describe("decodificador zxing: bordas", () => {
  it("o carregamento que falhou é tentado de novo no quadro seguinte", async () => {
    const readBarcodes = vi.fn(async () => [
      { text: "7891000315507", format: "EAN13" },
    ]);
    const carregar = vi
      .fn<() => Promise<ModuloZxingReader>>()
      .mockRejectedValueOnce(new Error("rede caiu"))
      .mockResolvedValue({ readBarcodes });

    const decodificador = await criarDecodificador({
      escopo: {},
      carregarFallback: carregar,
    });

    await expect(decodificador.detectar(IMAGEM)).rejects.toMatchObject({
      name: "ErroDoDecodificador",
      origem: "falha_do_fallback",
    });
    // Falha de rede é transitória: o próximo quadro carrega de novo.
    expect(await decodificador.detectar(IMAGEM)).toEqual([
      { codigo: "7891000315507", formato: "ean_13" },
    ]);
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("objeto com `data` mas sem width/height não é imagem: fonte_invalida", async () => {
    const decodificador = await criarDecodificador({
      escopo: {},
      carregarFallback: async () => ({ readBarcodes: vi.fn(async () => []) }),
    });

    const soComData = {
      data: new Uint8ClampedArray(4),
    } as unknown as ImageData;
    const soComDataEWidth = {
      data: new Uint8ClampedArray(4),
      width: 1,
    } as unknown as ImageData;

    await expect(decodificador.detectar(soComData)).rejects.toBeInstanceOf(
      ErroDoDecodificador,
    );
    await expect(decodificador.detectar(soComDataEWidth)).rejects.toMatchObject(
      { origem: "fonte_invalida" },
    );
  });

  it("o nome do formato do zxing é normalizado: espaço, hífen, barra, sublinhado e caixa; UPC-A é upc_a e UPC-E é upc_e", async () => {
    const readBarcodes = vi.fn(async () => [
      { text: "1", format: "EAN 13" },
      { text: "2", format: "ean_8" },
      { text: "3", format: "UPC-A" },
      { text: "4", format: "upc/e" },
      { text: "5", format: "Code 128" },
      { text: "6", format: "CODE-39" },
      { text: "7", format: "QR Code" },
    ]);
    const decodificador = await criarDecodificador({
      escopo: {},
      carregarFallback: async () => ({ readBarcodes }),
    });

    const leituras = await decodificador.detectar(IMAGEM);

    expect(leituras.map((l) => l.formato)).toEqual([
      "ean_13",
      "ean_8",
      "upc_a",
      "upc_e",
      "code_128",
      "code_39",
      "qr_code",
    ]);
  });
});
