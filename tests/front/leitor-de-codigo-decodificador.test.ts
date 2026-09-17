// Prende a regra de escolha de motor do decodificador único de código de
// barras (tarefa C2.1): BarcodeDetector nativo quando o navegador sabe
// detectar `ean_13` E `code_128`, senão o fallback zxing-wasm — que aqui
// chega só por INJEÇÃO (`carregarFallback`), nunca por especificador de
// import, porque o pacote zxing-wasm só entra no repositório em C2.5 (ver a
// divergência registrada no plano do lote C2).
//
// Sem docblock de jsdom: nenhuma fonte aqui é um elemento de DOM de
// verdade, só objetos simples (`as unknown as HTMLVideoElement`/`ImageData`)
// — o próprio decodificador é puro o bastante para rodar em
// `environment: "node"" (vitest.config.ts).
//
// Dublês feitos à mão com `vi.fn()`. Nada de `vi.mock("zxing-wasm/reader")`:
// o pacote não está instalado ainda (`ls node_modules | grep -i zxing` é
// vazio em 16/09/2026) e mockar um especificador que o resolvedor do Vite
// não acha derruba a coleta do próprio arquivo de teste.
import {
  ErroDoDecodificador,
  type ModuloZxingReader,
  criarDecodificador,
} from "@/lib/leitor/decodificador";
import { describe, expect, it, vi } from "vitest";

// Pedacinho do que a spec WICG chama de `ConstrutorDeBarcodeDetector` —
// escrito à mão porque `BarcodeDetector` não existe na lib DOM do
// TypeScript (tsconfig.app.json usa ES2022/DOM/DOM.Iterable, sem Shape
// Detection API). O decodificador aceita esse dublê pelo parâmetro
// `opcoes.escopo`, então o teste nunca precisa de `declare global`.
function criarConstrutorNativoFalso(config: {
  suportados?: readonly string[];
  suportadosRejeitaCom?: unknown;
  detectarMock?: ReturnType<typeof vi.fn>;
}) {
  const detectarMock = config.detectarMock ?? vi.fn(async () => []);
  const getSupportedFormats =
    config.suportadosRejeitaCom !== undefined
      ? vi.fn().mockRejectedValue(config.suportadosRejeitaCom)
      : vi.fn().mockResolvedValue(config.suportados ?? []);

  // Sem construtor explícito: a spec só usa `formats` para o construtor
  // VALIDAR (o dublê não precisa fazer nada com ele), e um construtor que só
  // recebe e ignora o argumento é redundante (`lint/complexity/noUselessConstructor`
  // do Biome) — o construtor padrão da classe já aceita e ignora o argumento
  // extra, como qualquer construtor JS sem parâmetros declarados.
  class BarcodeDetectorFalso {
    static getSupportedFormats = getSupportedFormats;
    detect = detectarMock;
  }

  return { Ctor: BarcodeDetectorFalso, detectarMock, getSupportedFormats };
}

describe("criarDecodificador", () => {
  it("caso 1: nativo com os sete formatos detecta e mapeia ean_13", async () => {
    const { Ctor, detectarMock } = criarConstrutorNativoFalso({
      suportados: [
        "ean_13",
        "ean_8",
        "upc_a",
        "upc_e",
        "code_128",
        "code_39",
        "qr_code",
      ],
    });
    detectarMock.mockResolvedValue([
      { rawValue: "7891000315507", format: "ean_13" },
    ]);
    const video = { readyState: 2 } as unknown as HTMLVideoElement;

    const decodificador = await criarDecodificador({
      escopo: { BarcodeDetector: Ctor as never },
    });

    expect(decodificador.motor).toBe("nativo");
    expect(decodificador.entrada).toBe("video");

    const leituras = await decodificador.detectar(video);

    expect(detectarMock).toHaveBeenCalledWith(video);
    expect(leituras).toEqual([{ codigo: "7891000315507", formato: "ean_13" }]);
  });

  it("caso 2: getSupportedFormats() resolve vazio cai no fallback", async () => {
    const { Ctor } = criarConstrutorNativoFalso({ suportados: [] });
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

  it("caso 3: getSupportedFormats() rejeita cai no fallback sem vazar a rejeição", async () => {
    const { Ctor } = criarConstrutorNativoFalso({
      suportadosRejeitaCom: new Error("plataforma não respondeu"),
    });
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

  it("caso 4: nativo só com qr_code (sem ean_13/code_128) cai no fallback", async () => {
    const { Ctor } = criarConstrutorNativoFalso({ suportados: ["qr_code"] });
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

  it("caso 5: sem nativo usa zxing, traduz formatos e mapeia a saída", async () => {
    const readBarcodes = vi.fn(async () => [
      { text: " 7891000315507 ", format: "EAN-13" },
      { text: "", format: "EAN13" },
      { text: "7891000000019", format: "EANUPC" },
      { text: "999", format: "Bolacha" },
    ]);
    const carregar = vi.fn(
      async (): Promise<ModuloZxingReader> => ({ readBarcodes }),
    );

    const decodificador = await criarDecodificador({
      carregarFallback: carregar,
    });

    expect(decodificador.motor).toBe("zxing");
    expect(decodificador.entrada).toBe("imageData");

    const imagem = {
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    } as unknown as ImageData;
    const leituras = await decodificador.detectar(imagem);

    expect(readBarcodes).toHaveBeenCalledWith(imagem, {
      formats: ["EAN13", "EAN8", "UPCA", "UPCE", "Code128", "Code39", "QRCode"],
      tryHarder: true,
      maxNumberOfSymbols: 1,
    });
    expect(leituras).toEqual([
      { codigo: "7891000315507", formato: "ean_13" },
      { codigo: "7891000000019", formato: "ean_13" },
      { codigo: "999", formato: "desconhecido" },
    ]);
  });

  it("caso 6: o fallback é lazy de verdade", async () => {
    // Com nativo disponível, o carregador nunca é chamado.
    const { Ctor } = criarConstrutorNativoFalso({
      suportados: ["ean_13", "code_128"],
    });
    const carregarComNativo = vi.fn(
      async (): Promise<ModuloZxingReader> => ({
        readBarcodes: vi.fn(async () => []),
      }),
    );
    const comNativo = await criarDecodificador({
      escopo: { BarcodeDetector: Ctor as never },
      carregarFallback: carregarComNativo,
    });
    await comNativo.detectar({} as unknown as HTMLVideoElement);
    expect(carregarComNativo).not.toHaveBeenCalled();

    // Sem nativo, duas chamadas de detectar chamam o carregador uma vez só.
    const readBarcodes = vi.fn(async () => []);
    const carregarSemNativo = vi.fn(
      async (): Promise<ModuloZxingReader> => ({ readBarcodes }),
    );
    const semNativo = await criarDecodificador({
      carregarFallback: carregarSemNativo,
    });
    const imagem = {
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    } as unknown as ImageData;
    await semNativo.detectar(imagem);
    await semNativo.detectar(imagem);
    expect(carregarSemNativo).toHaveBeenCalledTimes(1);
  });

  it("caso 7: sem nativo e sem carregador rejeita com sem_suporte", async () => {
    await expect(
      criarDecodificador({ carregarFallback: null }),
    ).rejects.toMatchObject({
      origem: "sem_suporte",
      message:
        "Este navegador não consegue ler código de barras pela câmera. Digite o código à mão.",
    });
    await expect(
      criarDecodificador({ carregarFallback: null }),
    ).rejects.toBeInstanceOf(ErroDoDecodificador);
  });

  it("caso 8: detect() rejeitando com InvalidStateError vira lista vazia", async () => {
    const { Ctor, detectarMock } = criarConstrutorNativoFalso({
      suportados: ["ean_13", "code_128"],
    });
    detectarMock.mockRejectedValue(
      new DOMException("quadro sem dados ainda", "InvalidStateError"),
    );

    const decodificador = await criarDecodificador({
      escopo: { BarcodeDetector: Ctor as never },
    });
    const leituras = await decodificador.detectar(
      {} as unknown as HTMLVideoElement,
    );

    expect(leituras).toEqual([]);
  });

  it("caso 9: zxing recebendo um HTMLVideoElement dublê rejeita com fonte_invalida", async () => {
    const carregar = vi.fn(
      async (): Promise<ModuloZxingReader> => ({
        readBarcodes: vi.fn(async () => []),
      }),
    );
    const decodificador = await criarDecodificador({
      carregarFallback: carregar,
    });

    const video = { readyState: 2 } as unknown as HTMLVideoElement;

    await expect(decodificador.detectar(video)).rejects.toMatchObject({
      origem: "fonte_invalida",
    });
  });

  it("caso 10: encerrar() duas vezes não lança", async () => {
    const { Ctor } = criarConstrutorNativoFalso({
      suportados: ["ean_13", "code_128"],
    });
    const decodificador = await criarDecodificador({
      escopo: { BarcodeDetector: Ctor as never },
    });

    expect(() => {
      decodificador.encerrar();
      decodificador.encerrar();
    }).not.toThrow();
  });
});
