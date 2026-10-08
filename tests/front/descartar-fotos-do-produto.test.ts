// `descartarFotosDoProduto`: apaga do bucket `products` o objeto que um envio
// atrasado acabou gravando. Apagar é irreversível, então o teste principal é o
// que NÃO pode ser apagado: só a URL pública do PRÓPRIO Supabase da loja, no
// bucket `products`, cujo nome é exatamente o que o envio gera
// (`<uuid minúsculo>.<ext>` na raiz). Qualquer outra forma falha FECHADA.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: mocks.from } },
}));

import { descartarFotosDoProduto } from "@/lib/descartar-fotos-do-produto";

const ORIGEM = "https://loja.supabase.co";
const BASE = `${ORIGEM}/storage/v1/object/public/products/`;
const UUID = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";
const ARQUIVO = `${UUID}.jpg`;

describe("descartarFotosDoProduto", () => {
  let aviso: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", ORIGEM);
    mocks.remove.mockReset();
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValue({ remove: mocks.remove });
    aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("o que apaga", () => {
    it("caso feliz: URL real do projeto + uuid.ext apaga exatamente esse nome, numa chamada só", async () => {
      await descartarFotosDoProduto([`${BASE}${ARQUIVO}`]);
      expect(mocks.from).toHaveBeenCalledWith("products");
      expect(mocks.remove).toHaveBeenCalledTimes(1);
      expect(mocks.remove).toHaveBeenCalledWith([ARQUIVO]);
    });

    it.each(["jpg", "jpeg", "png", "webp", "heic", "JPG", "JPEG"])(
      "extensão .%s (a do nome do arquivo do aparelho) é aceita",
      async (ext) => {
        await descartarFotosDoProduto([`${BASE}${UUID}.${ext}`]);
        expect(mocks.remove).toHaveBeenCalledWith([`${UUID}.${ext}`]);
      },
    );

    it("mistura: apaga só as URLs válidas, juntas numa chamada, e ignora as outras", async () => {
      const outro = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.webp";
      await descartarFotosDoProduto([
        `${BASE}${ARQUIVO}`,
        `${BASE}backup/x.jpg`,
        "https://placehold.co/1",
        `${BASE}${outro}`,
      ]);
      expect(mocks.remove).toHaveBeenCalledTimes(1);
      expect(mocks.remove).toHaveBeenCalledWith([ARQUIVO, outro]);
    });

    it("lista vazia: não fala com o storage", async () => {
      await descartarFotosDoProduto([]);
      expect(mocks.from).not.toHaveBeenCalled();
    });
  });

  describe("o que NÃO apaga (falha fechada: loga e segue)", () => {
    // Tabela hostil: cada linha já foi uma forma que a versão anterior apagava
    // (ou poderia apagar) por só olhar o trecho `/public/products/`.
    const hostis: Array<[string, string]> = [
      [
        "host de outro dono",
        `https://evil.com/storage/v1/object/public/products/${ARQUIVO}`,
      ],
      [
        "host que só começa igual",
        `https://loja.supabase.co.evil.com/storage/v1/object/public/products/${ARQUIVO}`,
      ],
      [
        "host com credencial embutida",
        `https://loja.supabase.co@evil.com/storage/v1/object/public/products/${ARQUIVO}`,
      ],
      [
        "http no lugar de https",
        `http://loja.supabase.co/storage/v1/object/public/products/${ARQUIVO}`,
      ],
      [
        "porta diferente",
        `https://loja.supabase.co:8443/storage/v1/object/public/products/${ARQUIVO}`,
      ],
      [
        "esquema javascript:",
        `javascript:/storage/v1/object/public/products/${ARQUIVO}`,
      ],
      [
        "prefixo de bucket não ancorado no começo",
        `${ORIGEM}/banners/storage/v1/object/public/products/${ARQUIVO}`,
      ],
      ["outro bucket", `${ORIGEM}/storage/v1/object/public/banners/${ARQUIVO}`],
      [
        "PRODUCTS em maiúsculo",
        `${ORIGEM}/storage/v1/object/public/PRODUCTS/${ARQUIVO}`,
      ],
      [
        "rota render/image",
        `${ORIGEM}/storage/v1/render/image/public/products/${ARQUIVO}`,
      ],
      [
        "rota object/sign",
        `${ORIGEM}/storage/v1/object/sign/products/${ARQUIVO}?token=abc`,
      ],
      ["subpasta backup/", `${BASE}backup/${ARQUIVO}`],
      ["subpasta qualquer", `${BASE}pasta/${ARQUIVO}`],
      ["barra dupla antes do nome", `${BASE}/${ARQUIVO}`],
      ["nome com barra dupla", `${BASE}/dupla.jpg`],
      ["curinga *", `${BASE}*`],
      ["nome que não é uuid", `${BASE}x.jpg`],
      ["nome antigo com hífens (não é uuid)", `${BASE}abc-123.jpg`],
      [
        "uuid em MAIÚSCULO (o envio gera minúsculo)",
        `${BASE}${UUID.toUpperCase()}.jpg`,
      ],
      ["uuid sem extensão", `${BASE}${UUID}`],
      ["uuid com extensão vazia", `${BASE}${UUID}.`],
      ["uuid com extensão longa demais", `${BASE}${UUID}.jpegjpeg`],
      ["uuid com dupla extensão", `${BASE}${UUID}.jpg.exe`],
      ["uuid com lixo depois", `${BASE}${UUID}.jpg%00`],
      ["barra invertida codificada", `${BASE}a%5Cb.jpg`],
      ["byte nulo codificado", `${BASE}a%00.jpg`],
      ["percent malformado", `${BASE}%E0%A4%A`],
      ["ponto sozinho", `${BASE}.`],
      ["dois pontos (sobe pasta)", `${BASE}..`],
      ["dois pontos codificados", `${BASE}%2e%2e`],
      ["sobe pasta antes do nome", `${BASE}../${ARQUIVO}`],
      ["uuid com query string", `${BASE}${ARQUIVO}?download=1`],
      ["uuid com fragmento", `${BASE}${ARQUIVO}#x`],
      ["sem caminho depois do bucket", BASE],
      ["placeholder externo", "https://placehold.co/600x600"],
      ["texto que não é URL", "nao-e-url"],
      ["string vazia", ""],
    ];

    it.each(hostis)("NÃO apaga: %s", async (_nome, url) => {
      await expect(descartarFotosDoProduto([url])).resolves.toBeUndefined();
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
    });

    it("loga o que recusou (não some em silêncio)", async () => {
      await descartarFotosDoProduto([`https://evil.com/${ARQUIVO}`]);
      expect(aviso).toHaveBeenCalled();
    });

    it("sem VITE_SUPABASE_URL não há como provar de quem é a URL: não apaga nada", async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "");
      await descartarFotosDoProduto([`${BASE}${ARQUIVO}`]);
      expect(mocks.remove).not.toHaveBeenCalled();
    });

    it("o host configurado é outro: a URL de uma loja não apaga na outra", async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "https://outra-loja.supabase.co");
      await descartarFotosDoProduto([`${BASE}${ARQUIVO}`]);
      expect(mocks.remove).not.toHaveBeenCalled();
    });
  });

  describe("falha ao apagar", () => {
    it("o storage devolve erro: loga e NÃO lança", async () => {
      const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.remove.mockResolvedValue({
        data: null,
        error: { message: "negado" },
      });
      await expect(
        descartarFotosDoProduto([`${BASE}${ARQUIVO}`]),
      ).resolves.toBeUndefined();
      expect(erroLog).toHaveBeenCalled();
    });

    it("o storage lança: loga e NÃO lança", async () => {
      const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.remove.mockRejectedValue(new Error("rede caiu"));
      await expect(
        descartarFotosDoProduto([`${BASE}${ARQUIVO}`]),
      ).resolves.toBeUndefined();
      expect(erroLog).toHaveBeenCalled();
    });
  });
});
