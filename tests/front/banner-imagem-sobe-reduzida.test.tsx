// @vitest-environment jsdom
//
// A foto do banner subia CRUA: o arquivo do jeito que saiu do celular (vários
// MB) ia inteiro ao Storage — e, como a loja IKCOUS não tem redimensionamento
// no servidor (src/lib/imageUrl.ts), toda cliente baixava a foto inteira na
// tela inicial. A foto de produto já é reduzida antes do envio
// (`redimensionarImagem`); o banner passa a usar o mesmo utilitário.
//
// Este teste roda o hook REAL (`useBanners`) e o utilitário REAL; só o que o
// jsdom não tem é dublado: decodificação (`createImageBitmap`), canvas e o
// Storage. O que o Storage recebe é o que se afirma aqui.
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

const MB = 1024 * 1024;

/** Um File com o PESO que se quer, sem alocar o conteúdo todo. */
function arquivoComPeso(nome: string, tipo: string, bytes: number): File {
  const arquivo = new File(["x"], nome, { type: tipo });
  Object.defineProperty(arquivo, "size", { value: bytes });
  return arquivo;
}

describe("foto do banner sobe reduzida", () => {
  let desmontar: () => Promise<void>;
  let uploadBannerImage: (file: File) => Promise<string>;
  let canvasCriado: { width: number; height: number } | null;
  let pesoDoCanvas: number;

  beforeEach(async () => {
    h.upload.mockReset().mockResolvedValue({ error: null });
    canvasCriado = null;
    pesoDoCanvas = 300 * 1024;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Canvas "de mentira": guarda o tamanho pedido e devolve um Blob do
    // tipo pedido com o peso que o teste escolheu.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, cb, tipo) {
        canvasCriado = { width: this.width, height: this.height };
        const blob = new Blob(["r"], { type: tipo ?? "image/png" });
        Object.defineProperty(blob, "size", { value: pesoDoCanvas });
        cb(blob);
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

  function decodificaComo(largura: number, altura: number) {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: largura, height: altura, close() {} }),
    );
  }

  function arquivoEnviado(): File {
    expect(h.upload).toHaveBeenCalledTimes(1);
    return h.upload.mock.calls[0][1] as File;
  }

  it("foto grande do celular (JPEG de 5 MB, 4000x3000) sai menor, em 1600 px e com tipo aceito", async () => {
    decodificaComo(4000, 3000);
    const original = arquivoComPeso("foto.jpg", "image/jpeg", 5 * MB);

    await act(async () => {
      await uploadBannerImage(original);
    });

    const enviado = arquivoEnviado();
    expect(enviado).not.toBe(original);
    expect(enviado.size).toBeLessThan(original.size);
    expect(enviado.type).toBe("image/jpeg");
    expect(canvasCriado).toEqual({ width: 1600, height: 1200 });
  });

  it("o File enviado é válido: nome e extensão coerentes com o tipo", async () => {
    decodificaComo(3000, 4000);
    const original = arquivoComPeso("Promo Verao.jpeg", "image/jpeg", 3 * MB);

    await act(async () => {
      await uploadBannerImage(original);
    });

    const enviado = arquivoEnviado();
    expect(enviado).toBeInstanceOf(File);
    expect(enviado.name).toBe("Promo Verao.jpeg");
    expect(enviado.type).toBe("image/jpeg");
    // retrato: o lado maior (altura) é que fica em 1600
    expect(canvasCriado).toEqual({ width: 1200, height: 1600 });
    // o caminho gravado no Storage mantém a extensão do arquivo
    expect(h.upload.mock.calls[0][0]).toMatch(/\.jpeg$/);
  });

  it("PNG grande continua PNG (a transparência do banner sobrevive)", async () => {
    decodificaComo(2400, 1200);
    const original = arquivoComPeso("arte.png", "image/png", 4 * MB);

    await act(async () => {
      await uploadBannerImage(original);
    });

    const enviado = arquivoEnviado();
    expect(enviado.type).toBe("image/png");
    expect(enviado.name).toBe("arte.png");
    expect(enviado.size).toBeLessThan(original.size);
    expect(h.upload.mock.calls[0][0]).toMatch(/\.png$/);
  });

  it("imagem pequena em dimensão NÃO é ampliada", async () => {
    decodificaComo(800, 400);
    const original = arquivoComPeso("pequena.jpg", "image/jpeg", 900 * 1024);

    await act(async () => {
      await uploadBannerImage(original);
    });

    expect(canvasCriado).toEqual({ width: 800, height: 400 });
  });

  it("imagem leve (abaixo de 400 KB) passa intacta, sem canvas", async () => {
    decodificaComo(4000, 3000);
    const original = arquivoComPeso("leve.jpg", "image/jpeg", 100 * 1024);

    await act(async () => {
      await uploadBannerImage(original);
    });

    expect(arquivoEnviado()).toBe(original);
    expect(canvasCriado).toBeNull();
  });

  it("se a redução não encolhe o arquivo, sobe o original", async () => {
    decodificaComo(4000, 3000);
    pesoDoCanvas = 6 * MB;
    const original = arquivoComPeso("foto.jpg", "image/jpeg", 5 * MB);

    await act(async () => {
      await uploadBannerImage(original);
    });

    expect(arquivoEnviado()).toBe(original);
  });

  it("falha ao decodificar: sobe o ORIGINAL, sem erro para o lojista", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("formato não suportado")),
    );
    const original = arquivoComPeso("foto.jpg", "image/jpeg", 5 * MB);

    let url = "";
    await act(async () => {
      url = await uploadBannerImage(original);
    });

    expect(arquivoEnviado()).toBe(original);
    expect(url).toMatch(/^https:\/\/loja\.test\/banners\//);
  });

  it.each([
    ["animacao.gif", "image/gif"],
    ["vetor.svg", "image/svg+xml"],
    ["recorte.webp", "image/webp"],
  ])(
    "%s passa intacto (rasterizar mataria o GIF animado e o SVG)",
    async (nome, tipo) => {
      decodificaComo(4000, 3000);
      const original = arquivoComPeso(nome, tipo, 5 * MB);

      await act(async () => {
        await uploadBannerImage(original);
      });

      expect(arquivoEnviado()).toBe(original);
      expect(canvasCriado).toBeNull();
    },
  );
});
