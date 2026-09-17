// @vitest-environment jsdom
//
// achado AdminProductFormView-499: o ImageAdjuster SEMPRE exporta
// `image/webp` (ver ImageAdjuster.tsx: `const exportFormat = "image/webp"`
// passado a `canvas.toBlob`), mas `handleAdjustConfirm` embrulhava esse
// blob com nome fixo `product-image-<ts>.jpg` e `type: "image/jpeg"` —
// mentindo nome E Content-Type sobre um conteúdo que é WEBP de verdade.
//
// A consequência não é só estética: `uploadProductImages` deriva a
// extensão do bucket a partir do NOME do arquivo (`pronto.name.split(".")
// .pop()`, useProducts.ts:1223) e o Storage serve o objeto com o
// Content-Type do `File.type`. O transformador de imagem do Storage
// decodifica pelo Content-Type DECLARADO, não pelos bytes — um ".jpg"
// que é webp por dentro falha na transformação, e o LazyImage cai no
// fallback da imagem ORIGINAL (sem redimensionar) em toda a vitrine.
//
// Este teste não monta o componente inteiro (não precisa de contexto de
// produto/categoria/loja para provar isto): testa direto a função pura
// que decide nome e tipo do arquivo de upload a partir do Blob recortado,
// exportada só para isso — mesmo mecanismo de `compressProductImage` já
// usado em admin-product-form-compressimage-fundo-preto.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

// AdminProductFormView.tsx importa estes hooks no topo do arquivo — mockar
// evita que o `import` do módulo dispare a implementação real (que fala com
// Supabase/contexto React fora deste teste). Nenhum é chamado: este teste
// nunca monta o componente.
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminProductFormView — arquivoDaImagemRecortada (upload do recorte da tesoura) usa o tipo REAL do blob", () => {
  it("blob WEBP (o que o ImageAdjuster realmente exporta) vira arquivo .webp com Content-Type image/webp — não .jpg/image/jpeg", async () => {
    const { arquivoDaImagemRecortada } = await import(
      "@/views/admin/AdminProductFormView"
    );

    const blobWebp = new Blob(["conteudo-fake-webp"], { type: "image/webp" });
    const arquivo = arquivoDaImagemRecortada(blobWebp);

    // Esta é a asserção que o defeito original quebrava: nome e tipo
    // MENTIAM jpeg para um conteúdo webp.
    expect(arquivo.type).toBe("image/webp");
    expect(arquivo.name.endsWith(".webp")).toBe(true);
    expect(arquivo.name.endsWith(".jpg")).toBe(false);
    expect(arquivo.type).not.toBe("image/jpeg");
  });

  it("nome continua com o prefixo esperado por quem lê o arquivo depois", async () => {
    const { arquivoDaImagemRecortada } = await import(
      "@/views/admin/AdminProductFormView"
    );

    const blobWebp = new Blob(["x"], { type: "image/webp" });
    const arquivo = arquivoDaImagemRecortada(blobWebp);

    expect(arquivo.name.startsWith("product-image-")).toBe(true);
  });

  it("controle: um blob jpeg (se o ImageAdjuster algum dia mudar) ainda sai coerente — extensão .jpg com Content-Type image/jpeg", async () => {
    const { arquivoDaImagemRecortada } = await import(
      "@/views/admin/AdminProductFormView"
    );

    const blobJpeg = new Blob(["conteudo-fake-jpeg"], { type: "image/jpeg" });
    const arquivo = arquivoDaImagemRecortada(blobJpeg);

    expect(arquivo.type).toBe("image/jpeg");
    expect(arquivo.name.endsWith(".jpg")).toBe(true);
  });

  it("controle: blob sem `type` (ambiente que não preenche Blob.type) cai no formato que o ImageAdjuster de fato produz, webp — nunca no jpeg mentiroso antigo", async () => {
    const { arquivoDaImagemRecortada } = await import(
      "@/views/admin/AdminProductFormView"
    );

    const blobSemTipo = new Blob(["sem-tipo"]);
    const arquivo = arquivoDaImagemRecortada(blobSemTipo);

    expect(arquivo.type).toBe("image/webp");
    expect(arquivo.name.endsWith(".webp")).toBe(true);
  });
});
