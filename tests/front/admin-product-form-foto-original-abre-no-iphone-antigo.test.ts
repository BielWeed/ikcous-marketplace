// @vitest-environment jsdom
//
// A foto ORIGINAL do produto tem de abrir no iPhone antigo (28/11/2026). As
// miniaturas WebP têm plano B — se o aparelho não as abre, a vitrine cai na
// original —, mas a original não tem para onde cair. iPhone com iOS 13 ou
// mais velho não abre WebP; até o iOS 15, não abre AVIF. Ali a cliente via
// "Toque para tentar de novo" no lugar da foto.
//
// O caminho: `compressProductImage` deixava passar intacto todo arquivo com
// menos de 100 KB — inclusive WebP e AVIF —, e o envio seguinte
// (`redimensionarImagem`) também não mexe abaixo de 400 KB. Um WebP pequeno
// ia ao armazenamento como WebP.
//
// O que protege: WebP e AVIF ESTÁTICOS de qualquer peso passam pelo canvas e
// saem JPEG, sem ampliar. Controles: JPEG e PNG pequenos continuam subindo
// como vieram (sem recompressão à toa); GIF e WebP animado continuam intactos
// (o canvas guardaria só o primeiro quadro).
//
// Mesmo arnês de `admin-product-form-compressimage-tamanho-e-limite.test.ts`.
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

/** WebP animado: RIFF....WEBPVP8X com o selo de animação (0x02) no byte 20. */
function webpAnimado(bytes: number): File {
  const dados = new Uint8Array(bytes);
  const ascii = (texto: string) => [...texto].map((c) => c.charCodeAt(0));
  dados.set(ascii("RIFF"), 0);
  dados.set(ascii("WEBPVP8X"), 8);
  dados[20] = 0x02;
  return new File([dados], "girando.webp", { type: "image/webp" });
}

describe("compressProductImage — a original sobe num formato que o iPhone antigo abre", () => {
  let tiposPedidos: string[];
  let canvasGravado: { width: number; height: number } | null;
  let desenhou: boolean;

  beforeAll(async () => {
    await import("@/views/admin/AdminProductFormView");
  }, 60_000);

  beforeEach(() => {
    tiposPedidos = [];
    canvasGravado = null;
    desenhou = false;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(() => {
        desenhou = true;
      }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, cb, tipo) {
        tiposPedidos.push(tipo ?? "");
        canvasGravado = { width: this.width, height: this.height };
        cb(new Blob(["x"], { type: tipo ?? "image/png" }));
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

  const pequena = (nome: string, tipo: string) =>
    new File([new Uint8Array(50 * 1024)], nome, { type: tipo });

  it.each([
    ["WebP", "foto.webp", "image/webp"],
    ["AVIF", "foto.avif", "image/avif"],
  ])(
    "%s pequeno (50 KB) sai JPEG, sem ampliar a foto",
    async (_rotulo, nome, tipo) => {
      const resultado = await comprimir(pequena(nome, tipo));

      expect(resultado.type).toBe("image/jpeg");
      expect(tiposPedidos).toEqual(["image/jpeg"]);
      expect(canvasGravado).toEqual({ width: 800, height: 600 });
    },
  );

  it.each([
    ["JPEG", "foto.jpg", "image/jpeg"],
    ["PNG", "foto.png", "image/png"],
    ["GIF", "foto.gif", "image/gif"],
  ])(
    "controle: %s pequeno sobe como veio, sem passar pelo canvas",
    async (_rotulo, nome, tipo) => {
      const arquivo = pequena(nome, tipo);

      expect(await comprimir(arquivo)).toBe(arquivo);
      expect(desenhou).toBe(false);
      expect(tiposPedidos).toEqual([]);
    },
  );

  it("controle: WebP animado continua intacto (o canvas perderia a animação)", async () => {
    const arquivo = webpAnimado(50 * 1024);

    expect(await comprimir(arquivo)).toBe(arquivo);
    expect(desenhou).toBe(false);
  });
});
