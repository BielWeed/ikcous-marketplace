// @vitest-environment jsdom
//
// Banner e a pirâmide de cópias (plano das miniaturas, 26/11/2026).
//
// ENVIO (`uploadBannerImage(file, { piramide })`): as 3 cópias sobem primeiro e
// a original marcada (`<epoch>-<aleatório>-vw.<ext>`) por último; cópia que
// falha = cópias apagadas e original SEM marca (nome de hoje); original
// marcada que falha = cópias apagadas e o erro sobe, como hoje. Sem
// `opcoes.piramide`, o envio é exatamente o de hoje.
//
// EXCLUSÃO: apagar o arquivo de um banner marcado leva as 3 cópias junto; a
// guarda que impede apagar a imagem que OUTRO banner ainda usa vale também
// para as cópias (nada é apagado).
//
// Hook REAL; Supabase dublado; o gerador é entregue pelo teste.
import { useBanners } from "@/hooks/useBanners";
import type { GerarPiramide, Piramide } from "@/lib/piramide-da-foto-nomes";
import { marcaDe } from "@/lib/piramide-da-foto-nomes";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PASTA =
  "https://novalojagratisaaaaaa.supabase.co/storage/v1/object/public/banners/";
const NOME_MARCADO = "1791565996435-7tdkqgfb019-vw.png";
const COPIAS = [
  "1791565996435-7tdkqgfb019-240.webp",
  "1791565996435-7tdkqgfb019-480.webp",
  "1791565996435-7tdkqgfb019-960.webp",
];

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  linhas: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: async () => {},
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
// O jsdom não decodifica imagem: a conferência "a foto abre?" é dublada.
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));
vi.mock("@/lib/supabase", () => {
  const lista = async () => ({ data: h.linhas, error: null });
  const ordenada = () => ({ order: () => ({ order: lista }) });
  return {
    supabase: {
      from: () => ({
        select: () => ({ ...ordenada(), eq: ordenada }),
        delete: () => ({
          eq: (_c: string, id: string) => ({
            select: async () => ({ data: [{ id }], error: null }),
          }),
        }),
      }),
      storage: {
        from: (bucket: string) => {
          expect(bucket).toBe("banners");
          return {
            upload: h.upload,
            remove: h.remove,
            getPublicUrl: (caminho: string) => ({
              data: { publicUrl: `${PASTA}${caminho}` },
            }),
          };
        },
      },
    },
  };
});

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function piramideW(): Piramide {
  return {
    marca: "w",
    copias: ([240, 480, 960] as const).map((lado) => ({
      lado,
      arquivo: new Blob([`c${lado}`], { type: "image/webp" }),
    })),
  };
}

/** Leve (abaixo de 400 KB): o redimensionamento não passa pelo canvas. */
const foto = () => new File(["x"], "arte.png", { type: "image/png" });
const caminhosEnviados = () =>
  h.upload.mock.calls.map(([caminho]) => caminho as string);

const desmontagens: (() => Promise<void>)[] = [];
async function montar() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const raiz = createRoot(host);
  let atual: ReturnType<typeof useBanners> | undefined;
  function Sonda() {
    const hook = useBanners(true);
    useEffect(() => {
      atual = hook;
    });
    return null;
  }
  const ler = () => {
    if (!atual) throw new Error("Hook não montado");
    return atual;
  };
  desmontagens.push(async () => {
    await act(async () => raiz.unmount());
    host.remove();
  });
  await act(async () => raiz.render(<Sonda />));
  await act(async () => ler().refreshBanners(false, true));
  return ler;
}

describe("useBanners e a pirâmide de cópias", () => {
  beforeEach(() => {
    h.upload.mockReset().mockResolvedValue({ error: null });
    h.remove.mockReset().mockResolvedValue({ data: [], error: null });
    h.linhas = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const desmontar of desmontagens.splice(0)) await desmontar();
    vi.restoreAllMocks();
  });

  describe("envio", () => {
    it("sem opções: o envio de hoje (um arquivo, sem marca)", async () => {
      const ler = await montar();
      let url = "";
      await act(async () => {
        url = await ler().uploadBannerImage(foto());
      });
      expect(caminhosEnviados()).toHaveLength(1);
      expect(caminhosEnviados()[0]).toMatch(/^\d+-[0-9a-z]+\.png$/);
      expect(marcaDe(url)).toBeNull();
    });

    it("com pirâmide: as 3 cópias primeiro e a original marcada por último", async () => {
      const ler = await montar();
      const piramide = vi.fn<GerarPiramide>(async () => piramideW());
      let url = "";
      await act(async () => {
        url = await ler().uploadBannerImage(foto(), { piramide });
      });
      const caminhos = caminhosEnviados();
      expect(caminhos).toHaveLength(4);
      const base = caminhos[3].replace(/-vw\.png$/, "");
      expect(base).toMatch(/^\d+-[0-9a-z]+$/);
      expect(caminhos).toEqual([
        `${base}-240.webp`,
        `${base}-480.webp`,
        `${base}-960.webp`,
        `${base}-vw.png`,
      ]);
      expect(marcaDe(url)).toBe("w");
      expect(h.remove).not.toHaveBeenCalled();
    });

    it("uma cópia falha: apaga as cópias e a original sobe sem marca", async () => {
      const ler = await montar();
      h.upload.mockImplementation(async (caminho: string) =>
        caminho.endsWith("-960.webp")
          ? { error: new Error("cota") }
          : { error: null },
      );
      let url = "";
      await act(async () => {
        url = await ler().uploadBannerImage(foto(), {
          piramide: async () => piramideW(),
        });
      });
      const caminhos = caminhosEnviados();
      const base = caminhos[0].replace(/-240\.webp$/, "");
      expect(h.remove).toHaveBeenCalledWith([
        `${base}-240.webp`,
        `${base}-480.webp`,
        `${base}-960.webp`,
      ]);
      expect(caminhos[3]).toBe(`${base}.png`);
      expect(marcaDe(url)).toBeNull();
    });

    it("a original marcada falha: apaga as cópias e o envio falha como hoje", async () => {
      const ler = await montar();
      h.upload.mockImplementation(async (caminho: string) =>
        /-vw\./.test(caminho)
          ? { error: new Error("falhou") }
          : { error: null },
      );
      let erro: unknown = null;
      await act(async () => {
        await ler()
          .uploadBannerImage(foto(), { piramide: async () => piramideW() })
          .catch((e) => {
            erro = e;
          });
      });
      expect(erro).toBeInstanceOf(Error);
      const base = caminhosEnviados()[3].replace(/-vw\.png$/, "");
      expect(h.remove).toHaveBeenCalledWith([
        `${base}-240.webp`,
        `${base}-480.webp`,
        `${base}-960.webp`,
      ]);
    });

    it("gerador que devolve null: só a original, sem marca", async () => {
      const ler = await montar();
      let url = "";
      await act(async () => {
        url = await ler().uploadBannerImage(foto(), {
          piramide: async () => null,
        });
      });
      expect(caminhosEnviados()).toHaveLength(1);
      expect(marcaDe(url)).toBeNull();
    });
  });

  describe("exclusão", () => {
    it("apagar o arquivo de um banner marcado leva as 3 cópias, numa chamada", async () => {
      const ler = await montar();
      await act(async () => {
        await ler().deleteStorageFile(`${PASTA}${NOME_MARCADO}`);
      });
      expect(h.remove).toHaveBeenCalledExactlyOnceWith([
        NOME_MARCADO,
        ...COPIAS,
      ]);
    });

    it("arquivo sem marca: apaga só ele, como hoje", async () => {
      const ler = await montar();
      await act(async () => {
        await ler().deleteStorageFile(`${PASTA}1791565996435-7tdkqgfb019.png`);
      });
      expect(h.remove).toHaveBeenCalledExactlyOnceWith([
        "1791565996435-7tdkqgfb019.png",
      ]);
    });

    it("na dúvida (consulta na URL marcada): só o arquivo, como hoje", async () => {
      const ler = await montar();
      await act(async () => {
        await ler().deleteStorageFile(`${PASTA}${NOME_MARCADO}?v=2`);
      });
      expect(h.remove).toHaveBeenCalledExactlyOnceWith([NOME_MARCADO]);
    });

    it("excluir banner cuja imagem marcada OUTRO banner usa: nada é apagado, nem as cópias", async () => {
      h.linhas = [
        {
          id: "b1",
          image_url: `${PASTA}${NOME_MARCADO}`,
          position: "home_top",
          active: true,
          order: 1,
        },
        {
          id: "b2",
          image_url: `${PASTA}outra.png`,
          desktop_image_url: `${PASTA}${NOME_MARCADO}`,
          position: "home_top",
          active: true,
          order: 2,
        },
      ];
      const ler = await montar();
      expect(ler().banners).toHaveLength(2);

      await act(async () => {
        await ler().deleteBanner("b1");
      });
      expect(h.remove).not.toHaveBeenCalled();

      await act(async () => {
        await ler().deleteBanner("b2");
      });
      expect(h.remove).toHaveBeenCalledWith(["outra.png"]);
      expect(h.remove).toHaveBeenCalledWith([NOME_MARCADO, ...COPIAS]);
    });
  });
});
