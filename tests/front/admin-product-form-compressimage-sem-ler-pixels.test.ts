// @vitest-environment jsdom
//
// WebP/AVIF PEQUENO (< 100 KB) passa pelo canvas só para abrir no iPhone
// antigo, e ali a imagem é desenhada SEM fundo — para o recorte com
// transparência sair PNG. Mas quando o navegador não deixa ler os pixels
// (`getImageData` lança: canvas "sujo", bloqueio de leitura), a tela não vê a
// transparência e escolhe JPEG. JPEG não tem canal alfa: a área transparente
// saía PRETA na foto que vende o produto (28/11/2026).
//
// O conserto pinta branco ATRÁS do que já foi desenhado (`destination-over`)
// sempre que o ramo pequeno sai JPEG. O dublê de contexto grava o modo de
// composição e a cor VIGENTES no instante do `fillRect` — o `fillStyle`
// default do canvas é preto, e um `fillRect` em `source-over` depois do
// `drawImage` cobriria a foto inteira de branco.
//
// Mesmo arnês de `admin-product-form-compressimage-transparencia-e-nome.test.ts`.
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

interface Pintura {
  modo: string;
  cor: string;
  area: number[];
}

describe("compressProductImage — WebP/AVIF pequeno que sai JPEG nunca fica com fundo preto", () => {
  let chamadas: string[];
  let pinturas: Pintura[];
  /** Modo de composição vigente no instante do `toBlob`. */
  let modoNoToBlob: string | null;
  let tiposPedidos: string[];
  /** `getImageData` lança (navegador que bloqueia a leitura dos pixels). */
  let leituraBloqueada: boolean;
  /** Alfa do segundo pixel que o `getImageData` devolve (255 = opaco). */
  let alfa: number;

  beforeAll(async () => {
    await import("@/views/admin/AdminProductFormView");
  }, 60_000);

  beforeEach(() => {
    chamadas = [];
    pinturas = [];
    modoNoToBlob = null;
    tiposPedidos = [];
    leituraBloqueada = false;
    alfa = 255;
    const contexto = {
      fillStyle: "#000000",
      globalCompositeOperation: "source-over",
      fillRect: vi.fn((...area: number[]) => {
        chamadas.push("fillRect");
        pinturas.push({
          modo: contexto.globalCompositeOperation,
          cor: contexto.fillStyle,
          area,
        });
      }),
      drawImage: vi.fn(() => chamadas.push("drawImage")),
      getImageData: vi.fn(() => {
        if (leituraBloqueada) {
          throw new DOMException("canvas sujo", "SecurityError");
        }
        return {
          data: new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, alfa]),
        };
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      contexto as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (cb, tipo) => {
        modoNoToBlob = contexto.globalCompositeOperation;
        tiposPedidos.push(tipo ?? "");
        cb(new Blob([new Uint8Array(1)], { type: tipo ?? "image/png" }));
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

  const arquivo = (nome: string, tipo: string) =>
    new File([new Uint8Array(50 * 1024)], nome, { type: tipo });

  it.each([
    ["WebP", "recorte.webp", "image/webp"],
    ["AVIF", "recorte.avif", "image/avif"],
  ])(
    "%s pequeno sem poder ler os pixels: sai JPEG com branco pintado ATRÁS da foto",
    async (_rotulo, nome, tipo) => {
      leituraBloqueada = true;

      const resultado = await comprimir(arquivo(nome, tipo));

      expect(resultado.type).toBe("image/jpeg");
      expect(tiposPedidos).toEqual(["image/jpeg"]);
      // Branco, atrás do que já foi desenhado, cobrindo o canvas inteiro.
      expect(pinturas).toEqual([
        { modo: "destination-over", cor: "#FFFFFF", area: [0, 0, 800, 600] },
      ]);
      expect(chamadas).toEqual(["drawImage", "fillRect"]);
      // Modo restaurado: nada depois desenha "por trás" sem querer.
      expect(modoNoToBlob).toBe("source-over");
    },
  );

  it("WebP pequeno todo opaco também ganha o fundo — não muda nada na foto, e o JPEG nunca depende da leitura", async () => {
    const resultado = await comprimir(arquivo("foto.webp", "image/webp"));

    expect(resultado.type).toBe("image/jpeg");
    expect(pinturas).toEqual([
      { modo: "destination-over", cor: "#FFFFFF", area: [0, 0, 800, 600] },
    ]);
    expect(modoNoToBlob).toBe("source-over");
  });

  it("controle: com transparência detectada sai PNG, sem fundo nenhum pintado", async () => {
    alfa = 0;

    const resultado = await comprimir(arquivo("recorte.webp", "image/webp"));

    expect(resultado.type).toBe("image/png");
    expect(tiposPedidos).toEqual(["image/png"]);
    expect(chamadas).toEqual(["drawImage"]);
    expect(pinturas).toEqual([]);
  });
});
