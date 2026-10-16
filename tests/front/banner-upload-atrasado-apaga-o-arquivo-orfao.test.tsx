// @vitest-environment jsdom
// O upload descartado deve apagar somente o arquivo que ele criou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadBannerImage = vi.fn<(file: File) => Promise<string>>();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastDismiss = vi.fn();
const toastLoading = vi.fn(() => "toast-upload");
const banners = [
  {
    id: "banner-a",
    title: "",
    imageUrl: "https://loja.test/banner-a.jpg",
    link: "",
    position: "home_top" as const,
    active: true,
    order: 1,
  },
  {
    id: "banner-b",
    title: "",
    imageUrl: "https://loja.test/banner-b.jpg",
    link: "",
    position: "home_top" as const,
    active: true,
    order: 2,
  },
];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners,
    isLoaded: true,
    uploadBannerImage,
    addBanner: vi.fn(),
    updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile,
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({}),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    loading: toastLoading,
    dismiss: toastDismiss,
  },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function uploadPendente() {
  let resolver!: (url: string) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<string>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  uploadBannerImage.mockReturnValueOnce(promessa);
  return { resolver, rejeitar };
}

describe("limpeza do arquivo órfão de upload atrasado de banner", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadBannerImage.mockReset();
    updateBanner.mockResolvedValue(undefined);
    deleteStorageFile.mockResolvedValue(undefined);
    toastLoading.mockImplementation(
      () => `toast-${toastLoading.mock.calls.length}`,
    );
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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

  async function montar() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
      await esperarMicrotarefas();
    });
    await act(async () => esperarMicrotarefas());
  }

  async function editar(indice: number) {
    const botao = hospedeiro
      .querySelectorAll<HTMLButtonElement>('button[title="Editar"]')
      .item(indice);
    if (!botao) throw new Error(`Botão Editar ${indice} ausente`);
    await act(async () => botao.click());
    await act(async () => esperarMicrotarefas());
  }

  function botaoComTexto(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === texto,
    );
    if (!botao) throw new Error(`Botão ${texto} ausente`);
    return botao;
  }

  async function clicar(texto: string) {
    await act(async () => botaoComTexto(texto).click());
    await act(async () => esperarMicrotarefas());
  }

  function campoDeUpload() {
    const campo = hospedeiro.querySelector<HTMLInputElement>("#banner-upload");
    if (!campo) throw new Error("Campo de upload ausente");
    return campo;
  }

  async function iniciarUpload(nome: string) {
    const campo = campoDeUpload();
    expect(campo.disabled).toBe(false);
    const arquivo = new File(["imagem"], nome, { type: "image/jpeg" });
    Object.defineProperty(campo, "files", {
      value: [arquivo],
      configurable: true,
    });
    await act(async () => {
      campo.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(uploadBannerImage).toHaveBeenLastCalledWith(arquivo);
    expect(campoDeUpload().disabled).toBe(true);
  }

  function imagemDoEditor() {
    return hospedeiro.querySelector<HTMLImageElement>(
      'img[alt="Preview Thumbnail"]',
    )?.src;
  }

  it("apaga só a URL devolvida pelo upload de A depois de Cancelar e abrir B", async () => {
    await montar();
    await editar(0);
    const upload = uploadPendente();
    await iniciarUpload("nova-a.jpg");
    await clicar("Cancelar");
    await editar(1);
    expect(deleteStorageFile).not.toHaveBeenCalled();

    await act(async () => upload.resolver("https://loja.test/nova-a.jpg"));

    expect(deleteStorageFile.mock.calls).toEqual([
      ["https://loja.test/nova-a.jpg"],
    ]);
    expect(imagemDoEditor()).toBe("https://loja.test/banner-b.jpg");
    expect(campoDeUpload().disabled).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(toastDismiss).toHaveBeenCalledWith("toast-1");
    await clicar("Salvar Banner");
    expect(updateBanner).toHaveBeenCalledWith(
      "banner-b",
      expect.objectContaining({ imageUrl: "https://loja.test/banner-b.jpg" }),
    );
    expect(deleteStorageFile).toHaveBeenCalledTimes(1);
  });

  it("usa a URL do upload atual sem apagar o arquivo", async () => {
    await montar();
    await editar(0);
    const upload = uploadPendente();
    await iniciarUpload("nova-a.jpg");

    await act(async () => upload.resolver("https://loja.test/nova-a.jpg"));

    expect(deleteStorageFile).not.toHaveBeenCalled();
    expect(imagemDoEditor()).toBe("https://loja.test/nova-a.jpg");
    expect(campoDeUpload().disabled).toBe(false);
    expect(toastSuccess).toHaveBeenCalledWith("Imagem enviada com sucesso", {
      id: "toast-1",
    });
    expect(toastError).not.toHaveBeenCalled();
    await clicar("Salvar Banner");
    expect(updateBanner).toHaveBeenCalledWith(
      "banner-a",
      expect.objectContaining({ imageUrl: "https://loja.test/nova-a.jpg" }),
    );
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });

  it("ignora a falha da limpeza sem toast e mantém B utilizável", async () => {
    await montar();
    await editar(0);
    const upload = uploadPendente();
    await iniciarUpload("nova-a.jpg");
    await clicar("Cancelar");
    await editar(1);
    deleteStorageFile.mockRejectedValueOnce(new Error("Falha ao apagar"));

    await act(async () => {
      upload.resolver("https://loja.test/nova-a.jpg");
      await esperarMicrotarefas();
    });

    expect(deleteStorageFile.mock.calls).toEqual([
      ["https://loja.test/nova-a.jpg"],
    ]);
    expect(toastLoading).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(toastDismiss).toHaveBeenCalledWith("toast-1");
    expect(imagemDoEditor()).toBe("https://loja.test/banner-b.jpg");
    expect(campoDeUpload().disabled).toBe(false);
    await clicar("Salvar Banner");
    expect(updateBanner).toHaveBeenCalledWith(
      "banner-b",
      expect.objectContaining({ imageUrl: "https://loja.test/banner-b.jpg" }),
    );
    expect(deleteStorageFile).toHaveBeenCalledTimes(1);
  });

  it("não tenta apagar arquivo quando o upload atrasado falha", async () => {
    await montar();
    await editar(0);
    const upload = uploadPendente();
    await iniciarUpload("nova-a.jpg");
    await clicar("Cancelar");
    await editar(1);

    await act(async () => upload.rejeitar(new Error("Falha de rede")));

    expect(deleteStorageFile).not.toHaveBeenCalled();
    expect(imagemDoEditor()).toBe("https://loja.test/banner-b.jpg");
    expect(campoDeUpload().disabled).toBe(false);
    expect(toastDismiss).toHaveBeenCalledWith("toast-1");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each(["A", "B"] as const)(
    "em uploads sobrepostos apaga só A descartado quando %s termina primeiro",
    async (primeiro) => {
      await montar();
      await editar(0);
      const uploadA = uploadPendente();
      await iniciarUpload("nova-a.jpg");
      await clicar("Cancelar");
      await editar(1);
      const uploadB = uploadPendente();
      await iniciarUpload("nova-b.jpg");
      expect(deleteStorageFile).not.toHaveBeenCalled();

      if (primeiro === "A") {
        await act(async () => uploadA.resolver("https://loja.test/nova-a.jpg"));
        expect(deleteStorageFile.mock.calls).toEqual([
          ["https://loja.test/nova-a.jpg"],
        ]);
        // O upload de B segue no ar: o editor mostra "Enviando Imagem..." no lugar da prévia.
        expect(imagemDoEditor()).toBeUndefined();
        expect(hospedeiro.textContent).toContain("Enviando Imagem...");
        expect(campoDeUpload().disabled).toBe(true);
        await act(async () => uploadB.resolver("https://loja.test/nova-b.jpg"));
      } else {
        await act(async () => uploadB.resolver("https://loja.test/nova-b.jpg"));
        expect(deleteStorageFile).not.toHaveBeenCalled();
        expect(imagemDoEditor()).toBe("https://loja.test/nova-b.jpg");
        expect(campoDeUpload().disabled).toBe(false);
        await act(async () => uploadA.resolver("https://loja.test/nova-a.jpg"));
      }

      expect(deleteStorageFile.mock.calls).toEqual([
        ["https://loja.test/nova-a.jpg"],
      ]);
      expect(imagemDoEditor()).toBe("https://loja.test/nova-b.jpg");
      expect(campoDeUpload().disabled).toBe(false);
      expect(toastError).not.toHaveBeenCalled();
      expect(toastSuccess).toHaveBeenCalledTimes(1);
      expect(toastSuccess).toHaveBeenCalledWith("Imagem enviada com sucesso", {
        id: "toast-2",
      });
      expect(toastDismiss).toHaveBeenCalledWith("toast-1");
    },
  );
});
