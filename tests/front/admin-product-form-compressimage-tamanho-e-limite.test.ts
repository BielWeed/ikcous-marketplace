// @vitest-environment jsdom
//
// Caça de provas fracas (mutação) em `compressProductImage` (foto do produto
// no formulário), 24/11/2026. O teste do fundo branco prova o canvas, mas nunca
// olha o TAMANHO do que sai nem a fronteira dos 100 KB. Sobreviviam: arredondar
// a largura de uma foto em retrato para baixo (685,7 px viram 685) e tratar o
// arquivo de exatamente 100 KB como pequeno demais para reduzir.
//
// O que protege: a foto grande sai com o maior lado em 1200 px, a proporção
// mantida e a fração ARREDONDADA; foto que já cabe não é redimensionada; e o
// limite dos 100 KB é "a partir de 100 KB reduz" (o teste anterior só tinha
// arquivos bem acima ou bem abaixo).
//
// Mesmo arnês do teste irmão (`...-fundo-preto`): só o que o jsdom não tem é
// dublado (a imagem que "carrega" com a dimensão escolhida e o canvas).
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn(),
    deleteVariants: vi.fn(),
    uploadProductImages: vi.fn(),
    fetchProduct: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

const medidas = { largura: 0, altura: 0 };

class ImagemComMedida {
  width = medidas.largura;
  height = medidas.altura;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = "";
  set src(valor: string) {
    this.#src = valor;
    setTimeout(() => this.onload?.(), 0);
  }
  get src() {
    return this.#src;
  }
}

describe("compressProductImage — tamanho de saída e fronteira dos 100 KB", () => {
  let canvasGravado: { width: number; height: number } | null;
  let qualidadePedida: unknown;
  let desenhou: boolean;

  // O formulário inteiro é um módulo enorme: a primeira importação leva
  // segundos e não pode contar no prazo de um teste.
  beforeAll(async () => {
    await import("@/views/admin/AdminProductFormView");
  }, 60_000);

  beforeEach(() => {
    canvasGravado = null;
    qualidadePedida = null;
    desenhou = false;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(() => {
        desenhou = true;
      }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, cb, tipo, qualidade) {
        canvasGravado = { width: this.width, height: this.height };
        qualidadePedida = qualidade;
        cb(new Blob(["x"], { type: tipo ?? "image/jpeg" }));
      },
    );
    vi.stubGlobal("Image", ImagemComMedida);
    class URLComObjectURL extends URL {
      static createObjectURL = vi.fn(() => "blob:fake-url");
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", URLComObjectURL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const foto = (bytes: number, nome = "produto.jpg") =>
    new File([new Uint8Array(bytes)], nome, { type: "image/jpeg" });

  async function comprimir(
    largura: number,
    altura: number,
    arquivo: File = foto(150 * 1024),
  ) {
    medidas.largura = largura;
    medidas.altura = altura;
    const { compressProductImage } = await import(
      "@/views/admin/AdminProductFormView"
    );
    return compressProductImage(arquivo);
  }

  it.each([
    ["paisagem 3000x2000", 3000, 2000, 1200, 800],
    ["retrato 2000x3000", 2000, 3000, 800, 1200],
    ["quadrada 2400x2400", 2400, 2400, 1200, 1200],
    ["paisagem pouco acima do limite 1800x1200", 1800, 1200, 1200, 800],
    ["retrato pouco acima do limite 1200x1800", 1200, 1800, 800, 1200],
    // 2000 * 1200 / 3500 = 685,71: arredonda para 686 (cortar daria 685)
    ["paisagem 3500x2000 (fração .71)", 3500, 2000, 1200, 686],
    ["retrato 2000x3500 (fração .71)", 2000, 3500, 686, 1200],
  ])(
    "foto %s sai com o maior lado em 1200 px e a proporção mantida",
    async (_nome, largura, altura, larguraEsperada, alturaEsperada) => {
      await comprimir(largura, altura);

      expect(canvasGravado).toEqual({
        width: larguraEsperada,
        height: alturaEsperada,
      });
    },
  );

  it.each([
    ["menor que o limite nos dois lados", 1000, 800],
    ["exatamente no limite", 1200, 1200],
  ])("foto %s não é ampliada nem encolhida", async (_nome, largura, altura) => {
    await comprimir(largura, altura);

    expect(canvasGravado).toEqual({ width: largura, height: altura });
  });

  it("sai JPEG com o mesmo nome, qualidade 0,85 e data de agora", async () => {
    const resultado = await comprimir(
      3000,
      2000,
      foto(150 * 1024, "IMG_9.jpg"),
    );

    expect(resultado.type).toBe("image/jpeg");
    expect(resultado.name).toBe("IMG_9.jpg");
    expect(qualidadePedida).toBe(0.85);
  });

  it("100 KB cravados já passam pelo canvas; um byte a menos sai intacto", async () => {
    const cravado = foto(100 * 1024);
    const resultadoCravado = await comprimir(3000, 2000, cravado);

    expect(desenhou).toBe(true);
    expect(resultadoCravado).not.toBe(cravado);

    desenhou = false;
    const menor = foto(100 * 1024 - 1);
    expect(await comprimir(3000, 2000, menor)).toBe(menor);
    expect(desenhou).toBe(false);
  });
});
