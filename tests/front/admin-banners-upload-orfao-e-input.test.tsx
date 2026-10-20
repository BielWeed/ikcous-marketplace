// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadBannerImage = vi.fn<(file: File) => Promise<string>>();
const deleteStorageFile = vi.fn<(url: string) => Promise<void>>();
const updateBanner = vi.fn();
const toastError = vi.fn();
const imagemRecortada = "https://loja.test/recorte.webp";
const imagemEnviada = "https://loja.test/upload.webp";
const banner = {
  id: "banner-a",
  title: "",
  imageUrl: "https://loja.test/publicada.webp",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [banner],
    isLoaded: true,
    uploadBannerImage,
    deleteStorageFile,
    updateBanner,
    addBanner: vi.fn(),
    deleteBanner: vi.fn(),
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useCoupons", () => ({ useCoupons: () => ({}) }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: toastError,
    dismiss: vi.fn(),
    loading: vi.fn(() => "toast-upload"),
  },
}));
// Só a exportação do bitmap é simulada; os dois envios pertencem à view real.
vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: (props: {
    onConfirm: (blob: Blob) => Promise<void>;
    isSubmitting: boolean;
  }) => (
    <button
      type="button"
      data-testid="confirmar-recorte"
      disabled={props.isSubmitting}
      onClick={() =>
        void props.onConfirm(new Blob(["recorte"], { type: "image/webp" }))
      }
    >
      Confirmar recorte
    </button>
  ),
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function pendente<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

describe("uploads de banner limpam a imagem substituída e o seletor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadBannerImage.mockReset();
    deleteStorageFile.mockReset().mockResolvedValue(undefined);
    updateBanner.mockReset().mockResolvedValue(undefined);
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function botao(texto: string) {
    const encontrado = [...hospedeiro.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === texto,
    );
    if (!encontrado) throw new Error(`Botão ${texto} ausente`);
    return encontrado;
  }

  async function clicar(texto: string) {
    await act(async () => botao(texto).click());
    await act(async () => {
      if (["Completo", "3Destino", "✓Conteúdo"].includes(texto)) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      } else await esperar();
    });
  }

  async function abrir(modo: "Simples" | "Completo" = "Simples") {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView active={true} onNavigate={vi.fn()} />);
    });
    const editar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Editar"]',
    );
    if (!editar) throw new Error("Botão Editar ausente");
    await act(async () => editar.click());
    await act(async () => esperar());
    if (modo === "Completo") await clicar("Completo");
  }

  function input() {
    const campo =
      hospedeiro.querySelector<HTMLInputElement>('input[type="file"]');
    if (!campo) throw new Error("Upload ausente");
    return campo;
  }

  function selecionar(
    campo = input(),
    arquivo = new File(["imagem"], "banner.webp", {
      type: "image/webp",
    }),
  ) {
    Object.defineProperty(campo, "files", {
      value: [arquivo],
      configurable: true,
    });
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function imagem() {
    return hospedeiro.querySelector<HTMLImageElement>(
      'img[alt="Preview Thumbnail"], img[alt="Banner Preview"]',
    )?.src;
  }

  it.each(["recorte primeiro", "upload primeiro"] as const)(
    "%s: salva o último resultado e apaga apenas o envio substituído",
    async (ordem) => {
      await abrir();
      await clicar("Ajustar");
      const recorte = pendente<string>();
      const upload = pendente<string>();
      uploadBannerImage
        .mockReturnValueOnce(recorte.promessa)
        .mockReturnValueOnce(upload.promessa);
      await clicar("Confirmar recorte");
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(
        hospedeiro.querySelector('[data-testid="confirmar-recorte"]'),
      ).toBeNull();
      await act(async () => selecionar());
      expect(uploadBannerImage).toHaveBeenCalledTimes(2);

      const primeiro = ordem === "recorte primeiro" ? recorte : upload;
      const segundo = ordem === "recorte primeiro" ? upload : recorte;
      const imagemPrimeira =
        ordem === "recorte primeiro" ? imagemRecortada : imagemEnviada;
      const imagemFinal =
        ordem === "recorte primeiro" ? imagemEnviada : imagemRecortada;
      await act(async () => primeiro.resolver(imagemPrimeira));
      expect(imagem()).toBe(imagemPrimeira);
      expect(deleteStorageFile).not.toHaveBeenCalled();
      await act(async () => segundo.resolver(imagemFinal));
      expect(imagem()).toBe(imagemFinal);
      await clicar("Salvar Banner");

      expect(updateBanner).toHaveBeenCalledWith(
        banner.id,
        expect.objectContaining({ imageUrl: imagemFinal }),
      );
      expect(deleteStorageFile.mock.calls).toEqual([[imagemPrimeira]]);
    },
  );

  it.each(["recorte primeiro", "upload primeiro"] as const)(
    "%s: dois resultados no mesmo lote também limpam o envio substituído",
    async (ordem) => {
      await abrir();
      await clicar("Ajustar");
      const recorte = pendente<string>();
      const upload = pendente<string>();
      uploadBannerImage
        .mockReturnValueOnce(recorte.promessa)
        .mockReturnValueOnce(upload.promessa);
      await clicar("Confirmar recorte");
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      await act(async () => selecionar());
      expect(uploadBannerImage).toHaveBeenCalledTimes(2);
      await act(async () => {
        if (ordem === "recorte primeiro") {
          recorte.resolver(imagemRecortada);
          upload.resolver(imagemEnviada);
        } else {
          upload.resolver(imagemEnviada);
          recorte.resolver(imagemRecortada);
        }
      });
      const imagemFinal =
        ordem === "recorte primeiro" ? imagemEnviada : imagemRecortada;
      const imagemAnterior =
        ordem === "recorte primeiro" ? imagemRecortada : imagemEnviada;
      expect(imagem()).toBe(imagemFinal);
      await clicar("Salvar Banner");
      expect(updateBanner).toHaveBeenCalledWith(
        banner.id,
        expect.objectContaining({ imageUrl: imagemFinal }),
      );
      expect(deleteStorageFile.mock.calls).toEqual([[imagemAnterior]]);
    },
  );

  describe.each(["Simples", "Completo"] as const)("%s", (modo) => {
    it.each(["sucesso", "erro"] as const)(
      "limpa o input após %s e permite selecionar o mesmo File de novo",
      async (resultado) => {
        await abrir(modo);
        const campo = input();
        // jsdom não tem seletor de arquivos. O dublê conserva o caminho e,
        // como o navegador, não emite change ao repetir a seleção não limpa.
        Object.defineProperty(campo, "value", {
          value: "",
          writable: true,
          configurable: true,
        });
        const arquivo = new File(["imagem"], "banner.webp", {
          type: "image/webp",
        });
        const caminho = "C:\\fakepath\\banner.webp";
        const escolherMesmoArquivo = () => {
          if (campo.value === caminho) return;
          campo.value = caminho;
          selecionar(campo, arquivo);
        };
        const envio = pendente<string>();
        uploadBannerImage.mockReturnValueOnce(envio.promessa);
        await act(async () => escolherMesmoArquivo());
        expect(campo.value).toBe(caminho);
        expect(uploadBannerImage).toHaveBeenCalledTimes(1);
        await act(async () => {
          if (resultado === "sucesso") envio.resolver(imagemEnviada);
          else envio.rejeitar(new Error("Falha de rede"));
        });
        if (resultado === "erro") {
          expect(toastError).toHaveBeenCalledWith("Erro ao enviar imagem", {
            id: "toast-upload",
          });
          expect(imagem()).toBe(banner.imageUrl);
        } else expect(imagem()).toBe(imagemEnviada);
        expect(campo.value).toBe("");
        expect(campo.disabled).toBe(false);

        uploadBannerImage.mockResolvedValueOnce(
          "https://loja.test/reenvio.webp",
        );
        await act(async () => escolherMesmoArquivo());
        expect(uploadBannerImage).toHaveBeenCalledTimes(2);
        expect(uploadBannerImage).toHaveBeenLastCalledWith(arquivo);
        expect(campo.value).toBe("");
        expect(imagem()).toBe("https://loja.test/reenvio.webp");
      },
    );
  });
});
