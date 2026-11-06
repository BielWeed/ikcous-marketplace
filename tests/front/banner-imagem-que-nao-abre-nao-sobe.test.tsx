// @vitest-environment jsdom
//
// Imagem de banner que o aparelho NÃO abre (arquivo estragado, formato que o
// navegador não decodifica) subia como se estivesse boa e a tela dizia
// "Imagem enviada com sucesso" -- o banner ia ao ar quebrado.
//
// Agora o envio confere que a imagem abre (primeiro por `createImageBitmap`,
// depois, como segunda opinião, pelo próprio <img> do navegador) e recusa com
// o erro `FotoIlegivel`, SEM mandar nada ao armazenamento. Só recusa quando as
// duas conferências falham: se uma não existe ou não consegue conferir, a
// imagem segue (fail-open, como o redimensionamento).
import { useBanners } from "@/hooks/useBanners";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  upload: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload: h.upload,
        getPublicUrl: (caminho: string) => ({
          data: { publicUrl: `https://loja.test/banners/${caminho}` },
        }),
      }),
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function arquivo(nome: string, tipo: string): File {
  const f = new File(["x"], nome, { type: tipo });
  Object.defineProperty(f, "size", { value: 100 * 1024 });
  return f;
}

describe("banner: imagem que não abre não sobe", () => {
  let desmontar: () => Promise<void>;
  let uploadBannerImage: (file: File) => Promise<string>;
  let imagemAbreNoImg: boolean;

  beforeEach(async () => {
    h.upload.mockReset().mockResolvedValue({ error: null });
    imagemAbreNoImg = true;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    URL.createObjectURL = () => "blob:teste";
    URL.revokeObjectURL = () => {};
    // O jsdom não decodifica: o dublê de <img> responde o que o teste manda.
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() =>
            (imagemAbreNoImg ? this.onload : this.onerror)?.(),
          );
        }
      },
    );

    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    function Sonda() {
      const hook = useBanners(true);
      useEffect(() => {
        uploadBannerImage = hook.uploadBannerImage;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
    desmontar = async () => {
      await act(async () => raiz.unmount());
      hospedeiro.remove();
    };
  });

  afterEach(async () => {
    await desmontar();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function enviar(f: File) {
    let erro: unknown;
    await act(async () => {
      try {
        await uploadBannerImage(f);
      } catch (e) {
        erro = e;
      }
    });
    return erro as Error | undefined;
  }

  it("nem o bitmap nem o <img> abrem: recusa com FotoIlegivel e nada vai ao armazenamento", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("não decodifica")),
    );
    imagemAbreNoImg = false;

    const erro = await enviar(arquivo("estragada.jpg", "image/jpeg"));

    expect(erro?.name).toBe("FotoIlegivel");
    expect(h.upload).not.toHaveBeenCalled();
  });

  it.each([
    ["animacao.gif", "image/gif"],
    ["recorte.webp", "image/webp"],
    ["foto.avif", "image/avif"],
  ])(
    "%s (tipo que o redimensionamento nem toca) que não abre também é recusado",
    async (nome, tipo) => {
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn().mockRejectedValue(new Error("não decodifica")),
      );
      imagemAbreNoImg = false;

      const erro = await enviar(arquivo(nome, tipo));

      expect(erro?.name).toBe("FotoIlegivel");
      expect(h.upload).not.toHaveBeenCalled();
    },
  );

  it("sem createImageBitmap, o <img> que não abre basta para recusar", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    imagemAbreNoImg = false;

    const erro = await enviar(arquivo("estragada.png", "image/png"));

    expect(erro?.name).toBe("FotoIlegivel");
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("controle: o bitmap falha mas o <img> abre -> a imagem sobe (nada de recusar foto boa)", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("memória")),
    );
    imagemAbreNoImg = true;
    const original = arquivo("boa.webp", "image/webp");

    const erro = await enviar(original);

    expect(erro).toBeUndefined();
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.upload.mock.calls[0][1]).toBe(original);
  });

  it("controle: o bitmap abre -> sobe, sem nem consultar o <img>", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 800, height: 400, close() {} }),
    );
    imagemAbreNoImg = false; // se o <img> fosse consultado, recusaria
    const original = arquivo("boa.webp", "image/webp");

    const erro = await enviar(original);

    expect(erro).toBeUndefined();
    expect(h.upload).toHaveBeenCalledTimes(1);
  });
});
