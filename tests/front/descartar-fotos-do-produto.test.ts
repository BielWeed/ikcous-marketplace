// `descartarFotosDoProduto`: apaga do bucket `products` o objeto que um envio
// atrasado acabou gravando. Apagar é irreversível, então o teste principal é o
// que NÃO pode ser apagado: só `<uuid>.<ext>` na raiz do bucket de produtos.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: mocks.from } },
}));

import { descartarFotosDoProduto } from "@/lib/descartar-fotos-do-produto";

const BASE = "https://loja.supabase.co/storage/v1/object/public/products/";

describe("descartarFotosDoProduto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockReset();
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValue({ remove: mocks.remove });
  });

  it("apaga, do bucket products, o caminho que a URL do envio aponta", async () => {
    await descartarFotosDoProduto([`${BASE}abc-123.jpg`]);
    expect(mocks.from).toHaveBeenCalledWith("products");
    expect(mocks.remove).toHaveBeenCalledWith(["abc-123.jpg"]);
  });

  it("decodifica o nome (URL com caractere escapado)", async () => {
    await descartarFotosDoProduto([`${BASE}foto%20a.jpg`]);
    expect(mocks.remove).toHaveBeenCalledWith(["foto a.jpg"]);
  });

  it("lista vazia: não fala com o storage", async () => {
    await descartarFotosDoProduto([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    [
      "outro bucket",
      "https://loja.supabase.co/storage/v1/object/public/banners/b.jpg",
    ],
    ["subpasta (backup/)", `${BASE}backup/antigo_1.jpg`],
    ["subpasta qualquer", `${BASE}pasta/x.jpg`],
    ["travessia de pasta codificada", `${BASE}..%2Foutro.jpg`],
    ["placeholder externo", "https://placehold.co/600x600"],
    ["sem caminho depois do bucket", BASE],
    ["texto que não é URL", "nao-e-url"],
    ["string vazia", ""],
  ])("NÃO apaga: %s", async (_nome, url) => {
    await descartarFotosDoProduto([url]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("mistura: apaga só as URLs válidas e ignora as outras", async () => {
    await descartarFotosDoProduto([
      `${BASE}ok.jpg`,
      `${BASE}backup/x.jpg`,
      "https://placehold.co/1",
    ]);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(["ok.jpg"]);
  });

  it("o storage devolve erro: loga e NÃO lança", async () => {
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.remove.mockResolvedValue({
      data: null,
      error: { message: "negado" },
    });
    await expect(
      descartarFotosDoProduto([`${BASE}a.jpg`]),
    ).resolves.toBeUndefined();
    expect(erroLog).toHaveBeenCalled();
    erroLog.mockRestore();
  });

  it("o storage lança: loga e NÃO lança", async () => {
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.remove.mockRejectedValue(new Error("rede caiu"));
    await expect(
      descartarFotosDoProduto([`${BASE}a.jpg`]),
    ).resolves.toBeUndefined();
    expect(erroLog).toHaveBeenCalled();
    erroLog.mockRestore();
  });
});
