// @vitest-environment node
//
// C2.5 (fila do bastão 19/09) — a prova de que o WASM do leitor zxing fica
// FORA do boot e do chunk do PDV. Duas metades:
//
// 1. CONTRATO DE ESPECIFICADORES (varredura do src/): "zxing-wasm" só pode
//    aparecer em src/lib/leitor/fallback-zxing.ts, e "fallback-zxing" só em
//    src/lib/leitor/decodificador.ts — sempre DENTRO de um import
//    dinâmico `import(...)`. Um import estático em qualquer outro lugar
//    arrastaria os ~931 kB de WASM para o chunk de quem o escrevesse, e é
//    exatamente isso que a decisão D10 veta: WASM só para quem não tem
//    BarcodeDetector nativo (Safari iOS), nunca para o boot.
// 2. RUNTIME: com nativo presente (dublê), o fallback NUNCA é importado; sem
//    nativo, é importado UMA vez na primeira detecção e memoizado (a segunda
//    detecção não reimporta) — o mesmo `criarDecodificador` real, com o
//    `carregarFallback` padrão de C2.5.
//
// Mesmo ambiente `node` do teste do decodificador
// (leitor-de-codigo-decodificador.test.ts): o módulo é puro.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const RAIZ = path.resolve(process.cwd(), "src");

// vi.mock intercepta TAMBÉM o `import("./fallback-zxing")` dinâmico que o
// decodificador real dispara — é assim que o teste conta quantas vezes o
// fallback foi parar na memória sem carregar o WASM de verdade.
const contador = vi.hoisted(() => ({ importacoes: 0 }));
vi.mock("@/lib/leitor/fallback-zxing", () => {
  contador.importacoes += 1;
  return {
    moduloZxing: {
      readBarcodes: vi.fn(async () => [
        { text: "7891234567890", format: "EAN13" },
      ]),
    },
  };
});

import { criarDecodificador } from "@/lib/leitor/decodificador";

function arquivosDaPasta(pasta: string): string[] {
  const saida: string[] = [];
  // Os três `eslint-disable` da família fs: os caminhos nascem todos da
  // constante RAIZ (a pasta src/ deste repositório), nunca de entrada de
  // usuário — a regra não distingue, e o teto de warnings não tem folga.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const nome of readdirSync(pasta)) {
    const caminho = path.join(pasta, nome);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivosDaPasta(caminho));
    } else if (/\.(ts|tsx)$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
}

// Barras literais de verdade: `path.join` do Windows fabricaria "lib\\leitor"
// e a comparação com o relativo (sempre "/") nunca casaria.
const CAMINHO_DO_FALLBACK = "lib/leitor/fallback-zxing.ts";
const CAMINHO_DO_DECODIFICADOR = "lib/leitor/decodificador.ts";

// Especificador de USO, não menção em comentário: o bundler só enxerga
// `from "zxing-wasm…"`, `import("zxing-wasm…")` e `require("zxing-wasm…")`.
const ESPECIFICADOR_ZXING =
  /(from\s+["']zxing-wasm)|(import\(\s*["']zxing-wasm)|(require\(\s*["']zxing-wasm)/;

describe("C2.5 — o WASM do zxing fica fora do boot e do PDV", () => {
  it("contrato: 'zxing-wasm' só vive no adaptador, e o adaptador só é citado por import dinâmico", () => {
    const violadores: string[] = [];
    for (const caminho of arquivosDaPasta(RAIZ)) {
      const relativo = path.relative(RAIZ, caminho).split(path.sep).join("/");
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem da varredura da própria RAIZ, não de entrada de usuário
      const conteudo = readFileSync(caminho, "utf8");

      if (
        ESPECIFICADOR_ZXING.test(conteudo) &&
        relativo !== CAMINHO_DO_FALLBACK
      ) {
        violadores.push(
          `especificador zxing-wasm fora do adaptador: ${relativo}`,
        );
      }
      if (relativo !== CAMINHO_DO_DECODIFICADOR) continue;

      // Dentro do decodificador, cada citação ao adaptador tem de estar em
      // LINHA de import dinâmico — `import("...fallback-zxing...")`. Uma
      // citação em import estático (ou em string de outro tipo) reprova.
      // Linhas de comentário (`//` e `*`) não contam: o contrato é sobre o
      // que o bundler vê, e comentário não gera chunk.
      const linhas = conteudo.split(/\r?\n/);
      linhas.forEach((linha, indice) => {
        if (!linha.includes("fallback-zxing")) return;
        const limpa = linha.trim();
        const ehComentario = limpa.startsWith("//") || limpa.startsWith("*");
        const dinamico = /import\(/.test(linha);
        if (!ehComentario && !dinamico) {
          violadores.push(
            `linha ${indice + 1} do decodificador cita o adaptador fora de import(): ${limpa}`,
          );
        }
      });
    }
    expect(violadores).toEqual([]);
  });
});

describe("C2.5 — o carregador padrão só dispara quando falta o nativo", () => {
  beforeEach(() => {
    contador.importacoes = 0;
    vi.clearAllMocks();
  });

  const detectorNativo = {
    detect: async () => [{ rawValue: "7891234567890", format: "ean_13" }],
    getSupportedFormats: async () => ["ean_13", "code_128"],
  };
  const BarcodeDetectorNativo = class {
    constructor() {
      return detectorNativo;
    }
    static getSupportedFormats() {
      return detectorNativo.getSupportedFormats();
    }
  };

  it("com BarcodeDetector nativo, o fallback NUNCA é importado", async () => {
    const decodificador = await criarDecodificador({
      escopo: { BarcodeDetector: BarcodeDetectorNativo as never },
    });

    expect(decodificador.motor).toBe("nativo");
    const leituras = await decodificador.detectar({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    } as never);
    expect(leituras[0]?.codigo).toBe("7891234567890");
    expect(contador.importacoes).toBe(0);
  });

  it("sem nativo, o fallback é importado UMA vez e memoizado para os quadros seguintes", async () => {
    // `escopo: {}` desliga o nativo (é assim que o teste do decodificador
    // força o caminho zxing) — e `carregarFallback` fica por conta do
    // PADRÃO de C2.5: o import dinâmico do adaptador real (aqui, mockado).
    const decodificador = await criarDecodificador({ escopo: {} });

    expect(decodificador.motor).toBe("zxing");

    const quadro = {
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    } as never;
    const primeira = await decodificador.detectar(quadro);
    expect(primeira[0]?.codigo).toBe("7891234567890");
    expect(contador.importacoes).toBe(1);

    const segunda = await decodificador.detectar(quadro);
    expect(segunda[0]?.codigo).toBe("7891234567890");
    // Memoizado no fecho: o WASM não é recarregado a cada quadro (o laço da
    // câmera chama detectar várias vezes por segundo).
    expect(contador.importacoes).toBe(1);
  });
});
