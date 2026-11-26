// @vitest-environment jsdom
//
// Envio da foto do produto COM a pirâmide de cópias (plano das miniaturas,
// 26/11/2026). A invariante que este arquivo prende: NUNCA existe endereço
// marcado sem as 3 cópias gravadas.
//   - as 3 cópias sobem PRIMEIRO; a original marcada (`<uuid>-vw.<ext>`) sobe
//     por ÚLTIMO, só depois de as três terem dado certo;
//   - falhou qualquer cópia: as cópias são apagadas e a original sobe SEM
//     marca, com o nome de hoje (`<uuid>.<ext>`);
//   - falhou a original marcada: as cópias são apagadas e o envio falha como
//     hoje (aviso de erro, nenhuma URL);
//   - sem `opcoes.piramide` (outros chamadores), o envio é exatamente o de hoje.
//
// Hook REAL; o Storage é dublado e o gerador é entregue pelo teste (o real
// mora só no painel).
import { useProducts } from "@/hooks/useProducts";
import { marcaDe } from "@/lib/piramide-da-foto-nomes";
import type { GerarPiramide, Piramide } from "@/lib/piramide-da-foto-nomes";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  erro: vi.fn(),
  buckets: [] as string[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "u-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: h.erro, loading: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { refreshSession: vi.fn() },
    storage: {
      from: (bucket: string) => {
        h.buckets.push(bucket);
        return {
          upload: h.upload,
          remove: h.remove,
          getPublicUrl: (caminho: string) => ({
            data: {
              publicUrl: `https://novalojagratisaaaaaa.supabase.co/storage/v1/object/public/products/${caminho}`,
            },
          }),
        };
      },
    },
  },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useProducts>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function piramideW(): Piramide {
  return {
    marca: "w",
    copias: [240, 480, 960].map((lado) => ({
      lado: lado as 240 | 480 | 960,
      arquivo: new Blob([`c${lado}`], { type: "image/webp" }),
    })),
  };
}

const foto = () => new File(["x"], "foto.jpg", { type: "image/jpeg" });
const caminhosEnviados = () =>
  h.upload.mock.calls.map(([caminho]) => caminho as string);

describe("uploadProductImages com a pirâmide", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api;

  beforeEach(async () => {
    h.upload.mockReset().mockResolvedValue({ error: null });
    h.remove.mockReset().mockResolvedValue({ data: [], error: null });
    h.erro.mockReset();
    h.buckets.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    function Sonda() {
      const hook = useProducts({ autoFetch: false });
      useEffect(() => {
        api = hook;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("sem opções: o envio de hoje (um arquivo `<uuid>.<ext>`, sem cópia)", async () => {
    const urls = await api.uploadProductImages([foto()]);
    expect(caminhosEnviados()).toHaveLength(1);
    expect(caminhosEnviados()[0]).toMatch(new RegExp(`${UUID.source}\\.jpg$`));
    expect(h.upload.mock.calls[0][2]).toEqual({
      cacheControl: "31536000",
      upsert: false,
    });
    expect(marcaDe(urls[0])).toBeNull();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("com pirâmide: as 3 cópias primeiro, a original marcada por último", async () => {
    const piramide = vi.fn<GerarPiramide>(async () => piramideW());
    const urls = await api.uploadProductImages([foto()], { piramide });

    const caminhos = caminhosEnviados();
    expect(caminhos).toHaveLength(4);
    const base = caminhos[3].replace(/-vw\.jpg$/, "");
    expect(base).toMatch(new RegExp(`${UUID.source}$`));
    expect(caminhos).toEqual([
      `${base}-240.webp`,
      `${base}-480.webp`,
      `${base}-960.webp`,
      `${base}-vw.jpg`,
    ]);
    // As cópias vão com o tipo delas; todas com cache de um ano, sem sobrescrever.
    for (const [, arquivo, opcoes] of h.upload.mock.calls.slice(0, 3)) {
      expect((arquivo as File).type).toBe("image/webp");
      expect(opcoes).toMatchObject({ cacheControl: "31536000", upsert: false });
    }
    expect(h.upload.mock.calls[3][2]).toEqual({
      cacheControl: "31536000",
      upsert: false,
    });
    expect(h.buckets.every((b) => b === "products")).toBe(true);
    expect(marcaDe(urls[0])).toBe("w");
    expect(urls[0].endsWith(`${base}-vw.jpg`)).toBe(true);
    expect(piramide).toHaveBeenCalledTimes(1);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("a original marcada só sobe DEPOIS de as 3 cópias terminarem", async () => {
    const pendentes: Array<(v: { error: null }) => void> = [];
    h.upload.mockImplementation(
      (caminho: string) =>
        new Promise((resolve) => {
          if (/-v[wj]\./.test(caminho)) resolve({ error: null });
          else pendentes.push(resolve);
        }),
    );
    const envio = api.uploadProductImages([foto()], {
      piramide: async () => piramideW(),
    });
    await vi.waitFor(() => expect(pendentes).toHaveLength(3));
    expect(caminhosEnviados().some((c) => /-vw\./.test(c))).toBe(false);
    for (const resolver of pendentes) resolver({ error: null });
    const urls = await envio;
    expect(caminhosEnviados()[3]).toMatch(/-vw\.jpg$/);
    expect(marcaDe(urls[0])).toBe("w");
  });

  it("uma cópia falha: apaga as cópias e a original sobe SEM marca (nome de hoje)", async () => {
    h.upload.mockImplementation(async (caminho: string) =>
      caminho.endsWith("-480.webp")
        ? { error: new Error("cota estourada") }
        : { error: null },
    );
    const urls = await api.uploadProductImages([foto()], {
      piramide: async () => piramideW(),
    });

    const caminhos = caminhosEnviados();
    const base = caminhos[0].replace(/-240\.webp$/, "");
    expect(caminhos.slice(0, 3).sort()).toEqual(
      [`${base}-240.webp`, `${base}-480.webp`, `${base}-960.webp`].sort(),
    );
    expect(h.remove).toHaveBeenCalledWith([
      `${base}-240.webp`,
      `${base}-480.webp`,
      `${base}-960.webp`,
    ]);
    expect(caminhos[3]).toBe(`${base}.jpg`);
    expect(caminhos.some((c) => /-v[wj]\./.test(c))).toBe(false);
    expect(urls).toHaveLength(1);
    expect(marcaDe(urls[0])).toBeNull();
    expect(h.erro).not.toHaveBeenCalled();
  });

  it("uma cópia LANÇA (rede): mesmo desfecho, original sem marca", async () => {
    h.upload.mockImplementation(async (caminho: string) => {
      if (caminho.endsWith("-960.webp")) throw new Error("rede caiu");
      return { error: null };
    });
    const urls = await api.uploadProductImages([foto()], {
      piramide: async () => piramideW(),
    });
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(marcaDe(urls[0])).toBeNull();
    expect(caminhosEnviados()[3]).toMatch(new RegExp(`${UUID.source}\\.jpg$`));
  });

  it("apagar as cópias também falha: a original ainda sobe sem marca", async () => {
    h.upload.mockImplementation(async (caminho: string) =>
      caminho.endsWith("-240.webp")
        ? { error: new Error("falhou") }
        : { error: null },
    );
    h.remove.mockRejectedValue(new Error("sem rede"));
    const urls = await api.uploadProductImages([foto()], {
      piramide: async () => piramideW(),
    });
    expect(urls).toHaveLength(1);
    expect(marcaDe(urls[0])).toBeNull();
  });

  it("a original marcada falha: apaga as cópias e o envio falha como hoje", async () => {
    h.upload.mockImplementation(async (caminho: string) =>
      /-vw\./.test(caminho)
        ? { error: new Error("falhou a original") }
        : { error: null },
    );
    const urls = await api.uploadProductImages([foto()], {
      piramide: async () => piramideW(),
    });
    const caminhos = caminhosEnviados();
    const base = caminhos[3].replace(/-vw\.jpg$/, "");
    expect(h.remove).toHaveBeenCalledWith([
      `${base}-240.webp`,
      `${base}-480.webp`,
      `${base}-960.webp`,
    ]);
    expect(urls).toEqual([]);
    expect(h.erro).toHaveBeenCalledWith("Erro ao enviar imagem foto.jpg");
  });

  it.each<[string, GerarPiramide]>([
    ["gerador devolve null", async () => null],
    [
      "gerador lança",
      async () => {
        throw new Error("canvas");
      },
    ],
    [
      "só 2 cópias",
      async () => ({ ...piramideW(), copias: piramideW().copias.slice(0, 2) }),
    ],
    [
      "lados fora de ordem",
      async () => ({
        ...piramideW(),
        copias: [...piramideW().copias].reverse(),
      }),
    ],
    ["marca desconhecida", async () => ({ ...piramideW(), marca: "x" as "w" })],
  ])("%s: sobe só a original sem marca, sem cópia", async (_caso, piramide) => {
    const urls = await api.uploadProductImages([foto()], { piramide });
    expect(caminhosEnviados()).toHaveLength(1);
    expect(caminhosEnviados()[0]).toMatch(new RegExp(`${UUID.source}\\.jpg$`));
    expect(marcaDe(urls[0])).toBeNull();
  });

  it("extensão que o leitor da marca não reconhece: sem pirâmide", async () => {
    const piramide = vi.fn<GerarPiramide>(async () => piramideW());
    const semPonto = new File(["x"], "IMG_1234", { type: "image/jpeg" });
    const urls = await api.uploadProductImages([semPonto], { piramide });
    expect(caminhosEnviados()).toHaveLength(1);
    expect(marcaDe(urls[0])).toBeNull();
    expect(piramide).not.toHaveBeenCalled();
  });

  it("várias fotos: cada uma com a sua pirâmide, numa base própria", async () => {
    const urls = await api.uploadProductImages([foto(), foto()], {
      piramide: async () => piramideW(),
    });
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => marcaDe(u) === "w")).toBe(true);
    expect(urls[0]).not.toBe(urls[1]);
    expect(caminhosEnviados()).toHaveLength(8);
  });
});
