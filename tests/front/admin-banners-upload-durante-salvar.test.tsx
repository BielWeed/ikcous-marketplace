// @vitest-environment jsdom
import type { Banner } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadBannerImage = vi.fn<(file: File) => Promise<string>>();
const deleteStorageFile = vi.fn<(url: string) => Promise<void>>();
const updateBanner =
  vi.fn<(id: string, banner: Partial<Banner>) => Promise<void>>();
const imagemX = "https://loja.test/upload-x.webp";
const imagemY = "https://loja.test/upload-y.webp";
const banner: Banner = {
  id: "banner-a",
  title: "",
  imageUrl: "https://loja.test/original.webp",
  link: "",
  position: "home_top",
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
    error: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(() => "toast-upload"),
  },
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

describe("upload normal e salvar banner não disputam a imagem", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadBannerImage.mockReset().mockResolvedValue(imagemX);
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

  function input() {
    const encontrado =
      hospedeiro.querySelector<HTMLInputElement>('input[type="file"]');
    if (!encontrado) throw new Error("Upload ausente");
    return encontrado;
  }

  function selecionar(campo = input()) {
    Object.defineProperty(campo, "files", {
      value: [new File(["imagem"], "banner.webp", { type: "image/webp" })],
      configurable: true,
    });
    // O change também pode chegar do seletor aberto ANTES do salvamento.
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function imagem() {
    return hospedeiro.querySelector<HTMLImageElement>(
      'img[alt="Preview Thumbnail"], img[alt="Banner Preview"]',
    )?.src;
  }

  async function abrir(modo: "Simples" | "Completo") {
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
    await act(async () => {
      selecionar();
      await esperar();
    });
    expect(imagem()).toBe(imagemX);
  }

  async function destino(modo: "Simples" | "Completo") {
    if (modo === "Completo") await clicar("3Destino");
    return botao(modo === "Completo" ? "Salvar Alterações" : "Salvar Banner");
  }

  it.each(["Simples", "Completo"] as const)(
    "%s: seletor atrasado durante salvar não sobe Y nem apaga X publicada",
    async (modo) => {
      await abrir(modo);
      const salvar = await destino(modo);
      const envio = pendente<void>();
      updateBanner.mockReturnValueOnce(envio.promessa);
      uploadBannerImage.mockResolvedValueOnce(imagemY);
      await act(async () => salvar.click());
      if (modo === "Completo") await clicar("✓Conteúdo");
      const campo = input();
      await act(async () => {
        selecionar(campo);
        await esperar();
      });
      // Sem a guarda, o handler envia Y e a limpeza exclui X em publicação.
      expect(deleteStorageFile).not.toHaveBeenCalled();
      expect(uploadBannerImage).toHaveBeenCalledTimes(1);
      expect(campo.disabled).toBe(true);
      await act(async () => envio.resolver());
      expect(updateBanner).toHaveBeenCalledWith(
        banner.id,
        expect.objectContaining({ imageUrl: imagemX }),
      );
      expect(hospedeiro.querySelector('input[type="file"]')).toBeNull();
    },
  );

  it.each(["Simples", "Completo"] as const)(
    "%s: upload pendente bloqueia salvar (mesmo lote no modo Simples)",
    async (modo) => {
      await abrir(modo);
      const upload = pendente<string>();
      uploadBannerImage.mockReturnValueOnce(upload.promessa);
      if (modo === "Simples") {
        const salvar = botao("Salvar Banner");
        await act(async () => {
          selecionar();
          salvar.click();
        });
      } else {
        // No Completo as etapas desmontam o input: navegar é a trajetória real.
        await act(async () => selecionar());
        await clicar("3Destino");
      }
      expect(updateBanner).not.toHaveBeenCalled();
      expect(botao("Enviando Imagem...").disabled).toBe(true);
      await act(async () => upload.resolver(imagemY));
      if (modo === "Completo") await clicar("✓Conteúdo");
      expect(imagem()).toBe(imagemY);
      const liberado = await destino(modo);
      await act(async () => liberado.click());
      expect(updateBanner).toHaveBeenCalledWith(
        banner.id,
        expect.objectContaining({ imageUrl: imagemY }),
      );
      expect(deleteStorageFile.mock.calls).toEqual([[imagemX]]);
    },
  );

  it("salvar e seletor no mesmo lote usam a guarda síncrona", async () => {
    await abrir("Simples");
    const campo = input();
    const salvar = botao("Salvar Banner");
    const envio = pendente<void>();
    updateBanner.mockReturnValueOnce(envio.promessa);
    await act(async () => {
      salvar.click();
      selecionar(campo);
    });
    expect(uploadBannerImage).toHaveBeenCalledTimes(1);
    expect(deleteStorageFile).not.toHaveBeenCalled();
    await act(async () => envio.resolver());
  });

  it.each(["Simples", "Completo"] as const)(
    "%s: falha de salvar preserva X e rascunho, depois permite upload e nova tentativa",
    async (modo) => {
      await abrir(modo);
      const salvar = await destino(modo);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      });
      const rascunho = localStorage.getItem(
        "admin_banner_form_draft:lojista-1",
      );
      expect(rascunho).toContain(imagemX);
      const envio = pendente<void>();
      updateBanner.mockReturnValueOnce(envio.promessa);
      await act(async () => salvar.click());
      await act(async () =>
        envio.rejeitar(new Error("Falha simulada de rede")),
      );
      expect(deleteStorageFile).not.toHaveBeenCalled();
      expect(localStorage.getItem("admin_banner_form_draft:lojista-1")).toBe(
        rascunho,
      );
      if (modo === "Completo") await clicar("✓Conteúdo");
      expect(input().disabled).toBe(false);
      uploadBannerImage.mockResolvedValueOnce(imagemY);
      await act(async () => {
        selecionar();
        await esperar();
      });
      expect(imagem()).toBe(imagemY);
      const tentarNovamente = await destino(modo);
      await act(async () => tentarNovamente.click());
      expect(updateBanner).toHaveBeenLastCalledWith(
        banner.id,
        expect.objectContaining({ imageUrl: imagemY }),
      );
    },
  );

  it("edição textual durante salvar mantém editor, mas não permite excluir X em publicação", async () => {
    await abrir("Completo");
    const salvar = await destino("Completo");
    const envio = pendente<void>();
    updateBanner.mockReturnValueOnce(envio.promessa);
    await act(async () => salvar.click());
    await clicar("✓Conteúdo");
    const titulo = hospedeiro.querySelector<HTMLInputElement>("#banner-title");
    if (!titulo) throw new Error("Título ausente");
    expect(titulo.disabled).toBe(false);
    const definir = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!definir) throw new Error("Setter de input ausente");
    await act(async () => {
      definir.call(titulo, "Título posterior");
      titulo.dispatchEvent(new Event("input", { bubbles: true }));
      selecionar();
      await esperar();
    });
    expect(uploadBannerImage).toHaveBeenCalledTimes(1);
    expect(deleteStorageFile).not.toHaveBeenCalled();
    await act(async () => envio.resolver());
    expect(titulo.value).toBe("Título posterior");
    // O buffer descarrega em 200 ms; só após o render começa o autosave de 1 s.
    // Um único act de 1100 ms adia esse render até o fim e ainda não grava.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(input().disabled).toBe(false);
    expect(localStorage.getItem("admin_banner_form_draft:lojista-1")).toContain(
      "Título posterior",
    );
    uploadBannerImage.mockResolvedValueOnce(imagemY);
    await act(async () => {
      selecionar();
      await esperar();
    });
    expect(imagem()).toBe(imagemY);
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });

  it("conclusão de upload antigo não libera upload pendente da nova abertura", async () => {
    await abrir("Simples");
    const antigo = pendente<string>();
    uploadBannerImage.mockReturnValueOnce(antigo.promessa);
    await act(async () => selecionar());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await act(async () => esperar());
    const editar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Editar"]',
    );
    if (!editar) throw new Error("Botão Editar ausente");
    await act(async () => editar.click());
    await act(async () => esperar());
    const atual = pendente<string>();
    uploadBannerImage.mockReturnValueOnce(atual.promessa);
    await act(async () => selecionar());
    await act(async () => antigo.resolver("https://loja.test/orfao.webp"));
    await act(async () => botao("Enviando Imagem...").click());
    expect(updateBanner).not.toHaveBeenCalled();
    expect(input().disabled).toBe(true);
    await act(async () => atual.resolver(imagemY));
    expect(input().disabled).toBe(false);
    await act(async () => botao("Salvar Banner").click());
    expect(updateBanner).toHaveBeenCalledWith(
      banner.id,
      expect.objectContaining({ imageUrl: imagemY }),
    );
  });
});
