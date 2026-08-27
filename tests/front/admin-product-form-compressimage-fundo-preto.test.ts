// @vitest-environment jsdom
//
// A foto do PRODUTO — a que vende na vitrine — vira fundo preto quando a
// lojista sobe um PNG com área transparente. `compressProductImage`, a
// cópia LOCAL deste arquivo (não a `compressImage` de
// `src/utils/avatars.ts`, já corrigida — nomes diferentes de propósito,
// para o TypeScript nunca auto-importar a errada), desenha a
// imagem num <canvas> e chama `canvas.toBlob(..., "image/jpeg", quality)`
// sem pintar nada antes. JPEG não tem canal alfa: a área transparente do PNG
// é composta sobre PRETO por padrão do canvas.
//
// Diferença desta cópia para a de avatars.ts/covers.ts: devolve `File` via
// `canvas.toBlob` (assíncrono, por callback), não `string` via
// `toDataURL()`. E tem uma porta de saída ANTES do canvas —
// `if (!file.type.startsWith("image/") || file.size < 100 * 1024) resolve(file)`
// — então só o arquivo de imagem com 100 KB ou mais passa pelo canvas; menor
// que isso mantém a transparência intacta (não é o caminho que este arquivo
// testa, é o controle negativo abaixo).
//
// Mesmo mecanismo de prova de avatar-e-capa-png-transparente-vira-fundo-preto
// .test.ts: dublê de contexto 2D que grava a ORDEM das chamadas e a COR
// vigente no instante do `fillRect` — o `fillStyle` default de um canvas real
// é preto, então uma asserção que só medisse a ordem (sem a cor) passaria
// verde com o defeito original de volta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastInfo = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastLoading = vi.fn();

// AdminProductFormView.tsx importa estes hooks no topo do arquivo — mockar é
// necessário só para o `import` do módulo não disparar a implementação real
// (que fala com Supabase/contexto React fora deste teste). Nenhum deles é
// chamado: este teste nunca monta o componente, só importa
// `compressProductImage`.
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
    info: toastInfo,
    success: toastSuccess,
    error: toastError,
    loading: toastLoading,
  },
}));

class ImagemFalsa {
  width = 1600;
  height = 1600;
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

interface ContextoFalso {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

describe("AdminProductFormView — compressImage (foto do produto) não pinta a área transparente do PNG", () => {
  let chamadas: string[];
  let contexto: ContextoFalso;
  // A cor VIGENTE no instante do `fillRect`, não a lida no fim — mesma
  // proteção do teste irmão de avatar/capa.
  let corNoFillRect: string | null;
  let toBlobSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    chamadas = [];
    corNoFillRect = null;
    contexto = {
      fillStyle: "",
      fillRect: vi.fn(() => {
        corNoFillRect = contexto.fillStyle;
        chamadas.push("fillRect");
      }),
      drawImage: vi.fn(() => chamadas.push("drawImage")),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      // Dublê deliberadamente parcial do CanvasRenderingContext2D real —
      // só o que o código sob teste usa.
      contexto as any,
    );
    toBlobSpy = vi.fn(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
    ) {
      chamadas.push("toBlob");
      callback(new Blob(["conteudo-fake"], { type: type ?? "image/jpeg" }));
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      toBlobSpy as unknown as typeof HTMLCanvasElement.prototype.toBlob,
    );
    vi.stubGlobal("Image", ImagemFalsa);
    // jsdom não implementa `URL.createObjectURL`/`revokeObjectURL` — e
    // substituir `URL` por um objeto plano (`{ ...URL }`) quebra `new URL(...)`
    // em qualquer código carregado no meio do caminho ("URL is not a
    // constructor"). Uma subclasse continua sendo um construtor de verdade.
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

  // > 100 KB: passa da porta de saída antecipada e entra de verdade no
  // canvas — é o caminho que este arquivo testa.
  function arquivoGrande(tipo = "image/png"): File {
    return new File([new Uint8Array(150 * 1024)], "produto.png", {
      type: tipo,
    });
  }

  it("pinta um fundo BRANCO antes de desenhar a imagem — senão a área transparente vira preto na foto do produto", async () => {
    const { compressProductImage } = await import(
      "@/views/admin/AdminProductFormView"
    );

    await compressProductImage(arquivoGrande());

    expect(contexto.fillRect).toHaveBeenCalled();
    expect(contexto.drawImage).toHaveBeenCalled();
    const posicaoFill = chamadas.indexOf("fillRect");
    const posicaoDraw = chamadas.indexOf("drawImage");
    expect(posicaoFill).toBeGreaterThanOrEqual(0);
    expect(posicaoFill).toBeLessThan(posicaoDraw);
    // Ordem certa com a cor errada é o defeito original de volta.
    expect(corNoFillRect?.toUpperCase()).toBe("#FFFFFF");
    // O `fillRect` precisa cobrir o canvas INTEIRO (largura e altura), não
    // metade dele — pintar só metade deixaria a outra metade da foto
    // composta sobre preto na vitrine, e nenhuma asserção acima (ordem,
    // cor) enxerga essa área. A imagem falsa é 1600x1600 e o padrão de
    // `compressProductImage` é 1200x1200: o maior lado é reduzido para
    // 1200, o outro acompanha a proporção (também 1200, por ser quadrada).
    expect(contexto.fillRect).toHaveBeenCalledWith(0, 0, 1200, 1200);
  });

  it("continua devolvendo image/jpeg, com a qualidade padrão — o conserto não troca o tipo nem destrói a compressão que o upload espera", async () => {
    const { compressProductImage } = await import(
      "@/views/admin/AdminProductFormView"
    );

    const comprimido = await compressProductImage(arquivoGrande());

    expect(comprimido.type).toBe("image/jpeg");
    // Sem checar os argumentos do `toBlob`, um `quality` despencado (ex.:
    // 0.1 no lugar do padrão 0.85) passaria verde — o dublê de `toBlob`
    // ignora esse argumento, só o tipo do arquivo final é conferido acima.
    expect(toBlobSpy).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.85,
    );
  });

  it("controle negativo: arquivo PEQUENO (< 100 KB) nunca passa pelo canvas — sai intacto, sem fillRect nem drawImage", async () => {
    const { compressProductImage } = await import(
      "@/views/admin/AdminProductFormView"
    );
    const arquivoPequeno = new File(
      [new Uint8Array(50 * 1024)],
      "produto-pequeno.png",
      { type: "image/png" },
    );

    const resultado = await compressProductImage(arquivoPequeno);

    expect(contexto.fillRect).not.toHaveBeenCalled();
    expect(contexto.drawImage).not.toHaveBeenCalled();
    expect(resultado).toBe(arquivoPequeno);
  });

  it("controle negativo: arquivo que NÃO é imagem sai intacto, sem passar pelo canvas", async () => {
    const { compressProductImage } = await import(
      "@/views/admin/AdminProductFormView"
    );
    const arquivoNaoImagem = new File(
      [new Uint8Array(200 * 1024)],
      "documento.pdf",
      { type: "application/pdf" },
    );

    const resultado = await compressProductImage(arquivoNaoImagem);

    expect(contexto.fillRect).not.toHaveBeenCalled();
    expect(contexto.drawImage).not.toHaveBeenCalled();
    expect(resultado).toBe(arquivoNaoImagem);
  });
});
