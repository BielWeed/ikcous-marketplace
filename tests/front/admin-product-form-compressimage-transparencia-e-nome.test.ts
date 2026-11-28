// @vitest-environment jsdom
//
// Quatro bordas da conversão da foto do produto (`compressProductImage`),
// 28/11/2026, todas no caminho que existe para a foto abrir no iPhone antigo:
//
//  1. WebP/AVIF pequeno COM transparência (produto recortado, sem fundo) saía
//     JPEG — JPEG não tem canal alfa, e o recorte ganhava um fundo. Agora sai
//     PNG; sem transparência continua JPEG.
//  2. "Fica com o menor": a conversão de um JPEG/PNG grande que sai MAIOR que
//     o original fica com o original (como `src/lib/canvas-para-blob.ts`). Mas
//     WebP/AVIF não abre no iPhone antigo: ali a compatibilidade vence o peso.
//  3. `.webp` com tipo vazio ou `application/octet-stream` (alguns gerenciadores
//     de arquivo mandam assim): a tela já o tipa pelo nome na entrada (#1985);
//     aqui fica a guarda de que, tipado assim, ele converte e troca o nome.
//  4. A foto convertida guardava o nome antigo: "foto.webp" com JPEG dentro.
//     O upload tira a extensão do bucket do NOME — ela tem de dizer a verdade.
//
// Mesmo arnês de `admin-product-form-foto-original-abre-no-iphone-antigo.test.ts`,
// com `getImageData` no contexto falso: é por ele que a tela vê a transparência.
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

class ImagemDe800x600 {
  width = 800;
  height = 600;
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

describe("compressProductImage — transparência, peso, tipo pelo nome e extensão", () => {
  let tiposPedidos: string[];
  let chamadas: string[];
  let desenhou: boolean;
  /** Alfa do segundo pixel que o `getImageData` devolve (255 = opaco). */
  let alfa: number;
  /** Peso, em bytes, do que o canvas "gera". */
  let pesoDaSaida: number;

  beforeAll(async () => {
    await import("@/views/admin/AdminProductFormView");
  }, 60_000);

  beforeEach(() => {
    tiposPedidos = [];
    chamadas = [];
    desenhou = false;
    alfa = 255;
    pesoDaSaida = 1;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(() => chamadas.push("fillRect")),
      drawImage: vi.fn(() => {
        desenhou = true;
        chamadas.push("drawImage");
      }),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, alfa]),
      })),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (cb, tipo) => {
        tiposPedidos.push(tipo ?? "");
        cb(
          new Blob([new Uint8Array(pesoDaSaida)], {
            type: tipo ?? "image/png",
          }),
        );
      },
    );
    vi.stubGlobal("Image", ImagemDe800x600);
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

  async function comprimir(arquivo: File) {
    const { compressProductImage } = await import(
      "@/views/admin/AdminProductFormView"
    );
    return compressProductImage(arquivo);
  }

  const arquivo = (kb: number, nome: string, tipo: string) =>
    new File([new Uint8Array(kb * 1024)], nome, { type: tipo });

  describe("1. WebP/AVIF pequeno com transparência sai PNG", () => {
    it.each([
      ["WebP", "recorte.webp", "image/webp"],
      ["AVIF", "recorte.avif", "image/avif"],
    ])(
      "%s com um pixel transparente sai PNG, sem fundo pintado",
      async (_rotulo, nome, tipo) => {
        alfa = 0;

        const resultado = await comprimir(arquivo(50, nome, tipo));

        expect(resultado.type).toBe("image/png");
        expect(tiposPedidos).toEqual(["image/png"]);
        expect(chamadas).not.toContain("fillRect");
      },
    );

    it("meio transparente (alfa 128) também conta como transparência", async () => {
      alfa = 128;

      const resultado = await comprimir(
        arquivo(50, "sombra.webp", "image/webp"),
      );

      expect(resultado.type).toBe("image/png");
    });

    it("controle: WebP pequeno todo opaco continua saindo JPEG", async () => {
      const resultado = await comprimir(arquivo(50, "foto.webp", "image/webp"));

      expect(resultado.type).toBe("image/jpeg");
      expect(tiposPedidos).toEqual(["image/jpeg"]);
    });
  });

  describe("2. fica com o menor, mas a compatibilidade vence", () => {
    it("JPEG grande cuja conversão sai MAIOR que o original: sobe o original", async () => {
      const original = arquivo(150, "produto.jpg", "image/jpeg");
      pesoDaSaida = 200 * 1024;

      expect(await comprimir(original)).toBe(original);
    });

    it("PNG grande cuja conversão empata com o original: sobe o original", async () => {
      const original = arquivo(150, "produto.png", "image/png");
      pesoDaSaida = 150 * 1024;

      expect(await comprimir(original)).toBe(original);
    });

    it.each([
      ["WebP pequeno", 50, "foto.webp", "image/webp"],
      ["WebP grande", 150, "foto.webp", "image/webp"],
      ["AVIF pequeno", 50, "foto.avif", "image/avif"],
    ])(
      "%s cuja conversão sai MAIOR: sobe a convertida (o original não abre no iPhone antigo)",
      async (_rotulo, kb, nome, tipo) => {
        const original = arquivo(kb, nome, tipo);
        pesoDaSaida = kb * 1024 * 3;

        const resultado = await comprimir(original);

        expect(resultado).not.toBe(original);
        expect(resultado.type).toBe("image/jpeg");
      },
    );

    it("controle: JPEG grande cuja conversão sai menor sobe a convertida", async () => {
      const original = arquivo(150, "produto.jpg", "image/jpeg");
      pesoDaSaida = 80 * 1024;

      const resultado = await comprimir(original);

      expect(resultado).not.toBe(original);
      expect(resultado.size).toBe(80 * 1024);
    });
  });

  // O tipo pelo nome já é dado na ENTRADA do envio (`comTipoDaExtensao`, PR
  // #1985), antes de `compressProductImage`: a tela chama as duas nesta ordem.
  // Guarda de regressão da composição — não é o vermelho deste lote.
  describe("3. .webp sem tipo, como a tela o entrega, também converte", () => {
    it.each([
      ["tipo vazio", ""],
      ["application/octet-stream", "application/octet-stream"],
    ])(
      "foto.webp com %s passa pelo canvas e sai JPEG",
      async (_rotulo, tipo) => {
        const { comTipoDaExtensao } = await import("@/lib/recusa-de-foto");

        const resultado = await comprimir(
          comTipoDaExtensao(arquivo(50, "foto.webp", tipo)),
        );

        expect(desenhou).toBe(true);
        expect(resultado.type).toBe("image/jpeg");
        expect(resultado.name).toBe("foto.jpg");
      },
    );
  });

  describe("4. o nome da convertida tem a extensão do conteúdo real", () => {
    it.each([
      ["WebP opaco", 50, "foto.webp", "image/webp", 255, "foto.jpg"],
      ["WebP transparente", 50, "foto.webp", "image/webp", 0, "foto.png"],
      ["AVIF opaco", 50, "IMG_1.avif", "image/avif", 255, "IMG_1.jpg"],
      [
        "WebP grande",
        150,
        "loja.da.ana.webp",
        "image/webp",
        255,
        "loja.da.ana.jpg",
      ],
      ["PNG grande", 150, "produto.png", "image/png", 0, "produto.jpg"],
    ])(
      "%s: %s vira o nome certo",
      async (_rotulo, kb, nome, tipo, alfaDoPixel, esperado) => {
        alfa = alfaDoPixel;

        const resultado = await comprimir(arquivo(kb, nome, tipo));

        expect(resultado.name).toBe(esperado);
      },
    );

    it.each([
      ["foto.jpg", "foto.jpg"],
      ["foto.JPEG", "foto.JPEG"],
    ])(
      "controle: JPEG grande que continua JPEG mantém o nome (%s)",
      async (nome, esperado) => {
        const resultado = await comprimir(arquivo(150, nome, "image/jpeg"));

        expect(resultado.name).toBe(esperado);
      },
    );
  });
});
